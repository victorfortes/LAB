import { nextEntry, verifyChain, type AuditEntry } from '../audit/chain.ts';
import type { AuthorizedProcess } from '../domain/types.ts';
import type { Comment, Correction, Rec, Run, User, WriteAuthorization, WriteOp } from './models.ts';
import { RunInProgress, VersionConflict, type AuditInput, type Repo } from './repo.ts';

const ACTIVE = new Set(['running', 'awaiting_login']);
const clone = <T>(x: T): T => structuredClone(x);

export class MemoryRepo implements Repo {
  users = new Map<string, User>();
  runs = new Map<string, Run>();
  procs: AuthorizedProcess[] = [];
  records = new Map<string, Rec>();
  comments: Comment[] = [];
  wauth = new Map<string, WriteAuthorization>();
  wops = new Map<string, WriteOp>();
  corrections = new Map<string, Correction>();
  audit: AuditEntry[] = [];

  async getUserByName(u: string) { return clone([...this.users.values()].find((x) => x.username === u) ?? null); }
  async createUser(u: User) {
    if ([...this.users.values()].some((x) => x.username === u.username)) throw new Error('usuário já existe');
    this.users.set(u.id, clone(u));
  }

  async tryStartRun(run: Run, staleMs: number) {
    for (const r of this.runs.values()) {
      if (!ACTIVE.has(r.status)) continue;
      if (Date.now() - Date.parse(r.heartbeatAt) > staleMs) { r.status = 'abandoned'; r.finishedAt = new Date().toISOString(); continue; }
      throw new RunInProgress(r.id);
    }
    this.runs.set(run.id, clone(run));
  }
  async updateRun(id: string, patch: Partial<Run>) {
    const r = this.runs.get(id); if (!r) throw new Error('run não encontrada');
    Object.assign(r, clone(patch)); return clone(r);
  }
  async getRun(id: string) { return clone(this.runs.get(id) ?? null); }
  async listRuns(limit = 20) { return clone([...this.runs.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, limit)); }

  async listAuthorizedProcesses() { return clone(this.procs); }
  async setAuthorizedProcesses(l: AuthorizedProcess[]) { this.procs = clone(l); }

  async insertRecord(r: Rec) {
    if ([...this.records.values()].some((x) => x.externalId === r.externalId)) return false;
    this.records.set(r.id, clone(r)); return true;
  }
  async getRecord(id: string) { return clone(this.records.get(id) ?? null); }
  async updateRecord(id: string, patch: Partial<Rec>, expectedVersion: number) {
    const r = this.records.get(id); if (!r) throw new Error('registro não encontrado');
    if (r.version !== expectedVersion) throw new VersionConflict();
    Object.assign(r, clone(patch), { version: r.version + 1, updatedAt: new Date().toISOString() });
    return clone(r);
  }
  async listRecords(f: { runId?: string; state?: string } = {}) {
    return clone([...this.records.values()].filter((r) => (!f.runId || r.runId === f.runId) && (!f.state || r.state === f.state))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
  }
  async existsExternalId(id: string) { return [...this.records.values()].some((r) => r.externalId === id); }

  async addComment(c: Comment) { this.comments.push(clone(c)); }
  async listComments(recordId: string) { return clone(this.comments.filter((c) => c.recordId === recordId)); }

  async addWriteAuthorization(a: WriteAuthorization) { this.wauth.set(a.id, clone(a)); }
  async listWriteAuthorizations() { return clone([...this.wauth.values()]); }
  async revokeWriteAuthorization(id: string, at: string) { const a = this.wauth.get(id); if (a) a.revokedAt = at; }

  async claimWriteOp(op: WriteOp) {
    const ex = this.wops.get(op.key);
    if (ex) return { claimed: false, existing: clone(ex) };
    this.wops.set(op.key, clone(op)); return { claimed: true, existing: clone(op) };
  }
  async updateWriteOp(key: string, patch: Partial<WriteOp>) {
    const o = this.wops.get(key); if (!o) throw new Error('write op não encontrada');
    Object.assign(o, clone(patch), { updatedAt: new Date().toISOString() }); return clone(o);
  }
  async listAllWriteOps() { return clone([...this.wops.values()]); }
  async listWriteOps(recordId: string) { return clone([...this.wops.values()].filter((o) => o.recordId === recordId)); }

  async addCorrection(c: Correction) { this.corrections.set(c.id, clone(c)); }
  async getCorrection(id: string) { return clone(this.corrections.get(id) ?? null); }
  async updateCorrection(id: string, patch: Partial<Correction>) {
    const c = this.corrections.get(id); if (!c) throw new Error('correção não encontrada');
    Object.assign(c, clone(patch)); return clone(c);
  }
  async listCorrections(recordId: string) { return clone([...this.corrections.values()].filter((c) => c.recordId === recordId)); }

  async appendAudit(i: AuditInput) {
    const e = nextEntry(this.audit.at(-1) ?? null, i);
    this.audit.push(e); return clone(e);
  }
  async listAudit(f: { entityId?: string; limit?: number } = {}) {
    const l = f.entityId ? this.audit.filter((e) => e.entityId === f.entityId) : this.audit;
    return clone(f.limit ? l.slice(-f.limit) : l);
  }
  async verifyAudit() { return { ...verifyChain(this.audit), count: this.audit.length }; }
}
