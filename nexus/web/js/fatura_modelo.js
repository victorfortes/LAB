/**
 * Fatura no modelo oficial do escritório.
 *
 * Word: abre o próprio modelo (web/img/fatura/modelo.docx, com fontes embutidas), troca só os textos
 * (data, cliente, CNPJ, descrição, vencimento, valor e total) e devolve o arquivo. Todo o resto do
 * documento (papel timbrado, caixas, cores, posições) sai byte a byte igual ao modelo.
 * Tela e PDF: a mesma página desenhada em HTML A4, com as medidas e as fontes do modelo (ver LAYOUT).
 */

// Textos do modelo que serão trocados (é a fatura que serviu de base).
const MODELO = {
  data: 'Curitiba, 05 de novembro de 2026.', cliente: 'DEVILLE HOTEIS E TURISMO LTDA', cnpj: 'CNPJ 81.071.623/0001-57',
  descricao: 'Honorários Advocatícios Mensais', vencimento: '10/11/2026', valor: 'R$ 7.294,50',
};

const escXml = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const desXml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/**
 * Troca um texto que o Word pode ter partido em vários `<w:t>` seguidos. A primeira peça recebe o texto
 * novo e as demais ficam vazias, preservando a formatação de cada pedaço. `vezes` limita quantas
 * ocorrências trocar (o cliente aparece duas vezes: versão nova e versão de compatibilidade da caixa).
 */
export function trocarTexto(xml, antigo, novo, { vezes = Infinity, pular = 0 } = {}) {
  const re = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g; const pecas = []; let m;
  while ((m = re.exec(xml))) pecas.push({ ini: m.index, fim: re.lastIndex, texto: desXml(m[1]) });
  const trocas = []; let achadas = 0;
  for (let i = 0; i < pecas.length && trocas.length < vezes; i++) {
    // Não começa em peça vazia (sobra de troca anterior) nem atravessa parágrafo: sem isso o valor do item
    // casava a partir das peças vazias da data e ia parar na célula do vencimento.
    if (!pecas[i].texto) continue;
    let junto = ''; let j = i;
    while (j < pecas.length && junto.length < antigo.length) {
      if (j > i && xml.slice(pecas[j - 1].fim, pecas[j].ini).includes('</w:p>')) break;
      junto += pecas[j].texto; j++; if (!antigo.startsWith(junto)) break;
    }
    if (junto === antigo) { if (achadas++ >= pular) trocas.push([i, j]); i = j - 1; }
  }
  let saida = xml;
  for (const [i, j] of trocas.reverse()) {
    for (let k = j - 1; k >= i; k--) {
      const p = pecas[k]; const texto = k === i ? novo : '';
      saida = `${saida.slice(0, p.ini)}<w:t xml:space="preserve">${escXml(texto)}</w:t>${saida.slice(p.fim)}`;
    }
  }
  return { xml: saida, trocas: trocas.length };
}

export function preencherDocumento(xml, f) {
  let x = xml; const faltou = [];
  const trocar = (a, n, o) => { const r = trocarTexto(x, a, n, o); x = r.xml; if (!r.trocas) faltou.push(a); };
  trocar(MODELO.data, f.cidadeData);
  trocar(MODELO.cliente, f.cliente);
  trocar(MODELO.cnpj, f.cnpj);
  const item = f.itens[0];
  trocar(MODELO.descricao, item.descricao);
  trocar(MODELO.vencimento, item.vencimento);
  // O valor aparece duas vezes: na linha do item e no TOTAL.
  trocar(MODELO.valor, item.valor, { vezes: 1 });
  trocar(MODELO.valor, f.total, { vezes: 1 });
  if (faltou.length) throw new Error(`o modelo da fatura mudou: não achei ${faltou.join(', ')}`);
  return x;
}

// ------------------------------------------------------------------ zip mínimo ---
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
const fluxo = async (bytes, t) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(t)).arrayBuffer());

