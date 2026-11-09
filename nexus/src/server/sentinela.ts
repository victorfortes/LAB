/**
 * NGA Sentinela na nuvem. Cada execução trabalha poucos segundos e guarda onde parou:
 * a fila é durável, então uma função encerrada por limite retoma no minuto seguinte.
 */
import type { PoolClient } from 'pg';
import { z } from 'zod';
import type { Banco } from '../store/conexao.ts';
import { auditar } from '../store/conexao.ts';
import type { Identidade } from '../security/sessao.ts';
import { NaoEncontrado, PedidoInvalido } from './erros.ts';
import { avaliar, consultasDoCliente, RANK, type Classificacao, type ClienteSentinela } from '../domain/sentinela/matcher.ts';
import { normalizar as normalizarNome } from '../domain/sentinela/nomes.ts';
import { limparCnpj, validarCnpj } from '../domain/analise/identificadores.ts';

const URL_DJEN = 'https://comunicaapi.pje.jus.br/api/v1/comunicacao';
const URL_DATAJUD = (t: string) => `https://api-publica.datajud.cnj.jus.br/api_publica_${t}/_search`;
/** Chave pública divulgada pelo CNJ em datajud-wiki.cnj.jus.br/api-publica/acesso. */
const CHAVE_DATAJUD = 'cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==';
const ESTADO_AUTO: Record<Classificacao, string> = { confirmada: 'automatico', provavel: 'pendente', inconclusiva: 'pendente', descartada: 'descartado_auto' };
const AUTOMATICOS = new Set(Object.values(ESTADO_AUTO));
const POR_PAGINA = 100; const TETO = 10_000; const CHUNK = 3; const RESCAN = 7; const MAX_TENTATIVAS = 6; const TAM_TRECHO = 6000; const DIAS_NOVA = 15;
export interface Limites { readonly ms: number; readonly bytes: number }
export const LIMITES_PADRAO: Limites = { ms: 90_000, bytes: 5_000_000 };

