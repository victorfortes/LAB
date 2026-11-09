/** Lê CSV ou .xlsx no navegador e devolve linhas como objetos, com o cabeçalho como chave. */
function csv(texto) {
  const t = texto.replace(/^﻿/, ''), amostra = t.slice(0, 2048);
  const sep = amostra.split(';').length > amostra.split(',').length ? ';' : ',';
  const linhas = []; let lin = [], cel = '', aspas = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (aspas) { if (c === '"' && t[i + 1] === '"') { cel += '"'; i++; } else if (c === '"') aspas = false; else cel += c; }
    else if (c === '"') aspas = true;
    else if (c === sep) { lin.push(cel); cel = ''; }
    else if (c === '\n') { lin.push(cel.replace(/\r$/, '')); linhas.push(lin); lin = []; cel = ''; }
    else cel += c;
  }
  if (cel || lin.length) { lin.push(cel.replace(/\r$/, '')); linhas.push(lin); }
  return linhas;
}
async function entradasZip(buf) {
  const v = new DataView(buf); let eocd = buf.byteLength - 22;
  while (eocd >= 0 && v.getUint32(eocd, true) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('O arquivo não é um Excel .xlsx válido.');
  const n = v.getUint16(eocd + 10, true), out = new Map(); let p = v.getUint32(eocd + 16, true);
  for (let i = 0; i < n; i++) {
    const metodo = v.getUint16(p + 10, true), tam = v.getUint32(p + 20, true), nl = v.getUint16(p + 28, true), xl = v.getUint16(p + 30, true), cl = v.getUint16(p + 32, true), ini = v.getUint32(p + 42, true);
    out.set(new TextDecoder().decode(new Uint8Array(buf, p + 46, nl)), { metodo, tam, ini }); p += 46 + nl + xl + cl;
  }
  return { out, buf, v };
}
async function lerEntrada({ out, buf, v }, nome) {
  const e = out.get(nome); if (!e) return null;
  const dados = new Uint8Array(buf, e.ini + 30 + v.getUint16(e.ini + 26, true) + v.getUint16(e.ini + 28, true), e.tam);
  if (e.metodo === 0) return new TextDecoder().decode(dados);
  return new Response(new Blob([dados]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
}
const coluna = (ref) => [...ref.replace(/\d/g, '')].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
async function xlsx(buf) {
  const z = await entradasZip(buf), xml = (s) => new DOMParser().parseFromString(s, 'application/xml');
  const ss = await lerEntrada(z, 'xl/sharedStrings.xml');
  const comuns = ss ? [...xml(ss).getElementsByTagName('si')].map((si) => [...si.getElementsByTagName('t')].map((t) => t.textContent).join('')) : [];
  const nomeFolha = [...z.out.keys()].filter((k) => /^xl\/worksheets\/[^/]+\.xml$/.test(k)).sort()[0];
  if (!nomeFolha) throw new Error('Planilha vazia.');
  return [...xml(await lerEntrada(z, nomeFolha)).getElementsByTagName('row')].map((r) => {
    const lin = [];
    for (const c of r.getElementsByTagName('c')) { const t = c.getAttribute('t'), val = c.getElementsByTagName('v')[0]?.textContent ?? [...c.getElementsByTagName('t')].map((x) => x.textContent).join(''); lin[coluna(c.getAttribute('r'))] = t === 's' ? comuns[Number(val)] ?? '' : val; }
    return Array.from(lin, (x) => x ?? '');
  });
}
export async function lerPlanilha(arquivo) {
  if (arquivo.size > 5_000_000) throw new Error('Arquivo grande demais (limite de 5 MB).');
  const grade = /\.xlsx$/i.test(arquivo.name) ? await xlsx(await arquivo.arrayBuffer()) : csv(await arquivo.text());
  const [cab, ...resto] = grade; if (!cab) throw new Error('Planilha vazia.');
  const chaves = cab.map((c) => String(c).trim().toLowerCase());
  return resto.filter((l) => l.some((c) => String(c).trim())).map((l) => Object.fromEntries(chaves.map((k, i) => [k, String(l[i] ?? '').trim()])));
}