function lerEntradas(buf) {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = buf.length - 22; while (eocd >= 0 && v.getUint32(eocd, true) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('modelo .docx inválido');
  const n = v.getUint16(eocd + 10, true); let p = v.getUint32(eocd + 16, true); const ents = [];
  for (let i = 0; i < n; i++) {
    const nl = v.getUint16(p + 28, true), el = v.getUint16(p + 30, true), cl = v.getUint16(p + 32, true);
    const e = { metodo: v.getUint16(p + 10, true), hora: v.getUint16(p + 12, true), data: v.getUint16(p + 14, true), crc: v.getUint32(p + 16, true), comp: v.getUint32(p + 20, true), tam: v.getUint32(p + 24, true), local: v.getUint32(p + 42, true), nome: new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nl)) };
    const lnl = v.getUint16(e.local + 26, true), lel = v.getUint16(e.local + 28, true);
    e.bytes = buf.subarray(e.local + 30 + lnl + lel, e.local + 30 + lnl + lel + e.comp);
    ents.push(e); p += 46 + nl + el + cl;
  }
  return ents;
}

function montarZip(ents) {
  const enc = new TextEncoder(); const partes = []; const central = []; let off = 0;
  for (const e of ents) {
    const nome = enc.encode(e.nome);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, e.metodo, true); h.setUint16(10, e.hora, true); h.setUint16(12, e.data, true);
    h.setUint32(14, e.crc, true); h.setUint32(18, e.bytes.length, true); h.setUint32(22, e.tam, true); h.setUint16(26, nome.length, true); h.setUint16(28, 0, true);
    partes.push(new Uint8Array(h.buffer), nome, e.bytes);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, e.metodo, true); c.setUint16(12, e.hora, true); c.setUint16(14, e.data, true);
    c.setUint32(16, e.crc, true); c.setUint32(20, e.bytes.length, true); c.setUint32(24, e.tam, true); c.setUint16(28, nome.length, true); c.setUint32(42, off, true);
    central.push(new Uint8Array(c.buffer), nome);
    off += 30 + nome.length + e.bytes.length;
  }
  const tamCentral = central.reduce((s, b) => s + b.length, 0);
  const fim = new DataView(new ArrayBuffer(22));
  fim.setUint32(0, 0x06054b50, true); fim.setUint16(8, ents.length, true); fim.setUint16(10, ents.length, true); fim.setUint32(12, tamCentral, true); fim.setUint32(16, off, true);
  return new Blob([...partes, ...central, new Uint8Array(fim.buffer)], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

export async function gerarWord(f) {
  const r = await fetch('/img/fatura/modelo.docx', { credentials: 'same-origin' });
  if (!r.ok) throw new Error('modelo da fatura indisponível');
  const ents = lerEntradas(new Uint8Array(await r.arrayBuffer()));
  const doc = ents.find((e) => e.nome === 'word/document.xml');
  const xml = new TextDecoder().decode(doc.metodo === 8 ? await fluxo(doc.bytes, new DecompressionStream('deflate-raw')) : doc.bytes);
  const novo = new TextEncoder().encode(preencherDocumento(xml, f));
  Object.assign(doc, { metodo: 8, bytes: await fluxo(novo, new CompressionStream('deflate-raw')), crc: crc32(novo), tam: novo.length });
  return montarZip(ents);
}

// ------------------------------------------------------------- tela e PDF (HTML A4) ---
//
// Réplica da página do modelo medida no próprio Word (exportado em PDF e comparado ponto a ponto). Todas as
// medidas abaixo saem do XML do modelo: página A4 com margens de 0,5" (12,7 mm), o corpo começa onde o
// cabeçalho termina (20 mm + duas linhas de Calibri 11 = 29,47 mm), as caixas e os ícones são objetos
// ancorados (posições em EMU convertidas para mm) e cada parágrafo vazio entre a tabela e os dados
// bancários mede 1,15 × 1,2 × 11,5 pt. As fontes são as mesmas que o .docx embute (Lato 2.015 e Inter Tight
// Bold), servidas daqui, para que tela, PDF e Word tenham a mesma letra.
//
// No Word o espaço extra do entrelinhamento fica embaixo da linha; no navegador fica metade em cima e metade
// embaixo (e o Word não aplica kerning nem ligaduras). Por isso os blocos com entrelinha 1,15 sobem 0,09 em (= (1,38 − 1,2) / 2). Quando o texto não cabe
// na caixa (dados bancários, 4 linhas), o Word o prende no topo em vez de centralizar: daí o `safe center`.

const AZUL = '#17283B'; const OURO = '#BE8E57'; const CINZA = '#767171';
const LIN = 1.15 * 1.2; // entrelinha 1,15 sobre a altura natural da Lato (ascendente + descendente = 1,2 em)

/** Posições em mm (x, y, largura, altura) tiradas do modelo. */
export const LAYOUT = Object.freeze({
  papel: [0, -1.06, 210.88, 298.06],
  logo: [19.985, 26.863, 48.031, 27.005],
  titulo: [77.04, 29.474], data: [77.04, 40.542],
  cliente: { caixa: [12.929, 65.357, 185.085, 23], quadro: [12.541, 65.375, 38.523, 23], icone: [21.978, 66.98, 19.685, 19.685] },
  tabela: { x: 12.435, y: 93.956, colunas: [120.297, 25.333, 39.64], cabecalho: 14.412, item: 14.412, total: 16.122 },
  banco: { caixa: [12.929, 234.868, 185.085, 23], quadro: [12.541, 234.851, 38.523, 23], icone: [22.331, 236.667, 19.262, 19.262] },
  // Texto das caixas: recuo de 2.494 twips (43,99 mm) + margem interna de 0,1" (2,54 mm) e 0,05" (1,27 mm).
  recuoTexto: 43.992, folgaX: 2.54, folgaY: 1.27,
});

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const mm = (n) => `${n}mm`;
const caixa = ([x, y, w, h]) => `left:${mm(x)};top:${mm(y)};width:${mm(w)};height:${mm(h)}`;

/** Folha A4 da fatura (só o corpo, sem `<html>`), usada na tela e na impressão. */
export function folhaDaFatura(f, base = location.origin) {
  const img = (n) => `${base}/img/fatura/${n}`; const L = LAYOUT; const t = L.tabela;
  const bloco = (c, conteudo) => `<div class="fx-texto" style="${caixa(c)};padding:${mm(L.folgaY)} ${mm(L.folgaX)} ${mm(L.folgaY)} ${mm(L.folgaX + L.recuoTexto)}"><div>${conteudo}</div></div>`;
  const itens = f.itens.map((i) => `<tr style="height:${mm(t.item)}"><td><span><b>${esc(i.descricao)}</b></span></td><td><span>${esc(i.vencimento)}</span></td><td><span>${esc(i.valor)}</span></td></tr>`).join('');
  return `<section class="fx-pg" aria-label="Fatura ${esc(f.numero ?? '')}">
<img class="fx-abs" style="${caixa(L.papel)}" src="${img('papel.png')}" alt="">
<img class="fx-abs" style="${caixa(L.logo)}" src="${img('logo.png')}" alt="NGA ADV">
<div class="fx-abs fx-tit" style="left:${mm(L.titulo[0])};top:${mm(L.titulo[1])}">FATURA – PRESTAÇÃO DE SERVIÇOS</div>
<div class="fx-abs fx-data" style="left:${mm(L.data[0])};top:${mm(L.data[1])}">${esc(f.cidadeData)}</div>
<div class="fx-abs fx-ouro" style="${caixa(L.cliente.caixa)}"></div>${bloco(L.cliente.caixa, `<b>CLIENTE:</b><br>${esc(f.cliente)}${f.cnpj ? `<br>${esc(f.cnpj)}` : ''}`)}
<div class="fx-abs fx-azul" style="${caixa(L.cliente.quadro)}"></div><img class="fx-abs" style="${caixa(L.cliente.icone)}" src="${img('cliente.svg')}" alt="">
<table class="fx-abs fx-tab" style="left:${mm(t.x)};top:${mm(t.y)};width:${mm(t.colunas.reduce((a, b) => a + b, 0))}">
<colgroup>${t.colunas.map((c) => `<col style="width:${mm(c)}">`).join('')}</colgroup>
<tr class="fx-cab" style="height:${mm(t.cabecalho)}"><th><span>DESCRIÇÃO</span></th><th><span>VENC.</span></th><th><span>VALOR</span></th></tr>
${itens}
<tr class="fx-tot" style="height:${mm(t.total)}"><td></td><td><span>TOTAL</span></td><td><span>${esc(f.total)}</span></td></tr></table>
<div class="fx-abs fx-ouro" style="${caixa(L.banco.caixa)}"></div>${bloco(L.banco.caixa, '<b>Banco Itaú – 341 </b>| Ag 3835 | C/C 54.188-3<br>NITSCHKE, GRABOSKI &amp; ADVOGADOS ASSOCIADOS<br>CNPJ 07.045.249/0001-62<br>PIX: 07045249000162')}
<div class="fx-abs fx-azul" style="${caixa(L.banco.quadro)}"></div><img class="fx-abs" style="${caixa(L.banco.icone)}" src="${img('banco.svg')}" alt="">
</section>`;
}

/** CSS da folha (fontes do modelo e posições fixas em mm). */
export function cssDaFatura(base = location.origin) {
  const fonte = (familia, peso, arq) => `@font-face{font-family:'${familia}';font-weight:${peso};font-style:normal;font-display:block;src:url('${base}/img/fatura/fontes/${arq}') format('truetype')}`;
  return `${fonte('NGA Lato', 400, 'Lato-Regular.ttf')}${fonte('NGA Lato', 700, 'Lato-Bold.ttf')}${fonte('NGA Inter Tight', 700, 'InterTight-Bold.ttf')}
.fx-pg{position:relative;width:210mm;height:297mm;overflow:hidden;background:#fff;color:#000;font:400 11pt/1.2 'NGA Lato',Lato,Arial,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact;text-rendering:geometricPrecision;font-variant-ligatures:none;font-kerning:none}
.fx-pg *{box-sizing:border-box}
.fx-abs{position:absolute;margin:0;display:block}
.fx-tit{font:700 16pt/1.2109 'NGA Inter Tight','Inter Tight',Arial,sans-serif;color:${AZUL};white-space:nowrap;letter-spacing:.0125em}
.fx-data{font-size:11pt;line-height:1.2;color:${CINZA};white-space:nowrap}
.fx-ouro{background:${OURO}}.fx-azul{background:${AZUL}}
.fx-texto{position:absolute;display:flex;flex-direction:column;justify-content:safe center;color:#fff;line-height:${LIN}}
.fx-texto>div{position:relative;top:-.09em}
.fx-tab{border-collapse:collapse;border-spacing:0;table-layout:fixed;line-height:${LIN}}
.fx-tab th,.fx-tab td{padding:0 1.905mm;text-align:center;vertical-align:middle;font-weight:400;border:0}
.fx-tab span{position:relative;top:-.09em}
.fx-cab th{background:${AZUL};color:#fff;font-weight:700}
.fx-tot td+td{background:${OURO};color:#fff;font-weight:700}`;
}

export function htmlDaFatura(f, base = location.origin) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(f.arquivo)}</title>
<style>@page{size:210mm 297mm;margin:0}html,body{margin:0;padding:0;background:#fff}@media print{html,body{width:210mm;height:297mm;overflow:hidden}}${cssDaFatura(base)}</style></head><body>${folhaDaFatura(f, base)}</body></html>`;
}

