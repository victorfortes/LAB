/**
 * Diagnóstico inicial em HTML: um único documento serve à aba do projeto e ao PDF.
 *
 * Estrutura: capa, sumário e 12 seções numeradas em `.dg-fluxo`. Cada seção é uma sequência de linhas
 * (`.dg-linha`) numa grade de 12 colunas. Para o PDF, `web/js/diag_paginar.js` distribui as linhas em páginas
 * A4 paisagem com cabeçalho, rodapé e "n / N", divide tabelas longas e preenche o sumário. Na aba, as mesmas
 * seções aparecem em fluxo contínuo, sem página.
 *
 * Gráficos: SVG com viewBox na largura útil da coluna em milímetros (265 mm na página inteira), então ocupam a
 * largura toda e o texto sai no corpo certo no PDF. Cores por classe (`.s1`, `.ok`...), para a aba trocar o tema.
 *
 * Versões antigas (gravadas antes desta estrutura) continuam abrindo: o que faltar no JSON é recalculado ou omitido.
 */
import type { RelatorioDiagnostico } from '../domain/diagnostico/relatorio.ts';
import { semTravessao } from '../domain/diagnostico/analises.ts';
import { CATEGORIA, QUORUNS, type Requisito } from '../domain/diagnostico/juridico.ts';
import type { PatrimonioDosSocios } from '../domain/diagnostico/socios.ts';

// ------------------------------------------------------------------ formatação ---

