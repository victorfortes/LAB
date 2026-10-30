import { randomUUID } from 'node:crypto';
import { transition, type RecordEvent } from '../domain/states.ts';
import { require as requirePerm } from '../security/rbac.ts';
import type { Comment, Rec, WriteAuthorization } from '../store/models.ts';
import type { Repo } from '../store/repo.ts';
import { AppError } from './errors.ts';
import type { Actor } from './runner.ts';

/** Aprovação, rejeição, comentários, "Auditoria feita" e autorizações de escrita. */
export class Workflow {
  constructor(private repo: Repo, private productionWrite = false) {}

  async get(id: string): Promise<Rec> {
    const r = await this.repo.getRecord(id);
    if (!r) throw new AppError('not_found', 'Registro não encontrado', 404);
    return r;
  }

  async move(id: string, event: RecordEvent, actor: Actor, patch: Partial<Rec> = {}, data: unknown = {}): Promise<Rec> {
    const r = await this.get(id);
    let to;
    try { to = transition(r.state, event); } catch (e) { throw new AppError('invalid_transition', (e as Error).message, 409); }
    const n = await this.repo.updateRecord(id, { ...patch, state: to }, r.version);
    await this.repo.appendAudit({ actor: actor.username, action: `record.${event}`, entityType: 'record', entityId: id, data: { from: r.state, to, ...(data as object) } });
    return n;
  }

  async approve(id: string, actor: Actor, acknowledgeAmbiguity = false): Promise<Rec> {
    requirePerm(actor.role, 'records:approve');
    const r = await this.get(id);
    const needsAck = r.state === 'needs_review';
    if (needsAck && !acknowledgeAmbiguity)
      throw new AppError('ack_required', 'Registro com ambiguidade: aprovação individual exige confirmação explícita dos alertas.', 422);
    return this.move(id, 'approve', actor, { approvedBy: actor.username, approvedAt: new Date().toISOString(), acknowledgedFlags: needsAck }, { acknowledgedAmbiguity: needsAck });
  }

  /** Lote: só registros sem ambiguidade. Ambíguos são recusados e devem ser aprovados individualmente. */
  async approveBatch(ids: string[], actor: Actor) {
    requirePerm(actor.role, 'records:approve');
    const approved: string[] = [];
    const skipped: Array<{ id: string; reason: string }> = [];
    for (const id of ids) {
      try {
        const r = await this.get(id);
        if (r.state === 'needs_review') { skipped.push({ id, reason: 'ambiguidade: aprovar individualmente' }); continue; }
        await this.approve(id, actor); approved.push(id);
      } catch (e) { skipped.push({ id, reason: (e as Error).message }); }
    }
    await this.repo.appendAudit({ actor: actor.username, action: 'batch.approve', entityType: 'batch', entityId: randomUUID(), data: { approved: approved.length, skipped: skipped.length } });
    return { approved, skipped };
  }

  async reject(id: string, actor: Actor, reason: string): Promise<Rec> {
    requirePerm(actor.role, 'records:approve');
    if (reason.trim().length < 5) throw new AppError('reason_required', 'Informe o motivo da rejeição', 422);
    const r = await this.move(id, 'reject', actor, {}, { reason });
    await this.comment(id, actor, `Rejeitado: ${reason}`);
    return r;
  }

  async comment(id: string, actor: Actor, text: string): Promise<Comment> {
    requirePerm(actor.role, 'records:comment');
    await this.get(id);
    if (!text.trim()) throw new AppError('empty', 'Comentário vazio', 422);
    const c: Comment = { id: randomUUID(), recordId: id, author: actor.username, text: text.trim(), createdAt: new Date().toISOString() };
    await this.repo.addComment(c);
    await this.repo.appendAudit({ actor: actor.username, action: 'record.comment', entityType: 'record', entityId: id, data: { commentId: c.id, length: c.text.length } });
    return c;
  }

  /** Botão "Auditoria feita". */
  async markAudited(id: string, actor: Actor): Promise<Rec> {
    requirePerm(actor.role, 'records:audit');
    return this.move(id, 'mark_audited', actor, { auditedBy: actor.username, auditedAt: new Date().toISOString() });
  }

  async createWriteAuthorization(actor: Actor, input: { processNumbers: string[]; expiresAt: string; note: string }): Promise<WriteAuthorization> {
    requirePerm(actor.role, 'write:authorize');
    // Em produção, "autorizado" = processo já capturado dentro do escopo de clientes; fora disso, a lista de processos autorizados.
    const allowed = new Set(this.productionWrite ? (await this.repo.listRecords()).map((r) => r.processNumber) : (await this.repo.listAuthorizedProcesses()).map((p) => p.processNumber));
    const outside = input.processNumbers.filter((p) => !allowed.has(p));
    if (!input.processNumbers.length || outside.length) throw new AppError('scope', 'Autorização deve cobrir apenas processos da lista autorizada', 422);
    if (Date.parse(input.expiresAt) <= Date.now() || Date.parse(input.expiresAt) > Date.now() + 7 * 86_400_000)
      throw new AppError('expiry', 'Validade deve ser futura e de no máximo 7 dias', 422);
    if (input.note.trim().length < 10) throw new AppError('note', 'Descreva a finalidade do teste autorizado', 422);
    const a: WriteAuthorization = { id: randomUUID(), createdBy: actor.username, createdAt: new Date().toISOString(), revokedAt: null, ...input };
    await this.repo.addWriteAuthorization(a);
    await this.repo.appendAudit({ actor: actor.username, action: 'write_authorization.created', entityType: 'write_authorization', entityId: a.id, data: { processes: a.processNumbers.length, expiresAt: a.expiresAt, note: a.note } });
    return a;
  }

  async revokeWriteAuthorization(actor: Actor, id: string) {
    requirePerm(actor.role, 'write:authorize');
    await this.repo.revokeWriteAuthorization(id, new Date().toISOString());
    await this.repo.appendAudit({ actor: actor.username, action: 'write_authorization.revoked', entityType: 'write_authorization', entityId: id });
  }
}

export async function hasActiveWriteAuthorization(repo: Repo, processNumber: string, now = Date.now()): Promise<WriteAuthorization | null> {
  const list = await repo.listWriteAuthorizations();
  return list.find((a) => !a.revokedAt && Date.parse(a.expiresAt) > now && a.processNumbers.includes(processNumber)) ?? null;
}
