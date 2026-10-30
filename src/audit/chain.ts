import { createHash } from 'node:crypto';
import { maskDeep } from '../security/mask.ts';

export interface AuditEntry {
  seq: number;
  ts: string;
  actor: string;
  action: string;
  entityType: string;
  entityId: string;
  data: unknown;
  prevHash: string;
  hash: string;
}

export const GENESIS = '0'.repeat(64);

function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

export function computeHash(e: Omit<AuditEntry, 'hash'>): string {
  return createHash('sha256')
    .update(`${e.prevHash}|${e.seq}|${e.ts}|${e.actor}|${e.action}|${e.entityType}|${e.entityId}|${canonical(e.data)}`)
    .digest('hex');
}

/** Cria a próxima entrada encadeada. `data` é sempre mascarado antes de entrar na cadeia. */
export function nextEntry(
  last: Pick<AuditEntry, 'seq' | 'hash'> | null,
  input: { actor: string; action: string; entityType: string; entityId: string; data?: unknown },
  now = new Date(),
): AuditEntry {
  const base = {
    seq: (last?.seq ?? 0) + 1,
    ts: now.toISOString(),
    actor: input.actor,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    data: maskDeep(input.data ?? {}),
    prevHash: last?.hash ?? GENESIS,
  };
  return { ...base, hash: computeHash(base) };
}

export function verifyChain(entries: AuditEntry[]): { ok: boolean; brokenAt?: number } {
  let prev = GENESIS;
  for (const e of entries) {
    if (e.prevHash !== prev || computeHash(e) !== e.hash) return { ok: false, brokenAt: e.seq };
    prev = e.hash;
  }
  return { ok: true };
}
