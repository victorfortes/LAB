/**
 * NGA Sentinela na nuvem. Cada execução trabalha poucos segundos e guarda onde parou:
 * a fila é durável, então uma função encerrada por limite retoma no minuto seguinte.
 */
import type { PoolClient } from 'pg';
import type { Banco } from '../store/conexao.ts';
import { avaliar, consultasDoCliente, RANK, type Classificacao, type ClienteSentinela } from '../domain/sentinela/matcher.ts';
import { analisarPorRegras, motivoInvisivel, obterConfig, type ComunicacaoAnalise } from './sentinela_regras.ts';

const URL_DJEN = 'https://comunicaapi.pje.jus.br/api/v1/comunicacao';
const URL_DATAJUD = (t: string) => `https://api-publica.datajud.cnj.jus.br/api_publica_${t}/_search`;
/** Chave pública divulgada pelo CNJ em datajud-wiki.cnj.jus.br/api-publica/acesso. */
export const CHAVE_DATAJUD = 'cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==';
const ESTADO_AUTO: Record<Classificacao, string> = { confirmada: 'automatico', provavel: 'pendente', inconclusiva: 'pendente', descartada: 'descartado_auto' };
const AUTOMATICOS = new Set(Object.values(ESTADO_AUTO));
const POR_PAGINA = 100; const TETO = 10_000; const CHUNK = 3; const RESCAN = 7; const MAX_TENTATIVAS = 6; const TAM_TRECHO = 6000;
export interface Limites { readonly ms: number; readonly bytes: number }
export const LIMITES_PADRAO: Limites = { ms: 90_000, bytes: 5_000_000 };

