/**
 * Fatura no modelo oficial do escritório.
 *
 * Word: abre o próprio modelo (web/img/fatura/modelo.docx, com fontes embutidas), troca só os textos
 * (data, cliente, CNPJ, descrição, vencimento, valor e total) e devolve o arquivo. Todo o resto do
 * documento (papel timbrado, caixas, cores, posições) sai byte a byte igual ao modelo.
 * PDF: a mesma página desenhada em HTML A4 sobre o papel timbrado do modelo, impressa pelo navegador.
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
    let junto = ''; let j = i;
    while (j < pecas.length && junto.length < antigo.length) { junto += pecas[j].texto; j++; if (!antigo.startsWith(junto)) break; }
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

// ------------------------------------------------------------------- PDF (HTML A4) ---
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function htmlDaFatura(f, base = location.origin) {
  const img = (n) => `${base}/img/fatura/${n}`;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(f.arquivo)}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;600;700&family=Lato:wght@400;700&display=swap">
<style>
@page{size:210mm 297mm;margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0}
body{font-family:Lato,Arial,sans-serif;font-size:11pt;color:#000;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.pg{position:relative;width:210mm;height:297mm;overflow:hidden;background:#fff url('${img('papel.png')}') 0 0/210mm 297mm no-repeat}
.abs{position:absolute}
.logo{left:17mm;top:20mm;width:48mm;height:27mm;background:url('${img('logo.png')}') center/contain no-repeat}
.tit{left:75mm;top:27mm;font:400 16pt 'Inter Tight',Arial,sans-serif;color:#17283B;letter-spacing:.01em}
.dt{left:75mm;top:37mm;font-size:11pt;color:#767171}
.caixa{left:12.9mm;width:185mm;height:23mm;background:#BE8E57}
.quad{left:12.6mm;width:38.5mm;height:23mm;background:#17283B}
.ico{width:19.6mm;height:19.6mm}
.txt{left:57mm;color:#fff;line-height:1.28}
.txt b.rot{font:700 14pt 'Inter Tight',Arial,sans-serif;color:#17283B}
table{position:absolute;left:12.7mm;top:100mm;width:185.3mm;border-collapse:collapse;table-layout:fixed}
td,th{text-align:center;vertical-align:middle;padding:0 2mm}
th{background:#17283B;color:#fff;font-weight:700;height:12mm;border-left:.3mm solid #fff}
th:first-child{border-left:0}
td{height:14.4mm}
tr.tot td{height:13mm}
tr.tot td.g{background:#BE8E57;color:#fff;font-weight:700;border-left:.3mm solid #fff}
</style></head><body><section class="pg">
<div class="abs logo"></div>
<div class="abs tit">FATURA – PRESTAÇÃO DE SERVIÇOS</div>
<div class="abs dt">${esc(f.cidadeData)}</div>
<div class="abs caixa" style="top:66mm"></div><div class="abs quad" style="top:66mm"></div>
<img class="abs ico" style="left:21.9mm;top:67.7mm" src="${img('cliente.svg')}" alt="">
<div class="abs txt" style="top:68.5mm"><b class="rot">CLIENTE:</b><br>${esc(f.cliente)}<br>${esc(f.cnpj)}</div>
<table><colgroup><col style="width:64.9%"><col style="width:13.7%"><col style="width:21.4%"></colgroup>
<tr><th>DESCRIÇÃO</th><th>VENC.</th><th>VALOR</th></tr>
${f.itens.map((i) => `<tr><td><b>${esc(i.descricao)}</b></td><td>${esc(i.vencimento)}</td><td>${esc(i.valor)}</td></tr>`).join('')}
<tr class="tot"><td></td><td class="g">TOTAL</td><td class="g">${esc(f.total)}</td></tr></table>
<div class="abs caixa" style="top:212mm"></div><div class="abs quad" style="top:218.4mm;height:23mm"></div>
<img class="abs ico" style="left:22.3mm;top:220.6mm" src="${img('banco.svg')}" alt="">
<div class="abs txt" style="top:213.5mm"><b class="rot">Banco Itaú</b><b> – 341</b> | Ag 3835 | C/C 54.188-3<br>NITSCHKE, GRABOSKI &amp; ADVOGADOS ASSOCIADOS<br>CNPJ 07.045.249/0001-62<br>PIX: 07045249000162</div>
</section></body></html>`;
}

/** Abre a janela de impressão com a fatura (o usuário escolhe "Salvar como PDF"). */
export function imprimirFatura(f) {
  const q = document.createElement('iframe');
  q.setAttribute('aria-hidden', 'true'); q.style.cssText = 'position:fixed;right:0;bottom:0;width:210mm;height:297mm;border:0;opacity:0;pointer-events:none';
  q.srcdoc = htmlDaFatura(f); document.body.appendChild(q);
  q.onload = () => { setTimeout(() => { const t = document.title; document.title = f.arquivo; q.contentWindow.focus(); q.contentWindow.print(); document.title = t; setTimeout(() => q.remove(), 60_000); }, 700); };
}

export function baixar(blob, nome) {
  const u = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = u; a.download = nome; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 30_000);
}
