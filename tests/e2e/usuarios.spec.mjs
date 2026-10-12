// Administração: criação em lote com senha temporária, troca obrigatória no primeiro acesso, permissões do novo usuário.
import { test, expect } from '@playwright/test';
import { entrar, geradorPronto, sair, sql } from './helpers.mjs';

test('admin cria usuários em lote; a pessoa entra com a senha temporária, é obrigada a trocá-la e fica com o perfil certo', async ({ page, request }) => {
  await entrar(page, 'admin@teste.local'); const fr = await geradorPronto(page);
  await fr.locator('#topbar-btn-gerenciar').click();
  await page.fill('#lote-texto', 'Maria Teste, maria.lote@teste.local, advogado\nJoão Teste, joao.lote@teste.local, consulta\nSem Perfil, semperfil.lote@teste.local\nInvalido, nao-e-email, admin');
  await page.click('#form-lote button');
  await expect(page.locator('#admin-msg')).toHaveText(/3 de 4 usuário\(s\) criado\(s\)/);
  const linhas = page.locator('#tb-resultado tr');
  await expect(linhas).toHaveCount(4);
  const senhaMaria = await linhas.filter({ hasText: 'maria.lote@teste.local' }).locator('.senha').textContent();
  expect(senhaMaria.length).toBeGreaterThanOrEqual(12);
  await expect(linhas.filter({ hasText: 'nao-e-email' })).toContainText('Dados inválidos');
  // perfis gravados com o papel certo (consulta => visualizador; sem perfil informado => visualizador)
  const p = await sql(request, "select email, papel from perfis where email like '%.lote@teste.local' order by email");
  expect(p).toEqual([{ email: 'joao.lote@teste.local', papel: 'visualizador' }, { email: 'maria.lote@teste.local', papel: 'advogado' }, { email: 'semperfil.lote@teste.local', papel: 'visualizador' }]);
  // repetir o mesmo e-mail não cria de novo
  await page.fill('#lote-texto', 'Maria Teste, maria.lote@teste.local, advogado'); await page.click('#form-lote button');
  await expect(page.locator('#tb-resultado tr').first()).toContainText('Já existe');
  // nova senha temporária (e a anterior deixa de valer)
  await page.locator('#tb-usuarios tr', { hasText: 'joao.lote@teste.local' }).locator('button.mini').click();
  await expect(page.locator('#admin-msg')).toHaveText(/Nova senha temporária gerada/);
  await page.locator('#admin-fechar').click(); await sair(page, fr);

  // primeiro acesso da Maria: senha temporária -> troca obrigatória -> gerador com papel de advogado
  await entrar(page, 'maria.lote@teste.local', senhaMaria);
  await expect(page.locator('#form-nova-senha')).toBeVisible();
  await expect(page.locator('#gerador')).toBeHidden();
  await page.fill('#nova-senha', 'curta'); await page.fill('#nova-senha2', 'curta'); await page.click('#form-nova-senha button[type=submit]');
  await expect(page.locator('#nova-erro')).toContainText('12 caracteres');
  await page.fill('#nova-senha', 'Nova-senha-da-Maria-2026'); await page.fill('#nova-senha2', 'Nova-senha-da-Maria-2026'); await page.click('#form-nova-senha button[type=submit]');
  const fm = await geradorPronto(page);
  expect(await fm.evaluate(() => window.NGA_USUARIO.papel)).toBe('operador');
  await expect(fm.locator('#topbar-btn-gerenciar')).toBeHidden();   // advogado não administra
  await sair(page, fm);
  // depois da troca, entra direto com a nova senha (sem nova troca obrigatória)
  await entrar(page, 'maria.lote@teste.local', 'Nova-senha-da-Maria-2026');
  await geradorPronto(page);
});

test('quem não é administrador não consegue criar usuários nem gerar senhas (nem direto pela função)', async ({ request }) => {
  const tok = async (email) => (await (await request.post('/auth/v1/token?grant_type=password', { data: { email, password: 'Senha-de-teste-123' } })).json()).access_token;
  for (const email of ['adv@teste.local', 'vis@teste.local']) {
    const r = await request.post('/functions/v1/gerenciar-usuarios', { headers: { Authorization: 'Bearer ' + await tok(email) }, data: { acao: 'criar', usuarios: [{ nome: 'X', email: 'x.' + email, papel: 'admin' }] } });
    expect(r.status()).toBe(403);
  }
  expect((await request.post('/functions/v1/gerenciar-usuarios', { data: { acao: 'criar', usuarios: [] } })).status()).toBe(401);
  const n = await sql(request, "select count(*)::int n from perfis where email like 'x.%'"); expect(n[0].n).toBe(0);
});
