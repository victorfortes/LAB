/** Importação de CSV, OFX, XLSX e XML de NF-e, sempre com prévia antes de gravar. */
import { createHash } from 'node:crypto';
import { lerXlsx } from '../analise/planilha.ts';

export interface LinhaImportada {
  data: string | null; valor: string | null; tipo: 'receita' | 'despesa'; natureza: 'lancamento' | 'titulo'; descricao: string; contraparte: string; categoria: string; situacao: 'realizado' | 'previsto'; documento: string | null; problemas: string[];
}
export interface Previa { formato: string; colunas: string[]; mapa: Record<string, number | null>; linhas: LinhaImportada[]; avisos: string[] }
export type Campo = 'data' | 'valor' | 'descricao' | 'contraparte' | 'categoria' | 'situacao';

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const PISTAS: Record<Campo, RegExp> = { data: /^(data|vencimento|dt|date|emissao|pagamento)/, valor: /(valor|montante|total|amount|vlr)/, descricao: /(descricao|historico|memo|detalhe|observacao)/, contraparte: /(fornecedor|cliente|credor|devedor|favorecido|contraparte|nome|razao)/, categoria: /(categoria|classificacao|natureza|conta contabil)/, situacao: /(situacao|status|pago|baixa)/ };

export function dataBr(v: string): string | null {
  const t = v.trim(); let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(t);
  if (m) { const a = m[3]!.length === 2 ? `20${m[3]}` : m[3]; if (Number(m[2]) > 12) return null; return `${a}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`; }
  // Número de série do Excel.
  if (/^\d{5}$/.test(t)) return new Date(Date.UTC(1899, 11, 30) + Number(t) * 86400000).toISOString().slice(0, 10);
  return null;
}
/** Devolve centavos com sinal, ou null. Aceita 1.234,56 · 1,234.56 · 1234.56 · (1.234,56). */
export function valorBr(v: string): bigint | null {
  let t = v.trim().replace(/r\$/i, '').replace(/\s/g, ''); if (!t) return null;
  const neg = /^\(.*\)$/.test(t) || t.startsWith('-') || /-$/.test(t) || /d$/i.test(t); t = t.replace(/[()\-+dc]/gi, '');
  const v1 = t.lastIndexOf(','), p1 = t.lastIndexOf('.'); const dec = Math.max(v1, p1);
  let i = t, c = '';
  if (dec >= 0 && (t.length - dec - 1 <= 2 || (v1 >= 0 && p1 >= 0))) { i = t.slice(0, dec); c = t.slice(dec + 1); }
  i = i.replace(/[.,]/g, ''); if (!/^\d+$/.test(i || '0') || !/^\d*$/.test(c)) return null;
  const r = BigInt(i || '0') * 100n + BigInt((c + '00').slice(0, 2)); return neg ? -r : r;
}

export function csv(texto: string): string[][] {
  const primeira = texto.split(/\r?\n/, 1)[0] ?? ''; const sep = [';', '\t', ','].sort((a, b) => primeira.split(b).length - primeira.split(a).length)[0]!;
  const linhas: string[][] = []; let linha: string[] = []; let campo = ''; let aspas = false;
  for (let i = 0; i < texto.length; i++) { const c = texto[i]!;
    if (aspas) { if (c === '"' && texto[i + 1] === '"') { campo += '"'; i++; } else if (c === '"') aspas = false; else campo += c; }
    else if (c === '"') aspas = true; else if (c === sep) { linha.push(campo); campo = ''; }
    else if (c === '\n') { linha.push(campo.replace(/\r$/, '')); linhas.push(linha); linha = []; campo = ''; } else campo += c; }
  if (campo || linha.length) { linha.push(campo); linhas.push(linha); }
  return linhas.filter((l) => l.some((x) => x.trim()));
}

const paraLinha = (dataT: string, valorT: string, descricao: string, contraparte: string, categoria: string, situacaoT: string): LinhaImportada => {
  const problemas: string[] = []; const data = dataBr(dataT); if (!data) problemas.push('data não reconhecida');
  const c = valorBr(valorT); if (c === null) problemas.push('valor não reconhecido'); else if (c === 0n) problemas.push('valor zerado');
  const s = norm(situacaoT); const aberto = /(aberto|pendente|a pagar|a receber|nao pago)/.test(s);
  return { data, valor: c === null ? null : (c < 0n ? -c : c).toString(), tipo: c !== null && c < 0n ? 'despesa' : 'receita', natureza: aberto ? 'titulo' : 'lancamento', descricao: descricao.trim().slice(0, 500), contraparte: contraparte.trim().slice(0, 300), categoria: categoria.trim().slice(0, 120) || 'Sem categoria', situacao: aberto ? 'previsto' : 'realizado', documento: null, problemas };
};

