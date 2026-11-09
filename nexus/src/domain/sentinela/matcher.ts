/**
 * Identifica o cliente numa comunicação do DJEN. Porte fiel do matcher do Sentinela.
 * Níveis: 1 CNPJ matriz · 2 filial · 3 razão/fantasia · 4 denominação anterior · 5 aproximado.
 * O DJEN não informa o documento da parte: a evidência de CNPJ vem do texto.
 */
import { eAbreviacao, iniciais, normalizar, normalizarIniciais, similaridade } from './nomes.ts';
import { validarCnpj } from '../analise/identificadores.ts';

export type Classificacao = 'descartada' | 'inconclusiva' | 'provavel' | 'confirmada';
export const RANK: Record<Classificacao, number> = { descartada: 1, inconclusiva: 2, provavel: 3, confirmada: 4 };
export interface ClienteSentinela { nomes: { nome: string; nome_norm: string; tipo: string }[]; cnpjs: { cnpj: string; tipo: string }[]; confirmar_por_nome_exato?: boolean }
export interface ComunicacaoDjen { texto: string; destinatarios: { nome: string; polo: string | null }[] }
export interface Avaliacao { nivel: number; classificacao: Classificacao; polo: string | null; nome_na_fonte: string | null; evidencia: Record<string, unknown> }

const LIMIAR = 0.88;
const RE_CNPJ = /(?<![0-9A-Za-z_])\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}(?![0-9A-Za-z_])/g;
const dig = (s: string) => s.replace(/\D/g, '');
export function cnpjsNoTexto(t: string): Set<string> { const a = new Set<string>(); for (const m of t.match(RE_CNPJ) ?? []) { const d = dig(m); if (validarCnpj(d)) a.add(d); } return a; }

const PASSIVO = new Set(['reu', 're', 'reus', 'requerido', 'requerida', 'requeridos', 'executado', 'executada', 'executados', 'reclamado', 'reclamada', 'demandado', 'demandada', 'impetrado', 'impetrada', 'promovido', 'promovida']);
const ATIVO = new Set(['autor', 'autora', 'autores', 'requerente', 'requerentes', 'exequente', 'exequentes', 'reclamante', 'impetrante', 'demandante', 'promovente']);
const NAO_PAPEL = new Set(['cnpj', 'cpf', 'rg', 'mail', 'email', 'cep', 'ssp', 'oab', 'endereco', 'telefone']);
const REC = new Set(['apelante', 'apelado', 'apelada', 'embargante', 'embargado', 'embargada', 'agravante', 'agravado', 'agravada', 'recorrente', 'recorrido', 'recorrida']);
const TERC = new Set(['terceiro', 'terceira', 'interessado', 'interessada', 'litisconsorte']);
const semAcento = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const dobrar = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

export function papelDoCnpj(texto: string, cnpj: string): 'P' | 'A' | null {
  for (const m of texto.matchAll(RE_CNPJ)) {
    if (dig(m[0]) !== cnpj) continue;
    const antes = texto.slice(Math.max(0, m.index - 260), m.index);
    const rot = [...antes.matchAll(/([A-Za-zÀ-ÿ]+)(?:\(a\))?(?:\(s\))?\s*:/g)].map((r) => semAcento(r[1]!)).filter((x) => !NAO_PAPEL.has(x));
    if (rot.length) { const u = rot[rot.length - 1]!; if (PASSIVO.has(u)) return 'P'; if (ATIVO.has(u)) return 'A'; }
  }
  return null;
}
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function papelDoNome(texto: string, nomeNorm: string): { papel: string | null; trecho: string } | null {
  const toks = nomeNorm.split(' ').filter(Boolean); if (!toks.length || !texto) return null;
  const F = dobrar(texto); const re = new RegExp(`(?<![A-Z0-9])${toks.map(esc).join('[^A-Za-z0-9]+')}(?![A-Z0-9])`, 'g');
  const ach: [string | null, string][] = [];
  for (const m of F.matchAll(re)) {
    const pre = F.slice(Math.max(0, m.index - 45), m.index), antes = F.slice(Math.max(0, m.index - 260), m.index);
    let papel: string | null = null;
    if (/(EM FACE (DE|DA|DO)|CONTRA)[^A-Za-z0-9_]*$/.test(pre)) papel = 'P';
    else if (/(RECUPERACAO JUDICIAL|FALENCIA|RECUPERANDA)[^A-Za-z0-9_]*(DE|DA|DO)?[^A-Za-z0-9_]*$/.test(pre)) papel = 'RJ';
    else if (/(INTERPOSTO|APRESENTAD[AO]) POR[^A-Za-z0-9_]*$/.test(pre)) papel = 'REC';
    else if (/(PROPOST[AO]|MOVID[AO]|AJUIZAD[AO]) POR[^A-Za-z0-9_]*$/.test(pre)) papel = 'A';
    else for (const r of antes.matchAll(/([A-Z]+)(?:\(A\))?(?:\(S\))?\s*:/g)) { const w = r[1]!.toLowerCase(); if (PASSIVO.has(w)) papel = 'P'; else if (ATIVO.has(w)) papel = 'A'; else if (REC.has(w)) papel = 'REC'; else if (TERC.has(w)) papel = 'T'; }
    ach.push([papel, F.slice(Math.max(0, m.index - 60), m.index + m[0].length + 40).replaceAll('\n', ' ')]);
  }
  for (const pref of ['P', 'REC', 'T', 'RJ', null, 'A']) for (const [p, t] of ach) if (p === pref) return { papel: p, trecho: t.split(/\s+/).filter(Boolean).join(' ') };
  return null;
}