function quadroDaFatura(f) {
  const q = document.createElement('iframe');
  q.title = `Fatura ${f.numero ?? ''}`; q.srcdoc = htmlDaFatura(f);
  return q;
}

/** Espera fontes e imagens da folha antes de imprimir ou mostrar (sem isso o PDF sai com a letra trocada). */
async function pronto(q) {
  await new Promise((r) => { if (q.contentDocument?.readyState === 'complete' && q.contentDocument.body?.childElementCount) r(); else q.addEventListener('load', r, { once: true }); });
  const d = q.contentDocument; if (!d) return;
  await Promise.all([d.fonts?.ready, ...[...d.images].map((i) => (i.complete ? null : new Promise((r) => { i.onload = i.onerror = r; })))]);
}

/** Abre a janela de impressão com a fatura (o usuário escolhe "Salvar como PDF"). */
export async function imprimirFatura(f) {
  const q = quadroDaFatura(f);
  q.setAttribute('aria-hidden', 'true'); q.style.cssText = 'position:fixed;right:0;bottom:0;width:210mm;height:297mm;border:0;opacity:0;pointer-events:none';
  document.body.appendChild(q);
  await pronto(q);
  const t = document.title; document.title = f.arquivo; q.contentWindow.focus(); q.contentWindow.print(); document.title = t;
  setTimeout(() => q.remove(), 60_000);
}

