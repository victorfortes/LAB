/**
 * BI de Prazos dentro do Nexus: a mesma base do painel publicado (prazos, eventos e audiências do Astrea).
 *
 * Quem alimenta é a automação diária (Astrea → planilha → lista final), que entrega a lista INTEIRA por
 * `/api/integracao/agenda`. A carga troca tudo de uma vez, na mesma transação: a tela nunca vê metade.
 * A TV do escritório lê por uma credencial de exibição, que só alcança estas linhas.
 */
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { createHash, randomBytes } from 'node:crypto';
import { auditar } from '../store/conexao.ts';
import type { Identidade } from '../security/sessao.ts';
import { NaoEncontrado, PedidoInvalido } from './erros.ts';

const data = z.string().trim().regex(/^\d{2}\/\d{2}\/\d{4}$/, 'data no formato DD/MM/AAAA');
const texto = (max: number) => z.preprocess((v) => (v === null || v === undefined ? '' : String(v)), z.string().trim().max(max));
const normTipo = (t: unknown) => { const s = String(t ?? 'Prazo').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim(); return s.startsWith('audien') ? 'Audiência' : s.startsWith('evento') ? 'Evento' : 'Prazo'; };
export const EsquemaLinha = z.object({
  tipo: z.preprocess(normTipo, z.enum(['Prazo', 'Evento', 'Audiência'])),
  data, hora: texto(5).refine((h) => !h || /^\d{2}:\d{2}$/.test(h), 'hora HH:MM').optional(),
  caso: texto(500), conclusao: texto(40), juizo: texto(500), numero: texto(60), resp: texto(200), status: texto(60), titulo: texto(500),
});
export const EsquemaCarga = z.object({
  updatedAt: z.string().datetime({ offset: true }),
  rows: z.array(EsquemaLinha).max(30_000),
  /** Liberar uma carga bem menor que a atual (por padrão, abaixo de 90% é recusada). */
  forcar: z.boolean().default(false),
});
export type Linha = z.infer<typeof EsquemaLinha>;

