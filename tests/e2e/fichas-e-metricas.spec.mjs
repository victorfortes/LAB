import { test, expect } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { entrar, geradorPronto } from './helpers.mjs';

// ---------- fixture SINTÉTICO (roda no CI): três tipos de cabeçalho, valor da causa nos dois layouts, CNJ repetido ----------
const montar = (fr, paginas) => fr.evaluate((paginas) => {
  const { jsPDF } = window.jspdf, doc = new jsPDF({ unit: 'pt', format: 'a4' });
  paginas.forEach((pg, k) => { if (k) doc.addPage(); doc.setFontSize(10); pg.forEach(([x, y, t]) => doc.text(t, x, y)); });
  return Array.from(new Uint8Array(doc.output('arraybuffer')));
}, paginas);
const reg = (y, data, desc, tipo) => [[40, y, data], [140, y, desc], [500, y, tipo]];
const ficha = (cab, extra = []) => [...cab, [40, 290, 'Histórico | 1º Grau -'], [40, 310, 'DATA DESCRIÇÃO TIPO'], ...extra];
const P1 = ficha([[40, 100, 'Ficha do processo - Nº 0001111-11.2026.8.16.0001 1/5'], [40, 130, 'CLIENTE: Cliente Teste'], [40, 150, 'VALOR DA CAUSA: R$ 100.000,00'], [40, 170, 'STATUS: Ativo 1º Grau'], [40, 190, 'CLIENTE: A EQUIPE: CÍVEL FASE: EM TRÂMITE SJ: PROJUDI']],
  [...reg(330, '05/10/2026', 'Elaborar peça', 'Tarefa realizada'), ...reg(350, '06/10/2026', 'Juntada de petição', 'Andamento')]);
const P2 = ficha([[40, 100, 'Ficha do processo - Nº 0001111-11.2026.8.16.0001 2/5'], [40, 130, 'CLIENTE: Cliente Teste'], [40, 150, 'R$ 135.000,00'], [40, 170, 'VALOR DA CAUSA:'], [40, 190, 'STATUS: Ativo 1º Grau'], [40, 210, 'CLIENTE: A EQUIPE: CÍVEL FASE: EM TRÂMITE SJ: PROJUDI']],
  [...reg(330, '07/10/2026', 'Analisar intimação', 'Tarefa realizada')]);
const P3 = ficha([[40, 100, 'Ficha do processo - Nº 0002222-22.2026.8.16.0001 3/5'], [40, 130, 'VALOR DA CAUSA: R$ 50.000,00'], [40, 150, 'STATUS: Ativo 1º Grau'], [40, 170, 'CLIENTE: A EQUIPE: CÍVEL FASE: ARQUIVADO SJ: PROJUDI']], reg(330, '08/10/2026', 'Arquivamento', 'Andamento'));
const P4 = ficha([[40, 100, 'Ficha do processo 4/5'], [40, 130, 'PASTA: 009999'], [40, 150, 'VALOR DA CAUSA: R$ 11.103,86'], [40, 170, 'STATUS: Ativo 1º Grau']], reg(330, '09/10/2026', 'Contato com cliente', 'Tarefa realizada'));
const P5 = ficha([[40, 100, 'Ficha do caso 5/5'], [40, 130, 'CLIENTE: Cliente Teste'], [40, 150, 'TÍTULO: Notificação extrajudicial'], [40, 170, 'ADVOGADO: Maria'], [40, 190, 'VALOR DA CAUSA: R$ 0,00'], [40, 210, 'STATUS: Ativo']], reg(330, '10/10/2026', 'Notificação enviada', 'Histórico manual'));