const ROT: Record<string, string> = { REC: 'recursal (apelante/embargante…)', T: 'de terceiro interessado', RJ: 'na recuperação judicial/falência', null: 'indefinido' };
function porTexto(c: ClienteSentinela, com: ComunicacaoDjen): Avaliacao | null {
  let melhor: Avaliacao | null = null;
  for (const n of c.nomes) {
    if (n.nome_norm.replaceAll(' ', '').length < 4) continue;
    const r = papelDoNome(com.texto, n.nome_norm); if (!r) continue;
    const conf = !!c.confirmar_por_nome_exato; const ev = { nome_cliente: n.nome, tipo_nome: n.tipo, trecho: r.trecho, papel_no_texto: r.papel, cnpj_no_texto: null };
    const res: Avaliacao = r.papel === 'P' ? { nivel: 3, classificacao: conf ? 'confirmada' : 'provavel', polo: 'P', nome_na_fonte: null, evidencia: { ...ev, regra: 'nome do cliente no corpo da comunicação, no polo passivo' } }
      : r.papel === 'A' ? { nivel: 5, classificacao: 'descartada', polo: 'A', nome_na_fonte: null, evidencia: { ...ev, regra: 'nome do cliente no corpo da comunicação, como autor' } }
      : { nivel: 5, classificacao: 'inconclusiva', polo: null, nome_na_fonte: null, evidencia: { ...ev, regra: `nome do cliente citado no corpo da comunicação, papel ${ROT[String(r.papel)]}: requer conferência` } };
    if (!melhor || RANK[res.classificacao] > RANK[melhor.classificacao]) melhor = res;
  }
  return melhor;
}

function melhorNome(parte: string, nomes: ClienteSentinela['nomes']): [string | null, number, string | null] {
  const np = normalizar(parte); let m: [string | null, number, string | null] = [null, 0, null];
  for (const n of nomes) { const s = np && np === n.nome_norm ? 1 : similaridade(parte, n.nome); if (s > m[1]) m = [n.tipo, s, n.nome]; }
  return m;
}