/**
 * Mostra a fatura na tela, do jeito que sai no PDF e no Word, com os botões de baixar.
 * `acoes` recebe { word, pdf } (funções); um botão some quando a função não vem.
 */
export function verFatura(f, acoes = {}) {
  const fundo = document.createElement('div'); fundo.className = 'fat-visor'; fundo.setAttribute('role', 'dialog'); fundo.setAttribute('aria-modal', 'true'); fundo.setAttribute('aria-label', `Fatura ${f.numero ?? ''}`);
  fundo.innerHTML = `<div class="fat-visor__barra"><div><b>${esc(f.numero ?? 'Fatura')}</b><small>${esc(f.cliente)}</small></div>
    <div class="fat-visor__acts">${acoes.word ? '<button type="button" class="btn btn--ghost btn--sm" data-v="word">Baixar Word</button>' : ''}${acoes.pdf ? '<button type="button" class="btn btn--accent btn--sm" data-v="pdf">Imprimir / PDF</button>' : ''}<button type="button" class="btn btn--ghost btn--sm" data-v="fechar" aria-label="Fechar">Fechar</button></div></div>
    <div class="fat-visor__palco"><div class="fat-visor__folha"></div></div>`;
  const q = quadroDaFatura(f); q.className = 'fat-visor__quadro'; fundo.querySelector('.fat-visor__folha').append(q);
  const ajustar = () => {
    const palco = fundo.querySelector('.fat-visor__palco'); const folha = fundo.querySelector('.fat-visor__folha');
    const pxMm = 96 / 25.4; const w = 210 * pxMm; const h = 297 * pxMm;
    const esc2 = Math.min((palco.clientWidth - 32) / w, (palco.clientHeight - 32) / h, 1.4);
    folha.style.width = `${w * esc2}px`; folha.style.height = `${h * esc2}px`; q.style.transform = `scale(${esc2})`;
  };
  const anterior = document.activeElement;
  const fechar = () => { removeEventListener('resize', ajustar); removeEventListener('keydown', tecla); fundo.remove(); anterior?.focus?.(); };
  const tecla = (e) => { if (e.key === 'Escape') fechar(); };
  fundo.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-v]'); if (!b) { if (e.target === fundo) fechar(); return; }
    if (b.dataset.v === 'fechar') return fechar();
    b.disabled = true; try { await acoes[b.dataset.v]?.(); } finally { b.disabled = false; }
  });
  document.body.append(fundo); addEventListener('resize', ajustar); addEventListener('keydown', tecla); ajustar();
  fundo.querySelector('[data-v="fechar"]').focus();
  return fechar;
}

export function baixar(blob, nome) {
  const u = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = u; a.download = nome; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 30_000);
}
