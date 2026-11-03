import type { BrowserContext } from 'playwright';
import { requireSelector, type SelectorMap } from './selectors.ts';

/**
 * Espera o usuário fazer login MANUALMENTE na janela do navegador (MFA/CAPTCHA inclusos) e MANTÉM a página aberta.
 * Este Astrea não persiste a sessão ao fechar o navegador; por isso o app mantém o mesmo contexto aberto enquanto roda.
 * O robô nunca digita credenciais nem contorna verificações: apenas observa se o menu logado apareceu.
 */
export async function waitForManualLogin(
  ctx: BrowserContext, baseUrl: string, sel: SelectorMap,
  opts: { timeoutMs?: number; log?: (m: string) => void } = {},
): Promise<void> {
  const log = opts.log ?? (() => {});
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  const loggedIn = requireSelector(sel, 'read', 'loggedInIndicator');
  const deadline = Date.now() + (opts.timeoutMs ?? 15 * 60_000);
  let told = false;
  while (Date.now() < deadline) {
    if ((await page.locator(loggedIn).count()) > 0) { log('Sessão do Astrea detectada.'); return; }
    if (!told) { log('>>> Faça login MANUALMENTE na janela do navegador que abriu (MFA/CAPTCHA inclusos). Aguardando…'); told = true; }
    await page.waitForTimeout(3000);
  }
  throw new Error('Login manual no Astrea não concluído a tempo');
}
