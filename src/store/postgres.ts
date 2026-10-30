import pg from 'pg';
import { GENESIS, nextEntry, verifyChain, type AuditEntry } from '../audit/chain.ts';
import type { AuthorizedProcess } from '../domain/types.ts';
import type { Comment, Correction, Rec, Run, User, WriteAuthorization, WriteOp } from './models.ts';
import { RunInProgress, VersionConflict, type AuditInput, type Repo } from './repo.ts';

/** Falhas transitórias de conexão (rede/pooler derrubou a conexão): tenta de novo até 2 vezes com conexão nova. */
const transient = (e: unknown) => /ETIMEDOUT|ECONNRESET|EPIPE|ECONNREFUSED|Connection terminated|connection timeout|57P01|08006|08003|08001/i.test(`${(e as { code?: string })?.code ?? ''} ${(e as Error)?.message ?? ''}`);
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let i = 0; ; i++) {
    try { return await fn(); } catch (e) { if (i >= 2 || !transient(e)) throw e; await new Promise((r) => setTimeout(r, 300 * (i + 1))); }
  }
}

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v));

export class PgRepo implements Repo {
  constructor(private pool: pg.Pool) {}

  private async q<T = any>(sql: string, p: unknown[] = []): Promise<T[]> {
    return (await withRetry(() => this.pool.query(sql, p))).rows as T[];
  }

  async getUserByName(username: string) {
    const [r] = await this.q('SELECT * FROM users WHERE username=$1', [username]);
    return r ? ({ id: r.id, username: r.username, passwordHash: r.password_hash, role: r.role, active: r.active } as User) : null;
  }
  async createUser(u: User) {
    await this.q('INSERT INTO users(id,username,password_hash,role,active) VALUES ($1,$2,$3,$4,$5)', [u.id, u.username, u.passwordHash, u.role, u.active]);
  }

  async tryStartRun(run: Run, staleMs: number) {
    await this.q(
      `UPDATE runs SET status='abandoned', data = data || '{"status":"abandoned"}'::jsonb
       WHERE status IN ('running','awaiting_login') AND heartbeat_at < now() - ($1 || ' milliseconds')::interval`, [String(staleMs)]);
    try {
      await this.q('INSERT INTO runs(id,status,heartbeat_at,started_at,data) VALUES ($1,$2,$3,$4,$5)', [run.id, run.status, run.heartbeatAt, run.startedAt, run]);
    } catch (e: any) {
      if (e.code === '23505') {
        const [a] = await this.q(`SELECT id FROM runs WHERE status IN ('running','awaiting_login') LIMIT 1`);
        throw new RunInProgress(a?.id ?? '?');
      }
      throw e;
    }
  }
  async updateRun(id: string, patch: Partial<Run>) {
    const cur = await this.getRun(id); if (!cur) throw new Error('run não encontrada');
    const n = { ...cur, ...patch };
    await this.q('UPDATE runs SET status=$2, heartbeat_at=$3, data=$4 WHERE id=$1', [id, n.status, n.heartbeatAt, n]);
    return n;
  }
  async getRun(id: string) { return (await this.q('SELECT data FROM runs WHERE id=$1', [id]))[0]?.data ?? null; }
  async listRuns(limit = 20) { return (await this.q('SELECT data FROM runs ORDER BY started_at DESC LIMIT $1', [limit])).map((r) => r.data as Run); }

