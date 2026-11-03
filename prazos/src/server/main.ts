import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { loadConfig } from '../config.ts';
import { DEMO_AUTHORIZED, SimulatedAstrea } from '../astrea/simulated.ts';
import { hashPassword } from '../security/auth.ts';
import { log } from '../security/mask.ts';
import type { Role } from '../security/rbac.ts';
import { MemoryRepo } from '../store/memory.ts';
import { PgRepo } from '../store/postgres.ts';
import type { Repo } from '../store/repo.ts';
import { createApp } from './app.ts';
import { makePool, resolveDatabaseUrl } from '../store/connect.ts';
import { migrate } from '../../scripts/migrate.ts';
import { buildServices } from './services.ts';
import type { AstreaPort } from '../astrea/port.ts';
import { Vault } from '../security/vault.ts';

const demo = process.argv.includes('--demo');
/** Leitura do Astrea REAL numa sessão local: memória, usuários efêmeros, escrita DESLIGADA, escopo por cliente. */
const liveLocal = process.argv.includes('--live-local');
/** Teste de ESCRITA REAL (Etapa 1): exige confirmação digitada e fica restrito a 1 publicação e 1 processo. */
const realWriteTest = liveLocal && process.env.NGA_REAL_WRITE_TEST === 'yes-i-authorize';
/**
 * PILOTO (Etapa 4): prazo REAL (sem prefixo de teste), travado em 1 publicação + 1 processo informados por você, com no máximo 1 gravação.
 * Não há valores padrão: sem NGA_PILOT_PUBLICATION e NGA_PILOT_PROCESS o app não sobe.
 */
const realPilot = liveLocal && process.env.NGA_REAL_PILOT === 'yes-i-authorize';
const production = liveLocal && process.env.NGA_PRODUCTION === 'yes-i-authorize';
if (production && (realPilot || realWriteTest)) { console.error('Use só um modo: produção, piloto ou teste.'); process.exit(1); }
if (realPilot && realWriteTest) { console.error('Use NGA_REAL_WRITE_TEST (teste) OU NGA_REAL_PILOT (piloto), não os dois.'); process.exit(1); }
if (realPilot && (!process.env.NGA_PILOT_PUBLICATION || !process.env.NGA_PILOT_PROCESS)) {
  console.error('Piloto: defina NGA_PILOT_PUBLICATION (id da publicação) e NGA_PILOT_PROCESS (nº do processo). Não há padrão.'); process.exit(1);
}
const env = { ...process.env } as Record<string, string | undefined>;
if (demo) {
  env.NGA_MODE = 'simulated';
  env.JWT_SECRET ??= randomBytes(48).toString('base64'); // efêmero, só para o demo
  env.NGA_WRITE_ENABLED ??= 'true'; // simulador: escrita liberada para a demonstração
  env.NGA_STEP_DELAY_MS ??= '700';
}
if (liveLocal) {
  env.NGA_MODE = 'live';
  // Chave de sessão FIXA (Keychain): reiniciar o app não derruba o login de quem está usando.
  if (!env.JWT_SECRET && process.platform === 'darwin') {
    const k = Bun.spawnSync(['security', 'find-generic-password', '-s', 'nga-prazos-jwt', '-w']);
    if (k.exitCode === 0 && k.stdout.toString().trim().length >= 32) env.JWT_SECRET = k.stdout.toString().trim();
    else { const sec = randomBytes(48).toString('base64'); Bun.spawnSync(['security', 'add-generic-password', '-U', '-a', process.env.USER ?? 'nga', '-s', 'nga-prazos-jwt', '-w', sec]); env.JWT_SECRET = sec; }
  }
  env.JWT_SECRET ??= randomBytes(48).toString('base64');
  env.NGA_WRITE_ENABLED = realWriteTest || realPilot || production ? 'true' : 'false'; // só grava no teste/piloto/produção confirmados
  env.NGA_AUTHORIZED_CLIENT_REGEX ??= 'copel';
  env.NGA_STALE_RUN_MS ??= String(15 * 60_000);
  if (realPilot) {
    if (!new Vault(env.NGA_VAULT_FILE ?? '.nga-vault.json').has('astrea')) env.NGA_HEADLESS ??= 'false';
    env.NGA_LEARN_WRITE = 'true';
    env.NGA_TITLE_PREFIX = ''; // prazo REAL: sem prefixo de teste
    env.NGA_WRITE_ONLY_PUBLICATIONS = process.env.NGA_PILOT_PUBLICATION;
    env.NGA_MAX_REAL_WRITES = '1';
    if (process.env.NGA_PILOT_ALLOW_THIRD_PARTY === 'yes') env.NGA_ALLOW_THIRD_PARTY_PUBLICATIONS = process.env.NGA_PILOT_PUBLICATION; // autorizado pelo usuário só p/ esta publicação
  }
  if (production) {
    env.NGA_LEARN_WRITE = 'true'; env.NGA_TITLE_PREFIX = ''; env.NGA_PRODUCTION_WRITE = 'yes';
    env.NGA_MAX_REAL_WRITES ??= '25'; // teto de criações por execução do app; reinicie para liberar mais
  }
  if (realWriteTest) {
    if (!new Vault(env.NGA_VAULT_FILE ?? '.nga-vault.json').has('astrea')) env.NGA_HEADLESS ??= 'false'; // sem credenciais salvas: janela visível p/ login manual
    env.NGA_LEARN_WRITE = 'true';
    env.NGA_TITLE_PREFIX ??= '[TESTE NGA PRAZOS] ';
    env.NGA_WRITE_ONLY_PUBLICATIONS ??= '359137884';
  }
  env.ASTREA_BASE_URL ??= 'https://astrea.net.br/';
}
env.DATABASE_URL = resolveDatabaseUrl(env) ?? undefined;
const cfg = loadConfig(env);
if (!cfg.jwtSecret) { log.error('JWT_SECRET obrigatório'); process.exit(1); }

