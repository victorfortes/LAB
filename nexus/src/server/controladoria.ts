/**
 * Controladoria: as publicações do DJEN para as OABs dos sócios.
 *
 * Fonte: a API pública de comunicações do CNJ (comunicaapi.pje.jus.br), sem credencial. O que ela devolve é
 * DADO DE TERCEIROS (o texto da publicação), então é guardado e exibido como texto, nunca interpretado como
 * instrução, e fica restrito a quem tem `controladoria.ler` — uma publicação pode citar outros clientes.
 *
 * O que a coleta NÃO faz: calcular prazo sozinha. O prazo nasce de uma pessoa clicando em "Calcular prazo" com
 * a publicação à vista, porque a contagem exige conferência (feriado local, intimação pessoal, dobra).
 */
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { auditar, type Banco } from '../store/conexao.ts';
import type { Identidade } from '../security/sessao.ts';
import { NaoEncontrado, PedidoInvalido } from './erros.ts';

const URL_DJEN = 'https://comunicaapi.pje.jus.br/api/v1/comunicacao';

export interface ItemDjen {
  id: number; data_disponibilizacao: string; siglaTribunal?: string; tipoComunicacao?: string; nomeOrgao?: string;
  texto: string; numero_processo?: string; link?: string; nomeClasse?: string;
  destinatarios?: Array<{ nome: string; polo?: string }>;
}
export interface PedidoDjen { numeroOab: string; ufOab: string; inicio: string; fim: string; pagina: number; itensPorPagina: number }
export type Buscador = (p: PedidoDjen) => Promise<{ count: number; items: ItemDjen[] }>;

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Busca no DJEN com tentativas: a API responde "muito ocupado" com frequência, e isso não é motivo para desistir. */
export const buscarNoDjen: Buscador = async (p) => {
  const q = new URLSearchParams({
    numeroOab: p.numeroOab, ufOab: p.ufOab, dataDisponibilizacaoInicio: p.inicio, dataDisponibilizacaoFim: p.fim,
    pagina: String(p.pagina), itensPorPagina: String(p.itensPorPagina),
  });
  let ultimo = 'sem resposta';
  for (let tentativa = 0; tentativa < 4; tentativa++) {
    try {
      const r = await fetch(`${URL_DJEN}?${q}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(25_000) });
      const j = await r.json() as { status?: string; message?: string; count?: number; items?: ItemDjen[] };
      if (r.ok && j.status === 'success') return { count: j.count ?? 0, items: j.items ?? [] };
      ultimo = j.message ?? `HTTP ${r.status}`;
    } catch (e) { ultimo = (e as Error).message; }
    await dormir(1500 * (tentativa + 1));
  }
  throw new Error(`DJEN indisponível: ${ultimo}`);
};

export const EsquemaOab = z.object({
  nome: z.string().trim().min(2).max(200),
  numeroOab: z.string().trim().regex(/^\d{1,8}$/, 'só os dígitos do número da OAB'),
  ufOab: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, 'sigla da UF com duas letras'),
});

export async function listarOabs(db: PoolClient) {
  const { rows } = await db.query(
    `SELECT o.id, o.nome, o.numero_oab, o.uf_oab, o.ativo, o.ultima_sincronizacao, o.ultimo_erro,
            (SELECT count(*)::int FROM publicacoes p WHERE o.nome = ANY(p.oabs)) AS publicacoes
       FROM oabs_monitoradas o ORDER BY o.ativo DESC, o.nome`);
  return rows;
}

export async function cadastrarOab(db: PoolClient, d: z.infer<typeof EsquemaOab>, identidade: Identidade) {
  const org = identidade.organizacoes.find((o) => o.tipo === 'escritorio')?.id;
  if (!org) throw new PedidoInvalido('usuário não pertence ao escritório');
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO oabs_monitoradas (organizacao_id, nome, numero_oab, uf_oab, criado_por) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (organizacao_id, numero_oab, uf_oab) DO UPDATE SET nome = EXCLUDED.nome, ativo = TRUE RETURNING id`,
    [org, d.nome, d.numeroOab, d.ufOab, identidade.usuarioId]);
  await auditar(db, { organizacaoId: org, usuarioId: identidade.usuarioId, acao: 'controladoria.oab_cadastrada', entidade: 'oab', entidadeId: rows[0]!.id, depois: { nome: d.nome, oab: `${d.numeroOab}/${d.ufOab}` } });
  return { id: rows[0]!.id };
}

export async function alternarOab(db: PoolClient, id: string, ativo: boolean, identidade: Identidade) {
  const { rows } = await db.query<{ organizacao_id: string; nome: string }>('UPDATE oabs_monitoradas SET ativo = $2 WHERE id = $1 RETURNING organizacao_id, nome', [id, ativo]);
  if (!rows[0]) throw new NaoEncontrado('OAB não encontrada');
  await auditar(db, { organizacaoId: rows[0].organizacao_id, usuarioId: identidade.usuarioId, acao: ativo ? 'controladoria.oab_ativada' : 'controladoria.oab_pausada', entidade: 'oab', entidadeId: id, depois: { nome: rows[0].nome } });
  return { ok: true };
}

const soDigitos = (s: string | undefined) => (s ?? '').replace(/\D/g, '');
const somarDiasISO = (iso: string, n: number) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

export interface ResultadoDaSincronizacao { oab: string; consultadas: number; novas: number; erro: string | null }

/** Sincroniza UMA OAB. Janela: desde 2 dias antes da última sincronização (ou 7 dias na primeira vez) até hoje. */
export async function sincronizarOab(
  db: PoolClient, oab: { id: string; organizacao_id: string; nome: string; numero_oab: string; uf_oab: string; ultima_sincronizacao: Date | null },
  buscar: Buscador, hoje: string, pausa = 700,
): Promise<ResultadoDaSincronizacao> {
  const inicio = oab.ultima_sincronizacao ? somarDiasISO(new Date(oab.ultima_sincronizacao).toISOString().slice(0, 10), -2) : somarDiasISO(hoje, -7);
  let novas = 0; let consultadas = 0;
  try {
    for (let pagina = 1; pagina <= 30; pagina++) {
      const r = await buscar({ numeroOab: oab.numero_oab, ufOab: oab.uf_oab, inicio, fim: hoje, pagina, itensPorPagina: 100 });
      for (const it of r.items) {
        consultadas++;
        const numero = soDigitos(it.numero_processo);
        const { rows } = await db.query<{ nova: boolean }>(
          `INSERT INTO publicacoes (organizacao_id, comunicacao_id, oabs, data_disponibilizacao, tribunal, tipo, orgao, numero_processo, classe, texto, link, destinatarios, processo_id)
           VALUES ($1,$2,ARRAY[$3],$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,
                   (SELECT id FROM processos WHERE $8 <> '' AND regexp_replace(numero,'\\D','','g') = $8 LIMIT 1))
           ON CONFLICT (organizacao_id, comunicacao_id) DO UPDATE
             SET oabs = (SELECT array_agg(DISTINCT x) FROM unnest(publicacoes.oabs || EXCLUDED.oabs) x)
           RETURNING (xmax = 0) AS nova`,
          [oab.organizacao_id, it.id, oab.nome, it.data_disponibilizacao, it.siglaTribunal ?? null, it.tipoComunicacao ?? null, it.nomeOrgao ?? null,
           numero, it.nomeClasse ?? null, it.texto ?? '', it.link ?? null, JSON.stringify(it.destinatarios ?? [])]);
        if (rows[0]?.nova) novas++;
      }
      if (r.items.length < 100 || pagina * 100 >= r.count) break;
      await dormir(pausa);
    }
    await db.query('UPDATE oabs_monitoradas SET ultima_sincronizacao = now(), ultimo_erro = NULL WHERE id = $1', [oab.id]);
    return { oab: `${oab.numero_oab}/${oab.uf_oab}`, consultadas, novas, erro: null };
  } catch (e) {
    const msg = (e as Error).message.slice(0, 300);
    await db.query('UPDATE oabs_monitoradas SET ultimo_erro = $2 WHERE id = $1', [oab.id, msg]);
    return { oab: `${oab.numero_oab}/${oab.uf_oab}`, consultadas, novas, erro: msg };
  }
}

/** Sincroniza todas as OABs ativas (a da organização do usuário). */
export async function sincronizar(db: PoolClient, identidade: Identidade, buscar: Buscador = buscarNoDjen, pausa = 700) {
  const { rows } = await db.query(
    `SELECT id, organizacao_id, nome, numero_oab, uf_oab, ultima_sincronizacao FROM oabs_monitoradas WHERE ativo ORDER BY nome`);
  const hoje = new Date().toISOString().slice(0, 10);
  const resultados: ResultadoDaSincronizacao[] = [];
  for (const oab of rows) resultados.push(await sincronizarOab(db, oab, buscar, hoje, pausa));
  const novas = resultados.reduce((t, r) => t + r.novas, 0);
  if (rows[0]) await auditar(db, { organizacaoId: rows[0].organizacao_id, usuarioId: identidade.usuarioId, acao: 'controladoria.sincronizada', entidade: 'oab', entidadeId: null, depois: { oabs: rows.length, novas } });
  return { resultados, novas };
}

// ------------------------------------------------------------- consulta ---

export const SITUACOES_PUB = ['nova', 'lida', 'tratada', 'descartada'] as const;
export interface FiltroPublicacoes { situacao?: string; oab?: string; q?: string; pagina?: number }

export async function listarPublicacoes(db: PoolClient, f: FiltroPublicacoes = {}) {
  const cond: string[] = []; const args: unknown[] = [];
  if (f.situacao && f.situacao !== 'todas') { args.push(f.situacao); cond.push(`p.situacao = $${args.length}`); }
  else if (!f.situacao) cond.push(`p.situacao <> 'descartada'`);
  if (f.oab) { args.push(f.oab); cond.push(`$${args.length} = ANY(p.oabs)`); }
  if (f.q) { args.push(`%${f.q.replace(/[%_]/g, '')}%`); cond.push(`(p.texto ILIKE $${args.length} OR p.numero_processo ILIKE $${args.length} OR p.orgao ILIKE $${args.length})`); }
  const onde = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
  const { rows } = await db.query(
    `SELECT p.id, p.comunicacao_id, p.oabs, p.data_disponibilizacao, p.tribunal, p.tipo, p.orgao, p.numero_processo, p.classe, p.texto, p.link,
            p.destinatarios, p.processo_id, p.situacao, p.observacao, p.tratada_em, p.criado_em,
            pr.numero AS processo_numero, pr.projeto_id, pj.nome AS projeto, u.nome AS tratada_por_nome
       FROM publicacoes p LEFT JOIN processos pr ON pr.id = p.processo_id LEFT JOIN projetos pj ON pj.id = pr.projeto_id LEFT JOIN usuarios u ON u.id = p.tratada_por
       ${onde} ORDER BY p.data_disponibilizacao DESC, p.comunicacao_id DESC LIMIT 200 OFFSET ${Math.max(0, ((f.pagina ?? 1) - 1) * 200)}`, args);
  const { rows: cont } = await db.query<{ situacao: string; n: number }>(`SELECT situacao, count(*)::int n FROM publicacoes GROUP BY situacao`);
  const por = Object.fromEntries(cont.map((c) => [c.situacao, c.n]));
  return { publicacoes: rows, resumo: { novas: por['nova'] ?? 0, lidas: por['lida'] ?? 0, tratadas: por['tratada'] ?? 0, descartadas: por['descartada'] ?? 0 } };
}

export const EsquemaPublicacaoAtualizacao = z.object({
  situacao: z.enum(SITUACOES_PUB).optional(),
  observacao: z.string().max(2000).nullable().optional(),
  processoId: z.string().uuid().nullable().optional(),
}).refine((d) => Object.keys(d).length > 0, 'nada a atualizar');

export async function atualizarPublicacao(db: PoolClient, id: string, d: z.infer<typeof EsquemaPublicacaoAtualizacao>, identidade: Identidade) {
  const { rows } = await db.query<{ organizacao_id: string; situacao: string }>('SELECT organizacao_id, situacao FROM publicacoes WHERE id = $1', [id]);
  if (!rows[0]) throw new NaoEncontrado('publicação não encontrada');
  const sets: string[] = []; const args: unknown[] = [id];
  const campo = (c: string, v: unknown) => { args.push(v); sets.push(`${c} = $${args.length}`); };
  if (d.observacao !== undefined) campo('observacao', d.observacao);
  if (d.processoId !== undefined) campo('processo_id', d.processoId);
  if (d.situacao !== undefined) {
    campo('situacao', d.situacao);
    if (d.situacao === 'tratada') { campo('tratada_por', identidade.usuarioId); sets.push('tratada_em = now()'); }
    else { sets.push('tratada_por = NULL'); sets.push('tratada_em = NULL'); }
  }
  await db.query(`UPDATE publicacoes SET ${sets.join(', ')} WHERE id = $1`, args);
  await auditar(db, { organizacaoId: rows[0].organizacao_id, usuarioId: identidade.usuarioId, acao: 'controladoria.publicacao_atualizada', entidade: 'publicacao', entidadeId: id, antes: { situacao: rows[0].situacao }, depois: { situacao: d.situacao } });
  return { ok: true };
}

// ------------------------------------------------------- rotina agendada ---

let hashDeServico: string | null = null;

/** Roda a sincronização de todas as organizações com OAB ativa, sem ninguém logado. Nunca lança. */
export async function sincronizarAgendado(banco: Banco, buscar: Buscador = buscarNoDjen): Promise<ResultadoDaSincronizacao[]> {
  const todos: ResultadoDaSincronizacao[] = [];
  try {
    const orgs = await banco.semContexto(async (db) => (await db.query<{ organizacoes_com_oab_ativa: string }>('SELECT organizacoes_com_oab_ativa()')).rows.map((r) => r.organizacoes_com_oab_ativa));
    hashDeServico ??= await Bun.password.hash(crypto.randomUUID() + crypto.randomUUID(), { algorithm: 'argon2id' });
    for (const org of orgs) {
      const usuarioId = await banco.semContexto(async (db) => (await db.query<{ u: string }>('SELECT usuario_de_servico_da_organizacao($1,$2,$3) AS u', [org, 'controladoria', hashDeServico])).rows[0]!.u);
      const identidade: Identidade = { usuarioId, nome: 'Rotina: controladoria', email: 'controladoria@nga.local', papeis: ['integracao'], organizacoes: [{ id: org, nome: '', tipo: 'escritorio', papel: 'integracao' }] };
      const r = await banco.comoUsuario(usuarioId, (db) => sincronizar(db, identidade, buscar));
      todos.push(...r.resultados);
    }
  } catch (e) { console.error('controladoria: rotina agendada falhou:', (e as Error).message); }
  return todos;
}