test('fichas: três cabeçalhos, valor da causa nos dois layouts, CNJ repetido uma vez, ativos e conferência do contador', async ({ page }) => {
  await entrar(page, 'admin@teste.local'); const fr = await geradorPronto(page);
  const bytes = await montar(fr, [P1, P2, P3, P4, P5]);
  const r = await fr.evaluate(async (b) => {
    const d = await window.NGA_ABRIR_PDF(new Uint8Array(b)); const x = await parseAstreaPDF(d);
    const ini = new Date(Date.UTC(2026, 9, 1)), fim = new Date(Date.UTC(2026, 9, 31));
    const c = calcularIndicadores(x.processos, x.atividades, ini, fim, [], x.atividadesAdministrativas, x.casosAdministrativos), i = c.indicadores;
    const au = await auditoriaTextoBruto(d, x, c, ini, fim);
    return { diag: x.diagnostico, avisos: x.avisos, procs: x.processos.map(p => [p.numero_processo, p.valor_causa, !!p.sem_numero]), i: { total: i.total_processos, ativos: i.processos_ativos, valor: i.valor_total_causa, reg: i.quantidade_total_atividades_periodo, mov: i.quantidade_processos_movimentados, det: i.movimentados_detalhe, media: i.media_atividades_por_processo_movimentado, carteira: i.carteira, avisosM: i.avisos_metricas }, dif: au.diferencas };
  }, bytes);
  expect(r.diag).toMatchObject({ numeradas: 3, sem_numero: 1, casos: 1, esperadas: 5, lidas: 5 }); expect(r.avisos).toEqual([]);
  expect(r.procs.map(p => p[1])).toEqual(['R$ 100.000,00', 'R$ 135.000,00', 'R$ 50.000,00', 'R$ 11.103,86']);   // R$ depois e antes do rótulo
  expect(r.procs[3][2]).toBe(true);                                                                              // ficha sem número reconhecida
  expect(r.i.total).toBe(2);                                                                                     // CNJ distintos (3 fichas numeradas)
  expect(r.i.valor).toBe(135000 + 50000 + 11103.86);                                                             // uma vez por CNJ (o maior) + sem número
  expect(r.i.reg).toBe(6); expect(r.i.det).toEqual({ processos: 2, sem_numero: 1, casos: 1, fichas: 5 });   // 2 CNJ (3 fichas) + 1 sem número + 1 caso
  expect(r.i.media).toBe(1.5);   // 6 registros ÷ 4 itens movimentados (mesmo numerador e denominador dos cartões)
   expect(r.i.ativos).toBe(2);                                                         // 0001111 ativo; 0002222 arquivado; sem número ativo
  expect(r.i.carteira).toMatchObject({ fichas_total: 5, arquivadas: 1 });
  expect(r.i.avisosM).toEqual([]); expect(r.dif).toEqual([]);                                                    // auditoria sem diferenças
});

test('STATUS: a palavra de status é achada mesmo com R$ ou texto colado pela leitura por colunas', async ({ page }) => {
  await entrar(page, 'admin@teste.local'); const fr = await geradorPronto(page);
  const r = await fr.evaluate(() => [
    statusDaFicha('Ativo 1º Grau', ''), statusDaFicha('R$ 135.000,00 Ativo 1º Grau', ''), statusDaFicha('R$ 0,00 Ativo Superior 3/128', ''), statusDaFicha('Arquivado', ''),
    statusDaFicha(null, 'VALOR DA CAUSA: R$ 1,00 Ativo 1º Grau STATUS: AÇÃO: X'), statusDaFicha('', 'STATUS: Ativo 2º Grau'), statusDaFicha('R$ 5,00', 'sem nada'),
  ]);
  expect(r).toEqual(['Ativo 1º Grau', 'Ativo 1º Grau', 'Ativo Superior', 'Arquivado', 'Ativo 1º Grau', 'Ativo 2º Grau', null]);
});

test('conferência do contador: ficha não reconhecida gera aviso', async ({ page }) => {
  await entrar(page, 'admin@teste.local'); const fr = await geradorPronto(page);
  const bytes = await montar(fr, [P1, P3]);   // contadores 1/5 e 3/5: faltam fichas
  const r = await fr.evaluate(async (b) => { const x = await parseAstreaPDF(await window.NGA_ABRIR_PDF(new Uint8Array(b))); return x.avisos; }, bytes);
  expect(r.join(' ')).toMatch(/lidas: 2.*indica 5.*2, 4, 5/);
});

test('auditoria corrige sozinha os indicadores divergentes, sem perguntar nada', async ({ page }) => {
  await entrar(page, 'admin@teste.local'); const fr = await geradorPronto(page);
  const bytes = await montar(fr, [P1, P2, P3, P4, P5]);
  const r = await fr.evaluate(async (b) => {
    let perguntou = false; window.confirm = () => { perguntou = true; return false; };
    const d = await window.NGA_ABRIR_PDF(new Uint8Array(b)); const x = await parseAstreaPDF(d);
    const ini = new Date(Date.UTC(2026, 9, 1)), fim = new Date(Date.UTC(2026, 9, 31));
    const c = calcularIndicadores(x.processos, x.atividades, ini, fim, [], x.atividadesAdministrativas, x.casosAdministrativos), i = c.indicadores;
    i.processos_ativos = 0; i.valor_total_causa = 1; i.total_processos = 9; i.quantidade_processos_movimentados = 9; i.carteira.ativos = 0;   // simula a leitura errada
    await auditarGeracao(d, x, c, ini, fim);
    return { perguntou, ativos: i.processos_ativos, valor: i.valor_total_causa, cnj: i.total_processos, mov: i.quantidade_processos_movimentados, media: i.media_atividades_por_processo_movimentado, det: i.movimentados_detalhe, corr: i.correcoes_auditoria };
  }, bytes);
  expect(r.perguntou).toBe(false);
  expect(r).toMatchObject({ ativos: 2, valor: 196103.86, cnj: 2, mov: 4, media: 1.5 });
  expect(r.det).toMatchObject({ processos: 2, sem_numero: 1, casos: 1 });
  expect(r.corr.join(' | ')).toMatch(/processos ativos: 0 → 2/); expect(r.corr.length).toBeGreaterThanOrEqual(4);
});