const hojeBr = (d: Date) => d.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const horaBr = (d: Date) => Number(d.toLocaleString('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hour12: false }));
const somaDias = (iso: string, n: number) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export function janelas(ini: string, fim: string): [string, string][] { const o: [string, string][] = []; let c = ini; while (c <= fim) { const f = somaDias(c, CHUNK - 1) < fim ? somaDias(c, CHUNK - 1) : fim; o.push([c, f]); c = somaDias(f, 1); } return o; }
export function janelaDaConsulta(ultimoFim: string | null, hoje: string): [string, string] {
  if (!ultimoFim) return [somaDias(hoje, -7), hoje];
  const a = somaDias(ultimoFim, -1), b = somaDias(hoje, -(RESCAN - 1)); return [a < b ? a : b, hoje];
}

class Recusa429 extends Error {}
interface Rodada { fetch: typeof fetch; inicio: number; bytes: number; limites: Limites }

async function cliente(db: PoolClient, id: string): Promise<ClienteSentinela> {
  const { rows: [c] } = await db.query<{ confirmar_por_nome_exato: boolean }>('SELECT confirmar_por_nome_exato FROM sentinela_clientes WHERE id=$1', [id]);
  const nomes = (await db.query<{ nome: string; nome_norm: string; tipo: string }>('SELECT nome,nome_norm,tipo FROM sentinela_nomes WHERE cliente_id=$1 ORDER BY tipo DESC, nome', [id])).rows;
  const cnpjs = (await db.query<{ cnpj: string; tipo: string }>('SELECT cnpj,tipo FROM sentinela_cnpjs WHERE cliente_id=$1 ORDER BY tipo DESC, cnpj', [id])).rows;
  return { nomes, cnpjs, confirmar_por_nome_exato: !!c?.confirmar_por_nome_exato };
}

async function saude(db: PoolClient, org: string, fonte: string, ok: boolean, erro = ''): Promise<void> {
  if (ok) await db.query(`INSERT INTO sentinela_saude(organizacao_id,fonte,estado,ultimo_sucesso) VALUES($1,$2,'operacional',now()) ON CONFLICT(organizacao_id,fonte) DO UPDATE SET estado='operacional',ultimo_sucesso=now(),falhas_consecutivas=0`, [org, fonte]);
  else await db.query(`INSERT INTO sentinela_saude(organizacao_id,fonte,estado,ultima_falha,ultimo_erro,falhas_consecutivas) VALUES($1,$2,'degradado',now(),$3,1) ON CONFLICT(organizacao_id,fonte) DO UPDATE SET estado=CASE WHEN sentinela_saude.falhas_consecutivas+1>=3 THEN 'indisponivel' ELSE 'degradado' END,ultima_falha=now(),ultimo_erro=$3,falhas_consecutivas=sentinela_saude.falhas_consecutivas+1`, [org, fonte, erro.slice(0, 300)]);
}

export async function planejar(db: PoolClient, org: string, agora: Date): Promise<number> {
  const hoje = hojeBr(agora); if (horaBr(agora) < 6) return 0;
  if ((await db.query('SELECT 1 FROM sentinela_tarefas WHERE organizacao_id=$1 AND dia=$2 LIMIT 1', [org, hoje])).rowCount) return 0;
  let n = 0;
  for (const { id } of (await db.query<{ id: string }>('SELECT id FROM sentinela_clientes WHERE organizacao_id=$1 AND ativo ORDER BY criado_em', [org])).rows) {
    for (const q of consultasDoCliente(await cliente(db, id))) {
      const { rows: [u] } = await db.query<{ f: string | null }>(`SELECT to_char(max(fim),'YYYY-MM-DD') f FROM sentinela_tarefas WHERE cliente_id=$1 AND chave=$2 AND status IN ('ok','truncada')`, [id, q.chave]);
      const [a, b] = janelaDaConsulta(u?.f ?? null, hoje);
      for (const [i, f] of janelas(a, b)) n += (await db.query('INSERT INTO sentinela_tarefas(organizacao_id,cliente_id,dia,chave,param,valor,inicio,fim) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING', [org, id, hoje, q.chave, q.param, q.valor, i, f])).rowCount ?? 0;
    }
  }
  return n;
}

async function reivindicar(db: PoolClient, org: string) {
  await db.query(`UPDATE sentinela_tarefas SET status='falha',erro='excedeu o limite de tentativas',atualizado_em=now() WHERE organizacao_id=$1 AND status='executando' AND tentativas>=$2 AND atualizado_em<now()-interval '10 minutes'`, [org, MAX_TENTATIVAS]);
  const { rows } = await db.query<Record<string, any>>(`UPDATE sentinela_tarefas SET status='executando',tentativas=tentativas+1,atualizado_em=now() WHERE id=(SELECT id FROM sentinela_tarefas WHERE organizacao_id=$1 AND (status='pendente' OR (status='executando' AND atualizado_em<now()-interval '10 minutes')) ORDER BY criado_em,id LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *, to_char(inicio,'YYYY-MM-DD') ini, to_char(fim,'YYYY-MM-DD') fi`, [org]);
  return rows[0];
}

async function gravarAchado(db: PoolClient, org: string, clienteId: string, com: any, m: ReturnType<typeof avaliar> & object, chave: string): Promise<'nova' | 'atualizada' | 'igual'> {
  await db.query(`INSERT INTO sentinela_comunicacoes(id,organizacao_id,numero_processo,tribunal,tipo,data_disponibilizacao,classe,orgao,link,trecho,destinatarios) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT DO NOTHING`,
    [com.id, org, com.numero_processo, com.tribunal, com.tipo, com.data_disponibilizacao, com.classe, com.orgao, com.link, com.texto.slice(0, TAM_TRECHO), JSON.stringify(com.destinatarios)]);
  const { rows: [p] } = await db.query<{ id: string }>(`INSERT INTO sentinela_processos(organizacao_id,numero_processo,tribunal,classe,orgao) VALUES($1,$2,$3,$4,$5) ON CONFLICT(organizacao_id,numero_processo) DO UPDATE SET ultima_verificacao=now() RETURNING id`, [org, com.numero_processo, com.tribunal, com.classe, com.orgao]);
  const ev = JSON.stringify({ ...m.evidencia, comunicacao_id: com.id, tipo_comunicacao: com.tipo, data_disponibilizacao: com.data_disponibilizacao, consulta: chave });
  const { rows: [ex] } = await db.query<{ id: string; classificacao: Classificacao; estado_validacao: string }>('SELECT id,classificacao,estado_validacao FROM sentinela_achados WHERE cliente_id=$1 AND processo_id=$2', [clienteId, p!.id]);
  if (!ex) { await db.query('INSERT INTO sentinela_achados(organizacao_id,cliente_id,processo_id,comunicacao_id,nivel,classificacao,polo,nome_na_fonte,evidencia,estado_validacao) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [org, clienteId, p!.id, com.id, m.nivel, m.classificacao, m.polo, m.nome_na_fonte, ev, ESTADO_AUTO[m.classificacao]]); return 'nova'; }
  // Decisão de pessoa nunca é sobrescrita pela máquina.
  if (AUTOMATICOS.has(ex.estado_validacao) && RANK[m.classificacao] > RANK[ex.classificacao]) { await db.query('UPDATE sentinela_achados SET comunicacao_id=$2,nivel=$3,classificacao=$4,polo=$5,nome_na_fonte=$6,evidencia=$7,estado_validacao=$8,ultima_verificacao=now() WHERE id=$1', [ex.id, com.id, m.nivel, m.classificacao, m.polo, m.nome_na_fonte, ev, ESTADO_AUTO[m.classificacao]]); return 'atualizada'; }
  await db.query('UPDATE sentinela_achados SET ultima_verificacao=now() WHERE id=$1', [ex.id]); return 'igual';
}

async function pagina(r: Rodada, t: Record<string, any>) {
  const q = new URLSearchParams({ [t.param]: t.valor, itensPorPagina: String(POR_PAGINA), pagina: String(t.pagina), dataDisponibilizacaoInicio: t.ini, dataDisponibilizacaoFim: t.fi });
  const resp = await r.fetch(`${URL_DJEN}?${q}`, { headers: { accept: 'application/json', 'user-agent': 'NGA-Sentinela/1.0' }, signal: AbortSignal.timeout(30_000) });
  if (resp.status === 429) throw new Recusa429('DJEN pediu para aguardar (429)');
  if (!resp.ok) throw new Error(`DJEN HTTP ${resp.status}`);
  const corpo = await resp.text(); r.bytes += corpo.length;
  const d = JSON.parse(corpo) as { status?: string; count?: number; items?: Record<string, any>[] };
  if (d.status !== 'success') throw new Error('resposta inesperada do DJEN');
  return { total: d.count ?? 0, itens: d.items ?? [] };
}

async function processarTarefa(db: PoolClient, r: Rodada, org: string, t: Record<string, any>) {
  let res;
  try { res = await pagina(r, t); await saude(db, org, 'djen', true); }
  catch (e) {
    const msg = (e as Error).message; await saude(db, org, 'djen', false, msg);
    if (e instanceof Recusa429) { await db.query(`UPDATE sentinela_tarefas SET status='pendente',tentativas=greatest(tentativas-1,0),erro=$2,atualizado_em=now() WHERE id=$1`, [t.id, msg]); return { novas: 0, pausar: true }; }
    await db.query(`UPDATE sentinela_tarefas SET status=$2,erro=$3,atualizado_em=now() WHERE id=$1`, [t.id, t.tentativas >= MAX_TENTATIVAS ? 'falha' : 'pendente', msg.slice(0, 300)]); return { novas: 0 };
  }
  const c = await cliente(db, t.cliente_id); let novas = 0;
  for (const it of res.itens) {
    if (String(it.numero_processo ?? '').length !== 20) continue;
    const com = { id: String(it.id), numero_processo: it.numero_processo, tribunal: it.siglaTribunal ?? null, tipo: it.tipoComunicacao ?? null, data_disponibilizacao: it.data_disponibilizacao ?? null, classe: it.nomeClasse ?? null, orgao: it.nomeOrgao ?? null, link: it.link ?? null, texto: String(it.texto ?? ''), destinatarios: (it.destinatarios ?? []).map((d: any) => ({ nome: d.nome, polo: d.polo })) };
    const m = avaliar(c, com); if (m && (await gravarAchado(db, org, t.cliente_id, com, m, t.chave)) === 'nova') novas++;
  }
  const lidos = t.lidos + res.itens.length;
  if (res.total >= TETO && t.ini < t.fi) {
    for (let d = t.ini; d <= t.fi; d = somaDias(d, 1)) await db.query('INSERT INTO sentinela_tarefas(organizacao_id,cliente_id,dia,chave,param,valor,inicio,fim) VALUES($1,$2,$3,$4,$5,$6,$7,$7) ON CONFLICT DO NOTHING', [org, t.cliente_id, t.dia, t.chave, t.param, t.valor, d]);
    await db.query(`UPDATE sentinela_tarefas SET status='truncada',lidos=$2,total=$3,erro=NULL,atualizado_em=now() WHERE id=$1`, [t.id, lidos, res.total]); return { novas };
  }
  if (res.itens.length && lidos < res.total && t.pagina * POR_PAGINA < TETO) { await db.query(`UPDATE sentinela_tarefas SET status='pendente',pagina=pagina+1,lidos=$2,total=$3,tentativas=0,erro=NULL,atualizado_em=now() WHERE id=$1`, [t.id, lidos, res.total]); return { novas }; }
  await db.query(`UPDATE sentinela_tarefas SET status='ok',lidos=$2,total=$3,erro=NULL,atualizado_em=now() WHERE id=$1`, [t.id, lidos, res.total]);
  await db.query('UPDATE sentinela_clientes SET ultima_verificacao=now() WHERE id=$1', [t.cliente_id]);
  return { novas };
}

// Tribunal que falhou (o DataJud limita com 429) espera 1 hora e não impede os demais de avançar.
const ELEGIVEL = `(p.datajud_status='pendente' OR (p.datajud_status='falha' AND p.ultima_verificacao<now()-interval '1 hour'))`;

async function enriquecer(db: PoolClient, r: Rodada, org: string) {
  const { rows } = await db.query<{ id: string; numero_processo: string; tribunal: string }>(`SELECT p.id,p.numero_processo,p.tribunal FROM sentinela_processos p WHERE p.organizacao_id=$1 AND ${ELEGIVEL} AND p.tribunal = (SELECT tribunal FROM sentinela_processos p WHERE organizacao_id=$1 AND ${ELEGIVEL} AND tribunal ~ '^[A-Za-z0-9]+$' ORDER BY ultima_verificacao LIMIT 1) LIMIT 50`, [org]);
  if (!rows.length) return 0;
  const alias = rows[0]!.tribunal.toLowerCase();
  try {
    const resp = await r.fetch(URL_DATAJUD(alias), { method: 'POST', headers: { authorization: `APIKey ${CHAVE_DATAJUD}`, 'content-type': 'application/json' }, signal: AbortSignal.timeout(30_000), body: JSON.stringify({ size: Math.min(10_000, rows.length * 3), _source: ['numeroProcesso', 'dataAjuizamento', 'grau', 'classe', 'orgaoJulgador', 'sistema', 'assuntos'], query: { terms: { numeroProcesso: rows.map((x) => x.numero_processo) } } }) });
    if (!resp.ok) throw new Error(`DataJud HTTP ${resp.status}`);
    const d = await resp.json() as { hits?: { hits?: { _source: Record<string, any> }[] } }; await saude(db, org, 'datajud', true);
    const por = new Map<string, Record<string, any>[]>(); for (const h of d.hits?.hits ?? []) { const l = por.get(h._source.numeroProcesso) ?? []; l.push(h._source); por.set(h._source.numeroProcesso, l); }
    for (const p of rows) {
      const hs = (por.get(p.numero_processo) ?? []).sort((a, b) => String(a.dataAjuizamento ?? '9').localeCompare(String(b.dataAjuizamento ?? '9')));
      if (!hs.length) { await db.query(`UPDATE sentinela_processos SET datajud_status='nao_encontrado',ultima_verificacao=now() WHERE id=$1`, [p.id]); continue; }
      const s = hs[0]!; const b = String(s.dataAjuizamento ?? ''); const data = /^\d{8}/.test(b) ? `${b.slice(0, 4)}-${b.slice(4, 6)}-${b.slice(6, 8)}` : b.slice(0, 10) || null;
      await db.query(`UPDATE sentinela_processos SET datajud_status='ok',data_ajuizamento=$2,grau=$3,sistema=$4,assuntos=$5,classe=coalesce($6,classe),orgao=coalesce($7,orgao),ultima_verificacao=now() WHERE id=$1`, [p.id, data, s.grau ?? null, s.sistema?.nome ?? null, JSON.stringify((s.assuntos ?? []).map((a: any) => a?.nome).filter(Boolean)), s.classe?.nome ?? null, s.orgaoJulgador?.nome ?? null]);
      await db.query(`UPDATE sentinela_achados SET categoria_data=CASE WHEN $2::date IS NULL THEN 'indeterminada' WHEN identificada_em::date-$2::date<=$3 THEN 'nova_distribuicao' ELSE 'processo_antigo' END WHERE processo_id=$1`, [p.id, data, DIAS_NOVA]);
    }
    return rows.length;
  } catch (e) { await saude(db, org, 'datajud', false, (e as Error).message); await db.query(`UPDATE sentinela_processos SET datajud_status='falha',ultima_verificacao=now() WHERE id=ANY($1::uuid[])`, [rows.map((x) => x.id)]); return 0; }
}

let hashServico: string | undefined;
export async function rotinaSentinela(banco: Banco, opcoes: { fetch?: typeof fetch; agora?: Date; limites?: Limites } = {}) {
  const r: Rodada = { fetch: opcoes.fetch ?? fetch, inicio: Date.now(), bytes: 0, limites: opcoes.limites ?? LIMITES_PADRAO }; const agora = opcoes.agora ?? new Date();
  const orgs = await banco.semContexto(async (db) => (await db.query<{ o: string }>('SELECT organizacoes_com_sentinela() AS o')).rows.map((x) => x.o));
  hashServico ??= await Bun.password.hash(crypto.randomUUID() + crypto.randomUUID(), { algorithm: 'argon2id' });
  const tot = { planejadas: 0, tarefas: 0, novas: 0, enriquecidos: 0, bytes: 0 };
  for (const org of orgs) {
    const uid = await banco.semContexto(async (db) => (await db.query<{ u: string }>('SELECT usuario_de_servico_da_organizacao($1,$2,$3) AS u', [org, 'sentinela', hashServico])).rows[0]!.u);
    tot.planejadas += await banco.comoUsuario(uid, (db) => planejar(db, org, agora));
    let parar = false;
    while (!parar && Date.now() - r.inicio < r.limites.ms && r.bytes < r.limites.bytes) {
      const t = await banco.comoUsuario(uid, (db) => reivindicar(db, org)); if (!t) break;
      tot.tarefas++;
      // Sem lançar de dentro da transação: um erro aqui desfaria a volta da tarefa para a fila.
      const res: { novas: number; pausar?: boolean } = await banco.comoUsuario(uid, (db) => processarTarefa(db, r, org, t));
      tot.novas += res.novas; if (res.pausar) parar = true;
      await new Promise((f) => setTimeout(f, opcoes.fetch ? 0 : 1000)); // a fonte pede moderação
    }
    if (!parar && Date.now() - r.inicio < r.limites.ms && r.bytes < r.limites.bytes) tot.enriquecidos += await banco.comoUsuario(uid, (db) => enriquecer(db, r, org));
  }
  tot.bytes = r.bytes; return tot;
}

// ---------------------------------------------------------------- tela ---
const PENDENTES = ['pendente', 'em_verificacao'];
export async function painel(db: PoolClient, filtro: string) {
  const estados = filtro === 'novas' ? ['automatico', 'confirmado_manual'] : PENDENTES;
  const { rows: itens } = await db.query(`SELECT a.id,a.classificacao,a.nivel,a.polo,a.nome_na_fonte,a.categoria_data,a.estado_validacao,a.identificada_em,a.evidencia->>'regra' regra,a.evidencia->>'trecho' trecho,
      p.numero_processo,p.tribunal,p.classe,p.orgao,p.data_ajuizamento,c.razao_social cliente,m.link,m.tipo comunicacao_tipo
    FROM sentinela_achados a JOIN sentinela_processos p ON p.id=a.processo_id JOIN sentinela_clientes c ON c.id=a.cliente_id LEFT JOIN sentinela_comunicacoes m ON m.organizacao_id=a.organizacao_id AND m.id=a.comunicacao_id
    WHERE a.estado_validacao=ANY($1) ORDER BY ${filtro === 'novas' ? "(a.categoria_data='nova_distribuicao') DESC, a.identificada_em DESC" : "(a.classificacao='provavel') DESC, a.identificada_em DESC"} LIMIT 200`, [estados]);
  const { rows: clientes } = await db.query(`SELECT c.id,c.razao_social,c.nome_fantasia,c.cnpj_matriz,c.ativo,c.confirmar_por_nome_exato,c.ultima_verificacao,count(a.id)::int achados,count(a.id) FILTER (WHERE a.estado_validacao=ANY($1))::int pendentes FROM sentinela_clientes c LEFT JOIN sentinela_achados a ON a.cliente_id=c.id GROUP BY c.id ORDER BY c.razao_social`, [PENDENTES]);
  const { rows: [r] } = await db.query(`SELECT count(*) FILTER (WHERE estado_validacao=ANY($1))::int pendentes, count(*) FILTER (WHERE estado_validacao IN ('automatico','confirmado_manual'))::int confirmadas, count(*) FILTER (WHERE categoria_data='nova_distribuicao')::int novas, count(*) FILTER (WHERE estado_validacao IN ('descartado_auto','descartado_manual'))::int descartadas FROM sentinela_achados`, [PENDENTES]);
  const { rows: fila } = await db.query(`SELECT status,count(*)::int n,to_char(max(atualizado_em) AT TIME ZONE 'America/Sao_Paulo','DD/MM HH24:MI') ultima FROM sentinela_tarefas WHERE dia>=current_date-1 GROUP BY 1`);
  return { itens, clientes, resumo: r, fila, saude: (await db.query(`SELECT fonte,estado,ultimo_sucesso,ultima_falha,ultimo_erro FROM sentinela_saude`)).rows };
}
export const EsquemaDecisao = z.object({ decisao: z.enum(['confirmada', 'descartada']), justificativa: z.string().trim().max(1000).optional() });
export async function decidir(db: PoolClient, id: string, d: z.infer<typeof EsquemaDecisao>, i: Identidade) {
  const { rows: [a] } = await db.query<{ organizacao_id: string; classificacao: string }>('SELECT organizacao_id,classificacao FROM sentinela_achados WHERE id=$1', [id]); if (!a) throw new NaoEncontrado('registro não encontrado');
  await db.query('UPDATE sentinela_achados SET classificacao=$2,estado_validacao=$3,decidido_por=$4,decidido_em=now(),justificativa=$5 WHERE id=$1', [id, d.decisao, d.decisao === 'confirmada' ? 'confirmado_manual' : 'descartado_manual', i.usuarioId, d.justificativa ?? null]);
  await auditar(db, { organizacaoId: a.organizacao_id, usuarioId: i.usuarioId, acao: 'sentinela.decisao', entidade: 'sentinela_achado', entidadeId: id, antes: { classificacao: a.classificacao }, depois: d }); return { ok: true };
}
export const EsquemaClienteSentinela = z.object({ razaoSocial: z.string().trim().min(2).max(300), cnpj: z.string().max(20), nomeFantasia: z.string().trim().max(300).optional(), confirmarPorNomeExato: z.boolean().default(false) });
export async function criarCliente(db: PoolClient, d: z.infer<typeof EsquemaClienteSentinela>, i: Identidade) {
  const org = i.organizacoes.find((o) => o.tipo === 'escritorio')?.id; if (!org) throw new PedidoInvalido('usuário não pertence ao escritório');
  if (!validarCnpj(d.cnpj)) throw new PedidoInvalido('o dígito verificador do CNPJ não confere'); const cnpj = limparCnpj(d.cnpj);
  const { rows: [c] } = await db.query<{ id: string }>('INSERT INTO sentinela_clientes(organizacao_id,razao_social,nome_fantasia,cnpj_matriz,confirmar_por_nome_exato) VALUES($1,$2,$3,$4,$5) RETURNING id', [org, d.razaoSocial, d.nomeFantasia || null, cnpj, d.confirmarPorNomeExato]);
  await db.query(`INSERT INTO sentinela_cnpjs(cliente_id,organizacao_id,cnpj,tipo) VALUES($1,$2,$3,'matriz')`, [c!.id, org, cnpj]);
  for (const [n, t] of [[d.razaoSocial, 'razao_social'], ...(d.nomeFantasia ? [[d.nomeFantasia, 'fantasia']] : [])] as [string, string][]) await db.query('INSERT INTO sentinela_nomes(cliente_id,organizacao_id,nome,nome_norm,tipo) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING', [c!.id, org, n, normalizarNome(n), t]);
  await auditar(db, { organizacaoId: org, usuarioId: i.usuarioId, acao: 'sentinela.cliente_criado', entidade: 'sentinela_cliente', entidadeId: c!.id, depois: { razaoSocial: d.razaoSocial } }); return { id: c!.id };
}
