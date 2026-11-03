import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { migrate } from '../scripts/migrate.ts';
import { classify } from '../src/domain/classifier.ts';
import { DEMO_PUBLICATIONS } from '../src/astrea/simulated.ts';
import { PgRepo } from '../src/store/postgres.ts';
import { RunInProgress, VersionConflict } from '../src/store/repo.ts';
import type { Rec, Run } from '../src/store/models.ts';

/**
 * Contrato do repositório PostgreSQL. Usa DATABASE_URL_TEST se definido; senão sobe um Postgres
 * embarcado temporário (embedded-postgres). Se nenhum estiver disponível, os testes são pulados.
 */
let pool: pg.Pool | null = null; let repo: PgRepo; let stop: (() => Promise<void>) | null = null;
const dir = mkdtempSync(join(tmpdir(), 'nga-pg-'));

beforeAll(async () => {
  try {
    let url = process.env.DATABASE_URL_TEST;
    if (!url) {
      const { default: EmbeddedPostgres } = await import('embedded-postgres');
      const port = 54000 + Math.floor(Math.random() * 900);
      const pgs = new EmbeddedPostgres({ databaseDir: dir, user: 'nga', password: 'nga-test-only', port, persistent: false });
      await pgs.initialise(); await pgs.start(); await pgs.createDatabase('nga_test');
      stop = () => pgs.stop();
      url = `postgres://nga:nga-test-only@127.0.0.1:${port}/nga_test`;
    }
    pool = new pg.Pool({ connectionString: url });
    const c = await pool.connect(); await migrate(c); c.release();
    repo = new PgRepo(pool);
  } catch (e) { console.warn('PG indisponível, pulando:', (e as Error).message); pool = null; }
}, 120_000);
afterAll(async () => { await pool?.end(); await stop?.(); rmSync(dir, { recursive: true, force: true }); });

const run = (id: string): Run => ({ id, status: 'running', mode: 'simulated', startedBy: 'u', startedAt: new Date().toISOString(), finishedAt: null, heartbeatAt: new Date().toISOString(), progress: { total: 0, processed: 0, classified: 0, needsReview: 0, noAction: 0, duplicates: 0, skippedUnauthorized: 0 }, error: null });
const rec = (id: string, ext: string, runId: string): Rec => ({ id, runId, externalId: ext, processNumber: 'p', clientName: 'c', availabilityDate: '2026-03-02', fullText: 't', analysis: classify(DEMO_PUBLICATIONS[0]!), state: 'classified', version: 1, approvedBy: null, approvedAt: null, acknowledgedFlags: false, auditedBy: null, auditedAt: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });

describe('PgRepo', () => {
  test('lock: só uma execução ativa (índice único parcial)', async () => {
    if (!pool) return;
    await repo.tryStartRun(run('r1'), 60_000);
    await expect(repo.tryStartRun(run('r2'), 60_000)).rejects.toBeInstanceOf(RunInProgress);
    await repo.updateRun('r1', { status: 'completed' });
    await repo.tryStartRun(run('r3'), 60_000);
    await repo.updateRun('r3', { status: 'completed' });
  });
  test('registros: external_id único e controle otimista de versão', async () => {
    if (!pool) return;
    expect(await repo.insertRecord(rec('a', 'E1', 'r1'))).toBe(true);
    expect(await repo.insertRecord(rec('b', 'E1', 'r1'))).toBe(false);
    await repo.updateRecord('a', { state: 'approved' }, 1);
    await expect(repo.updateRecord('a', { state: 'rejected' }, 1)).rejects.toBeInstanceOf(VersionConflict);
  });
  test('idempotência: claimWriteOp só reivindica uma vez', async () => {
    if (!pool) return;
    const op = { key: 'k1', recordId: 'a', actionId: 'x', status: 'pending' as const, astreaId: null, expected: {}, readBack: null, adopted: false, error: null, evidence: [], updatedAt: '' };
    const [x, y] = await Promise.all([repo.claimWriteOp(op), repo.claimWriteOp(op)]);
    expect([x.claimed, y.claimed].sort()).toEqual([false, true]);
  });
  test('auditoria: cadeia íntegra sob concorrência e UPDATE/DELETE/TRUNCATE bloqueados', async () => {
    if (!pool) return;
    await Promise.all(Array.from({ length: 12 }, (_, i) => repo.appendAudit({ actor: 'u', action: 't', entityType: 'e', entityId: String(i), data: { cpf: '123.456.789-09' } })));
    const v = await repo.verifyAudit();
    expect(v.ok).toBe(true); expect(v.count).toBeGreaterThanOrEqual(12);
    await expect(pool.query("UPDATE audit_log SET actor='x'")).rejects.toThrow(/imutável/);
    await expect(pool.query('DELETE FROM audit_log')).rejects.toThrow(/imutável/);
    await expect(pool.query('TRUNCATE audit_log')).rejects.toThrow(/imutável/);
    expect(JSON.stringify(await repo.listAudit())).not.toContain('123.456.789-09');
  });
});
