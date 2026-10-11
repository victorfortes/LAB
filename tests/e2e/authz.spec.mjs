// Autorização ponta a ponta: o gerador original falando com o banco (RLS) com cada perfil.
import { test, expect } from '@playwright/test';
import { entrar, geradorPronto, sair, sql, SENHA } from './helpers.mjs';

async function token(request, email) {
  const r = await request.post('/auth/v1/token?grant_type=password', { data: { email, password: SENHA } });
  return (await r.json()).access_token;
}
const H = (t) => ({ apikey: 'x', Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' });

test('API sem token e com perfil errado: acesso negado no servidor', async ({ request }) => {
  expect((await request.get('/rest/v1/documentos?select=id')).status()).toBe(401);
  const vis = await token(request, 'vis@teste.local'), adv = await token(request, 'adv@teste.local'), sem = await token(request, 'semperfil@teste.local');
  // visualizador não grava
  const w = await request.post('/rest/v1/documentos?on_conflict=colecao,id', { headers: H(vis), data: { colecao: 'clientes', id: 'v1', dados: { id: 'v1' }, removido: false } });
  expect(w.status()).toBe(403);
  // usuário sem perfil não lê nada
  expect(await (await request.get('/rest/v1/documentos?select=id', { headers: H(sem) })).json()).toEqual([]);
  // advogado não lê auditoria nem altera perfis
  expect(await (await request.get('/rest/v1/auditoria', { headers: H(adv) })).json()).toEqual([]);
  const p = await request.patch('/rest/v1/perfis?user_id=eq.00000000-0000-0000-0000-000000000000', { headers: H(adv), data: { papel: 'admin' } });
  expect(await p.json()).toEqual([]);
});

test('visualizador: lê, mas a gravação é recusada pelo banco e a interface não oferece gerar', async ({ page, request }) => {
  await entrar(page, 'adv@teste.local'); let fr = await geradorPronto(page);
  await fr.evaluate(() => window.__NGA.Clientes.novo('CLIENTE PARA VISUALIZAR', {})); await page.waitForTimeout(1500);
  await sair(page, fr);
  await entrar(page, 'vis@teste.local'); fr = await geradorPronto(page);
  const r = await fr.evaluate(async () => {
    const db = await window.NGA_NUVEM.db();
    const lidos = (await db.collection('clientes').get()).docs.map(d => d.data().nome);
    let gravou; try { await db.doc('clientes/vis_x').set({ id: 'vis_x', nome: 'NÃO DEVE GRAVAR' }); gravou = 'gravou'; } catch (e) { gravou = e.code + ' ' + e.message; }
    return { lidos, gravou, gerar: window.NGA_EQUIPE.pode('gerar'), papel: window.NGA_USUARIO.papel, btnUsuarios: getComputedStyle(document.getElementById('topbar-btn-gerenciar')).display };
  });
  expect(r.lidos).toContain('CLIENTE PARA VISUALIZAR');
  expect(r.gravou).toMatch(/permission|403/);
  expect(r.gerar).toBe(false); expect(r.papel).toBe('leitor'); expect(r.btnUsuarios).toBe('none');
  expect((await sql(request, `select count(*)::int n from documentos where id='vis_x'`))[0].n).toBe(0);
});

test('advogado grava, mas só administrador exclui cliente; administrador consegue', async ({ page }) => {
  await entrar(page, 'adv@teste.local'); let fr = await geradorPronto(page);
  const r = await fr.evaluate(async () => {
    const db = await window.NGA_NUVEM.db();
    await db.doc('clientes/del_x').set({ id: 'del_x', nome: 'PARA EXCLUIR' });
    let excl; try { await db.doc('clientes/del_x').delete(); excl = 'excluiu'; } catch (e) { excl = e.code; }
    return { excl, btn: getComputedStyle(document.getElementById('topbar-btn-gerenciar')).display };
  });
  expect(r.excl).toBe('permission'); expect(r.btn).toBe('none');
  await sair(page, fr);
  await entrar(page, 'admin@teste.local'); fr = await geradorPronto(page);
  const ok = await fr.evaluate(async () => { const db = await window.NGA_NUVEM.db(); await db.doc('clientes/del_x').delete(); return (await db.doc('clientes/del_x').get()).exists; });
  expect(ok).toBe(false);
});

test('administração: lista usuários, muda perfil (e o efeito vale no banco), não permite mexer em si mesmo', async ({ page, request }) => {
  await entrar(page, 'admin@teste.local'); const fr = await geradorPronto(page);
  await expect(fr.locator('#topbar-btn-gerenciar')).toBeVisible();
  await fr.locator('#topbar-btn-gerenciar').click();
  await expect(page.locator('#admin')).toBeVisible();
  const linhas = page.locator('#tb-usuarios tr');
  await expect(linhas).toHaveCount(4);   // admin, adv, vis, inativo (semperfil não tem perfil)
  const minha = page.locator('#tb-usuarios tr', { hasText: 'admin@teste.local' });
  await expect(minha.locator('select').first()).toBeDisabled();
  const dele = page.locator('#tb-usuarios tr', { hasText: 'vis@teste.local' });
  await dele.locator('select').first().selectOption('advogado');
  await expect(page.locator('#admin-msg')).toHaveText(/Alteração salva/);
  expect((await sql(request, `select papel from perfis where email='vis@teste.local'`))[0].papel).toBe('advogado');
  await dele.locator('select').first().selectOption('visualizador');   // devolve
  await page.locator('.aba[data-aba="auditoria"]').click();
  await expect(page.locator('#tb-auditoria')).toContainText('usuario_alterar');
});

test('advogado não vê a administração e o pedido direto à API também falha', async ({ page }) => {
  await entrar(page, 'adv@teste.local'); const fr = await geradorPronto(page);
  await expect(fr.locator('#topbar-btn-gerenciar')).toBeHidden();
  await page.evaluate(() => window.postMessage({ nga: 'admin' }, location.origin));   // não vem do iframe: ignorado
  await expect(page.locator('#admin')).toBeHidden();
  await fr.evaluate(() => window.parent.postMessage({ nga: 'admin' }, location.origin));   // do iframe, mas sem papel admin
  await page.waitForTimeout(300);
  await expect(page.locator('#admin')).toBeHidden();
});