export async function receberCarga(db: PoolClient, organizacaoId: string, d: z.infer<typeof EsquemaCarga>, origem: 'automacao' | 'manual', usuarioId: string) {
  const { rows: [atual] } = await db.query<{ n: number }>('SELECT count(*)::int n FROM bi_agenda_linhas WHERE organizacao_id = $1', [organizacaoId]);
  // Mesma trava da automação do painel: base encolhendo muito de uma vez é sinal de exportação incompleta.
  if (!d.forcar && atual!.n > 50 && d.rows.length < atual!.n * 0.9) {
    throw new PedidoInvalido(`a carga tem ${d.rows.length} linhas e a base atual ${atual!.n}: menos de 90%, recusada por segurança (envie com "forcar": true se for intencional)`);
  }
  await db.query('DELETE FROM bi_agenda_linhas WHERE organizacao_id = $1', [organizacaoId]);
  for (let i = 0; i < d.rows.length; i += 1000) {
    const lote = d.rows.slice(i, i + 1000).map((r, j) => ({ ...r, hora: r.tipo === 'Prazo' ? null : r.hora || null, ordem: i + j }));
    await db.query(`INSERT INTO bi_agenda_linhas (organizacao_id, ordem, tipo, data, hora, caso, conclusao, juizo, numero, resp, status, titulo)
      SELECT $1, x.ordem, x.tipo, x.data, x.hora, x.caso, x.conclusao, x.juizo, x.numero, x.resp, x.status, x.titulo
        FROM jsonb_to_recordset($2::jsonb) AS x(ordem int, tipo text, data text, hora text, caso text, conclusao text, juizo text, numero text, resp text, status text, titulo text)`,
      [organizacaoId, JSON.stringify(lote)]);
  }
  const prazos = d.rows.filter((r) => r.tipo === 'Prazo').length;
  await db.query(`INSERT INTO bi_agenda_cargas (organizacao_id, atualizado_em, total, prazos, eventos, origem, enviado_por) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [organizacaoId, d.updatedAt, d.rows.length, prazos, d.rows.length - prazos, origem, usuarioId]);
  await auditar(db, { organizacaoId, usuarioId, acao: 'bi_prazos.carga', entidade: 'organizacao', entidadeId: organizacaoId, depois: { total: d.rows.length, prazos, origem, antes: atual!.n } });
  return { total: d.rows.length, prazos, eventos: d.rows.length - prazos, antes: atual!.n, updatedAt: d.updatedAt };
}

const COLUNAS = `l.tipo, l.data, nullif(l.hora, '') AS hora, l.caso, l.conclusao, l.juizo, l.numero, l.resp, l.status, l.titulo`;
const limpar = (rows: Record<string, unknown>[]) => rows.map((r) => { const o: Record<string, unknown> = {}; for (const [k, v] of Object.entries(r)) if (v !== null) o[k] = v; return o; });

export async function linhas(db: PoolClient) {
  const { rows } = await db.query<Record<string, unknown>>(`SELECT ${COLUNAS} FROM bi_agenda_linhas l ORDER BY l.ordem`);
  const { rows: [c] } = await db.query<{ atualizado_em: Date; recebido_em: Date; origem: string }>('SELECT atualizado_em, recebido_em, origem FROM bi_agenda_cargas ORDER BY recebido_em DESC LIMIT 1');
  return { updatedAt: c?.atualizado_em ?? null, recebidoEm: c?.recebido_em ?? null, origem: c?.origem ?? null, rows: limpar(rows) };
}

export async function historico(db: PoolClient) {
  return (await db.query('SELECT atualizado_em AS "atualizadoEm", recebido_em AS "recebidoEm", total, prazos, eventos, origem FROM bi_agenda_cargas ORDER BY recebido_em DESC LIMIT 30')).rows;
}

// ------------------------------------------------------------- acesso da TV ---
export const PREFIXO_TV = 'nga_tv_';
const hash = (t: string) => createHash('sha256').update(t).digest('hex');
export const pareceTokenTv = (t: string | null | undefined): t is string => !!t && t.startsWith(PREFIXO_TV) && /^nga_tv_[A-Za-z0-9_-]{40,64}$/.test(t);

export const EsquemaAcessoTv = z.object({ nome: z.string().trim().min(2).max(80).default('TV do escritório'), dias: z.number().int().min(1).max(730).default(365) });
export async function criarAcessoTv(db: PoolClient, d: z.infer<typeof EsquemaAcessoTv>, i: Identidade) {
  const org = i.organizacoes.find((o) => o.tipo === 'escritorio')?.id;
  if (!org) throw new PedidoInvalido('só a equipe do escritório cria acesso de TV');
  const token = PREFIXO_TV + randomBytes(32).toString('base64url');
  const { rows } = await db.query<{ id: string; expira_em: Date }>(`INSERT INTO bi_tv_acessos (organizacao_id, token_hash, nome, criado_por, expira_em) VALUES ($1,$2,$3,$4, now() + make_interval(days => $5)) RETURNING id, expira_em`,
    [org, hash(token), d.nome, i.usuarioId, d.dias]);
  await auditar(db, { organizacaoId: org, usuarioId: i.usuarioId, acao: 'bi_prazos.tv_criada', entidade: 'bi_tv_acesso', entidadeId: rows[0]!.id, depois: { nome: d.nome, dias: d.dias } });
  return { id: rows[0]!.id, token, expiraEm: rows[0]!.expira_em };
}
export async function listarAcessosTv(db: PoolClient) {
  return (await db.query(`SELECT a.id, a.nome, a.criado_em AS "criadoEm", a.expira_em AS "expiraEm", a.ultimo_uso AS "ultimoUso", a.revogado_em AS "revogadoEm", u.nome AS "criadoPor"
    FROM bi_tv_acessos a LEFT JOIN usuarios u ON u.id = a.criado_por ORDER BY a.criado_em DESC`)).rows;
}
export async function revogarAcessoTv(db: PoolClient, id: string, i: Identidade) {
  const { rows } = await db.query<{ organizacao_id: string }>('UPDATE bi_tv_acessos SET revogado_em = now() WHERE id = $1 AND revogado_em IS NULL RETURNING organizacao_id', [id]);
  if (!rows[0]) throw new NaoEncontrado('acesso de TV não encontrado ou já revogado');
  await auditar(db, { organizacaoId: rows[0].organizacao_id, usuarioId: i.usuarioId, acao: 'bi_prazos.tv_revogada', entidade: 'bi_tv_acesso', entidadeId: id });
  return { ok: true };
}
/** Leitura sem sessão: a função do banco confere o hash e devolve só as linhas do BI. */
export async function lerPelaTv(db: PoolClient, token: string) {
  const { rows } = await db.query<{ atualizado_em: Date | null; linhas: unknown[] }>('SELECT atualizado_em, linhas FROM bi_agenda_pela_tv($1)', [hash(token)]);
  if (!rows[0]) return null;
  return { updatedAt: rows[0].atualizado_em, rows: rows[0].linhas };
}
