import { test, expect } from '@playwright/test';
import { entrar, geradorPronto, sair, sql, SENHA } from './helpers.mjs';

test('credenciais erradas: mensagem genérica (não revela se o e-mail existe)', async ({ page }) => {
  await entrar(page, 'admin@teste.local', 'senha-errada');
  const a = await page.textContent('#login-erro');
  await page.fill('#login-email', 'ninguem@teste.local');
  await page.click('#login-entrar');
  await expect(page.locator('#login-erro')).toHaveText(/incorretos/);
  expect(a).toBe(await page.textContent('#login-erro'));
  await expect(page.locator('#gerador')).toBeHidden();
});

test('recuperação de senha responde igual para e-mail existente ou não', async ({ page }) => {
  await page.goto('/');
  await page.fill('#login-email', 'ninguem@teste.local'); await page.click('#login-esqueci');
  const a = await page.textContent('#login-erro');
  await page.fill('#login-email', 'admin@teste.local'); await page.click('#login-esqueci');
  expect(await page.textContent('#login-erro')).toBe(a);
  expect(a).toMatch(/Se o e-mail estiver cadastrado/);
});

test('usuário sem perfil e usuário desativado ficam bloqueados', async ({ page }) => {
  for (const email of ['semperfil@teste.local', 'inativo@teste.local']) {
    await entrar(page, email);
    await expect(page.locator('#bloqueio')).toBeVisible();
    await expect(page.locator('#gerador')).toBeHidden();
    await page.click('#bloqueio-sair');
    await expect(page.locator('#form-login')).toBeVisible();
  }
});

test('gerador aberto diretamente (fora da casca) volta para a entrada', async ({ page }) => {
  await page.goto('/app/gerador.html');
  await expect(page).toHaveURL(/127\.0\.0\.1:8788\/$/);
  await expect(page.locator('#form-login')).toBeVisible();
});

test('conta padrão do código original não existe mais', async ({ page }) => {
  await entrar(page, 'admin@nga.adv.br', 'nga2026');
  await expect(page.locator('#login-erro')).toHaveText(/incorretos/);
  const html = await (await page.request.get('/app/gerador.html')).text();
  expect(html).not.toContain('nga2026');
  expect(html).not.toContain('unshift({ email: "admin@nga.adv.br"');
});

test('login válido abre o gerador original com o papel certo; sair apaga os dados locais', async ({ page }) => {
  await entrar(page, 'adv@teste.local');
  const fr = await geradorPronto(page);
  expect(await fr.evaluate(() => window.NGA_USUARIO.papel)).toBe('operador');
  await fr.evaluate(() => window.__NGA.Clientes.novo('CLIENTE LOCAL XYZ', {}));
  await page.waitForTimeout(500);
  await sair(page, fr);
  await expect(page.locator('#form-login')).toBeVisible();
  const resto = await page.evaluate(async () => ({
    ls: Object.keys(localStorage).filter(k => /^nga/.test(k)), dbs: (await indexedDB.databases()).map(d => d.name).filter(n => n === 'nga_plataforma') }));
  expect(resto.ls).toEqual([]);
  expect(resto.dbs).toEqual([]);
});

test('CSP e cabeçalhos de segurança presentes', async ({ page }) => {
  const r = await page.request.get('/');
  const h = r.headers();
  expect(h['content-security-policy']).toContain("object-src 'none'");
  expect(h['x-content-type-options']).toBe('nosniff');
  expect(h['x-frame-options']).toBe('SAMEORIGIN');
  expect(h['referrer-policy']).toBe('no-referrer');
});
