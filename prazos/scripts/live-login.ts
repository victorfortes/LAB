/** Abre o Astrea no perfil persistente para você fazer login MANUALMENTE (MFA/CAPTCHA inclusos). Enter encerra e salva a sessão. */
import { createInterface } from 'node:readline/promises';
import { chromium } from 'playwright';

const base = process.env.ASTREA_BASE_URL;
if (!base) { console.error('Defina ASTREA_BASE_URL'); process.exit(1); }
const ctx = await chromium.launchPersistentContext(process.env.ASTREA_PROFILE_DIR ?? '.astrea-profile', { headless: false });
await (ctx.pages()[0] ?? (await ctx.newPage())).goto(base);
const rl = createInterface({ input: process.stdin, output: process.stdout });
await rl.question('Faça login na janela e pressione Enter aqui para salvar a sessão... ');
rl.close();
await ctx.close();
