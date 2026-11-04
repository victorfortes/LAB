// Persistência: o que o advogado faz fica no banco e reaparece, íntegro, para outra pessoa em outro computador.
import { test, expect } from '@playwright/test';
import { entrar, geradorPronto, sair, sql } from './helpers.mjs';

test('cliente criado por uma pessoa aparece para outra, com histórico de versões e auditoria', async ({ page, request }) => {
  await entrar(page, 'adv@teste.local'); let fr = await geradorPronto(page);
  const id = await fr.evaluate(async () => {
    const c = await window.__NGA.Clientes.novo('CLIENTE PERSISTENTE LTDA', { tipo: 'rj', templateTimeline: 'rj' });
    c.marcos = { AJUIZAMENTO: '10/01/2025' }; await window.__NGA.Clientes.salvar(c);
    c.marcos = { AJUIZAMENTO: '10/01/2025', DEFERIMENTO: '20/01/2025' }; await window.__NGA.Clientes.salvar(c);
    return c.id;
  });
  await page.waitForTimeout(2500);   // fila de envio ao banco
  await sair(page, fr);   // apaga tudo o que era local deste navegador
  await entrar(page, 'admin@teste.local'); fr = await geradorPronto(page);
  const visto = await fr.evaluate(async (id) => { const c = await window.__NGA.Clientes.obter(id); return c && { nome: c.nome, tipo: c.config.tipo, marcos: c.marcos }; }, id);
  expect(visto.nome).toBe('CLIENTE PERSISTENTE LTDA');
  expect(visto.tipo).toBe('rj');
  expect(visto.marcos).toEqual({ AJUIZAMENTO: '10/01/2025', DEFERIMENTO: '20/01/2025' });
  const v = await sql(request, `select count(*)::int n from documentos_versoes where colecao='clientes' and id=$1`, [id]);
  expect(v[0].n).toBeGreaterThanOrEqual(2);   // nada foi sobrescrito em silêncio
  const a = await sql(request, `select acao from auditoria where colecao='clientes' and doc_id=$1 and email='adv@teste.local'`, [id]);
  expect(a.map(r => r.acao)).toContain('criar');
});

test('PDF emitido sobe ao banco e outra pessoa baixa exatamente os mesmos bytes', async ({ page }) => {
  await entrar(page, 'adv@teste.local'); let fr = await geradorPronto(page);
  const orig = await fr.evaluate(async () => {
    const doc = new window.jspdf.jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    doc.text('Relatório sintético de teste NGA', 20, 30); doc.addPage(); doc.text('Página 2', 20, 30);
    const blob = doc.output('blob');
    const rec = await window.NGA_EMISSOES.registrar(blob, 'sintetico.pdf', { cliente: 'CLIENTE PDF', periodo: '2026-09', modelo: 'quantitativo' }, doc);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const h = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(b => b.toString(16).padStart(2, '0')).join('');
    return { id: rec.id, partes: rec.partes, sha: h, tamanho: bytes.length };
  });
  expect(orig.partes).toBeGreaterThan(0);
  await sair(page, fr);
  await entrar(page, 'admin@teste.local'); fr = await geradorPronto(page);
  await fr.waitForFunction((id) => window.NGA_EMISSOES.listar().then(l => l.some(e => e.id === id)), orig.id, { timeout: 20000 });
  const baixado = await fr.evaluate(async (id) => {
    const blob = await window.NGA_EMISSOES.blob(id);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const h = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(b => b.toString(16).padStart(2, '0')).join('');
    return { sha: h, tamanho: bytes.length };
  }, orig.id);
  expect(baixado).toEqual({ sha: orig.sha, tamanho: orig.tamanho });
});

test('modelo personalizado salvo por uma pessoa reabre editável para outra', async ({ page }) => {
  await entrar(page, 'adv@teste.local'); let fr = await geradorPronto(page);
  const modeloId = await fr.evaluate(async () => {
    const blocos = [{ id: 'b1', tipo: 'canvas', nome: 'Página 1', elementos: [{ id: 'e1', tipo: 'texto', x: 20, y: 20, w: 100, h: 20, texto: 'TEXTO EDITÁVEL QA', tam: 18 }], moldura: { ativa: false, titulo: '', kicker: '' } }];
    const m = await window.NGA_MODELOS.salvar({ nome: 'MODELO PERSISTENTE QA', blocos });
    return m.id;
  });
  await page.waitForTimeout(2500);
  await sair(page, fr);
  await entrar(page, 'admin@teste.local'); fr = await geradorPronto(page);
  const lido = await fr.evaluate(async (id) => { await window.NGA_MODELOS.carregar(); const m = window.NGA_MODELOS.obter(id); return m && { nome: m.nome, texto: m.blocos[0].elementos[0].texto }; }, modeloId);
  expect(lido).toEqual({ nome: 'MODELO PERSISTENTE QA', texto: 'TEXTO EDITÁVEL QA' });
});
