/**
 * BI de Prazos dentro do LAB: a mesma base do painel publicado (prazos, eventos e audiências do Astrea).
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
  // Vindo da API do Astrea (extrator): id, providência, local e a publicação de origem.
  astreaId: z.string().trim().max(40).optional(), detalhe: texto(4000).optional(), local: texto(500).optional(),
  publicacao: z.object({ id: z.string().trim().max(40), data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), texto: z.string().max(12000) }).nullable().optional(),
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
    const lote = d.rows.slice(i, i + 1000).map((r, j) => ({ ...r, hora: r.tipo === 'Prazo' ? null : r.hora || null, ordem: i + j,
      astrea_id: r.astreaId ?? null, detalhe: r.detalhe || null, local: r.local || null,
      publicacao_ref: r.publicacao?.id ?? null, publicacao_data: r.publicacao?.data ?? null, publicacao_texto: r.publicacao?.texto || null, publicacao: undefined }));
    await db.query(`INSERT INTO bi_agenda_linhas (organizacao_id, ordem, tipo, data, hora, caso, conclusao, juizo, numero, resp, status, titulo, astrea_id, detalhe, local, publicacao_ref, publicacao_data, publicacao_texto)
      SELECT $1, x.ordem, x.tipo, x.data, x.hora, x.caso, x.conclusao, x.juizo, x.numero, x.resp, x.status, x.titulo, x.astrea_id, x.detalhe, x.local, x.publicacao_ref, x.publicacao_data, x.publicacao_texto
        FROM jsonb_to_recordset($2::jsonb) AS x(ordem int, tipo text, data text, hora text, caso text, conclusao text, juizo text, numero text, resp text, status text, titulo text,
             astrea_id text, detalhe text, local text, publicacao_ref text, publicacao_data date, publicacao_texto text)`,
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

/**
 * Resumo da agenda do Astrea para o Painel geral: a mesma base do BI de Prazos (prazos, eventos e audiências),
 * contada por urgência em dias úteis, com os próximos vencimentos e o que foi cumprido em cada dia da semana.
 * `nome` filtra o que é da pessoa (responsável no Astrea com o mesmo nome).
 */
export async function painelAgenda(db: PoolClient, nome: string, hojeISO?: string) {
  const { diasUteisAte } = await import('../domain/processo/prazos.ts');
  const hoje = hojeISO ?? new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
  const iso = (br: string) => `${br.slice(6, 10)}-${br.slice(3, 5)}-${br.slice(0, 2)}`;
  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const eu = norm(nome);
  const { rows } = await db.query<{ tipo: string; data: string; hora: string | null; titulo: string; caso: string; numero: string; resp: string; status: string; conclusao: string; juizo: string }>(
    `SELECT tipo, data, hora, titulo, caso, numero, resp, status, conclusao, juizo FROM bi_agenda_linhas`);
  const { rows: [c] } = await db.query<{ recebido_em: Date | null }>('SELECT recebido_em FROM bi_agenda_cargas ORDER BY recebido_em DESC LIMIT 1');
  const FAIXAS = ['atrasada', 'hoje', 'esta_semana', 'adiante'] as const;
  const vazio = () => Object.fromEntries(FAIXAS.map((f) => [f, { total: 0, prazos: 0, eventos: 0 }])) as Record<typeof FAIXAS[number], { total: number; prazos: number; eventos: number }>;
  const todos = vazio(); const meus = vazio();
  const abertos: (typeof rows[number] & { venc: string; dias: number; meu: boolean })[] = [];
  for (const r of rows) {
    if (/conclu|cancel/i.test(r.status)) continue;
    const venc = iso(r.data); const dias = diasUteisAte(hoje, venc);
    const faixa = venc < hoje ? 'atrasada' : venc === hoje ? 'hoje' : dias <= 5 ? 'esta_semana' : 'adiante';
    const meu = !!eu && norm(r.resp) === eu; const campo = r.tipo === 'Prazo' ? 'prazos' : 'eventos';
    todos[faixa].total++; todos[faixa][campo]++;
    if (meu) { meus[faixa].total++; meus[faixa][campo]++; }
    abertos.push({ ...r, venc, dias, meu });
  }
  const futuros = abertos.filter((a) => a.venc >= hoje).sort((a, b) => a.venc.localeCompare(b.venc) || (a.hora ?? '').localeCompare(b.hora ?? ''));
  const item = (a: typeof abertos[number]) => ({ tipo: a.tipo, vencimento: a.venc, hora: a.hora || null, titulo: a.titulo, caso: a.caso, numero: a.numero, responsavel: a.resp, juizo: a.juizo, diasUteis: a.dias, meu: a.meu });
  // Cumpridos por dia (últimos 7 dias), pela data de conclusão no Astrea.
  const dias7 = Array.from({ length: 7 }, (_, i) => new Date(Date.parse(`${hoje}T12:00:00Z`) - (6 - i) * 86_400_000).toISOString().slice(0, 10));
  const porDia = new Map(dias7.map((d) => [d, { total: 0, meus: 0 }]));
  for (const r of rows) {
    if (!/conclu/i.test(r.status) || !/^\d{2}\/\d{2}\/\d{4}$/.test(r.conclusao)) continue;
    const d = porDia.get(iso(r.conclusao)); if (!d) continue;
    d.total++; if (eu && norm(r.resp) === eu) d.meus++;
  }
  return {
    atualizadoEm: c?.recebido_em ?? null, hoje, abertos: abertos.length, meusAbertos: abertos.filter((a) => a.meu).length,
    faixas: todos, faixasMeus: meus,
    proximos: futuros.slice(0, 8).map(item), meusProximos: futuros.filter((a) => a.meu).slice(0, 8).map(item),
    vencidos: abertos.filter((a) => a.venc < hoje).sort((a, b) => a.venc.localeCompare(b.venc)).slice(0, 8).map(item),
    cumpridosPorDia: dias7.map((d) => ({ dia: d, ...porDia.get(d)! })),
  };
}