const esc = (v: unknown) => semTravessao(String(v ?? '')).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const dec = (n: number, d = 1) => n.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
const mi = (n: number) => `R$ ${dec(n / 1e6)} mi`;
const mi2 = (n: number | null | undefined) => (n === null || n === undefined ? '·' : dec(n / 1e6, 2));
const brl = (n: number | null | undefined) => (n === null || n === undefined ? 'não informado' : `${n < 0 ? '-' : ''}R$ ${Math.abs(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const pct = (n: number | null | undefined, d = 1) => (n === null || n === undefined ? 'não informado' : `${dec(n, d)}%`);
const neg = (n: number | null | undefined) => (n !== null && n !== undefined && n < 0 ? ' neg' : '');
const dataBR = (s: string) => String(s ?? '').replace(/^(\d{4})-(\d{2})-(\d{2}).*$/, '$3/$2/$1');
const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const mesCurto = (m: string) => { const [a, x] = m.split('-'); return `${MES[Number(x) - 1] ?? x}/${String(a).slice(2)}`; };

// ------------------------------------------------------------------ estilo ---

/** Tokens do documento impresso. A aba redefine as variáveis (ver `web/js/views/projeto_diag_relatorio.js`). */
export const CSS = `
@page{size:297mm 210mm;margin:0}
*{box-sizing:border-box}
.dg{--fundo:#0E1726;--papel:#0E1726;--tinta:#E7EBF2;--tinta2:#B9C2D0;--suave:#8692A6;--linha:rgba(231,235,242,.12);--linha2:rgba(231,235,242,.22);
  --acento:#E3A23F;--s1:#7393C4;--s2:#E3A23F;--s3:#9AA6BA;--ok:#5DB98B;--mal:#E07A7F;--meio:#D9A441;--painel:rgba(231,235,242,.035);
  --fonte:"Inter","Helvetica Neue",Arial,sans-serif;
  font-family:var(--fonte);color:var(--tinta);font-size:9pt;line-height:1.45;font-feature-settings:"tnum" 1,"lnum" 1;-webkit-print-color-adjust:exact;print-color-adjust:exact}
html,body.dg{margin:0;background:var(--fundo)}
.dg h1,.dg h2,.dg h3{margin:0;font-weight:600;letter-spacing:-.005em;color:var(--tinta)}
.dg p{margin:0 0 2mm}
.dg b{font-weight:600}

/* página impressa */
.pg{position:relative;width:297mm;height:210mm;padding:12mm 16mm 10mm;overflow:hidden;break-after:page;page-break-after:always;background:var(--papel);display:flex;flex-direction:column}
.pg-cab{display:flex;justify-content:space-between;align-items:baseline;padding-bottom:2.2mm;border-bottom:.25mm solid var(--linha2);margin-bottom:6mm;font-size:7.5pt;color:var(--suave);flex:none}
.pg-corpo{flex:1;min-height:0;overflow:hidden}
.pg-rod{display:flex;justify-content:space-between;padding-top:2.2mm;border-top:.25mm solid var(--linha);margin-top:4mm;font-size:7pt;color:var(--suave);flex:none}
.marca{font-weight:300;letter-spacing:.06em;color:var(--tinta);font-size:10pt}.marca i{font-style:normal;color:var(--acento);font-size:6.5pt;letter-spacing:.35em;margin-left:1.6mm;font-weight:500}
.dg-cont{font-size:7pt;letter-spacing:.2em;text-transform:uppercase;color:var(--suave);margin-bottom:3mm}

/* capa */
.capa{padding:16mm 20mm 12mm}
.capa .marca{font-size:15pt}.capa .marca i{font-size:8pt}
.capa-meio{margin-top:34mm;max-width:190mm}
.capa-fio{width:14mm;height:.8mm;background:var(--acento);margin-bottom:7mm}
.capa h1{font-size:30pt;line-height:1.12;font-weight:600}
.capa-emp{margin-top:9mm;font-size:13pt;color:var(--acento);font-weight:500}
.capa-sub{font-size:10pt;color:var(--tinta2);margin-top:1.5mm}
.capa-pe{position:absolute;left:20mm;right:20mm;bottom:12mm;display:grid;grid-template-columns:repeat(4,1fr);gap:6mm;border-top:.25mm solid var(--linha2);padding-top:3.5mm;font-size:7.5pt;color:var(--suave)}
.capa-pe b{display:block;color:var(--tinta);font-weight:500;font-size:8.5pt;margin-top:.6mm}

/* sumário */
.sum h2{font-size:17pt;margin:2mm 0 7mm}
.sum ol{list-style:none;margin:0;padding:0;columns:2;column-gap:16mm}
.sum li{display:flex;align-items:baseline;gap:3mm;padding:2.3mm 0;border-bottom:.2mm solid var(--linha);break-inside:avoid;font-size:10pt}
.sum li span:first-child{color:var(--acento);font-weight:600;width:7mm;flex:none}
.sum li em{font-style:normal;color:var(--suave);font-size:8pt;display:block}
.sum li .dg-pag{margin-left:auto;color:var(--tinta2);font-variant-numeric:tabular-nums}
.sum-nota{margin-top:8mm;font-size:8pt;color:var(--suave);max-width:180mm}

/* seção */
.dg-secao{margin:0}
.dg-sec-cab{margin-bottom:5mm}
.dg-k{font-size:7pt;letter-spacing:.24em;text-transform:uppercase;color:var(--acento);font-weight:600;margin-bottom:1.6mm}
.dg-k span{color:var(--suave);margin-right:2.5mm;letter-spacing:.1em}
.dg-sec-cab h2{font-size:16pt;line-height:1.2}
.dg-lead{font-size:9.5pt;color:var(--tinta2);margin:2.5mm 0 0;max-width:235mm;line-height:1.5}

/* grade de 12 colunas, 265 mm de largura útil, 5 mm de calha */
.dg-linha{display:grid;grid-template-columns:repeat(12,1fr);column-gap:5mm;margin-bottom:5mm}
.c12{grid-column:span 12}.c9{grid-column:span 9}.c8{grid-column:span 8}.c7{grid-column:span 7}.c6{grid-column:span 6}.c5{grid-column:span 5}.c4{grid-column:span 4}.c3{grid-column:span 3}
.dg-t{font-size:7pt;letter-spacing:.16em;text-transform:uppercase;color:var(--suave);font-weight:600;margin:0 0 2.2mm;padding-bottom:1.6mm;border-bottom:.25mm solid var(--linha2)}
.dg-nota{font-size:7.5pt;color:var(--suave);margin-top:2mm;line-height:1.45}
.dg-painel{border:.25mm solid var(--linha);border-radius:1.6mm;padding:3.6mm 4mm;background:var(--painel);height:100%}
.dg-painel h3{font-size:9pt;margin-bottom:1.8mm}

/* números-chave */
.dg-kpi{border-top:.6mm solid var(--s3);padding-top:2.4mm}
.dg-kpi.mal{border-color:var(--mal)}.dg-kpi.meio{border-color:var(--meio)}.dg-kpi.ok{border-color:var(--ok)}
.dg-kpi b{display:block;font-size:17pt;font-weight:600;line-height:1.1;letter-spacing:-.01em}
.dg-kpi.mal b{color:var(--mal)}
.dg-kpi span{display:block;font-size:7.5pt;color:var(--suave);margin-top:1.2mm;line-height:1.35}

/* tabelas */
.dg-tab{width:100%;border-collapse:collapse;font-size:8pt}
.dg-tab th{font-size:6.6pt;letter-spacing:.12em;text-transform:uppercase;color:var(--suave);font-weight:600;text-align:left;padding:1.6mm 2mm 1.4mm;border-bottom:.3mm solid var(--linha2);vertical-align:bottom}
.dg-tab td{padding:1.7mm 2mm;border-bottom:.2mm solid var(--linha);vertical-align:top;line-height:1.4}
.dg-tab tr:last-child td{border-bottom:0}
.dg-tab .n{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
.dg-tab .sub{display:block;font-size:7pt;color:var(--suave);margin-top:.4mm}
.dg-tab tr.tot td{border-top:.3mm solid var(--linha2);font-weight:600}
.dg-tab td:first-child,.dg-tab th:first-child{padding-left:0}.dg-tab td:last-child,.dg-tab th:last-child{padding-right:0}
.neg{color:var(--mal)}
.dg-sel{display:inline-block;white-space:nowrap;font-size:6.8pt;font-weight:600;letter-spacing:.04em;padding:.35mm 1.8mm;border-radius:.8mm;border:.25mm solid currentColor}
.dg-sel.ok{color:var(--ok)}.dg-sel.mal{color:var(--mal)}.dg-sel.meio{color:var(--meio)}.dg-sel.info{color:var(--s1)}.dg-sel.neutro{color:var(--suave)}

/* achados */
.dg-ach{display:grid;grid-template-columns:44mm 1fr 20mm;gap:4mm;padding:2.2mm 0;border-bottom:.2mm solid var(--linha);font-size:8.6pt}
.dg-ach:last-child{border-bottom:0}.dg-ach > b{color:var(--acento);font-size:8pt}.dg-ach > span:last-child{text-align:right}
.dg-it{position:relative;padding:.7mm 0 .7mm 4mm;font-size:8.3pt;line-height:1.4}
.dg-it:before{content:"";position:absolute;left:0;top:2.15mm;width:1.5mm;height:1.5mm;border-radius:50%;background:var(--c,var(--acento))}
.dg-it.mal{--c:var(--mal)}.dg-it.meio{--c:var(--meio)}.dg-it.ok{--c:var(--ok)}
.dg-dl{display:grid;grid-template-columns:30mm 1fr;font-size:8.4pt}
.dg-dl dt{color:var(--suave);padding:1.5mm 0;border-bottom:.2mm solid var(--linha)}.dg-dl dd{margin:0;padding:1.5mm 0;border-bottom:.2mm solid var(--linha)}
.dg-vazio{border:.25mm dashed var(--linha2);border-radius:1.6mm;padding:5mm 6mm;color:var(--tinta2)}
.dg-vazio b{color:var(--tinta)}

/* gráficos */
.dg-fig{margin:0}
.dg-fig svg{display:block;width:100%;height:auto;overflow:visible}
.dg-fig text{font-family:var(--fonte);fill:var(--tinta2)}
.dg-fig .v{fill:var(--tinta);font-weight:600}.dg-fig .eixo{fill:var(--suave)}
.dg-fig .grade{stroke:var(--linha);stroke-width:.2}.dg-fig .zero{stroke:var(--linha2);stroke-width:.35}
.s1{fill:var(--s1)}.s2{fill:var(--s2)}.s3{fill:var(--s3)}.f-ok{fill:var(--ok)}.f-mal{fill:var(--mal)}.f-meio{fill:var(--meio)}.f-fundo{fill:var(--linha)}
.dg-leg{display:flex;flex-wrap:wrap;gap:5mm;font-size:7.4pt;color:var(--tinta2);margin-top:2mm}
.dg-leg i{display:inline-block;width:2.6mm;height:2.6mm;border-radius:.5mm;margin-right:1.6mm;vertical-align:-.35mm;background:var(--c)}
.dg-100{display:flex;height:5mm;border-radius:.8mm;overflow:hidden;background:var(--linha)}
.dg-100 i{display:block;height:100%;background:var(--c)}
.dg-100-t{display:flex;justify-content:space-between;font-size:7.6pt;color:var(--tinta2);margin:0 0 1.4mm}

/* PDF sem paginação (sem script): cada seção começa em página nova */
.dg-fluxo{padding:12mm 16mm}
.dg-fluxo .dg-secao + .dg-secao{break-before:page;page-break-before:always}
.dg-linha,.dg-ach,.dg-tab tr,.dg-kpi,.dg-painel,.dg-fig{break-inside:avoid;page-break-inside:avoid}
`;

// ------------------------------------------------------------------ peças ---

type Tom = 'ok' | 'mal' | 'meio' | 'info' | 'neutro';
const selo = (tom: Tom, t: string) => `<span class="dg-sel ${tom}">${esc(t)}</span>`;
const linha = (...cols: string[]) => `<div class="dg-linha">${cols.join('')}</div>`;
const col = (n: number, inner: string) => `<div class="c${n}">${inner}</div>`;
const titulo = (t: string) => `<div class="dg-t">${esc(t)}</div>`;
const nota = (t: string) => (t ? `<p class="dg-nota">${t}</p>` : '');
const kpi = (valor: string, rotulo: string, tom: Tom | 'neutro' = 'neutro') => `<div class="dg-kpi ${tom}"><b>${esc(valor)}</b><span>${esc(rotulo)}</span></div>`;
const vazio = (pedir: readonly string[], msg = 'Sem documentos para esta análise.') => `<div class="dg-vazio"><p><b>${esc(msg)}</b></p><p style="margin:0">Pedir ao cliente: ${pedir.map(esc).join('; ')}.</p></div>`;
const ref = (x?: { arquivo: string; local?: string }) => (x ? `<span class="sub">${esc(x.arquivo)}${x.local ? `, ${esc(x.local)}` : ''}</span>` : '');

interface Coluna { t: string; n?: boolean; w?: string }
function tabela(cab: Coluna[], linhas: string[][], extra = '') {
  return `<table class="dg-tab"><thead><tr>${cab.map((c) => `<th${c.n ? ' class="n"' : ''}${c.w ? ` style="width:${c.w}"` : ''}>${esc(c.t)}</th>`).join('')}</tr></thead><tbody>${linhas.map((l) => `<tr>${l.map((x, i) => `<td${cab[i]?.n ? ' class="n"' : ''}>${x}</td>`).join('')}</tr>`).join('')}${extra}</tbody></table>`;
}

function secao(id: string, n: number, nome: string, manchete: string, lead: string, corpo: string[]) {
  return `<section class="dg-secao" id="${id}" data-n="${n}" data-titulo="${esc(nome)}"><header class="dg-sec-cab"><div class="dg-k"><span>${String(n).padStart(2, '0')}</span>${esc(nome)}</div><h2>${esc(manchete)}</h2>${lead ? `<p class="dg-lead">${lead}</p>` : ''}</header>${corpo.join('')}</section>`;
}

// ------------------------------------------------------------------ gráficos ---

/** Escala "redonda" para o eixo: 0 sempre incluído, 4 a 5 marcas. */
function escala(min: number, max: number) {
  const lo = Math.min(0, min); const hi = Math.max(0, max); const amp = hi - lo || 1;
  const bruto = amp / 4; const mag = 10 ** Math.floor(Math.log10(bruto)); const passo = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((p) => amp / p <= 5) ?? 10 * mag;
  const a = Math.floor(lo / passo) * passo; const b = Math.ceil(hi / passo) * passo;
  const marcas: number[] = []; for (let v = a; v <= b + passo / 2; v += passo) marcas.push(Math.round(v * 1e6) / 1e6);
  return { a, b, marcas };
}

const legenda = (itens: [string, string][]) => `<div class="dg-leg">${itens.map(([cor, t]) => `<span><i style="--c:var(--${cor})"></i>${esc(t)}</span>`).join('')}</div>`;

/**
 * Barras verticais agrupadas na largura `W` (mm). Valores em reais, exibidos em R$ mi. Negativos descem do zero.
 */
function barras(o: { categorias: string[]; series: { nome: string; cor: 's1' | 's2' | 's3' | 'ok' | 'mal'; valores: (number | null)[] }[]; W?: number; H?: number; legenda?: boolean; casas?: number }) {
  const W = o.W ?? 265; const H = o.H ?? 72; const esq = 12; const topo = 5; const base = 9; const casas = o.casas ?? 1;
  const vals = o.series.flatMap((s) => s.valores.filter((v): v is number => v !== null).map((v) => v / 1e6));
  const { a, b, marcas } = escala(Math.min(0, ...vals), Math.max(0, ...vals));
  const alt = H - topo - base; const y = (v: number) => topo + ((b - v) / (b - a)) * alt;
  const larg = W - esq; const g = larg / Math.max(1, o.categorias.length); const ns = o.series.length;
  const bw = Math.min(16, (g * 0.62) / ns); const gap = Math.min(1.6, bw * 0.12);
  let svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMinYMin meet" role="img">`;
  for (const m of marcas) svg += `<line class="${m === 0 ? 'zero' : 'grade'}" x1="${esq}" x2="${W}" y1="${y(m)}" y2="${y(m)}"/><text class="eixo" x="${esq - 2}" y="${y(m) + 1}" font-size="2.5" text-anchor="end">${dec(m, Number.isInteger(Math.abs((marcas[1] ?? 1) - (marcas[0] ?? 0))) ? 0 : 1)}</text>`;
  o.categorias.forEach((c, i) => {
    const x0 = esq + i * g + (g - (bw * ns + gap * (ns - 1))) / 2;
    o.series.forEach((s, k) => {
      const v = s.valores[i]; if (v === null || v === undefined) return;
      const vm = v / 1e6; const x = x0 + k * (bw + gap); const y1 = y(Math.max(0, vm)); const h = Math.max(0.3, Math.abs(y(vm) - y(0)));
      svg += `<rect class="${/^s\d$/.test(s.cor) ? s.cor : `f-${s.cor}`}" x="${x}" y="${y1}" width="${bw}" height="${h}"/>`;
      svg += `<text class="v" x="${x + bw / 2}" y="${vm >= 0 ? y1 - 1.2 : y1 + h + 3}" font-size="${bw < 6 ? 2.1 : 2.6}" text-anchor="middle">${dec(vm, casas)}</text>`;
    });
    svg += `<text x="${esq + i * g + g / 2}" y="${H - 2.4}" font-size="2.8" text-anchor="middle">${esc(c)}</text>`;
  });
  svg += '</svg>';
  return `${svg}${o.legenda === false ? '' : legenda(o.series.map((s) => [s.cor, s.nome]))}`;
}

/** Barras horizontais: rótulo à esquerda, barra proporcional, valor e percentual à direita. */
function horizontais(linhas: { rotulo: string; valor: number; pct: number; cor: 'ok' | 'mal' | 'meio' | 's1' }[], W = 265) {
  const rot = 62; const dir = 34; const h = 7.2; const H = linhas.length * h + 2; const max = Math.max(1, ...linhas.map((l) => l.valor)); const area = W - rot - dir;
  let svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMinYMin meet" role="img">`;
  linhas.forEach((l, i) => {
    const y = 1 + i * h; const w = Math.max(0.6, (l.valor / max) * area);
    svg += `<text x="0" y="${y + h / 2 + 1}" font-size="2.9">${esc(l.rotulo)}</text><rect class="f-fundo" x="${rot}" y="${y + 1.4}" width="${area}" height="${h - 2.8}"/><rect class="${l.cor === 's1' ? 's1' : `f-${l.cor}`}" x="${rot}" y="${y + 1.4}" width="${w}" height="${h - 2.8}"/>`;
    svg += `<text class="v" x="${W}" y="${y + h / 2 + 1}" font-size="2.9" text-anchor="end">${esc(mi(l.valor))}  <tspan class="eixo">${dec(l.pct)}%</tspan></text>`;
  });
  return `${svg}</svg>`;
}

/** Barra 100% (HTML, ocupa a largura da coluna) com legenda de valores. */
function barra100(rotulo: string, partes: { t: string; v: number; cor: string }[], fmt: (v: number) => string) {
  const tot = partes.reduce((s, p) => s + p.v, 0) || 1;
  return `<div class="dg-100-t"><span>${esc(rotulo)}</span></div><div class="dg-100">${partes.filter((p) => p.v > 0).map((p) => `<i style="--c:var(--${p.cor});width:${((p.v / tot) * 100).toFixed(2)}%"></i>`).join('')}</div>${legenda(partes.map((p) => [p.cor, `${p.t}: ${fmt(p.v)} (${dec((p.v / tot) * 100)}%)`]))}`;
}

// ------------------------------------------------------------------ documento ---

const SIT: Record<string, [Tom, string]> = { atendido: ['ok', 'Atendido'], indicio: ['info', 'Indício'], pendente: ['meio', 'Pendente'], impeditivo: ['mal', 'Impeditivo'] };
const RJ: Record<string, [Tom, string]> = { sujeito: ['ok', 'Sujeito'], nao_sujeito: ['mal', 'Fora'], depende: ['meio', 'Depende'] };
const RE: Record<string, [Tom, string]> = { abrangido: ['ok', 'Abrange'], excluido: ['mal', 'Fora'], depende: ['meio', 'Depende'] };
const DOC51: Record<string, [Tom, string]> = { entregue: ['ok', 'Entregue'], parcial: ['meio', 'Parcial'], pendente: ['mal', 'Pendente'], fora_do_checklist: ['neutro', 'Fora do checklist'] };
const COR_RJ: Record<string, 'ok' | 'mal' | 'meio'> = { sujeito: 'ok', nao_sujeito: 'mal', depende: 'meio' };
const TOM_STATUS: Record<string, Tom> = { vermelho: 'mal', ambar: 'meio', verde: 'ok' };

export const SECOES = [
  ['resumo', 'Resumo executivo'], ['dados', 'Dados do caso e base documental'], ['endividamento', 'Endividamento por natureza'],
  ['sujeicao', 'Sujeição à RJ e à RE'], ['requisitos', 'Requisitos para o pedido'], ['art51', 'Documentos do art. 51'],
  ['quoruns', 'Quóruns e vias de negociação'], ['contabil', 'Indicadores contábeis'], ['financeiro', 'Indicadores financeiros'],
  ['patrimonio', 'Patrimônio dos sócios e partes relacionadas'], ['riscos', 'Matriz de riscos'], ['conclusoes', 'Conclusões e próximos passos'],
] as const;
const DESCR: Record<string, string> = {
  resumo: 'Achados centrais e números-chave', dados: 'Identificação, checklist e documentos lidos', endividamento: 'Passivo por natureza e principal dor',
  sujeicao: 'Arts. 41, 49 e 161, § 1º', requisitos: 'Arts. 1º, 2º, 48, 161 e 163', art51: 'Incisos I a XI e pendências por área', quoruns: 'Arts. 45, 45-A, 58, 162 e 163',
  contabil: 'Faturamento, resultado e balanço', financeiro: 'Extratos, passivo por fonte e clientes', patrimonio: 'Bens, ônus, garantias e fluxos com o grupo',
  riscos: 'Fato, hipótese e pendência', conclusoes: 'Leitura de caminho, frentes de trabalho e limites',
};

export function renderizarDiagnostico(r: RelatorioDiagnostico): string {
  const C = r.capa as RelatorioDiagnostico['capa'] & { cnpj?: string | null; segmento?: string | null };
  const J = r.juridico as RelatorioDiagnostico['juridico'] & Partial<{ comuns: Requisito[]; documentosArt51: { inciso: string; fundamento: string; documento: string; situacao: string; itens: number; entregues: number }[] }>;
  const M = r.endividamento[0];
  const s: string[] = [];
  const nSec = (id: string) => SECOES.findIndex(([x]) => x === id) + 1;
  const sec = (id: (typeof SECOES)[number][0], manchete: string, lead: string, corpo: string[]) => s.push(secao(id, nSec(id), SECOES[nSec(id) - 1]![1], manchete, lead, corpo));

  // 1. Resumo executivo
  const R = r.resumo;
  const cards = R.cards.slice(0, 4);
  const span = cards.length ? Math.max(3, Math.floor(12 / cards.length)) : 12;
  sec('resumo', R.titulo, esc(R.conclusao), [
    cards.length ? linha(...cards.map((c) => col(span, kpi(c.valor, c.rotulo, TOM_STATUS[c.status] ?? 'neutro')))) : '',
    linha(col(12, `${titulo('Achados')}${R.achados.length ? R.achados.map((a) => `<div class="dg-ach"><b>${esc(a.rotulo)}</b><span>${esc(a.texto)}</span><span>${selo(a.natureza === 'fato' ? 'mal' : a.natureza === 'hipotese' ? 'meio' : 'neutro', a.natureza === 'fato' ? 'Fato' : a.natureza === 'hipotese' ? 'Hipótese' : 'Pendência')}</span></div>`).join('') : vazio(['Documentos contábeis e financeiros'], 'Sem achados calculáveis com os documentos atuais.')}`)),
  ]);

  // 2. Dados do caso e base documental
  const B = r.baseDocumental;
  const ident: [string, string][] = [['Empresa', C.razaoSocial], ['CNPJ', C.cnpj ?? 'não informado'], ['Segmento', C.segmento ? C.segmento[0]!.toUpperCase() + C.segmento.slice(1) : 'não informado'], ['Projeto', C.projeto],
    ['Atuação do NGA', C.posicao === 'credor' ? 'Pelo credor' : 'Pelo devedor'], ['Escopo', C.escopo], ['Data-base', dataBR(C.dataBase)], ['Versão', `${r.versao}, elaborada por ${r.geradoPor}`]];
  sec('dados', 'O que veio e o que falta', `${B.portal.enviados} de ${B.portal.obrigatorios} documentos obrigatórios entregues no portal (${B.portal.percentual}%), ${B.portal.aprovados} aprovados pela equipe. ${B.lidos} arquivo(s) lido(s) automaticamente${B.ilegiveis ? `, ${B.ilegiveis} sem leitura confiável` : ''}.`, [
    linha(col(5, `${titulo('Identificação')}<dl class="dg-dl">${ident.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`),
      col(7, `${titulo('Respostas do checklist')}${barra100('Situação de cada item', [
        { t: 'Entregue', v: B.respostas.entregue, cor: 'ok' }, { t: 'Parcial', v: B.respostas.parcial, cor: 'meio' }, { t: 'Sem resposta', v: B.respostas.sem_resposta, cor: 's3' },
        { t: 'Pendente', v: B.respostas.pendente + B.respostas.marcado_sem_arquivo, cor: 'mal' }], (v) => `${v}`)}
        <div class="dg-linha" style="margin:5mm 0 0">${col(4, kpi(pct(B.percentuais.entregue, 0), 'dos itens entregues por completo', B.percentuais.entregue < 50 ? 'mal' : B.percentuais.entregue < 80 ? 'meio' : 'ok'))}${col(4, kpi(String(B.marcadosSemArquivo.length), 'marcados "sim" sem arquivo (tratados como pendentes)', B.marcadosSemArquivo.length ? 'meio' : 'neutro'))}${col(4, kpi(String(B.ilegiveis), 'arquivos sem leitura confiável', B.ilegiveis ? 'meio' : 'neutro'))}</div>
        ${B.marcadosSemArquivo.length ? nota(`Marcados "sim" sem arquivo: ${B.marcadosSemArquivo.slice(0, 6).map(esc).join('; ')}${B.marcadosSemArquivo.length > 6 ? '; e outros' : ''}.`) : ''}`)),
    linha(col(12, `${titulo('Documentos lidos')}${B.documentos.length ? tabela([{ t: 'Área', w: '22%' }, { t: 'Documento' }, { t: 'Leitura', w: '30%' }], B.documentos.map((d) => [esc(d.area), esc(d.nome), `${selo(d.qualidade === 'boa' ? 'ok' : d.qualidade === 'ilegivel' ? 'mal' : 'meio', d.qualidade === 'boa' ? 'Lido' : d.qualidade === 'ilegivel' ? 'Ilegível' : 'Regular')}${d.detalhe ? `<span class="sub">${esc(d.detalhe)}</span>` : ''}`])) : vazio(['Documentos pelo portal do cliente'], 'Nenhum documento recebido.')}`)),
  ]);

  // 3. Endividamento por natureza
  if (M) {
    const comp = r.endividamento[1];
    sec('endividamento', `Onde está a dor: ${M.principalDor?.categoria ?? 'passivo'}`, esc(M.principalDor?.texto ?? ''), [
      linha(col(12, `${titulo(`Passivo por natureza · ${M.fonte} · total ${mi(M.total)}`)}<figure class="dg-fig">${horizontais(M.categorias.map((c) => ({ rotulo: c.categoria, valor: c.valor, pct: c.percentual, cor: COR_RJ[c.rj] ?? 'meio' })))}${legenda([['ok', 'Sujeito à RJ'], ['meio', 'Depende do contrato ou da garantia'], ['mal', 'Fora da RJ']])}</figure>${nota(`Fonte: ${esc(M.ref.arquivo)}${M.ref.local ? `, ${esc(M.ref.local)}` : ''}.`)}`)),
      linha(col(4, kpi(mi(M.sujeitoRj), `sujeito à recuperação judicial (${dec((M.sujeitoRj / M.total) * 100)}%)`, 'ok')), col(4, kpi(mi(M.aDefinir), `depende dos contratos e garantias (${dec((M.aDefinir / M.total) * 100)}%)`, 'meio')), col(4, kpi(mi(M.foraDaRj), `fora da RJ, a tratar em paralelo (${dec((M.foraDaRj / M.total) * 100)}%)`, 'mal'))),
      linha(col(12, `${titulo('Composição')}${tabela([{ t: 'Natureza', w: '20%' }, { t: 'Principais contas' }, { t: 'Classe (art. 41)', w: '17%' }, { t: 'RJ', w: '8%' }, { t: 'RE', w: '8%' }, { t: 'R$ mi', n: true, w: '9%' }, { t: '%', n: true, w: '7%' }],
        M.categorias.map((c) => [`<b>${esc(c.categoria)}</b>`, esc(c.contas.slice(0, 3).map((x) => x.conta).join(', ')), esc(CATEGORIA[c.categoria]?.classe ?? (c as { classe?: string }).classe ?? 'A definir'), selo(...(RJ[c.rj] ?? RJ.depende!)), selo(...(RE[c.re] ?? RE.depende!)), mi2(c.valor), dec(c.percentual)]),
        `<tr class="tot"><td>Total</td><td></td><td></td><td></td><td></td><td class="n">${mi2(M.total)}</td><td class="n">100,0</td></tr>`)}${comp ? nota(`Comparação: ${esc(comp.fonte)} soma ${mi(comp.total)}; maior fatia ${esc(comp.principalDor?.categoria ?? '')} (${dec(comp.principalDor?.percentual ?? 0)}%).`) : ''}`)),
    ]);
  } else sec('endividamento', 'Mapa do endividamento', 'O passivo aberto por conta ainda não foi entregue; sem ele, não é possível medir o que a recuperação alcança.', [linha(col(12, vazio(['Balanço ou balancete com o passivo aberto por conta', 'Relatório consolidado de endividamento', 'Relação nominal de credores (art. 51, III)'])))]);

  // 4. Sujeição à RJ e à RE
  const porRe = (k: string) => (M ? M.categorias.filter((c) => c.re === k).reduce((t, c) => t + c.valor, 0) : 0);
  sec('sujeicao', 'O que a recuperação alcança', `${esc(J.rj.alcance)} ${esc(J.re.alcance)}`, [
    M ? linha(col(6, barra100('Recuperação judicial (art. 49)', [{ t: 'Sujeito', v: M.sujeitoRj, cor: 'ok' }, { t: 'Depende', v: M.aDefinir, cor: 'meio' }, { t: 'Fora', v: M.foraDaRj, cor: 'mal' }], mi)),
      col(6, barra100('Recuperação extrajudicial (art. 161, § 1º)', [{ t: 'Abrangível', v: porRe('abrangido'), cor: 'ok' }, { t: 'Depende', v: porRe('depende'), cor: 'meio' }, { t: 'Fora', v: porRe('excluido'), cor: 'mal' }], mi))) : '',
    linha(col(12, `${titulo('Natureza do crédito, classe e fundamento')}${tabela([{ t: 'Natureza', w: '17%' }, { t: 'RJ', w: '7%' }, { t: 'RE', w: '7%' }, { t: 'Classe', w: '14%' }, { t: 'Fundamento (Lei 11.101/2005, redação da Lei 14.112/2020)' }],
      (Object.entries(CATEGORIA) as [string, (typeof CATEGORIA)[keyof typeof CATEGORIA]][]).filter(([k]) => !M || M.categorias.some((c) => c.categoria === k) || k !== 'Outras obrigações')
        .map(([k, v]) => { const c = M?.categorias.find((x) => x.categoria === k); return [`<b>${esc(k)}</b>${c ? `<span class="sub">${esc(mi(c.valor))}, ${dec(c.percentual)}%</span>` : ''}`, selo(...RJ[v.rj]!), selo(...RE[v.re]!), esc(v.classe), esc(v.fundamento)]; }))}`)),
  ]);

  // 5. Requisitos para o pedido
  const comuns = J.comuns ?? J.rj.requisitos.filter((q) => q.fundamento !== 'art. 51');
  const linhaReq = (q: { requisito: string; fundamento: string; situacao: string; base: string }) => [esc(q.requisito), esc(q.fundamento), selo(...(SIT[q.situacao] ?? SIT.pendente!)), `<span class="sub" style="margin:0">${esc(q.base)}</span>`];
  const cabReq: Coluna[] = [{ t: 'Requisito', w: '38%' }, { t: 'Dispositivo', w: '14%' }, { t: 'Situação', w: '11%' }, { t: 'Base' }];
  const proprios = J.re.requisitos.filter((q) => !q.fundamento.includes('c/c art. 161'));
  const impeditivo = [...J.rj.requisitos, ...J.re.requisitos].some((q) => q.situacao === 'impeditivo');
  sec('requisitos', impeditivo ? 'Há requisito impeditivo a esclarecer' : 'Requisitos subjetivos e de instrução', 'Os requisitos subjetivos são os mesmos para a recuperação judicial e para a extrajudicial (art. 161, caput, que remete ao art. 48). O que depende de certidão fica pendente até a certidão chegar.', [
    linha(col(12, `${titulo('Comuns à RJ e à RE')}${tabela(cabReq, comuns.map(linhaReq))}`)),
    linha(col(12, `${titulo('Próprios da recuperação judicial')}${tabela(cabReq, J.rj.requisitos.filter((q) => q.fundamento === 'art. 51').map(linhaReq))}`)),
    linha(col(12, `${titulo('Próprios da recuperação extrajudicial')}${tabela(cabReq, proprios.map(linhaReq))}`)),
  ]);

  // 6. Documentos do art. 51
  const F = r.faltantes; const D51 = J.documentosArt51;
  const faltam = D51 ? D51.filter((d) => d.situacao !== 'entregue').length : null;
  sec('art51', faltam === null ? 'Documentos que instruem a petição' : faltam ? `${faltam} de 11 incisos ainda sem documento completo` : 'Os 11 incisos têm documento entregue',
    `A petição de recuperação judicial é instruída com os documentos do art. 51 (incisos IX a XI e a alínea "e" do inciso II acrescidos pela Lei 14.112/2020). Sem eles, o juiz manda emendar a inicial ou a indefere, e pode determinar constatação prévia (art. 51-A). Pendentes no checklist: ${F.pendentes}; parciais ou sem resposta: ${F.parcialOuSemResposta}.`, [
    D51 ? linha(col(12, tabela([{ t: 'Inciso', w: '7%' }, { t: 'Documento exigido' }, { t: 'Situação', w: '13%' }, { t: 'Itens entregues', n: true, w: '12%' }],
      D51.map((d) => [`<b>${esc(d.inciso)}</b>`, esc(d.documento), selo(...(DOC51[d.situacao] ?? DOC51.pendente!)), d.itens ? `${d.entregues} de ${d.itens}` : '·']))))
      : linha(col(12, `<div class="dg-vazio">Esta versão foi gerada antes do cruzamento com o art. 51. Gere uma nova versão para ver a situação de cada inciso.</div>`)),
    F.porArea.length ? linha(...F.porArea.slice(0, 6).map((a) => col(F.porArea.length === 1 ? 12 : F.porArea.length === 2 ? 6 : 4, `<div class="dg-painel"><h3>${esc(a.area)}</h3><p class="dg-nota" style="margin:0 0 1.5mm">${a.incompletos} de ${a.total} incompletos</p>${a.itens.slice(0, 7).map((i) => `<div class="dg-it ${i.marcador === 'ambar' ? 'meio' : 'mal'}">${esc(i.titulo)}${i.marcadoSemArquivo ? ' (marcado sim, sem arquivo)' : ''}${i.artigo ? ` <span class="dg-nota">${esc(i.artigo)}</span>` : ''}</div>`).join('')}${a.itens.length > 7 ? `<p class="dg-nota">e mais ${a.itens.length - 7}</p>` : ''}</div>`))) : '',
    F.foraDoChecklist.length ? linha(col(12, nota(`Exigidos pela lei e sem item no checklist (pedir à parte): ${F.foraDoChecklist.map(esc).join('; ')}.`))) : '',
  ]);

  // 7. Quóruns e vias
  const lq = (xs: readonly { regra: string; fundamento: string }[]) => tabela([{ t: 'Regra' }, { t: 'Dispositivo', w: '24%' }], xs.map((q) => [esc(q.regra), esc(q.fundamento)]));
  sec('quoruns', 'Como o plano se aprova em cada via', 'Na RJ, o plano é votado por classe em assembleia (ou por termo de adesão); na RE, basta a adesão escrita dos credores abrangidos, sem assembleia.', [
    linha(col(6, `${titulo('Recuperação judicial')}${lq(QUORUNS.rj)}`), col(6, `${titulo('Recuperação extrajudicial')}${lq(QUORUNS.re)}`)),
    J.caminhos.length ? linha(col(12, `${titulo('Leitura de caminho (hipóteses de trabalho)')}${J.caminhos.map((c) => `<div class="dg-it">${esc(c)}</div>`).join('')}${nota(esc(J.aviso))}`)) : '',
  ]);

  // 8. Indicadores contábeis
  const C1 = r.contabilI; const C2 = r.contabilII;
  const cont: string[] = [];
  if (!('semDados' in C1) && C1.faturamento) {
    const fa = C1.faturamento;
    cont.push(linha(col(12, `${titulo('Faturamento declarado por ano · fiscal x gerencial (R$ mi)')}<figure class="dg-fig">${barras({ categorias: fa.linhas.map((l) => String(l.ano)), series: [{ nome: 'Faturamento fiscal', cor: 's1', valores: fa.linhas.map((l) => l.fiscal) }, { nome: 'Faturamento gerencial', cor: 's2', valores: fa.linhas.map((l) => l.gerencial) }] })}</figure>${nota(`Diferença acumulada (gerencial menos fiscal): <b class="${neg(-fa.diferencaAcumulada).trim()}">${brl(fa.diferencaAcumulada)}</b>${fa.percentualSobreFiscal !== null ? `, ${pct(fa.percentualSobreFiscal)} sobre o fiscal` : ''}.`)}`)));
  }
  if (!('semDados' in C1) && C1.dre.length) {
    const d = C1.dre;
    cont.push(linha(col(7, `${titulo('Resultado do exercício · contábil x gerencial (R$ mi)')}<figure class="dg-fig">${barras({ W: 152, H: 60, categorias: d.map((x) => String(x.ano)), series: [{ nome: 'DRE contábil', cor: 's1', valores: d.map((x) => x.contabil?.resultado ?? null) }, { nome: 'DRE gerencial', cor: 's2', valores: d.map((x) => x.gerencial?.resultado ?? null) }], casas: 2 })}</figure>`),
      col(5, `${titulo('Resultado e receita (R$ mi)')}${tabela([{ t: 'Ano' }, { t: 'Contábil', n: true }, { t: 'Gerencial', n: true }, { t: 'Receita contábil', n: true }], d.map((x) => [String(x.ano), `<span class="${neg(x.contabil?.resultado).trim()}">${mi2(x.contabil?.resultado)}</span>`, `<span class="${neg(x.gerencial?.resultado).trim()}">${mi2(x.gerencial?.resultado)}</span>`, mi2(x.contabil?.receita)]))}${d.some((x) => x.sinalOposto) ? nota('<span class="neg">Resultados com sinais opostos entre as duas versões: indício de duas contabilidades, a esclarecer com o contador.</span>') : ''}`)));
  }
  if (!('semDados' in C2)) {
    const bs = C2.balancos;
    cont.push(linha(col(12, `${titulo('Balanço por exercício · ativo, exigível e patrimônio líquido (R$ mi)')}<figure class="dg-fig">${barras({ H: 66, categorias: bs.map((b) => String(b.exercicio)), series: [{ nome: 'Ativo total', cor: 's1', valores: bs.map((b) => b.ativo) }, { nome: 'Exigível', cor: 's3', valores: bs.map((b) => b.exigivel) }, { nome: 'Patrimônio líquido', cor: 's2', valores: bs.map((b) => b.patrimonioLiquido) }] })}</figure>`)));
    cont.push(linha(col(12, `${tabela([{ t: 'Exercício' }, { t: 'Ativo (R$ mi)', n: true }, { t: 'Exigível (R$ mi)', n: true }, { t: 'PL (R$ mi)', n: true }, { t: 'Liquidez corrente', n: true }, { t: 'Exigível / ativo', n: true }, { t: 'Fecha?', w: '22%' }],
      bs.map((b) => [`<b>${b.exercicio}</b>${ref(b.ref)}`, mi2(b.ativo), mi2(b.exigivel), `<span class="${neg(b.patrimonioLiquido).trim()}">${mi2(b.patrimonioLiquido)}</span>`, b.liquidezCorrente === null ? '·' : dec(b.liquidezCorrente, 2), b.exigivelSobreAtivo === null ? '·' : dec(b.exigivelSobreAtivo, 2), b.fecha ? selo('ok', 'Fecha') : `${selo('mal', 'Não fecha')}<span class="sub">diferença ${brl(b.diferenca)}</span>`]))}
      ${C2.ausentes.length ? nota(`<span class="neg">Exercícios sem demonstração: ${C2.ausentes.join(', ')}.</span>`) : ''}${C2.assinaturaTardia.length ? nota(`Assinadas muito depois do exercício (indício de demonstração feita sob demanda): ${C2.assinaturaTardia.map((a) => `${a.exercicio} em ${dataBR(String(a.assinadoEm))}`).join('; ')}.`) : ''}`)));
  }
  const pl = !('semDados' in C2) ? C2.balancos.at(-1) : undefined;
  sec('contabil', pl ? `Patrimônio líquido de ${mi(pl.patrimonioLiquido)} em ${pl.exercicio}` : 'Faturamento, resultado e balanço', 'Números extraídos das demonstrações e planilhas entregues; cada linha indica o arquivo de origem. Divergências são mostradas, nunca corrigidas.',
    cont.length ? cont : [linha(col(12, vazio([...('semDados' in C1 ? C1.pedir : []), ...('semDados' in C2 ? C2.pedir : [])])))]);

  // 9. Indicadores financeiros
  const F1 = r.financeiroI; const F2 = r.financeiroII; const fin: string[] = [];
  if (!('semDados' in F1)) for (const x of F1.extratos) {
    fin.push(linha(col(3, kpi(mi(x.entradasTotal), `entradas · ${x.banco}`)), col(3, kpi(mi(x.saidasTotal), 'saídas')), col(3, kpi(pct(x.percentualDiasNegativos), 'dos dias com saldo negativo', x.percentualDiasNegativos >= 30 ? 'mal' : 'neutro')),
      col(3, kpi(x.percentualFomentoNasEntradas === null ? 'não informado' : pct(x.percentualFomentoNasEntradas), 'das entradas vindas de fomento', (x.percentualFomentoNasEntradas ?? 0) >= 25 ? 'mal' : 'neutro'))));
    if (x.meses.length) fin.push(linha(col(12, `${titulo(`${x.banco} · entradas e saídas por mês (R$ mi)`)}<figure class="dg-fig">${barras({ H: 62, categorias: x.meses.map((m) => mesCurto(m.mes)), series: [{ nome: 'Entradas', cor: 's1', valores: x.meses.map((m) => m.entradas) }, { nome: 'Saídas', cor: 's3', valores: x.meses.map((m) => m.saidas) }], casas: x.meses.length > 9 ? 1 : 2 })}</figure>${nota(`${x.queda ? `Entrada média de ${brl(x.queda.mediaInicial)} nos cinco primeiros meses e de ${brl(x.queda.mediaFinal)} nos demais (${x.queda.variacaoPercentual > 0 ? '+' : ''}${dec(x.queda.variacaoPercentual)}%). ` : ''}Fonte: ${esc(x.ref.arquivo)}.`)}`)));
  }
  if (!('semDados' in F2)) {
    const P = F2.passivo!;
    fin.push(linha(col(F2.abc ? 7 : 12, `${titulo('Passivo por fonte (R$ mi)')}${tabela([{ t: 'Fonte' }, { t: 'Passivo total', n: true }, { t: 'Passivo fiscal', n: true }], P.fontes.map((f) => [`${esc(f.fonte)}${ref(f.ref)}`, mi2(f.total), mi2(f.fiscal)]))}${nota(`Faixa do passivo total: ${brl(P.total.minimo)} a ${brl(P.total.maximo)}.${P.fiscal ? ` Passivo fiscal: ${brl(P.fiscal.minimo)} a ${brl(P.fiscal.maximo)}.` : ''} A divergência entre fontes é mostrada como faixa, nunca como média.`)}`),
      F2.abc ? col(5, `${titulo('Concentração de clientes')}<div class="dg-linha" style="margin-bottom:3mm">${col(4, kpi(pct(F2.abc.top1), 'maior cliente'))}${col(4, kpi(pct(F2.abc.top5), 'cinco maiores'))}${col(4, kpi(pct(F2.abc.top10), 'dez maiores'))}</div>${(F2.abc as { principais?: { nome: string; valor: number; percentual: number | null }[] }).principais?.length ? tabela([{ t: 'Cliente' }, { t: '%', n: true }], (F2.abc as { principais: { nome: string; percentual: number | null }[] }).principais.slice(0, 6).map((c) => [esc(c.nome), c.percentual === null ? '·' : dec(c.percentual)])) : ''}`) : ''));
  }
  const ex0 = !('semDados' in F1) ? [...F1.extratos].sort((a, b) => b.entradasTotal - a.entradasTotal)[0] : undefined;
  sec('financeiro', ex0?.percentualFomentoNasEntradas != null && ex0.percentualFomentoNasEntradas >= 25 ? `Caixa dependente de fomento: ${dec(ex0.percentualFomentoNasEntradas, 0)}% das entradas no ${ex0.banco}` : 'Extratos, passivo e clientes', 'Movimento bancário classificado pela contraparte (fomento, tributos, cartórios, partes relacionadas). O passivo aparece por fonte, com a faixa entre elas.',
    fin.length ? fin : [linha(col(12, vazio([...('semDados' in F1 ? F1.pedir : []), ...('semDados' in F2 ? F2.pedir : [])])))]);

  // 10. Patrimônio
  const P = r.patrimonio; const S = (P as { socios?: PatrimonioDosSocios | null }).socios;
  const SIT_SOCIO: Record<string, [Tom, string]> = { critico: ['mal', 'Garantidor com bens'], atencao: ['meio', 'Bens onerados'], levantar: ['info', 'Bens a levantar'], sem_risco_aparente: ['ok', 'Sem risco aparente'] };
  const pat: string[] = [];
  if (S && S.socios.length) {
    pat.push(linha(col(3, kpi(String(S.socios.length), 'sócio(s) mapeado(s)')), col(3, kpi(mi(S.total / 100), 'patrimônio informado')), col(3, kpi(mi(S.onerado / 100), 'com ônus', S.onerado ? 'meio' : 'neutro')), col(3, kpi(String(S.garantidores), 'avalista(s) ou fiador(es)', S.garantidores ? 'mal' : 'neutro'))));
    pat.push(linha(col(12, `${titulo('Quadro por sócio')}${tabela([{ t: 'Sócio', w: '24%' }, { t: 'Bens' }, { t: 'Total', n: true }, { t: 'Onerado', n: true }, { t: 'Situação', w: '15%' }], S.socios.map((x) => [`<b>${esc(x.socio)}</b>${x.qualificacao ? `<span class="sub">${esc(x.qualificacao)}</span>` : ''}`, x.porNatureza.map((nn) => `${esc(nn.rotulo)} (${nn.quantidade})`).join(', ') || '<span class="sub" style="margin:0">a levantar</span>', x.bens ? brl(x.total / 100) : '·', x.onerado ? brl(x.onerado / 100) : '·', selo(...(SIT_SOCIO[x.situacao] ?? SIT_SOCIO.levantar!))]))}`)));
    if (S.alertas.length) pat.push(linha(col(12, `${titulo('O que olhar')}${S.alertas.map((a) => `<div class="dg-it ${a.tom === 'erro' ? 'mal' : 'meio'}"><b>${esc(a.titulo)}.</b> ${esc(a.detalhe)}</div>`).join('')}`)));
  } else pat.push(linha(col(12, vazio(P.pedir))));
  if (P.parteRelacionadaPorBanco.some((b) => b.entradas || b.saidas)) pat.push(linha(col(12, `${titulo('Fluxos com partes relacionadas nos extratos')}${tabela([{ t: 'Conta' }, { t: 'Entradas', n: true }, { t: 'Saídas', n: true }, { t: 'Líquido', n: true }], P.parteRelacionadaPorBanco.map((b) => [esc(b.banco), brl(b.entradas), brl(b.saidas), `<span class="${neg(b.liquido).trim()}">${brl(b.liquido)}</span>`]))}${nota('Créditos de sócios e de empresas do grupo não votam na assembleia (art. 43) nem contam na adesão da RE (art. 163, § 3º, II).')}`)));
  sec('patrimonio', S?.garantidores ? 'Sócios garantidores com patrimônio exposto' : 'Patrimônio dos sócios e grupo econômico', 'Bens declarados ou levantados, ônus e garantias prestadas pelos sócios. A relação de bens particulares dos sócios controladores e administradores instrui a petição (art. 51, VI).', pat);

  // 11. Riscos
  const altos = r.riscos.filter((x) => x.prioridade === 'Alta').length;
  sec('riscos', altos ? `${altos} risco(s) de prioridade alta` : 'Riscos e por que importam', 'Cada linha diz se é fato (calculado dos documentos), hipótese de trabalho ou pendência. Nada aqui afirma conduta ilícita.', [
    linha(col(12, r.riscos.length ? tabela([{ t: 'Tema', w: '14%' }, { t: 'Achado', w: '33%' }, { t: 'Por que importa' }, { t: 'Natureza', w: '9%' }, { t: 'Prioridade', w: '9%' }],
      r.riscos.map((x) => [`<b>${esc(x.tema)}</b>`, esc(x.achado), esc(x.porQueImporta), esc(x.natureza === 'fato' ? 'Fato' : x.natureza === 'hipotese' ? 'Hipótese' : 'Pendência'), selo(x.prioridade === 'Alta' ? 'mal' : 'meio', x.prioridade === 'Alta' ? 'Alta' : 'Média')])) : vazio(['Documentos contábeis e financeiros para calcular os indícios']))),
  ]);

  // 12. Conclusões
  const L = r.limites; const passos = r.proximosPassos;
  const pend51 = J.documentosArt51?.filter((d) => d.situacao !== 'entregue').length ?? 0;
  const foraPct = M ? (M.foraDaRj / M.total) * 100 : null;
  const mancheteFinal = impeditivo ? 'Esclarecer o impeditivo antes de qualquer pedido'
    : pend51 ? 'Completar a base documental antes de escolher a via' : foraPct !== null && foraPct >= 35 ? 'A RJ precisa vir acompanhada de tratamento do passivo que fica fora' : 'Base suficiente para decidir a via';
  const resumoFinal = [altos ? `${altos} risco(s) de prioridade alta` : 'nenhum risco de prioridade alta calculado', J.documentosArt51 ? `${pend51} de 11 incisos do art. 51 sem documento completo` : '', foraPct !== null ? `${dec(foraPct)}% do passivo fora da recuperação judicial` : 'passivo ainda sem abertura por natureza']
    .filter(Boolean).join('; ');
  sec('conclusoes', mancheteFinal, `${esc(resumoFinal[0]!.toUpperCase() + resumoFinal.slice(1))}. As frentes abaixo organizam o trabalho até a decisão sobre a via.`, [
    J.caminhos.length ? linha(col(12, `${titulo('Leitura de caminho')}${J.caminhos.map((c) => `<div class="dg-it">${esc(c)}</div>`).join('')}`)) : '',
    linha(...passos.map((f, i) => col(passos.length > 3 && i >= 3 ? 12 / (passos.length - 3) : 4, `<div class="dg-painel"><h3>${esc(f.frente)}</h3>${f.itens.map((t) => `<div class="dg-it">${esc(t)}</div>`).join('')}</div>`)).slice(0, 3)),
    passos.length > 3 ? linha(...passos.slice(3).map((f) => col(12 / (passos.length - 3), `<div class="dg-painel"><h3>${esc(f.frente)}</h3>${f.itens.map((t) => `<div class="dg-it">${esc(t)}</div>`).join('')}</div>`))) : '',
    linha(col(12, `${titulo('Limites desta análise')}<p class="dg-nota" style="font-size:8pt">Arquivos lidos: ${L.lidos}. Sem leitura confiável: ${L.ilegiveis.length}${L.ilegiveis.length ? ` (${L.ilegiveis.slice(0, 5).map((i) => esc(i.nome)).join('; ')})` : ''}. ${L.leitura.length ? `Avisos de leitura: ${L.leitura.slice(0, 5).map(esc).join('; ')}. ` : ''}Não consultado: ${L.naoConsultado.map(esc).join(', ')}. ${esc(L.observacao)}</p><p class="dg-nota" style="font-size:8pt">${esc(r.aviso)} ${esc(J.aviso)}</p>`)),
  ]);

  const capa = `<section class="pg capa"><div class="marca">NGA<i>LAB</i></div><div class="capa-meio"><div class="capa-fio"></div><h1>${esc(C.titulo)}</h1><div class="capa-emp">${esc(C.razaoSocial)}</div>${C.cnpj ? `<div class="capa-sub">CNPJ ${esc(C.cnpj)}</div>` : ''}<div class="capa-sub">${esc(C.escopo)}</div><div class="capa-sub">Projeto ${esc(C.projeto)}</div></div>
    <div class="capa-pe"><div>Data-base<b>${esc(dataBR(C.dataBase))}</b></div><div>Versão<b>${r.versao}</b></div><div>Elaborado por<b>${esc(r.geradoPor)}</b></div><div>Classificação<b>${esc(C.confidencialidade)}</b></div></div></section>`;
  const sumario = `<section class="pg sum" data-sumario><div class="pg-cab"><div class="marca">NGA<i>LAB</i></div><div>Diagnóstico inicial · ${esc(C.razaoSocial)}</div></div><div class="pg-corpo"><div class="dg-k">Sumário</div><h2>Conteúdo</h2><ol>${SECOES.map(([id, t], i) => `<li><span>${String(i + 1).padStart(2, '0')}</span><span>${esc(t)}<em>${esc(DESCR[id] ?? '')}</em></span><span class="dg-pag" data-pag="${id}"></span></li>`).join('')}</ol>
    <p class="sum-nota">Leitura automática dos documentos entregues pelo cliente, para revisão profissional. Os fundamentos citam a Lei 11.101/2005 na redação da Lei 14.112/2020. Todo número traz o arquivo de origem; o que não foi entregue aparece como pendência.</p></div><div class="pg-rod"><span>${esc(C.confidencialidade)}</span><span class="pg-n"></span></div></section>`;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Diagnóstico inicial · ${esc(C.razaoSocial)}</title><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&display=swap"><style>${CSS}</style></head>`
    + `<body class="dg" data-empresa="${esc(C.razaoSocial)}" data-rodape="${esc(C.confidencialidade)}">${capa}${sumario}<main class="dg-fluxo">${s.join('')}</main></body></html>`;
}