  async listAuthorizedProcesses() {
    return (await this.q('SELECT process_number, responsible FROM authorized_processes ORDER BY process_number'))
      .map((r) => ({ processNumber: r.process_number, responsible: r.responsible }) as AuthorizedProcess);
  }
  async setAuthorizedProcesses(list: AuthorizedProcess[]) {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('DELETE FROM authorized_processes');
      for (const p of list) await c.query('INSERT INTO authorized_processes VALUES ($1,$2)', [p.processNumber, p.responsible]);
      await c.query('COMMIT');
    } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
  }

  async insertRecord(r: Rec) {
    const res = await withRetry(() => this.pool.query(
      'INSERT INTO records(id,run_id,external_id,state,version,data) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (external_id) DO NOTHING',
      [r.id, r.runId, r.externalId, r.state, r.version, r]));
    return res.rowCount === 1;
  }
  async getRecord(id: string) { return (await this.q('SELECT data FROM records WHERE id=$1', [id]))[0]?.data ?? null; }
  async updateRecord(id: string, patch: Partial<Rec>, expectedVersion: number) {
    const cur = await this.getRecord(id); if (!cur) throw new Error('registro não encontrado');
    const n: Rec = { ...cur, ...patch, version: expectedVersion + 1, updatedAt: new Date().toISOString() };
    const res = await withRetry(() => this.pool.query('UPDATE records SET state=$2, version=$3, updated_at=now(), data=$4 WHERE id=$1 AND version=$5', [id, n.state, n.version, n, expectedVersion]));
    if (res.rowCount !== 1) throw new VersionConflict();
    return n;
  }
  async listRecords(f: { runId?: string; state?: string } = {}) {
    return (await this.q(
      'SELECT data FROM records WHERE ($1::text IS NULL OR run_id=$1) AND ($2::text IS NULL OR state=$2) ORDER BY created_at, id',
      [f.runId ?? null, f.state ?? null])).map((r) => r.data as Rec);
  }
  async existsExternalId(id: string) { return (await this.q('SELECT 1 FROM records WHERE external_id=$1', [id])).length > 0; }

  async addComment(c: Comment) { await this.q('INSERT INTO comments(id,record_id,data) VALUES ($1,$2,$3)', [c.id, c.recordId, c]); }
  async listComments(recordId: string) { return (await this.q('SELECT data FROM comments WHERE record_id=$1 ORDER BY created_at', [recordId])).map((r) => r.data as Comment); }

  async addWriteAuthorization(a: WriteAuthorization) { await this.q('INSERT INTO write_authorizations(id,expires_at,data) VALUES ($1,$2,$3)', [a.id, a.expiresAt, a]); }
  async listWriteAuthorizations() { return (await this.q('SELECT data, revoked_at FROM write_authorizations ORDER BY expires_at DESC')).map((r) => ({ ...r.data, revokedAt: r.revoked_at ? iso(r.revoked_at) : null }) as WriteAuthorization); }
  async revokeWriteAuthorization(id: string, at: string) { await this.q('UPDATE write_authorizations SET revoked_at=$2 WHERE id=$1', [id, at]); }

  async claimWriteOp(op: WriteOp) {
    const res = await withRetry(() => this.pool.query('INSERT INTO write_ops(key,record_id,status,data) VALUES ($1,$2,$3,$4) ON CONFLICT (key) DO NOTHING', [op.key, op.recordId, op.status, op]));
    if (res.rowCount === 1) return { claimed: true, existing: op };
    return { claimed: false, existing: (await this.q('SELECT data FROM write_ops WHERE key=$1', [op.key]))[0]!.data as WriteOp };
  }
  async updateWriteOp(key: string, patch: Partial<WriteOp>) {
    const cur = (await this.q('SELECT data FROM write_ops WHERE key=$1', [key]))[0]?.data as WriteOp | undefined;
    if (!cur) throw new Error('write op não encontrada');
    const n = { ...cur, ...patch, updatedAt: new Date().toISOString() };
    await this.q('UPDATE write_ops SET status=$2, updated_at=now(), data=$3 WHERE key=$1', [key, n.status, n]);
    return n;
  }
  async listAllWriteOps() { return (await this.q('SELECT data FROM write_ops')).map((r) => r.data as WriteOp); }
  async listWriteOps(recordId: string) { return (await this.q('SELECT data FROM write_ops WHERE record_id=$1', [recordId])).map((r) => r.data as WriteOp); }

  async addCorrection(c: Correction) { await this.q('INSERT INTO corrections(id,record_id,status,data) VALUES ($1,$2,$3,$4)', [c.id, c.recordId, c.status, c]); }
  async getCorrection(id: string) { return (await this.q('SELECT data FROM corrections WHERE id=$1', [id]))[0]?.data ?? null; }
  async updateCorrection(id: string, patch: Partial<Correction>) {
    const cur = await this.getCorrection(id); if (!cur) throw new Error('correção não encontrada');
    const n = { ...cur, ...patch };
    await this.q('UPDATE corrections SET status=$2, data=$3 WHERE id=$1', [id, n.status, n]);
    return n;
  }
  async listCorrections(recordId: string) { return (await this.q('SELECT data FROM corrections WHERE record_id=$1', [recordId])).map((r) => r.data as Correction); }

  async appendAudit(i: AuditInput) {
    return withRetry(() => this.appendAuditOnce(i));
  }
  private async appendAuditOnce(i: AuditInput) {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('SELECT pg_advisory_xact_lock(727001)'); // serializa a cadeia
      const last = (await c.query('SELECT seq, hash FROM audit_log ORDER BY seq DESC LIMIT 1')).rows[0] as { seq: string; hash: string } | undefined;
      const e = nextEntry(last ? { seq: Number(last.seq), hash: last.hash } : null, i);
      await c.query('INSERT INTO audit_log VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [e.seq, e.ts, e.actor, e.action, e.entityType, e.entityId, e.data, e.prevHash, e.hash]);
      await c.query('COMMIT');
      return e;
    } catch (err) { await c.query('ROLLBACK').catch(() => {}); throw err; } finally { c.release(); }
  }
  private row(r: any): AuditEntry {
    return { seq: Number(r.seq), ts: iso(r.ts), actor: r.actor, action: r.action, entityType: r.entity_type, entityId: r.entity_id, data: r.data, prevHash: r.prev_hash, hash: r.hash };
  }
  async listAudit(f: { entityId?: string; limit?: number } = {}) {
    const rows = await this.q('SELECT * FROM (SELECT * FROM audit_log WHERE ($1::text IS NULL OR entity_id=$1) ORDER BY seq DESC LIMIT $2) t ORDER BY seq', [f.entityId ?? null, f.limit ?? 1_000_000]);
    return rows.map((r) => this.row(r));
  }
  async verifyAudit() {
    const all = (await this.q('SELECT * FROM audit_log ORDER BY seq')).map((r) => this.row(r));
    // ts via Date perde precisão sub-ms? ISO com ms é suficiente: entradas são criadas com toISOString().
    return { ...verifyChain(all), count: all.length };
  }
}
export { GENESIS };
