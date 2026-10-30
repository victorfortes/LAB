import { randomUUID } from 'node:crypto';
import { SimulatedAstrea, DEMO_AUTHORIZED, type SimFaults } from '../src/astrea/simulated.ts';
import { loadConfig } from '../src/config.ts';
import { hashPassword } from '../src/security/auth.ts';
import type { Role } from '../src/security/rbac.ts';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault } from '../src/security/vault.ts';
import { buildServices } from '../src/server/services.ts';
import { MemoryRepo } from '../src/store/memory.ts';
import type { Actor } from '../src/runner/runner.ts';

export const actor = (role: Role, username = role): Actor => ({ role, username });

export async function setup(faults: SimFaults = {}, env: Record<string, string> = {}) {
  const repo = new MemoryRepo();
  const astrea = new SimulatedAstrea(undefined, faults);
  const cfg = loadConfig({ JWT_SECRET: 'x'.repeat(40), NGA_WRITE_ENABLED: 'true', NGA_STALE_RUN_MS: '60000', ...env }, '/nonexistent');
  await repo.setAuthorizedProcesses(DEMO_AUTHORIZED);
  // cofre de TESTE: arquivo temporário + chave fixa (nunca toca o Keychain nem o cofre real)
  const s = buildServices(cfg, repo, astrea, new Vault(join(tmpdir(), `nga-test-vault-${randomUUID()}.json`), async () => Buffer.alloc(32, 5)));
  return { repo, astrea, cfg, s };
}

export async function addUser(repo: MemoryRepo, username: string, role: Role, password = 'senha-de-teste-123') {
  await repo.createUser({ id: randomUUID(), username, role, active: true, passwordHash: await hashPassword(password) });
}

export async function runAll(s: Awaited<ReturnType<typeof setup>>['s']) {
  const run = await s.runner.start(actor('operator'));
  await s.runner.finished(run.id);
  return (await s.repo.getRun(run.id))!;
}

export async function authorizeWrites(s: Awaited<ReturnType<typeof setup>>['s'], processes?: string[]) {
  const all = processes ?? (await s.repo.listAuthorizedProcesses()).map((p) => p.processNumber);
  return s.workflow.createWriteAuthorization(actor('admin'), { processNumbers: all, expiresAt: new Date(Date.now() + 3600_000).toISOString(), note: 'teste automatizado autorizado' });
}