test('auditoria bloqueia a geração quando o texto bruto diverge do motor', async ({ page }) => {
  await entrar(page, 'admin@teste.local'); const fr = await geradorPronto(page);
  const bytes = await montar(fr, [P1, P2, P3, P4, P5]);
  const r = await fr.evaluate(async (b) => {
    window.confirm = () => false;                                     // quem gera recusa seguir
    const d = await window.NGA_ABRIR_PDF(new Uint8Array(b)); const x = await parseAstreaPDF(d);
    const ini = new Date(Date.UTC(2026, 9, 1)), fim = new Date(Date.UTC(2026, 9, 31));
    const c = calcularIndicadores(x.processos, x.atividades, ini, fim, [], x.atividadesAdministrativas, x.casosAdministrativos);
    x.atividades.pop(); const c2 = calcularIndicadores(x.processos, x.atividades, ini, fim, [], x.atividadesAdministrativas, x.casosAdministrativos);   // motor perde um registro
    try { await auditarGeracao(d, x, c2, ini, fim); return 'passou'; } catch (e) { return e.message; }
  }, bytes);
  expect(r).toContain('Geração bloqueada pela auditoria'); expect(r).toContain('registros no período');
});

// ---------- regressão com o bruto REAL (só local; dado de cliente não vai ao repositório) ----------
const DEVILLE = process.env.NGA_DEVILLE_PDF || '/Users/mac/Downloads/Astrea - DEVILLE.pdf';
test('Deville (out/2026), bruto real: fichas, CNJ, registros e auditoria', async ({ page }) => {
  test.skip(!existsSync(DEVILLE), 'PDF real do Deville não disponível neste ambiente');
  test.setTimeout(180000);
  await entrar(page, 'admin@teste.local'); const fr = await geradorPronto(page);
  const b64 = readFileSync(DEVILLE).toString('base64');
  const r = await fr.evaluate(async (b64) => {
    const d = await window.NGA_ABRIR_PDF(Uint8Array.from(atob(b64), c => c.charCodeAt(0))); const x = await parseAstreaPDF(d);
    const ini = new Date(Date.UTC(2026, 9, 1)), fim = new Date(Date.UTC(2026, 9, 31));
    const c = calcularIndicadores(x.processos, x.atividades, ini, fim, [], x.atividadesAdministrativas, x.casosAdministrativos), i = c.indicadores;
    const au = await auditoriaTextoBruto(d, x, c, ini, fim);
    return { diag: x.diagnostico, i: { cnj: i.total_processos, reg: i.quantidade_total_atividades_periodo, tipos: i.registros_por_tipo, det: i.movimentados_detalhe, valor: Math.round(i.valor_total_causa * 100) / 100, carteira: i.carteira, ativos: i.processos_ativos, avisosM: i.avisos_metricas }, dif: au.diferencas };
  }, b64);
  expect(r.diag).toMatchObject({ numeradas: 64, sem_numero: 3, casos: 3, esperadas: 70, lidas: 70, paginas_pdf: 100 }); expect(r.diag.avisos).toEqual([]);
  expect(r.i.cnj).toBe(56);
  expect(r.i.reg).toBe(47); expect(r.i.tipos).toEqual({ 'Tarefa realizada': 25, 'Prazo realizado': 7, 'Histórico manual': 5, 'Andamento': 10 });
  expect(r.i.det).toEqual({ processos: 11, sem_numero: 1, casos: 2, fichas: 14 });
  expect(r.i.carteira).toMatchObject({ fichas_total: 70, arquivadas: 18 }); expect(r.i.ativos).toBe(44);
  expect(r.i.avisosM).toEqual([]); expect(r.dif).toEqual([]);
});
