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
