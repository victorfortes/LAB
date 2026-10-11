// Equivalência entre o Artifact original (arquivo preservado) e o gerador migrado, com as MESMAS entradas.
// Compara: telas (pixels), PDFs (páginas, tamanho, texto, fontes, render por pixel e bytes normalizados).
import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { entrar, geradorPronto, sql, abrirOriginal, GANCHOS, analisarPdf, compararPng, normalizarPdf, compararImagens } from './helpers.mjs';

// abre os dois lado a lado: original (página solta) e migrado (dentro da casca, logado)
async function abrirAmbos(browser) {
  // estado inicial idêntico: o original começa vazio, então o banco de teste também
  const ctxLimpa = await browser.newContext({ baseURL: 'http://127.0.0.1:8788' });
  await sql(ctxLimpa.request, 'truncate documentos, documentos_versoes, auditoria'); await ctxLimpa.close();
  const ctxO = await browser.newContext({ baseURL: 'http://127.0.0.1:8788', viewport: { width: 1280, height: 800 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
  const ctxM = await browser.newContext({ baseURL: 'http://127.0.0.1:8788', viewport: { width: 1280, height: 800 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
  const T = new Date(Math.floor(Date.now() / 60000) * 60000);   // mesmo instante nos dois lados (carimbos de hora iguais)
  await ctxO.clock.setFixedTime(T); await ctxM.clock.setFixedTime(T);
  const pO = await ctxO.newPage(), pM = await ctxM.newPage();
  await abrirOriginal(pO, ctxO);
  await entrar(pM, 'admin@teste.local');
  const fM = await geradorPronto(pM);
  await pO.evaluate(GANCHOS); await fM.evaluate(GANCHOS);
  return { pO, pM, fM, fechar: async () => { await ctxO.close(); await ctxM.close(); } };
}
const irPara = (ctx, view) => ctx.evaluate((v) => window.NGA_CTX.irPara(v), view);

// ------------------------------------------------------------------------------------------- telas
for (const [nome, view] of [['painel', 'painel'], ['novo-relatorio', 'novo'], ['clientes', 'clientes'], ['regras', 'regras'], ['modelos', 'modelos']]) {
  test(`tela "${nome}" idêntica ao original (mesmo viewport)`, async ({ browser }) => {
    const { pO, pM, fM, fechar } = await abrirAmbos(browser);
    try {
      for (const ctx of [pO, fM]) await ctx.evaluate(async () => { await window.__NGA.Clientes.novo('CLIENTE EQUIVALENCIA S.A.', { tipo: 'rj', templateTimeline: 'rj' }); });
      await irPara(pO, view); await irPara(fM, view);
      await pO.waitForTimeout(1200); await pM.waitForTimeout(1200);
      const mascaraO = [pO.locator('.pill'), pO.locator('#topbar-user-email'), pO.locator('.clock, [id*=relogio], [class*=relogio]')];
      const mascaraM = [pM.frameLocator('#gerador').locator('.pill'), pM.frameLocator('#gerador').locator('#topbar-user-email'), pM.frameLocator('#gerador').locator('.clock, [id*=relogio], [class*=relogio]')];
      // Clientes: o cabeçalho do cartão muda de propósito com a sincronização ("guardado neste navegador" x "compartilhado com o escritório"); compara-se a tabela
      const soTabela = view === 'clientes';
      const a = soTabela ? await pO.locator('#clientes-lista table').screenshot() : await pO.screenshot({ mask: mascaraO, animations: 'disabled' });
      const b = soTabela ? await pM.frameLocator('#gerador').locator('#clientes-lista table').screenshot() : await pM.screenshot({ mask: mascaraM, animations: 'disabled' });
      const r = compararImagens(a, b);
      const pct = (100 * r.pixels) / r.total;
      console.log(`  [visual:${nome}] pixels diferentes: ${r.pixels} (${pct.toFixed(4)}%)`);
      // Clientes: crop pequeno da tabela; a única diferença são 2 px de borda do selo (arredondamento de subpixel). Demais telas: < 0,05%.
      expect(pct, 'diferença visual acima do tolerável').toBeLessThan(soTabela ? 0.25 : 0.05);
    } finally { await fechar(); }
  });
}

// ------------------------------------------------------------------------------------------- PDFs
async function comparar(nome, pdfO, pdfM, pO, fM) {
  expect(pdfO, 'original gerou PDF').toBeTruthy(); expect(pdfM, 'migrado gerou PDF').toBeTruthy();
  const aO = await analisarPdf(pO, pdfO.bytes), aM = await analisarPdf(fM, pdfM.bytes);
  expect(aM.length, 'número de páginas').toBe(aO.length);
  let totalPix = 0, totalPx = 0;
  aO.forEach((p, i) => {
    expect(aM[i].w, `largura pág ${i + 1}`).toBe(p.w); expect(aM[i].h, `altura pág ${i + 1}`).toBe(p.h);
    expect(aM[i].texto, `texto pág ${i + 1}`).toBe(p.texto); expect(aM[i].fontes, `fontes pág ${i + 1}`).toBe(p.fontes);
    const r = compararPng(p.png, aM[i].png); totalPix += r.pixels; totalPx += r.total;
  });
  const bytesIguais = normalizarPdf(pdfO.bytes) === normalizarPdf(pdfM.bytes);
  console.log(`  [pdf:${nome}] páginas=${aO.length} | texto/fontes/tamanho iguais | pixels diferentes=${totalPix}/${totalPx} | bytes idênticos (normalizados)=${bytesIguais}`);
  expect(totalPix, 'render por pixel').toBe(0);
}

test('PDF do laudo revisional: original x migrado', async ({ browser }) => {
  const { pO, pM, fM, fechar } = await abrirAmbos(browser);
  try {
    const preencher = async (ctx) => {
      await ctx.evaluate(() => window.NGA_CTX.irPara('novo'));
      await ctx.evaluate(() => { [...document.querySelectorAll('button')].find(b => /Análise revisional/.test(b.innerText)).click(); });
      await ctx.evaluate(async () => {
        const set = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); };
        set('rv-cliente', 'CLIENTE SINTÉTICO LTDA'); set('rv-banco', 'BANCO FICTÍCIO S.A.'); set('rv-contrato', 'SINT-0001/2024'); set('rv-data', '15/03/2024');
        set('rv-valor', '50000,00'); set('rv-prazo', '48'); set('rv-sistema', 'PRICE'); set('rv-am', '3,20'); set('rv-prest', '1950,00'); set('rv-pagas', '12');
        set('rv-serie', 'pj_capital_giro_total'); set('rv-resp', 'Equipe de teste');
        await new Promise(r => setTimeout(r, 300));
        [...document.querySelectorAll('button')].find(b => /Analisar contrato/.test(b.innerText)).click();
        await new Promise(r => setTimeout(r, 8000));
        [...document.querySelectorAll('button')].find(b => /Gerar laudo em PDF/.test(b.innerText)).click();
        await new Promise(r => setTimeout(r, 12000));
      });
      return ctx.evaluate(() => window.__pdfs[0]);
    };
    const pdfO = await preencher(pO), pdfM = await preencher(fM);
    await comparar('laudo revisional', pdfO, pdfM, pO, fM);
  } finally { await fechar(); }
});

test('PDF do modelo "Projeto, sem PDF": original x migrado', async ({ browser }) => {
  const { pO, pM, fM, fechar } = await abrirAmbos(browser);
  try {
    const gerar = async (ctx) => {
      await ctx.evaluate(() => window.NGA_CTX.irPara('novo'));
      await ctx.evaluate(async () => {
        [...document.querySelectorAll('button')].find(b => /Projeto, sem PDF/.test(b.innerText)).click();
        await new Promise(r => setTimeout(r, 800));
        const set = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); };
        set('pj-nome', 'PROJETO SINTÉTICO QA'); set('pj-data', '2026-10-09');
        await new Promise(r => setTimeout(r, 400));
        [...document.querySelectorAll('#view-novo button')].find(b => /Abrir a prévia/.test(b.innerText)).click();
        await new Promise(r => setTimeout(r, 3500));
        [...document.querySelectorAll('button')].find(b => /Gerar relatório/.test(b.innerText) && b.offsetParent).click();
        await new Promise(r => setTimeout(r, 1000));
        const ok = [...document.querySelectorAll('button')].find(b => /Gerar mesmo assim/.test(b.innerText)); if (ok) ok.click();
        await new Promise(r => setTimeout(r, 12000));
      });
      return ctx.evaluate(() => window.__pdfs[0]);
    };
    const pdfO = await gerar(pO), pdfM = await gerar(fM);
    await comparar('projeto sem PDF (12 págs)', pdfO, pdfM, pO, fM);
  } finally { await fechar(); }
});

// Com uma exportação REAL do Astrea (dados de cliente): só roda se NGA_ASTREA_PDF apontar para um arquivo local.
// Nada disso vai para o repositório nem para relatórios: o teste só imprime contagens de equivalência.
test('PDF Quantitativo/Executivo a partir de exportação real do Astrea: original x migrado', async ({ browser }) => {
  test.skip(!process.env.NGA_ASTREA_PDF || !existsSync(process.env.NGA_ASTREA_PDF), 'defina NGA_ASTREA_PDF para rodar com uma exportação real');
  test.setTimeout(240_000);
  const bytes = readFileSync(process.env.NGA_ASTREA_PDF);
  const { pO, pM, fM, fechar } = await abrirAmbos(browser);
  try {
    const gerar = async (ctx, modelo) => {
      await ctx.evaluate(() => window.NGA_CTX.irPara('novo'));
      await ctx.evaluate(async ({ b64, modelo }) => {
        const buf = Uint8Array.from(atob(b64), c => c.charCodeAt(0)); const dt = new DataTransfer(); dt.items.add(new File([buf], 'Astrea.pdf', { type: 'application/pdf' }));
        const inp = document.getElementById('arquivo'); inp.files = dt.files; inp.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise(r => setTimeout(r, 7000));
        const s = document.getElementById('astrea-modelo'); s.value = [...s.options].find(o => o.text.startsWith(modelo)).value; s.dispatchEvent(new Event('change', { bubbles: true }));
        const m = document.querySelector('#view-novo input[type=month]'); m.value = '2026-09'; m.dispatchEvent(new Event('change', { bubbles: true }));
        [...document.querySelectorAll('button')].find(b => /Processar relatório/.test(b.innerText) && b.offsetParent).click();
        await new Promise(r => setTimeout(r, 12000));
        [...document.querySelectorAll('button')].find(b => /^Gerar PDF/.test(b.innerText.trim()) && b.offsetParent).click();
        await new Promise(r => setTimeout(r, 12000));
      }, { b64: bytes.toString('base64'), modelo });
      return ctx.evaluate(() => window.__pdfs[0]);
    };
    const pdfO = await gerar(pO, 'Quantitativo'), pdfM = await gerar(fM, 'Quantitativo');
    await comparar('quantitativo (Astrea real)', pdfO, pdfM, pO, fM);
  } finally { await fechar(); }
});
