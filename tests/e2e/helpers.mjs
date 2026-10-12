export const SENHA = 'Senha-de-teste-123';
export async function entrar(page, email, senha = SENHA) {
  await page.goto('/');
  await page.waitForSelector('#form-login:not([hidden])');
  await page.fill('#login-email', email);
  await page.fill('#login-senha', senha);
  await page.click('#login-entrar');
}
export const gerador = (page) => page.frameLocator('#gerador');
// espera o gerador carregar e a sincronização com o banco ficar pronta
export async function geradorPronto(page) {
  await page.waitForSelector('#gerador:not([hidden])');
  const h = await page.waitForSelector('#gerador');
  const fr = await h.contentFrame();
  await fr.waitForFunction(() => window.__NGA && window.__NGA.Sync && window.__NGA.Sync.estado === 'compartilhado', null, { timeout: 30000 });
  return fr;
}

// sai pelo botão do gerador e espera a casca voltar para a tela de entrada
export async function sair(page, fr) {
  await fr.locator('#topbar-btn-sair').click();
  await page.waitForSelector('#form-login:not([hidden])');
}
// SQL de teste no banco (superusuário), via endpoint que só existe no servidor de teste
export async function sql(request, texto, params = []) {
  const r = await request.post('/__test/sql', { data: { sql: texto, params } });
  return r.json();
}

/* ----------------------------------------------------- equivalência original x migrado */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
const raizProjeto = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const ORIGINAL = path.join(raizProjeto, 'original/artifact-HksuUVxXv21ftK5iF5sFG7-v27.html');

// serve o Artifact original (arquivo preservado) como página, sem alterá-lo, na mesma origem de teste
export async function abrirOriginal(page, context) {
  // O original pede as fontes ao Google; no teste elas vêm dos MESMOS arquivos que o migrado hospeda (web/app/fonts),
  // para a comparação visual não depender de rede nem de timing de carga de fontes.
  const css = readFileSync(path.join(raizProjeto, 'web/app/fonts/fonts.css'), 'utf8').replace(/url\(([0-9a-f]+\.woff2)\)/g, 'url(http://127.0.0.1:8788/app/fonts/$1)');
  await context.route('**://fonts.googleapis.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/css; charset=utf-8', body: css }));
  await context.route('**://fonts.gstatic.com/**', (route) => route.abort());
  await context.route('**/__original.html', (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: readFileSync(ORIGINAL, 'utf8') }));
  await page.addInitScript(() => {
    try { sessionStorage.setItem('nga.acesso.sessao', '1'); sessionStorage.setItem('nga_auth_session_v1', JSON.stringify({ email: 'admin@teste.local', role: 'admin', logadoEm: '2026-01-01T00:00:00Z' })); } catch (e) {}
  });
  await page.goto('/__original.html');
  await page.waitForFunction(() => window.__NGA && window.NGA_EQUIPE && window.NGA_USUARIO, null, { timeout: 30000 });
  return page;
}
// instala o gancho que captura o PDF gerado (antes de ir para o download) e uma série Bacen fixa (sem rede)
export const GANCHOS = () => {
  window.__pdfs = [];
  const orig = window.NGA_SAVE;
  window.NGA_SAVE = function (doc, nome, meta) { try { window.__pdfs.push({ nome, bytes: Array.from(new Uint8Array(doc.output('arraybuffer'))) }); } catch (e) {} return orig.apply(this, arguments); };
  const f = window.fetch.bind(window);
  window.fetch = (u, o) => {
    if (/api\.bcb\.gov\.br|dadosabertos\.bcb/.test(String(u))) {
      const serie = []; for (let a = 2022; a <= 2026; a++) for (let m = 1; m <= 12; m++) serie.push({ data: `01/${String(m).padStart(2, '0')}/${a}`, valor: (1.4 + ((a * 12 + m) % 7) / 50).toFixed(2) });
      return Promise.resolve(new Response(JSON.stringify(serie), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }
    return f(u, o);
  };
};
// lê um PDF (bytes) com o pdf.js do próprio app: texto por página, tamanhos, fontes e imagens renderizadas
export async function analisarPdf(frameOuPage, bytes) {
  return frameOuPage.evaluate(async (arr) => {
    const doc = await window.NGA_ABRIR_PDF(new Uint8Array(arr));
    const paginas = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const pg = await doc.getPage(i), vp = pg.getViewport({ scale: 1 });
      const tc = await pg.getTextContent();
      const vp2 = pg.getViewport({ scale: 1.5 }), cv = document.createElement('canvas'); cv.width = Math.floor(vp2.width); cv.height = Math.floor(vp2.height);
      await pg.render({ canvasContext: cv.getContext('2d'), viewport: vp2 }).promise;
      paginas.push({ w: Math.round(vp.width * 100) / 100, h: Math.round(vp.height * 100) / 100, texto: tc.items.map(t => t.str).join('|'), fontes: [...new Set(tc.items.map(t => t.fontName))].length, png: cv.toDataURL('image/png') });
    }
    return paginas;
  }, Array.from(bytes));
}
export function compararPng(a64, b64) {
  const A = PNG.sync.read(Buffer.from(a64.split(',')[1], 'base64')), B = PNG.sync.read(Buffer.from(b64.split(',')[1], 'base64'));
  if (A.width !== B.width || A.height !== B.height) return { pixels: Infinity, total: A.width * A.height };
  return { pixels: pixelmatch(A.data, B.data, null, A.width, A.height, { threshold: 0.05 }), total: A.width * A.height };
}
export function normalizarPdf(bytes) {   // remove data de criação e ID (únicos por geração) para comparar o restante byte a byte
  let s = Buffer.from(bytes).toString('latin1');
  s = s.replace(/\/CreationDate\s*\(D:[^)]*\)/g, '/CreationDate()').replace(/\/ID\s*\[[^\]]*\]/g, '/ID[]');
  return s;
}
export function compararImagens(bufA, bufB) {
  const A = PNG.sync.read(bufA), B = PNG.sync.read(bufB);
  if (A.width !== B.width || A.height !== B.height) return { pixels: Infinity, total: A.width * A.height };
  return { pixels: pixelmatch(A.data, B.data, null, A.width, A.height, { threshold: 0.1 }), total: A.width * A.height };
}
