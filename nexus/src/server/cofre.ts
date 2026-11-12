/**
 * Cofre de credenciais de sistemas externos (hoje: Astrea).
 *
 * A senha é cifrada no servidor com AES-256-GCM antes de tocar o banco; o banco guarda só
 * `v1:<iv>:<tag>:<cifra>` em base64url. Nenhuma rota devolve a senha: a tela vê o usuário
 * mascarado e a data da última troca. Só rotinas do próprio servidor chamam `abrir`.
 */
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { auditar } from '../store/conexao.ts';
import type { Identidade } from '../security/sessao.ts';
import { PedidoInvalido } from './erros.ts';

const chave = (segredo: string) => createHash('sha256').update(`nga-cofre:${segredo}`).digest();

export function cifrar(texto: string, segredo: string): string {
  const iv = randomBytes(12); const c = createCipheriv('aes-256-gcm', chave(segredo), iv);
  const cifra = Buffer.concat([c.update(texto, 'utf8'), c.final()]);
  return `v1:${iv.toString('base64url')}:${c.getAuthTag().toString('base64url')}:${cifra.toString('base64url')}`;
}
export function decifrar(guardado: string, segredo: string): string {
  const [v, iv, tag, cifra] = guardado.split(':');
  if (v !== 'v1' || !iv || !tag || !cifra) throw new Error('formato do cofre desconhecido');
  const d = createDecipheriv('aes-256-gcm', chave(segredo), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(cifra, 'base64url')), d.final()]).toString('utf8');
}

const mascarar = (u: string) => { const [n, dom] = u.split('@'); return dom ? `${n!.slice(0, 2)}${'•'.repeat(Math.max(1, n!.length - 2))}@${dom}` : `${u.slice(0, 2)}•••`; };

export const EsquemaCredencial = z.object({
  servico: z.enum(['astrea']),
  usuario: z.string().trim().min(3).max(200),
  senha: z.string().min(4).max(200),
});

export async function salvar(db: PoolClient, d: z.infer<typeof EsquemaCredencial>, segredo: string | undefined, i: Identidade) {
  if (!segredo) throw new PedidoInvalido('cofre indisponível neste servidor: configure NGA_COFRE_CHAVE');
  const org = i.organizacoes.find((o) => o.tipo === 'escritorio' && o.papel === 'socio_administrador')?.id;
  if (!org) throw new PedidoInvalido('só a administração do escritório guarda credenciais');
  await db.query(`INSERT INTO cofre_credenciais (organizacao_id, servico, usuario, segredo, atualizado_por) VALUES ($1,$2,$3,$4,$5)
    ON CONFLICT (organizacao_id, servico) DO UPDATE SET usuario = EXCLUDED.usuario, segredo = EXCLUDED.segredo, atualizado_por = EXCLUDED.atualizado_por, atualizado_em = now()`,
    [org, d.servico, d.usuario, cifrar(d.senha, segredo), i.usuarioId]);
  // A auditoria registra QUEM trocou e QUANDO, nunca a senha nem o usuário completo.
  await auditar(db, { organizacaoId: org, usuarioId: i.usuarioId, acao: 'cofre.credencial_salva', entidade: 'organizacao', entidadeId: org, depois: { servico: d.servico, usuario: mascarar(d.usuario) } });
  return { ok: true, servico: d.servico, usuario: mascarar(d.usuario) };
}

export async function estado(db: PoolClient) {
  const { rows } = await db.query<{ servico: string; usuario: string; atualizado_em: Date; quem: string | null }>(
    'SELECT c.servico, c.usuario, c.atualizado_em, u.nome AS quem FROM cofre_credenciais c LEFT JOIN usuarios u ON u.id = c.atualizado_por');
  return rows.map((r) => ({ servico: r.servico, usuario: mascarar(r.usuario), atualizadoEm: r.atualizado_em, atualizadoPor: r.quem }));
}

export async function remover(db: PoolClient, servico: string, i: Identidade) {
  const r = await db.query('DELETE FROM cofre_credenciais WHERE servico = $1 RETURNING organizacao_id', [servico]);
  if (r.rows[0]) await auditar(db, { organizacaoId: r.rows[0].organizacao_id, usuarioId: i.usuarioId, acao: 'cofre.credencial_removida', entidade: 'organizacao', entidadeId: r.rows[0].organizacao_id, depois: { servico } });
  return { ok: true };
}

/** Uso interno (rotinas do servidor). Nunca exposto por rota. */
export async function abrir(db: PoolClient, servico: string, segredo: string) {
  const { rows } = await db.query<{ usuario: string; segredo: string }>('SELECT usuario, segredo FROM cofre_credenciais WHERE servico = $1', [servico]);
  return rows[0] ? { usuario: rows[0].usuario, senha: decifrar(rows[0].segredo, segredo) } : null;
}
