/**
 * Parceiros externos no projeto do cliente (trabalhista, tributário, criminal...).
 *
 * O parceiro entra com login próprio (e-mail do escritório dele), vê SÓ os projetos em que foi incluído (RLS 048/077),
 * e dentro deles: processos, documentos e as tarefas da área dele. Não vê QGC, finanças, portal, pauta nem controladoria
 * (RBAC). A equipe do NGA vê tudo o que o parceiro faz (tarefas, documentos e auditoria).
 */
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { auditar } from '../store/conexao.ts';
import type { Identidade } from '../security/sessao.ts';
import { NaoEncontrado, PedidoInvalido } from './erros.ts';
import { hashDaSenha } from '../security/sessao.ts';
import { randomBytes } from 'node:crypto';

export const AREAS = ['trabalhista', 'tributario', 'criminal', 'civel', 'empresarial', 'outra'] as const;
export const ROTULO_AREA: Record<string, string> = { trabalhista: 'Trabalhista', tributario: 'Tributário', criminal: 'Criminal', civel: 'Cível', empresarial: 'Empresarial', outra: 'Outra' };
export const EsquemaConvite = z.object({ nome: z.string().trim().min(2).max(200), email: z.string().trim().email().max(200), area: z.enum(AREAS), escritorio: z.string().trim().max(200).nullable().optional() });

const senhaTemporaria = () => randomBytes(9).toString('base64url');

export async function listar(db: PoolClient, projetoId: string) {
  return (await db.query(`SELECT p.id, p.area, p.escritorio, p.desde, p.ate, u.id "usuarioId", u.nome, u.email, u.ultimo_acesso "ultimoAcesso",
      (SELECT count(*)::int FROM tarefas t WHERE t.projeto_id = p.projeto_id AND t.responsavel_id = u.id AND t.status <> 'concluida') "tarefasAbertas"
     FROM projeto_parceiros p JOIN usuarios u ON u.id = p.usuario_id WHERE p.projeto_id = $1 ORDER BY p.ate NULLS FIRST, u.nome`, [projetoId])).rows;
}

export async function convidar(db: PoolClient, projetoId: string, d: z.infer<typeof EsquemaConvite>, i: Identidade) {
  const senha = senhaTemporaria();
  const { rows } = await db.query<{ usuario_id: string; novo: boolean }>('SELECT * FROM convidar_parceiro($1,$2,$3,$4,$5,$6)', [projetoId, d.email, d.nome, await hashDaSenha(senha), d.area, d.escritorio ?? null])
    .catch((e) => { throw new PedidoInvalido((e as Error).message.replace(/^.*?: /, '')); });
  const r = rows[0]!;
  if (r.novo) await db.query('SELECT auth_exigir_troca_senha($1)', [d.email]).catch(() => undefined);
  const { rows: [p] } = await db.query<{ organizacao_id: string; nome: string }>('SELECT organizacao_id, nome FROM projetos WHERE id = $1', [projetoId]);
  await auditar(db, { organizacaoId: p!.organizacao_id, usuarioId: i.usuarioId, acao: 'projeto.parceiro_convidado', entidade: 'projeto', entidadeId: projetoId, depois: { email: d.email, area: d.area, escritorio: d.escritorio ?? null } });
  return { usuarioId: r.usuario_id, email: d.email, senhaTemporaria: r.novo ? senha : null,
    aviso: r.novo ? 'Senha temporária: aparece só agora. Envie por canal seguro; o parceiro troca no primeiro acesso.' : 'Este parceiro já tinha acesso: o projeto foi incluído no login que ele já usa.' };
}

export async function encerrar(db: PoolClient, id: string, i: Identidade) {
  const { rows } = await db.query<{ organizacao_id: string; projeto_id: string; usuario_id: string }>('UPDATE projeto_parceiros SET ate = now() WHERE id = $1 AND ate IS NULL RETURNING organizacao_id, projeto_id, usuario_id', [id]);
  const r = rows[0]; if (!r) throw new NaoEncontrado('parceiro não encontrado ou já sem acesso');
  await db.query('UPDATE projeto_equipe SET ate = now() WHERE projeto_id = $1 AND usuario_id = $2 AND ate IS NULL', [r.projeto_id, r.usuario_id]);
  await auditar(db, { organizacaoId: r.organizacao_id, usuarioId: i.usuarioId, acao: 'projeto.parceiro_removido', entidade: 'projeto', entidadeId: r.projeto_id, depois: { usuario: r.usuario_id } });
  return { ok: true };
}

/** Para a tela do parceiro: em que projetos e áreas ele atua. */
export async function minhasAreas(db: PoolClient, i: Identidade) {
  return (await db.query(`SELECT p.projeto_id "projetoId", pj.nome projeto, p.area, p.escritorio FROM projeto_parceiros p JOIN projetos pj ON pj.id = p.projeto_id WHERE p.usuario_id = $1 AND p.ate IS NULL`, [i.usuarioId])).rows;
}
