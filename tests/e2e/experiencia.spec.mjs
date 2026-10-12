import { test, expect } from '@playwright/test';
import { entrar, geradorPronto } from './helpers.mjs';

test('clientes: busca sem acentos, áreas e seleção preservada', async ({ page }) => {
  await entrar(page, 'admin@teste.local');
  const fr = await geradorPronto(page);
  await fr.evaluate(async () => {
    const clientes = [];
    clientes.push(await window.__NGA.Clientes.novo('Álvaro Cível QA', { tipo: 'civel' }));
    clientes.push(await window.__NGA.Clientes.novo('Empresa Recuperação QA', { tipo: 'rj', templateTimeline: 'rj' }));
    window.NGA_FILTRAR_CLIENTES(clientes, '');
    window.NGA_CTX.irPara('novo');
  });
  await fr.locator('#nga-cliente-area').selectOption('civel');
  await fr.locator('#nga-cliente-busca').fill('alvaro');
  expect(await fr.locator('#astrea-cliente-select option').allTextContents()).toEqual(['Avulso, sem cadastro', 'Álvaro Cível QA · Cível']);
  const id = await fr.locator('#astrea-cliente-select option').nth(1).getAttribute('value');
  await fr.locator('#astrea-cliente-select').selectOption(id);
  await expect(fr.locator('#astrea-nome-avulso-wrap')).toBeHidden();
  await fr.locator('#nga-cliente-area').selectOption('empresarial');
  await fr.locator('#nga-cliente-busca').fill('empresa');
  await expect(fr.locator('#astrea-cliente-select')).toHaveValue(id);
  expect(await fr.locator('#astrea-cliente-select optgroup').allTextContents()).toEqual(['Empresa Recuperação QA · RJ']);
  await fr.locator('#nga-cliente-busca').fill('inexistente');
  await expect(fr.locator('#nga-clientes-contagem')).toHaveText('Nenhum cliente encontrado');
  await page.screenshot({ path: '/tmp/browser/clientes-nga.png' });
});

test('andamentos: todos, nenhum, seleção parcial e lista vazia', async ({ page }) => {
  await entrar(page, 'admin@teste.local');
  const fr = await geradorPronto(page);
  await fr.evaluate(() => { window.NGA_CTX.irPara('novo'); window.NGA_ANDAMENTOS.abrir({ cliente: 'Cliente QA', periodoISO: '2026-10', processos: [{ numero_processo: '0001' }, { numero_processo: '0002' }], atividadesBrutas: ['0001', '0002'].map(numero => ({ numero_processo: numero, tipo: 'Histórico manual', data: '12/10/2026', descricao: 'No dia 10/10/2026, decisão proferida.' })) }); });
  const todos = fr.locator('#an-todos');
  await expect(todos).toBeChecked();
  await todos.uncheck();
  await expect(fr.locator('#an-tabela input:checked')).toHaveCount(0);
  await expect(fr.locator('#an-gerar')).toBeDisabled();
  await todos.check();
  await expect(fr.locator('#an-tabela input:checked')).toHaveCount(2);
  await fr.locator('[data-an]').first().uncheck();
  expect(await todos.evaluate(el => el.indeterminate)).toBe(true);
  await expect(fr.locator('#an-info')).toContainText('1 andamento(s)');
  await page.screenshot({ path: '/tmp/browser/andamentos-nga.png' });
  await fr.evaluate(() => window.NGA_ANDAMENTOS.abrir({ processos: [], atividadesBrutas: [] }));
  await expect(todos).toBeDisabled();
});

test('datas: digitação, colagem, edição, exclusão e campos dinâmicos', async ({ page }) => {
  await entrar(page, 'admin@teste.local');
  const fr = await geradorPronto(page);
  await fr.evaluate(() => { window.NGA_CTX.irPara('novo'); document.querySelector('.mode-btn[data-mode="revisional"]').click(); });
  const data = fr.locator('#rv-data');
  await data.pressSequentially('12102026');
  await expect(data).toHaveValue('12/10/2026');
  await expect(data).toHaveAttribute('inputmode', 'numeric');
  await data.fill('15032024');
  await expect(data).toHaveValue('15/03/2024');
  await data.fill('15/03/2024');
  await expect(data).toHaveValue('15/03/2024');
  await data.press('End'); await data.press('Backspace');
  await expect(data).toHaveValue('15/03/202');
  await data.press('ControlOrMeta+A'); await data.press('Backspace');
  await expect(data).toHaveValue('');
  await fr.evaluate(() => { const input = document.createElement('input'); input.id = 'qa-marco'; input.placeholder = 'dd/mm/aaaa'; document.getElementById('panel-revisional').appendChild(input); });
  await fr.locator('#qa-marco').fill('01022026');
  await expect(fr.locator('#qa-marco')).toHaveValue('01/02/2026');
  await fr.locator('#qa-marco').evaluate(el => { el.placeholder = 'dd/mm'; el.value = ''; });
  await fr.locator('#qa-marco').fill('1209');
  await expect(fr.locator('#qa-marco')).toHaveValue('12/09');
  await page.screenshot({ path: '/tmp/browser/datas-nga.png' });
});

test('ícone NGA na casca e no gerador', async ({ page }) => {
  await entrar(page, 'admin@teste.local');
  const fr = await geradorPronto(page);
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', '/favicon.png');
  await expect(page.locator('#form-login .marca img')).toHaveAttribute('src', 'logo.png');
  expect((await page.request.get('/gerador/logo.png')).ok()).toBe(true);
  await expect(fr.locator('link[rel="icon"]')).toHaveAttribute('href', '/favicon.png');
});