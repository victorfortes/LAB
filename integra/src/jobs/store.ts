import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type JobStatus =
  | "queued"
  | "awaiting_human" // trava a UI: token/PIN, login ou exportação assistida
  | "capturing"
  | "splitting"
  | "split_done"
  | "uploading"
  | "analyzing"
  | "review_ready"
  | "failed";

export interface Job {
  id: string;
  userId: number;
  cnj: string;
  caseName: string;
  side: string;
  tribunalCodigo: string | null;
  sistema: string;
  url: string;
  status: JobStatus;
  humanPrompt: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export function openDb(path: string): Database {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.run("PRAGMA journal_mode = WAL");
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, hash TEXT NOT NULL, created_at TEXT NOT NULL)`);
  db.run(`CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires_at INTEGER NOT NULL)`);
  db.run(`CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, cnj TEXT NOT NULL, case_name TEXT NOT NULL, side TEXT NOT NULL,
    tribunal_codigo TEXT, sistema TEXT NOT NULL, url TEXT NOT NULL, status TEXT NOT NULL,
    human_prompt TEXT, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
  db.run(`CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY, job_id TEXT NOT NULL, at TEXT NOT NULL, kind TEXT NOT NULL, message TEXT NOT NULL)`);
  return db;
}

const now = () => new Date().toISOString();

const rowToJob = (r: any): Job => ({
  id: r.id, userId: r.user_id, cnj: r.cnj, caseName: r.case_name, side: r.side,
  tribunalCodigo: r.tribunal_codigo, sistema: r.sistema, url: r.url, status: r.status,
  humanPrompt: r.human_prompt, error: r.error, createdAt: r.created_at, updatedAt: r.updated_at,
});

export class Store {
  constructor(readonly db: Database) {}

  createUser(username: string, hash: string) {
    return this.db.query("INSERT INTO users (username, hash, created_at) VALUES (?, ?, ?) RETURNING id")
      .get(username, hash, now()) as { id: number };
  }
  userCount(): number {
    return (this.db.query("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n;
  }
  userByName(username: string) {
    return this.db.query("SELECT id, username, hash FROM users WHERE username = ?").get(username) as
      | { id: number; username: string; hash: string } | null;
  }
  createSession(token: string, userId: number, ttlMs: number) {
    this.db.query("INSERT INTO sessions VALUES (?, ?, ?)").run(token, userId, Date.now() + ttlMs);
  }
  sessionUser(token: string): { id: number; username: string } | null {
    return this.db.query(
      "SELECT u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires_at > ?",
    ).get(token, Date.now()) as any;
  }
  deleteSession(token: string) {
    this.db.query("DELETE FROM sessions WHERE token = ?").run(token);
  }

  createJob(j: Omit<Job, "status" | "humanPrompt" | "error" | "createdAt" | "updatedAt">): Job {
    const t = now();
    this.db.query(`INSERT INTO jobs (id, user_id, cnj, case_name, side, tribunal_codigo, sistema, url, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?)`)
      .run(j.id, j.userId, j.cnj, j.caseName, j.side, j.tribunalCodigo, j.sistema, j.url, t, t);
    this.event(j.id, "job.created", `Processo ${j.cnj} (${j.sistema})`);
    return this.job(j.id)!;
  }
  job(id: string): Job | null {
    const r = this.db.query("SELECT * FROM jobs WHERE id = ?").get(id);
    return r ? rowToJob(r) : null;
  }
  jobs(userId: number): Job[] {
    return this.db.query("SELECT * FROM jobs WHERE user_id = ? ORDER BY created_at DESC").all(userId).map(rowToJob);
  }
  setStatus(id: string, status: JobStatus, patch: { humanPrompt?: string | null; error?: string | null } = {}) {
    this.db.query("UPDATE jobs SET status = ?, human_prompt = ?, error = ?, updated_at = ? WHERE id = ?")
      .run(status, patch.humanPrompt ?? null, patch.error ?? null, now(), id);
    this.event(id, `status.${status}`, patch.error ?? patch.humanPrompt ?? status);
  }
  event(jobId: string, kind: string, message: string) {
    this.db.query("INSERT INTO events (job_id, at, kind, message) VALUES (?, ?, ?, ?)").run(jobId, now(), kind, message);
  }
  events(jobId: string) {
    return this.db.query("SELECT at, kind, message FROM events WHERE job_id = ? ORDER BY id").all(jobId) as
      { at: string; kind: string; message: string }[];
  }
  /** Jobs interrompidos por reinício do app não retomam sozinhos: viram "failed" com motivo claro. */
  failInterrupted() {
    const rows = this.db.query(
      "SELECT id FROM jobs WHERE status IN ('queued','awaiting_human','capturing','splitting','uploading','analyzing')",
    ).all() as { id: string }[];
    for (const r of rows) this.setStatus(r.id, "failed", { error: "Interrompido por reinício do app. Reenvie o processo." });
  }
}
