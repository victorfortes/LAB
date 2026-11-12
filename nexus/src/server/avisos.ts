/**
 * Avisos ao cliente no portal. Hoje nascem do Sentinela (nova ação encontrada contra a empresa): o gatilho
 * do banco cria o aviso como rascunho no projeto do cliente; a NGA revisa o texto e publica. Com o envio
 * automático ligado no projeto, ação CONFIRMADA já sai publicada.
 */
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { auditar } from '../store/conexao.ts';
import type { Identidade } from '../security/sessao.ts';
import { NaoEncontrado } from './erros.ts';

const COLS = `a.id, a.projeto_id AS "projetoId", a.origem, a.titulo, a.texto, a.dados, a.situacao, a.publicado_em AS "publicadoEm", a.lido_em AS "lidoEm", a.criado_em AS "criadoEm"`;

export async function doProjeto(db: PoolClient, projetoId: string) {
  const { rows } = await db.query(`SELECT ${COLS} FROM portal_avisos a WHERE a.projeto_id = $1 AND a.situacao <> 'descartado' ORDER BY a.criado_em DESC LIMIT 50`, [projetoId]);
  const { rows: [p] } = await db.query<{ auto: boolean }>('SELECT sentinela_aviso_automatico AS auto FROM projetos WHERE id = $1', [projetoId]);
  return { avisos: rows, automatico: !!p?.auto };
}

/** Rascunhos de todos os projetos: a fila que a equipe precisa revisar. */
export async function rascunhos(db: PoolClient) {
  return (await db.query(`SELECT ${COLS}, p.nome AS projeto FROM portal_avisos a JOIN projetos p ON p.id = a.projeto_id WHERE a.situacao = 'rascunho' ORDER BY a.criado_em DESC LIMIT 100`)).rows;
}

export const EsquemaPublicar = z.object({ titulo: z.string().trim().min(3).max(300).optional(), texto: z.string().trim().min(10).max(4000).optional() });
export async function publicar(db: PoolClient, id: string, d: z.infer<typeof EsquemaPublicar>, i: Identidade) {
  const { rows } = await db.query<{ organizacao_id: string; projeto_id: string }>(
    `UPDATE portal_avisos SET titulo = coalesce($2, titulo), texto = coalesce($3, texto), situacao = 'publicado', publicado_em = now(), publicado_por = $4 WHERE id = $1 AND situacao <> 'descartado' RETURNING organizacao_id, projeto_id`,
    [id, d.titulo ?? null, d.texto ?? null, i.usuarioId]);
  if (!rows[0]) throw new NaoEncontrado('aviso não encontrado');
  await auditar(db, { organizacaoId: rows[0].organizacao_id, usuarioId: i.usuarioId, acao: 'portal.aviso_publicado', entidade: 'projeto', entidadeId: rows[0].projeto_id, depois: { aviso: id } });
  return { ok: true };
}
export async function descartar(db: PoolClient, id: string, i: Identidade) {
  const { rows } = await db.query<{ organizacao_id: string; projeto_id: string }>(`UPDATE portal_avisos SET situacao = 'descartado' WHERE id = $1 RETURNING organizacao_id, projeto_id`, [id]);
  if (!rows[0]) throw new NaoEncontrado('aviso não encontrado');
  await auditar(db, { organizacaoId: rows[0].organizacao_id, usuarioId: i.usuarioId, acao: 'portal.aviso_descartado', entidade: 'projeto', entidadeId: rows[0].projeto_id, depois: { aviso: id } });
  return { ok: true };
}
export async function configurar(db: PoolClient, projetoId: string, automatico: boolean, i: Identidade) {
  const { rows } = await db.query<{ organizacao_id: string }>('UPDATE projetos SET sentinela_aviso_automatico = $2 WHERE id = $1 RETURNING organizacao_id', [projetoId, automatico]);
  if (!rows[0]) throw new NaoEncontrado('projeto não encontrado');
  await auditar(db, { organizacaoId: rows[0].organizacao_id, usuarioId: i.usuarioId, acao: 'portal.aviso_automatico', entidade: 'projeto', entidadeId: projetoId, depois: { automatico } });
  return { ok: true, automatico };
}

/** Portal do cliente: só o publicado, do mais novo ao mais antigo. */
export async function doPortal(db: PoolClient) {
  return (await db.query(`SELECT ${COLS} FROM portal_avisos a WHERE a.situacao = 'publicado' ORDER BY a.publicado_em DESC LIMIT 30`)).rows;
}
export async function marcarLido(db: PoolClient, id: string) {
  await db.query(`UPDATE portal_avisos SET lido_em = coalesce(lido_em, now()) WHERE id = $1 AND situacao = 'publicado'`, [id]);
  return { ok: true };
}
