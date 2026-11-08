/**
 * Dar acesso ao portal: convidar o cliente e administrar o que ele enxerga.
 *
 * A senha temporária é gerada AQUI, mostrada uma única vez a quem convidou e
 * gravada só em hash. Não há "ver senha do cliente": o que há é redefinir.
 * Quem convida a repassa por um canal seguro — e o cliente deve trocá-la.
 */
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { auditar } from '../store/conexao.ts';
import { hashDaSenha, type Identidade } from '../security/sessao.ts';
import { NaoEncontrado, PedidoInvalido } from './erros.ts';

export const EsquemaConvite = z.object({
  nome: z.string().trim().min(2).max(200),
  email: z.string().trim().toLowerCase().email().max(200),
  /** Nome da organização cliente; só usado se o projeto ainda não tem portal. */
  organizacao: z.string().trim().min(2).max(200).optional(),
});

export const EsquemaPortal = z.object({
  ativo: z.boolean().optional(),
  mostraDocumentos: z.boolean().optional(),
  mostraObrigacoes: z.boolean().optional(),
  mostraFinanceiro: z.boolean().optional(),
  mostraProcessos: z.boolean().optional(),
}).refine((d) => Object.keys(d).length > 0, 'nada a alterar');

/** 14 caracteres legíveis: sem 0/O/1/l, que se confundem ao ser lidos por telefone. */
function senhaTemporaria(): string {
  const alfabeto = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(14);
  return Array.from(bytes, (b) => alfabeto[b % alfabeto.length]).join('');
}

export async function convidar(
  db: PoolClient, projetoId: string,
  dados: z.infer<typeof EsquemaConvite>, identidade: Identidade,
) {
  const { rows } = await db.query<{ nome: string; organizacao_id: string }>(
    'SELECT nome, organizacao_id FROM projetos WHERE id = $1', [projetoId]);
  const projeto = rows[0];
  if (!projeto) throw new NaoEncontrado('projeto não encontrado');

  const { rows: jaTem } = await db.query<{ n: string }>(
    'SELECT count(*) AS n FROM portal_do_projeto($1)', [projetoId]);
  const temPortal = Number(jaTem[0]!.n) > 0;
  if (!temPortal && !dados.organizacao) {
    throw new PedidoInvalido('informe o nome da organização do cliente: este projeto ainda não tem portal');
  }

  const senha = senhaTemporaria();
  const hash = await hashDaSenha(senha);
  try {
    await db.query('SELECT convidar_cliente($1,$2,$3,$4,$5)',
      [projetoId, dados.organizacao ?? '(portal existente)', dados.email, dados.nome, hash]);
    await db.query('SELECT auth_exigir_troca_senha($1)', [dados.email]);
  } catch (e) {
    const m = (e as Error).message;
    if (m.includes('e-mail já cadastrado')) throw new PedidoInvalido('este e-mail já tem cadastro na plataforma');
    throw e;
  }

  await auditar(db, {
    organizacaoId: projeto.organizacao_id, usuarioId: identidade.usuarioId,
    acao: 'portal.cliente_convidado', entidade: 'projeto', entidadeId: projetoId,
    // A SENHA NÃO VAI PARA A AUDITORIA: a trilha registra quem foi convidado, não a credencial.
    depois: { projeto: projeto.nome, convidado: dados.email, nome: dados.nome },
  });

  return {
    email: dados.email, nome: dados.nome, senhaTemporaria: senha,
    aviso: 'Esta senha aparece uma vez. Repasse por um canal seguro; o cliente deve trocá-la ao entrar.',
  };
}

export async function portalDoProjeto(db: PoolClient, projetoId: string) {
  const { rows } = await db.query<{
    organizacao_id: string; organizacao_nome: string; ativo: boolean;
    mostra_documentos: boolean; mostra_obrigacoes: boolean; mostra_financeiro: boolean;
    mostra_processos: boolean; usuario_id: string | null; usuario_nome: string | null;
    usuario_email: string | null; ultimo_acesso: Date | null;
  }>('SELECT * FROM portal_do_projeto($1)', [projetoId]);
  const primeira = rows[0];
  if (!primeira) return { existe: false as const };
  return {
    existe: true as const,
    organizacao: primeira.organizacao_nome,
    ativo: primeira.ativo,
    mostra: {
      documentos: primeira.mostra_documentos, obrigacoes: primeira.mostra_obrigacoes,
      financeiro: primeira.mostra_financeiro, processos: primeira.mostra_processos,
    },
    usuarios: rows.filter((r) => r.usuario_id).map((r) => ({
      id: r.usuario_id, nome: r.usuario_nome, email: r.usuario_email, ultimoAcesso: r.ultimo_acesso,
    })),
  };
}

export async function ajustarPortal(
  db: PoolClient, projetoId: string,
  dados: z.infer<typeof EsquemaPortal>, identidade: Identidade,
) {
  const colunas: Record<string, string> = {
    ativo: 'ativo', mostraDocumentos: 'mostra_documentos', mostraObrigacoes: 'mostra_obrigacoes',
    mostraFinanceiro: 'mostra_financeiro', mostraProcessos: 'mostra_processos',
  };
  const sets: string[] = []; const args: unknown[] = [projetoId];
  for (const [k, v] of Object.entries(dados)) {
    const coluna = colunas[k]; if (!coluna || v === undefined) continue;
    args.push(v); sets.push(`${coluna} = $${args.length}`);
  }
  const { rowCount } = await db.query(`UPDATE portais SET ${sets.join(', ')} WHERE projeto_id = $1`, args);
  if (!rowCount) throw new NaoEncontrado('este projeto não tem portal');

  const { rows } = await db.query<{ organizacao_id: string; nome: string }>(
    'SELECT organizacao_id, nome FROM projetos WHERE id = $1', [projetoId]);
  await auditar(db, {
    organizacaoId: rows[0]!.organizacao_id, usuarioId: identidade.usuarioId,
    acao: 'portal.ajustado', entidade: 'projeto', entidadeId: projetoId, depois: dados,
  });
  return { ok: true };
}