export function mapearColunas(cab: readonly string[]): Record<Campo, number | null> {
  const r = {} as Record<Campo, number | null>; const usadas = new Set<number>();
  for (const campo of Object.keys(PISTAS) as Campo[]) { const i = cab.findIndex((c, n) => !usadas.has(n) && PISTAS[campo].test(norm(c))); r[campo] = i < 0 ? null : i; if (i >= 0) usadas.add(i); }
  return r;
}

export function tabelaParaPrevia(tabela: string[][], formato: string, mapaDado?: Record<string, number | null>): Previa {
  const inicio = Math.max(0, tabela.findIndex((l) => l.filter((x) => x.trim()).length >= 2));
  const cab = tabela[inicio] ?? []; const mapa = (mapaDado ?? mapearColunas(cab)) as Record<Campo, number | null>;
  const pega = (l: string[], c: Campo) => (mapa[c] === null || mapa[c] === undefined ? '' : l[mapa[c]!] ?? '');
  const avisos = (['data', 'valor'] as Campo[]).filter((c) => mapa[c] === null).map((c) => `coluna de ${c} não identificada: indique manualmente`);
  return { formato, colunas: cab, mapa, avisos, linhas: tabela.slice(inicio + 1, inicio + 20_001).map((l) => paraLinha(pega(l, 'data'), pega(l, 'valor'), pega(l, 'descricao'), pega(l, 'contraparte'), pega(l, 'categoria'), pega(l, 'situacao'))) };
}

function ofx(texto: string): Previa {
  const tag = (b: string, n: string) => new RegExp(`<${n}>([^<\\r\\n]*)`, 'i').exec(b)?.[1]?.trim() ?? '';
  const linhas = [...texto.matchAll(/<STMTTRN>([\s\S]*?)(?:<\/STMTTRN>|(?=<STMTTRN>))/gi)].map((m) => {
    const b = m[1]!; const d = tag(b, 'DTPOSTED'); const data = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
    const l = paraLinha(data, tag(b, 'TRNAMT'), tag(b, 'MEMO'), tag(b, 'NAME'), 'Extrato bancário', 'realizado'); l.documento = tag(b, 'FITID') || null; return l; });
  return { formato: 'ofx', colunas: ['Data', 'Valor', 'Histórico'], mapa: {}, linhas, avisos: linhas.length ? [] : ['nenhuma transação encontrada no OFX'] };
}

/** NF-e registra um título a confirmar: nota emitida não significa pagamento nem recebimento. */
function nfe(texto: string): Previa {
  const tag = (b: string, n: string) => new RegExp(`<${n}>([^<]*)</${n}>`).exec(b)?.[1] ?? '';
  const emit = /<emit>([\s\S]*?)<\/emit>/.exec(texto)?.[1] ?? ''; const dest = /<dest>([\s\S]*?)<\/dest>/.exec(texto)?.[1] ?? '';
  const venc = tag(texto, 'dVenc') || tag(texto, 'dhEmi').slice(0, 10); const v = tag(texto, 'vNF');
  const l = paraLinha(venc, v, `NF-e ${tag(texto, 'nNF')}`, tag(emit, 'xNome') || tag(dest, 'xNome'), 'Documento fiscal', 'aberto'); l.documento = tag(texto, 'nNF') || null;
  return { formato: 'xml_nfe', colunas: [], mapa: {}, linhas: [l], avisos: ['Nota fiscal não prova pagamento. Confirme se é a pagar ou a receber antes de importar.'] };
}

export function interpretarArquivo(nome: string, dados: Uint8Array): Previa {
  const ext = nome.toLowerCase().split('.').pop();
  if (ext === 'xlsx') { const abas = lerXlsx(dados); const a = abas.find((x) => x.linhas.length > 1) ?? abas[0]; return tabelaParaPrevia(a?.linhas ?? [], 'xlsx'); }
  let texto = new TextDecoder('utf-8').decode(dados); if (texto.includes('�')) texto = new TextDecoder('latin1').decode(dados);
  if (ext === 'ofx' || /<OFX>/i.test(texto)) return ofx(texto);
  if (ext === 'xml') { if (/<infNFe/.test(texto)) return nfe(texto); throw new Error('XML não reconhecido como NF-e'); }
  if (ext === 'csv' || ext === 'txt') return tabelaParaPrevia(csv(texto), 'csv');
  throw new Error('formato não suportado para importação: use Excel, CSV, OFX ou XML de NF-e');
}

export const chaveDedupe = (l: { tipo: string; data: string; valor: string; descricao?: string; contraparte?: string; documento?: string | null }, tag = ''): string =>
  createHash('sha256').update([l.tipo, l.data, l.valor, norm(l.documento ?? ''), norm(l.contraparte ?? ''), norm(l.descricao ?? ''), tag].join('|')).digest('hex');
