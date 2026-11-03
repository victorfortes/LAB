import type { Page } from 'playwright';
import type { Vault } from '../security/vault.ts';
import { requireSelector, type SelectorMap } from './selectors.ts';

export type AutoLoginResult = 'ok' | 'no_credentials' | 'challenge' | 'failed';

/** Sinais de verificação adicional. Se aparecerem, o robô PARA: MFA/CAPTCHA nunca são contornados. */
const CHALLENGE_RE = /captcha|n[ãa]o sou um rob[ôo]|c[oó]digo de verifica|verifica[cç][aã]o em duas etapas|autentica[cç][aã]o em dois fatores|enviamos um c[oó]digo|token de seguran/i;

/**
 * Login AUTOMÁTICO com as credenciais do cofre. Regras:
 *  - UMA tentativa por chamada (quem chama limita a frequência: errar senha repetidamente pode bloquear a conta);
 *  - nenhuma credencial é logada nem devolvida;
 *  - qualquer MFA/CAPTCHA ⇒ 'challenge' (o usuário conclui manualmente).
 */
export async function autoLogin(page: Page, vault: Vault, sel: SelectorMap, opts: { timeoutMs?: number } = {}): Promise<AutoLoginResult> {
  const creds = await vault.load('astrea');
  if (!creds) return 'no_credentials';
  const email = page.locator(requireSelector(sel, 'read', 'loginEmail')).first();
  const password = page.locator(requireSelector(sel, 'read', 'loginPassword')).first();
  // O botão vem depois de qualquer título "ENTRAR" da página: usa o ÚLTIMO.
  const submit = page.locator(requireSelector(sel, 'read', 'loginSubmit')).last();
  try {
    await email.waitFor({ state: 'visible', timeout: 15_000 });
  } catch {
    return 'failed'; // a tela de login não apareceu
  }
  if (CHALLENGE_RE.test(await page.locator('body').innerText())) return 'challenge';
  await email.fill(creds.email);
  await password.fill(creds.password);
  await submit.click();
  const loggedIn = page.locator(requireSelector(sel, 'read', 'loggedInIndicator')).first();
  const deadline = Date.now() + (opts.timeoutMs ?? 25_000);
  while (Date.now() < deadline) {
    if ((await loggedIn.count()) > 0) return 'ok';
    if (CHALLENGE_RE.test(await page.locator('body').innerText().catch(() => ''))) return 'challenge';
    await page.waitForTimeout(500);
  }
  return 'failed'; // senha incorreta, bloqueio ou lentidão: NÃO tenta de novo
}
