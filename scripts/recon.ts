/**
 * FASE 1 — Reconhecimento SOMENTE LEITURA do Astrea.
 *
 * O usuário faz login MANUALMENTE (incluindo MFA/CAPTCHA, se houver) na janela aberta; o script
 * nunca preenche credenciais nem contorna verificações. Depois, o usuário navega até cada tela do
 * fluxo e digita o nome do passo no terminal para capturar a estrutura (atributos, sem valores) e
 * a rede observada (método+caminho normalizado, sem query). Requisições não-GET são bloqueadas.
 *
 * Uso: ASTREA_BASE_URL=<url> bun run recon [--allow-post=<regex>] [--with-aria]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { chromium } from 'playwright';
import { maskString } from '../src/security/mask.ts';
import {
  RECON_STEPS, guardRequest, inventoryScript, normalizePath, sanitizeElements, sanitizeText,
  type ElementInfo, type NetRecord,
} from '../src/astrea/recon.ts';

const base = process.env.ASTREA_BASE_URL;
if (!base) { console.error('Defina ASTREA_BASE_URL (URL do Astrea que você usa).'); process.exit(1); }
const profile = process.env.ASTREA_PROFILE_DIR ?? '.astrea-profile';
const allow = process.argv.filter((a) => a.startsWith('--allow-post=')).map((a) => new RegExp(a.slice(13)));
const withAria = process.argv.includes('--with-aria');
const host = new URL(base).host;

const outDir = `recon-output/${new Date().toISOString().replace(/[:.]/g, '-')}`;
mkdirSync(outDir, { recursive: true });

const ctx = await chromium.launchPersistentContext(profile, { headless: false });
const page = ctx.pages()[0] ?? (await ctx.newPage());
let net: NetRecord[] = [];
const blockedLog: string[] = [];

await ctx.route('**/*', async (route) => {
  const req = route.request();
  if (new URL(req.url()).host === host) {
    const d = guardRequest(req.method(), req.url(), allow);
    if (d.block) {
      blockedLog.push(`${req.method()} ${normalizePath(req.url())}`);
      net.push({ method: req.method(), path: normalizePath(req.url()), type: req.resourceType(), status: null, blocked: true });
      return route.abort('blockedbyclient');
    }
  }
  return route.continue();
});
ctx.on('response', (res) => {
  const req = res.request();
  if (new URL(req.url()).host !== host) return;
  if (['xhr', 'fetch', 'document'].includes(req.resourceType()))
    net.push({ method: req.method(), path: normalizePath(req.url()), type: req.resourceType(), status: res.status(), blocked: false });
});

await page.goto(base);
console.log(`\nJanela aberta. Faça login MANUALMENTE (MFA/CAPTCHA inclusos). Saída: ${outDir}`);
console.log('Passos sugeridos (NÃO salve nada nos formulários):\n  ' + RECON_STEPS.join('\n  '));
console.log('\nDigite o nome do passo + Enter para capturar a tela atual. "q" encerra.\n');

const steps: unknown[] = [];
let lastSig = '';
const rl = createInterface({ input: process.stdin, output: process.stdout });
for (;;) {
  const name = (await rl.question('passo> ')).trim();
  if (name === 'q') break;
  if (!name) continue;
  // A tela alvo é a aba VISÍVEL/focada (o Astrea pode abrir telas em nova aba/janela).
  const pages = ctx.pages();
  let cur = pages[pages.length - 1]!;
  for (const pg of pages) { try { if ((await pg.evaluate('document.visibilityState')) === 'visible') cur = pg; } catch { /* aba fechando */ } }
  const els = sanitizeElements((await cur.evaluate(inventoryScript())) as ElementInfo[]);
  const sigNow = els.map((e) => `${e.tag}|${e.id}|${e.name}|${e.testId}|${e.text}`).join('\n');
  const same = sigNow === lastSig; lastSig = sigNow;
  const step = {
    name, capturedAt: new Date().toISOString(), url: normalizePath(cur.url()), title: sanitizeText(await cur.title(), 80), tabs: pages.length,
    elements: els, network: net, aria: withAria ? maskString(await cur.locator('body').ariaSnapshot()) : null,
  };
  net = [];
  steps.push(step);
  writeFileSync(`${outDir}/steps.json`, JSON.stringify({ host, blockedMutations: blockedLog, steps }, null, 2));
  console.log(`  capturado: ${els.length} elementos visíveis | url: ${normalizePath(cur.url())} | abas: ${pages.length} | bloqueios: ${blockedLog.length}`);
  if (same) console.log('  ⚠ IGUAL à captura anterior: a tela não mudou (ou a aba focada não é a que você navegou). Navegue e capture de novo com o mesmo nome.');
}
rl.close();
await ctx.close();
console.log(`Concluído. Revise ${outDir}/steps.json (mascarado) e transcreva o mapa para docs/ASTREA-MAP.md.`);