export const hojeBr = (d: Date) => d.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const horaBr = (d: Date) => Number(d.toLocaleString('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hour12: false }));
const somaDias = (iso: string, n: number) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export function janelas(ini: string, fim: string): [string, string][] { const o: [string, string][] = []; let c = ini; while (c <= fim) { const f = somaDias(c, CHUNK - 1) < fim ? somaDias(c, CHUNK - 1) : fim; o.push([c, f]); c = somaDias(f, 1); } return o; }
export function janelaDaConsulta(ultimoFim: string | null, hoje: string): [string, string] {
  if (!ultimoFim) return [somaDias(hoje, -7), hoje];
  const a = somaDias(ultimoFim, -1), b = somaDias(hoje, -(RESCAN - 1)); return [a < b ? a : b, hoje];
}

class Recusa429 extends Error {}
interface Rodada { fetch: typeof fetch; inicio: number; bytes: number; limites: Limites }

export async function cliente(db: PoolClient, id: string): Promise<ClienteSentinela> {
  const { rows: [c] } = await db.query<{ confirmar_por_nome_exato: boolean }>('SELECT confirmar_por_nome_exato FROM sentinela_clientes WHERE id=$1', [id]);
  const nomes = (await db.query<{ nome: string; nome_norm: string; tipo: string }>('SELECT nome,nome_norm,tipo FROM sentinela_nomes WHERE cliente_id=$1 ORDER BY tipo DESC, nome', [id])).rows;
  const cnpjs = (await db.query<{ cnpj: string; tipo: string }>('SELECT cnpj,tipo FROM sentinela_cnpjs WHERE cliente_id=$1 ORDER BY tipo DESC, cnpj', [id])).rows;
  return { nomes, cnpjs, confirmar_por_nome_exato: !!c?.confirmar_por_nome_exato };
}

async function saude(db: PoolClient, org: string, fonte: string, ok: boolean, erro = ''): Promise<void> {
  if (ok) await db.query(`INSERT INTO sentinela_saude(organizacao_id,fonte,estado,ultimo_sucesso) VALUES($1,$2,'operacional',now()) ON CONFLICT(organizacao_id,fonte) DO UPDATE SET estado='operacional',ultimo_sucesso=now(),falhas_consecutivas=0`, [org, fonte]);
  else await db.query(`INSERT INTO sentinela_saude(organizacao_id,fonte,estado,ultima_falha,ultimo_erro,falhas_consecutivas) VALUES($1,$2,'degradado',now(),$3,1) ON CONFLICT(organizacao_id,fonte) DO UPDATE SET estado=CASE WHEN sentinela_saude.falhas_consecutivas+1>=3 THEN 'indisponivel' ELSE 'degradado' END,ultima_falha=now(),ultimo_erro=$3,falhas_consecutivas=sentinela_saude.falhas_consecutivas+1`, [org, fonte, erro.slice(0, 300)]);
}

const INSERIR_TAREFA = 'INSERT INTO sentinela_tarefas(organizacao_id,cliente_id,dia,chave,param,valor,inicio,fim) VALUES($1,$2,$3,$4,$5,$6,$7,$8)';
/** `forcar` devolve à fila a janela já lida hoje: clique manual é para pesquisar de verdade. */
export async function enfileirar(db: PoolClient, org: string, id: string, hoje: string, q: { chave: string; param: string; valor: string }, ini: string, fim: string, forcar = false): Promise<number> {
  let n = 0;
  for (const [i, f] of janelas(ini, fim)) n += (await db.query(`${INSERIR_TAREFA} ON CONFLICT (cliente_id,chave,inicio,fim,dia) DO ${forcar ? "UPDATE SET status='pendente',pagina=1,lidos=0,total=NULL,tentativas=0,erro=NULL,atualizado_em=now() WHERE sentinela_tarefas.status NOT IN ('pendente','executando')" : 'NOTHING'}`, [org, id, hoje, q.chave, q.param, q.valor, i, f])).rowCount ?? 0;
  return n;
}
async function janelaDoCliente(db: PoolClient, id: string, chave: string, hoje: string) {
  const { rows: [u] } = await db.query<{ f: string | null }>(`SELECT to_char(max(fim),'YYYY-MM-DD') f FROM sentinela_tarefas WHERE cliente_id=$1 AND chave=$2 AND status IN ('ok','truncada')`, [id, chave]);
  return janelaDaConsulta(u?.f ?? null, hoje);
}
export async function planejar(db: PoolClient, org: string, agora: Date): Promise<number> {
  const hoje = hojeBr(agora); if (horaBr(agora) < 6) return 0;
  let n = 0;
  // Por cliente, não por escritório: quem acabou de entrar com busca inicial não pode cancelar a rodada dos demais.
  for (const { id } of (await db.query<{ id: string }>(`SELECT c.id FROM sentinela_clientes c WHERE c.organizacao_id=$1 AND c.ativo AND (c.frequencia_horas<=24 OR c.ultima_verificacao IS NULL OR c.ultima_verificacao<now()-make_interval(hours=>c.frequencia_horas)) AND NOT EXISTS (SELECT 1 FROM sentinela_tarefas t WHERE t.cliente_id=c.id AND t.dia=$2) ORDER BY c.criado_em`, [org, hoje])).rows) {
    for (const q of consultasDoCliente(await cliente(db, id))) { const [a, b] = await janelaDoCliente(db, id, q.chave, hoje); n += await enfileirar(db, org, id, hoje, q, a, b); }
  }
  return n;
}
/** "Executar pesquisa agora": refaz a janela normal de cada cliente ativo, ainda que já lida hoje. */
export async function pesquisarAgora(db: PoolClient, org: string, agora: Date): Promise<number> {
  const hoje = hojeBr(agora); let n = 0;
  for (const { id } of (await db.query<{ id: string }>('SELECT id FROM sentinela_clientes WHERE organizacao_id=$1 AND ativo ORDER BY criado_em', [org])).rows)
    for (const q of consultasDoCliente(await cliente(db, id))) { const [a, b] = await janelaDoCliente(db, id, q.chave, hoje); n += await enfileirar(db, org, id, hoje, q, a, b, true); }
  return n;
}
/** Cliente novo ou com nome/CNPJ novo pesquisa o retroativo na hora, sem esperar a rodada do dia seguinte. */
export async function buscaInicial(db: PoolClient, org: string, id: string, agora: Date): Promise<number> {
  const hoje = hojeBr(agora); const { dias_busca_inicial: dias } = await obterConfig(db, org, 'motor'); const ini = (() => { const d = new Date(`${hoje}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - dias); return d.toISOString().slice(0, 10); })();
  let n = 0; for (const q of consultasDoCliente(await cliente(db, id))) n += await enfileirar(db, org, id, hoje, q, ini, hoje); return n;
}

async function reivindicar(db: PoolClient, org: string) {
  await db.query(`UPDATE sentinela_tarefas SET status='falha',erro='excedeu o limite de tentativas',atualizado_em=now() WHERE organizacao_id=$1 AND status='executando' AND tentativas>=$2 AND atualizado_em<now()-interval '10 minutes'`, [org, MAX_TENTATIVAS]);
  const { rows } = await db.query<Record<string, any>>(`UPDATE sentinela_tarefas SET status='executando',tentativas=tentativas+1,atualizado_em=now() WHERE id=(SELECT id FROM sentinela_tarefas WHERE organizacao_id=$1 AND (status='pendente' OR (status='executando' AND atualizado_em<now()-interval '10 minutes')) ORDER BY criado_em,id LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *, to_char(inicio,'YYYY-MM-DD') ini, to_char(fim,'YYYY-MM-DD') fi`, [org]);
  return rows[0];
}

export async function gravarAchado(db: PoolClient, org: string, clienteId: string, com: any, m: ReturnType<typeof avaliar> & object, chave: string): Promise<'nova' | 'atualizada' | 'igual'> {
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

const comunicacaoDoItem = (it: Record<string, any>) => ({ id: String(it.id), numero_processo: it.numero_processo as string, tribunal: it.siglaTribunal ?? null, tipo: it.tipoComunicacao ?? null, data_disponibilizacao: it.data_disponibilizacao ?? null, classe: it.nomeClasse ?? null, orgao: it.nomeOrgao ?? null, link: it.link ?? null, texto: String(it.texto ?? ''), destinatarios: (it.destinatarios ?? []).map((d: any) => ({ nome: d.nome, polo: d.polo })) as { nome: string; polo: string | null }[] });

async function pagina(r: Rodada, t: Record<string, any>) {
  const q = new URLSearchParams({ [t.param]: t.valor, itensPorPagina: String(POR_PAGINA), pagina: String(t.pagina), ...(t.ini ? { dataDisponibilizacaoInicio: t.ini, dataDisponibilizacaoFim: t.fi } : {}) });
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
    const com = comunicacaoDoItem(it);
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
  const { dias_nova_distribuicao: DIAS_NOVA } = await obterConfig(db, org, 'motor');
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

/** Analisa o que é novo. Processo antigo achado agora não gasta análise nem gera alerta. */
export async function analisarAchado(db: PoolClient, org: string, achadoId: string, agora = new Date()) {
  const { rows: [a] } = await db.query<Record<string, any>>(`SELECT a.processo_id,a.polo,p.numero_processo,p.tribunal,p.orgao,p.classe,to_char(p.data_ajuizamento,'YYYY-MM-DD') data_ajuizamento,p.assuntos FROM sentinela_achados a JOIN sentinela_processos p ON p.id=a.processo_id WHERE a.id=$1`, [achadoId]);
  if (!a) return null;
  const coms = (await db.query<ComunicacaoAnalise>(`SELECT coalesce(trecho,'') texto,tipo,tribunal,to_char(data_disponibilizacao,'YYYY-MM-DD') data_disponibilizacao,destinatarios FROM sentinela_comunicacoes WHERE organizacao_id=$1 AND numero_processo=$2 ORDER BY data_disponibilizacao,id`, [org, a.numero_processo])).rows;
  const r = analisarPorRegras({ numero_processo: a.numero_processo, tribunal: a.tribunal, orgao: a.orgao, classe: a.classe, data_ajuizamento: a.data_ajuizamento, assuntos: a.assuntos ?? [], polo: a.polo }, coms, await obterConfig(db, org, 'prioridade'), hojeBr(agora));
  const { rows: [n] } = await db.query<{ id: string }>('INSERT INTO sentinela_analises(organizacao_id,processo_id,campos,resumo,prioridade,urgencia_aparente,requer_analise_imediata,documentos) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id', [org, a.processo_id, JSON.stringify(r.campos), r.resumo, r.prioridade, r.urgencia_aparente, r.requer_analise_imediata, JSON.stringify(r.documentos)]);
  await db.query('UPDATE sentinela_achados SET prioridade=$2 WHERE processo_id=$1', [a.processo_id, r.prioridade]);
  return n!.id;
}
export async function posColeta(db: PoolClient, org: string): Promise<{ analises: number; alertas: number }> {
  const novos = (await db.query<{ id: string }>(`SELECT DISTINCT ON (a.processo_id) a.id FROM sentinela_achados a WHERE a.organizacao_id=$1 AND a.classificacao<>'descartada' AND a.categoria_data IS NOT NULL AND a.categoria_data<>'processo_antigo' AND NOT EXISTS (SELECT 1 FROM sentinela_analises n WHERE n.processo_id=a.processo_id) ORDER BY a.processo_id,a.identificada_em DESC LIMIT 30`, [org])).rows;
  for (const a of novos) await analisarAchado(db, org, a.id);
  const alertas = (await db.query(`INSERT INTO sentinela_alertas(organizacao_id,chave_dedup,tipo,achado_id,payload)
    SELECT a.organizacao_id, t.tipo||':interno:'||a.id, t.tipo, a.id, jsonb_build_object('cliente',c.razao_social,'numero_processo',p.numero_processo,'tribunal',p.tribunal,'data_distribuicao',p.data_ajuizamento,'natureza',p.classe,'prioridade',coalesce(a.prioridade,'não classificada'))
    FROM sentinela_achados a JOIN sentinela_processos p ON p.id=a.processo_id JOIN sentinela_clientes c ON c.id=a.cliente_id
    CROSS JOIN LATERAL (SELECT CASE WHEN a.classificacao='confirmada' AND a.categoria_data='nova_distribuicao' THEN 'nova_acao_confirmada' ELSE 'conferencia_pendente' END tipo) t
    WHERE a.organizacao_id=$1 AND a.classificacao<>'descartada' AND a.categoria_data IS NOT NULL AND a.categoria_data<>'processo_antigo' AND a.identificada_em>now()-interval '3 days'
      AND (t.tipo='nova_acao_confirmada' OR a.estado_validacao IN ('pendente','automatico'))
    ON CONFLICT (organizacao_id,chave_dedup) DO NOTHING`, [org])).rowCount ?? 0;
  return { analises: novos.length, alertas };
}

/** Processos-controle: o único jeito de medir, com casos conhecidos, quanto a pesquisa deixa escapar. */
async function verificarControle(db: PoolClient, r: Rodada, org: string, c: Record<string, any>): Promise<boolean> {
  const fim = async (resultado: string, detalhe: string) => { await db.query('UPDATE sentinela_controle SET resultado=$2,detalhe=$3,verificado_em=now(),verificar=FALSE WHERE id=$1', [c.id, resultado, detalhe]); return false; };
  const naBase = (await db.query(`SELECT 1 FROM sentinela_achados a JOIN sentinela_processos p ON p.id=a.processo_id WHERE p.organizacao_id=$1 AND p.numero_processo=$2 AND a.cliente_id=$3 AND a.classificacao IN ('confirmada','provavel') AND a.evidencia::text NOT LIKE '%numeroProcesso:%' LIMIT 1`, [org, c.numero_processo, c.cliente_id])).rowCount;
  if (naBase) return fim('capturado', 'já está na base como ação contra o cliente');
  let itens: Record<string, any>[];
  try { itens = (await pagina(r, { param: 'numeroProcesso', valor: c.numero_processo, pagina: 1 })).itens; }
  catch (e) { if (e instanceof Recusa429) return true; return fim('erro', (e as Error).message.slice(0, 200)); }
  const coms = itens.filter((i) => String(i.numero_processo ?? '').length === 20).map(comunicacaoDoItem);
  if (!coms.length) return fim('fora_da_fonte', 'o DJEN não tem comunicações deste processo (limite da fonte, não da pesquisa)');
  const { rows: [h] } = await db.query<{ i: string | null }>(`SELECT to_char(min(inicio),'YYYY-MM-DD') i FROM sentinela_tarefas WHERE cliente_id=$1 AND status IN ('ok','truncada')`, [c.cliente_id]);
  const ini = h?.i ?? '9999-12-31'; const dadosCliente = await cliente(db, c.cliente_id);
  const aval = coms.map((com) => ({ com, m: avaliar(dadosCliente, com) }));
  const achados = aval.filter((x) => x.m && (x.m.classificacao === 'confirmada' || x.m.classificacao === 'provavel'));
  const recentes = achados.filter((x) => (x.com.data_disponibilizacao ?? '') >= ini);
  if (achados.length) for (const x of achados) await gravarAchado(db, org, c.cliente_id, x.com, x.m!, `numeroProcesso:${c.numero_processo}`);
  if (recentes.length) return fim('recuperado', 'FALHA NOSSA: o DJEN nomeou o cliente numa comunicação dentro do período pesquisado e a pesquisa não pegou; incluído agora (investigar a causa)');
  if (achados.length) return fim('anterior_ao_historico', `o DJEN só nomeou o cliente antes do início do histórico pesquisado (${ini}): não é falha; incluído agora no histórico`);
  if (aval.some((x) => x.m?.classificacao === 'inconclusiva' && (x.com.data_disponibilizacao ?? '') >= ini)) return fim('revisar', 'o DJEN tem partes parecidas com o cliente, mas sem certeza pelas regras: conferir nomes');
  return fim('invisivel_no_djen', `o DJEN tem comunicações, mas nenhuma nomeia o cliente (${motivoInvisivel(coms.flatMap((x) => x.destinatarios.map((d) => d.nome ?? '')))}): invisível para busca por nome/CNPJ`);
}

let hashServico: string | undefined;
export async function rotinaSentinela(banco: Banco, opcoes: { fetch?: typeof fetch; agora?: Date; limites?: Limites } = {}) {
  const r: Rodada = { fetch: opcoes.fetch ?? fetch, inicio: Date.now(), bytes: 0, limites: opcoes.limites ?? LIMITES_PADRAO }; const agora = opcoes.agora ?? new Date();
  const orgs = await banco.semContexto(async (db) => (await db.query<{ o: string }>('SELECT organizacoes_com_sentinela() AS o')).rows.map((x) => x.o));
  hashServico ??= await Bun.password.hash(crypto.randomUUID() + crypto.randomUUID(), { algorithm: 'argon2id' });
  const tot = { planejadas: 0, tarefas: 0, novas: 0, enriquecidos: 0, bytes: 0, analises: 0, alertas: 0, controles: 0 };
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
    const pos = await banco.comoUsuario(uid, (db) => posColeta(db, org)); tot.analises += pos.analises; tot.alertas += pos.alertas;
    if (!parar) for (const c of await banco.comoUsuario(uid, async (db) => (await db.query<Record<string, any>>('SELECT * FROM sentinela_controle WHERE organizacao_id=$1 AND verificar ORDER BY verificado_em NULLS FIRST LIMIT 20', [org])).rows)) {
      if (Date.now() - r.inicio >= r.limites.ms || r.bytes >= r.limites.bytes) break;
      if (await banco.comoUsuario(uid, (db) => verificarControle(db, r, org, c))) break;
      tot.controles++; await new Promise((f) => setTimeout(f, opcoes.fetch ? 0 : 1000));
    }
  }
  tot.bytes = r.bytes; return tot;
}