// Banco permanente (PostgreSQL/Supabase) sempre que DATABASE_URL existir (exceto no demo). Sem ela, o modo live-local usa memória.
const usePg = !!cfg.databaseUrl && !demo;
let repo: Repo;
if (usePg) {
  const pool = makePool(cfg.databaseUrl!, env);
  const c = await pool.connect();
  try { const applied = await migrate(c); if (applied.length) log.info('migrations aplicadas', { applied }); } finally { c.release(); }
  repo = new PgRepo(pool);
} else repo = new MemoryRepo();

const vault = new Vault(cfg.vaultFile);
let astrea: AstreaPort;
if (cfg.mode === 'simulated') astrea = new SimulatedAstrea();
else {
  const { chromium } = await import('playwright');
  const { LiveAstrea } = await import('../astrea/live.ts');
  const { loadSelectors } = await import('../astrea/selectors.ts');
  if (!env.ASTREA_BASE_URL) { log.error('ASTREA_BASE_URL obrigatório em modo live'); process.exit(1); }
  const headless = env.NGA_HEADLESS !== 'false';
  const ctx = await chromium.launchPersistentContext(env.ASTREA_PROFILE_DIR ?? '.astrea-profile', { headless });
  const selectors = loadSelectors('config/selectors.json');
  // Com janela visível, espera o login MANUAL e mantém o mesmo navegador aberto (a sessão não persiste ao fechar).
  const manualLogin = env.NGA_LOGIN_MODE === 'manual';
  const useAuto = !manualLogin;
  // Janela visível SEM login automático configurado: espera o login MANUAL e mantém o mesmo navegador aberto.
  if (!headless && !vault.has('astrea')) { const { waitForManualLogin } = await import('../astrea/live-session.ts'); await waitForManualLogin(ctx, env.ASTREA_BASE_URL, selectors, { log: (m) => console.log(m) }); }
  astrea = new LiveAstrea(ctx, env.ASTREA_BASE_URL, selectors, { maxPerRun: Number(env.NGA_LIVE_MAX ?? 12), learnWrite: cfg.learnWrite, writeAllow: cfg.astreaWriteAllow,
    // Navegador interno preso (ex.: Mac suspenso): reinicia e tenta de novo no início da execução.
    relaunch: () => chromium.launchPersistentContext(env.ASTREA_PROFILE_DIR ?? '.astrea-profile', { headless }),
    // Login automático com as credenciais do cofre (uma tentativa por vez; MFA/CAPTCHA nunca são contornados).
    autoLogin: useAuto ? async (page) => (await import('../astrea/auto-login.ts')).autoLogin(page, vault, selectors) : undefined });
}

if (demo || liveLocal) {
  if (demo) await repo.setAuthorizedProcesses(DEMO_AUTHORIZED);
  if (realPilot) await repo.setAuthorizedProcesses([{ processNumber: process.env.NGA_PILOT_PROCESS!, responsible: null }]); // responsável vem do Astrea
  if (realWriteTest) await repo.setAuthorizedProcesses([{ processNumber: process.env.NGA_TEST_PROCESS ?? '1001409-24.2022.8.26.0260', responsible: 'Victor Fortes' }]);
  const creds: Array<[string, Role]> = usePg ? [] : [['admin', 'admin'], ['operador', 'operator'], ['auditor', 'auditor']];
  if (usePg) console.log('\nBanco permanente em uso: usuários e senhas vêm do banco (crie com scripts/create-user.ts). Nada é gerado automaticamente.');
  console.log(liveLocal ? `\n=== NGA Prazos — ${production ? 'PRODUÇÃO (escrita liberada após aprovação humana)' : realPilot || realWriteTest ? 'PILOTO/TESTE' : 'LEITURA'} · Astrea REAL · escopo: clientes /${cfg.authorizedClientRegex}/i ===` : '\n=== NGA Prazos — DEMO (dados fictícios, simulador) ===');
  for (const [username, role] of creds) {
    const pw = randomBytes(9).toString('base64url');
    await repo.createUser({ id: randomUUID(), username, passwordHash: await hashPassword(pw), role, active: true });
    console.log(`  ${role.padEnd(9)} usuário: ${username}  senha (efêmera): ${pw}`);
  }
}

const app = createApp(buildServices(cfg, repo, astrea, vault));
const server = app.listen(cfg.port, '127.0.0.1', () => log.info('NGA Prazos no ar', { url: `http://127.0.0.1:${cfg.port}`, mode: cfg.mode, writeEnabled: cfg.writeEnabled }));
process.on('SIGINT', () => server.close(() => process.exit(0)));
