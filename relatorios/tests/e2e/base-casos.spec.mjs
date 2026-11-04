import { test, expect } from '@playwright/test';
import { entrar, geradorPronto } from './helpers.mjs';

// Export do Astrea só com "Ficha do caso" (sem ficha de processo): o caso é a unidade-base do relatório. Texto SINTÉTICO.
const montar = (fr, paginas) => fr.evaluate((paginas) => {
  const { jsPDF } = window.jspdf, doc = new jsPDF({ unit: 'pt', format: 'a4' });
  paginas.forEach((pg, k) => {
    if (k) doc.addPage();
    doc.setFontSize(10);
    pg.forEach(([x, y, t]) => doc.text(t, x, y));
  });
  return Array.from(new Uint8Array(doc.output('arraybuffer')));
}, paginas);
const FICHA_CASO = [
  [40, 100, 'Ficha do caso 1/1'], [40, 130, 'CLIENTE: Cliente Teste S.A'], [40, 150, 'TÍTULO: Projeto Teste S/A'], [40, 170, 'OBJETO: Tratativas de teste do RE'],
  [40, 190, 'ADVOGADO: Maria Teste'], [40, 210, 'CRIADO EM: 16/08/2026'], [40, 230, 'VALOR DA CAUSA: R$ 1.500,00'], [40, 250, 'STATUS: Ativo'],
  [40, 290, 'Histórico | 1º Grau -'], [40, 310, 'DATA DESCRIÇÃO TIPO'],
  [40, 330, '19/10/2026'], [140, 330, 'Enviar proposta aos credores'], [500, 330, 'Tarefa realizada'],
  [40, 350, '06/09/2026'], [140, 350, 'Acompanhar o envio dos acordos.'], [500, 350, 'Tarefa realizada'],
];
const FICHA_PROCESSO = [
  [40, 100, 'Ficha do processo - Nº 0001234-56.2026.8.16.0001 1/1'], [40, 130, 'CLIENTE: Cliente Teste S.A'], [40, 150, 'AÇÃO: Recuperação Extrajudicial'], [40, 170, 'ADVOGADO: Maria Teste'],
  [40, 290, 'Histórico | 1º Grau -'], [40, 310, 'DATA DESCRIÇÃO TIPO'], [40, 330, '10/10/2026'], [140, 330, 'Análise da intimação'], [500, 330, 'Tarefa realizada'],
];

test('export só de casos: o caso vira a unidade-base e o relatório sai com rótulos de caso', async ({ page }) => {
  await entrar(page, 'admin@teste.local'); const fr = await geradorPronto(page);
  const bytes = await montar(fr, [FICHA_CASO]);
  const r = await fr.evaluate(async (b) => { const d = await window.NGA_ABRIR_PDF(new Uint8Array(b)); const x = await parseAstreaPDF(d); return { n: x.processos.length, p: x.processos[0], a: x.atividades.map(a => a.numero_processo + '|' + a.data), adm: x.atividadesAdministrativas.length, casos: x.casosAdministrativos.length, base: !!x.baseCasos }; }, bytes);
  expect(r.base).toBe(true); expect(r.n).toBe(1); expect(r.adm).toBe(0); expect(r.casos).toBe(0);
  expect(r.p).toMatchObject({ numero_processo: 'Projeto Teste S/A', titulo: 'Projeto Teste S/A', acao: 'Tratativas de teste do RE', advogado: 'Maria Teste', criado_em: '16/08/2026', valor_causa: 'R$ 1.500,00', unidade: 'caso' });
  expect(r.a).toEqual(['Projeto Teste S/A|19/10/2026', 'Projeto Teste S/A|06/09/2026']);
});

test('export com processo e caso: o caso continua cadastro administrativo (comportamento anterior)', async ({ page }) => {
  await entrar(page, 'admin@teste.local'); const fr = await geradorPronto(page);
  const bytes = await montar(fr, [FICHA_PROCESSO, FICHA_CASO]);
  const r = await fr.evaluate(async (b) => { const d = await window.NGA_ABRIR_PDF(new Uint8Array(b)); const x = await parseAstreaPDF(d); return { n: x.processos.length, adm: x.atividadesAdministrativas.length, casos: x.casosAdministrativos.length, base: !!x.baseCasos }; }, bytes);
  expect(r.base).toBe(false); expect(r.n).toBe(1); expect(r.casos).toBe(1); expect(r.adm).toBe(2);
});

test('rótulos de caso só aparecem com base de casos', async ({ page }) => {
  await entrar(page, 'admin@teste.local'); const fr = await geradorPronto(page);
  const r = await fr.evaluate(async () => {
    const gerar = (casos) => { window.NGA_BASE_CASOS = casos; const g = new GeradorRelatorioPDF(); const doc = g.gerarExecutivo({ cliente: 'C', periodoISO: '2026-10', indicadores: { quantidade_processos_movimentados: 1, quantidade_total_atividades_periodo: 1 }, atividades: [], briefing: { marcos: [], proximosPassos: [], entregas: [], acontecimentos: [{ data: '19/10/2026', numero_processo: 'Projeto X', descricao: 'Algo no processo PROCESSO' }] }, config: { exibirEsforco: false, exibirLinhaTempo: false }, ondeEstamos: {} }); return Array.from(new Uint8Array(doc.output('arraybuffer'))); };
    const ler = async (b) => { const d = await window.NGA_ABRIR_PDF(new Uint8Array(b)); let t = ''; for (let i = 1; i <= d.numPages; i++) t += (await (await d.getPage(i)).getTextContent()).items.map(x => x.str).join(' ') + ' '; return t; };
    const c = await ler(gerar(true)), p = await ler(gerar(false)); window.NGA_BASE_CASOS = false; return { c, p };
  });
  expect(r.c).toContain('CASOS MOVIMENTADOS'); expect(r.c).toContain('agrupados por caso'); expect(r.c).toContain('Algo no processo PROCESSO');   // o texto do registro nunca é trocado
  expect(r.p).toContain('PROCESSOS MOVIMENTADOS'); expect(r.p).toContain('agrupados por processo');
});