export function avaliar(c: ClienteSentinela, com: ComunicacaoDjen): Avaliacao | null {
  const partes = com.destinatarios ?? []; const cli = new Map(c.cnpjs.map((x) => [x.cnpj, x.tipo]));
  const hits = [...cnpjsNoTexto(com.texto)].filter((x) => cli.has(x)).sort((a, b) => Number(cli.get(a) !== 'matriz') - Number(cli.get(b) !== 'matriz'));
  const cnpj = hits[0] ?? null; const nivelCnpj = cnpj ? (cli.get(cnpj) === 'matriz' ? 1 : 2) : 0;
  const cand = partes.flatMap((p) => { const [tipo, sim, nome] = melhorNome(p.nome ?? '', c.nomes); return sim >= LIMIAR ? [{ p, tipo, sim, nome }] : []; });
  const ini = new Map(c.nomes.filter((n) => iniciais(n.nome)).map((n) => [normalizarIniciais(iniciais(n.nome)), n]));
  const abrev = partes.filter((p) => eAbreviacao(p.nome ?? '') && ini.has(normalizarIniciais(p.nome ?? '')));
  const passivo = cand.filter((x) => x.p.polo === 'P'), ativo = cand.filter((x) => x.p.polo === 'A');
  const melhor = <T extends { sim: number }>(l: T[]) => l.reduce((a, b) => (b.sim > a.sim ? b : a));
  const ev = (x: (typeof cand)[number], regra: string) => ({ nome_na_fonte: x.p.nome, polo: x.p.polo, nome_cliente: x.nome, tipo_nome: x.tipo, similaridade: Math.round(x.sim * 1000) / 1000, cnpj_no_texto: cnpj, regra });
  if (passivo.length) {
    const x = melhor(passivo);
    if (cnpj) return { nivel: nivelCnpj, classificacao: 'confirmada', polo: 'P', nome_na_fonte: x.p.nome, evidencia: ev(x, 'CNPJ no texto + parte no polo passivo com nome compatível') };
    if (x.sim === 1 && (x.tipo === 'razao_social' || x.tipo === 'fantasia')) { const conf = !!c.confirmar_por_nome_exato; return { nivel: 3, classificacao: conf ? 'confirmada' : 'provavel', polo: 'P', nome_na_fonte: x.p.nome, evidencia: ev(x, conf ? 'nome idêntico no polo passivo; confirmação por nome habilitada para este cliente' : 'nome idêntico no polo passivo, sem CNPJ') }; }
    if (x.sim === 1) return { nivel: 4, classificacao: 'provavel', polo: 'P', nome_na_fonte: x.p.nome, evidencia: ev(x, 'denominação anterior/alternativa idêntica no polo passivo') };
    return { nivel: 5, classificacao: 'inconclusiva', polo: 'P', nome_na_fonte: x.p.nome, evidencia: ev(x, 'nome aproximado no polo passivo: requer conferência') };
  }
  const papel = cnpj ? papelDoCnpj(com.texto, cnpj) : null;
  if (papel === 'P' && !ativo.length) return { nivel: nivelCnpj, classificacao: 'confirmada', polo: 'P', nome_na_fonte: null, evidencia: { cnpj_no_texto: cnpj, regra: 'CNPJ do cliente consta no texto como parte no polo passivo' } };
  if (papel === 'A') return { nivel: nivelCnpj, classificacao: 'descartada', polo: 'A', nome_na_fonte: null, evidencia: { cnpj_no_texto: cnpj, regra: 'CNPJ do cliente consta no texto como autor/polo ativo' } };
  if (ativo.length) { const x = melhor(ativo); return { nivel: 5, classificacao: 'descartada', polo: 'A', nome_na_fonte: x.p.nome, evidencia: ev(x, 'cliente aparece como autor/polo ativo') }; }
  const abP = abrev.filter((p) => p.polo === 'P');
  if (abP.length) { const n = ini.get(normalizarIniciais(abP[0]!.nome))!; return { nivel: 5, classificacao: 'provavel', polo: 'P', nome_na_fonte: abP[0]!.nome, evidencia: { nome_cliente: n.nome, tipo_nome: 'iniciais', cnpj_no_texto: cnpj, papel_no_texto: null, regra: 'parte publicada só com iniciais coincide com as iniciais do cliente' } }; }
  const t = porTexto(c, com);
  if (cnpj) { const base: Avaliacao = { nivel: nivelCnpj, classificacao: 'inconclusiva', polo: null, nome_na_fonte: null, evidencia: { cnpj_no_texto: cnpj, regra: 'CNPJ citado no texto, mas cliente não consta entre as partes: posição desconhecida' } }; return t && RANK[t.classificacao] > RANK.inconclusiva ? t : base; }
  return t;
}

export interface ConsultaPlanejada { param: 'nomeParte' | 'texto'; valor: string; chave: string }
const NOME_MIN = 4;
export const formatarCnpj = (d: string) => `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
export function consultasDoCliente(c: ClienteSentinela): ConsultaPlanejada[] {
  const vistos = new Set<string>(); const qs: [ConsultaPlanejada['param'], string][] = [];
  const tem = (p: string, v: string) => qs.some((q) => q[0] === p && q[1] === v);
  for (const n of c.nomes) { if (vistos.has(n.nome_norm)) continue; vistos.add(n.nome_norm); if (n.nome_norm.replaceAll(' ', '').length < NOME_MIN) continue; qs.push(['nomeParte', n.nome_norm]); }
  for (const x of c.cnpjs) qs.push(['texto', formatarCnpj(x.cnpj)]);
  for (const n of c.nomes) { const i = iniciais(n.nome); if (i && !tem('nomeParte', i)) qs.push(['nomeParte', i]); }
  for (const [p, v] of qs.filter((q) => q[0] === 'nomeParte' && !eAbreviacao(q[1]))) qs.push(['texto', v]);
  return qs.map(([param, valor]) => ({ param, valor, chave: `${param}:${valor}` }));
}
