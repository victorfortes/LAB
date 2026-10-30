import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser } from 'playwright';
import { autoLogin } from '../src/astrea/auto-login.ts';
import { LiveAstrea } from '../src/astrea/live.ts';
import { SessionExpiredError } from '../src/astrea/port.ts';
import { loadSelectors } from '../src/astrea/selectors.ts';
import { Vault } from '../src/security/vault.ts';
import { serve } from './fixtures/fake-astrea.ts';

let browser: Browser; let up = true; const dir = mkdtempSync(join(tmpdir(), 'nga-al-'));
beforeAll(async () => { try { browser = await chromium.launch(); } catch (e) { up = false; console.warn('Chromium indisponível:', (e as Error).message); } }, 60_000);
afterAll(async () => { await browser?.close(); rmSync(dir, { recursive: true, force: true }); });

const sel = () => loadSelectors('config/selectors.json');
async function vaultWith(email: string, password: string) {
  const v = new Vault(join(dir, `v-${Math.random()}.json`), async () => Buffer.alloc(32, 3));
  await v.save('astrea', { email, password });
  return v;
}
async function mk(fake: ReturnType<typeof serve>, v: Vault) {
  const ctx = await browser.newContext(); // sessão limpa
  const s = sel();
  return new LiveAstrea(ctx, fake.url, s, { pageDelayMs: 0, timeoutMs: 20000, autoLogin: (p) => autoLogin(p, v, s) });
}

describe('login automático (fixture; credenciais FICTÍCIAS)', () => {
  test('sucesso: loga sozinho e a leitura segue; 1 tentativa', async () => {
    if (!up) return;
    const fake = serve({ requireLogin: true });
    try {
      const l = await mk(fake, await vaultWith('robo@exemplo.test', 'senha-fake-123'));
      const pubs = await l.listUntreatedPublications({ limit: 5 });
      expect(pubs.length).toBe(2);
      expect(fake.loginAttempts).toEqual([true]);
    } finally { fake.stop(); }
  }, 120_000);

  test('senha incorreta: SessionExpiredError e NÃO tenta de novo (não bloqueia a conta)', async () => {
    if (!up) return;
    const fake = serve({ requireLogin: true });
    try {
      const l = await mk(fake, await vaultWith('robo@exemplo.test', 'errada-errada'));
      await expect(l.assertSession()).rejects.toBeInstanceOf(SessionExpiredError);
      await expect(l.assertSession()).rejects.toThrow(/não será repetido/);
      expect(fake.loginAttempts).toEqual([false]); // UMA tentativa só
    } finally { fake.stop(); }
  }, 150_000);

  test('desafio (CAPTCHA/MFA): não digita nada, não contorna: pede login manual', async () => {
    if (!up) return;
    const fake = serve({ requireLogin: true, challenge: true });
    try {
      const l = await mk(fake, await vaultWith('robo@exemplo.test', 'senha-fake-123'));
      await expect(l.assertSession()).rejects.toThrow(/MFA\/CAPTCHA/);
      expect(fake.loginAttempts).toEqual([]);
    } finally { fake.stop(); }
  }, 120_000);

  test('sem credenciais salvas: mensagem clara, nenhuma tentativa', async () => {
    if (!up) return;
    const fake = serve({ requireLogin: true });
    try {
      const l = await mk(fake, new Vault(join(dir, 'vazio.json'), async () => Buffer.alloc(32, 3)));
      await expect(l.assertSession()).rejects.toThrow(/Sem credenciais salvas/);
      expect(fake.loginAttempts).toEqual([]);
    } finally { fake.stop(); }
  }, 120_000);
});
