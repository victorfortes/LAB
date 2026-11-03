import { randomUUID } from 'node:crypto';
import { markerFor, type AstreaPort, type AstreaSchedule } from '../astrea/port.ts';
import { transition } from '../domain/states.ts';
import { require as requirePerm, can } from '../security/rbac.ts';
import type { Correction, CorrectionField } from '../store/models.ts';
import type { Repo } from '../store/repo.ts';
import { AppError } from '../runner/errors.ts';
import type { Actor } from '../runner/runner.ts';
import { hasActiveWriteAuthorization } from '../runner/workflow.ts';

export const CORRECTABLE: CorrectionField[] = ['dueDate', 'title', 'responsible', 'description'];

/** Ciclo de correção (Fase 5): edita APENAS o agendamento e o campo autorizados e devolve para revalidação. */
export class Corrections {
  constructor(private repo: Repo, private astrea: AstreaPort, private cfg: { writeEnabled: boolean }) {}

  async request(recordId: string, actor: Actor, i: { actionId: string; field: CorrectionField; expectedValue: string; justification: string; authorize?: boolean }): Promise<Correction> {
    requirePerm(actor.role, 'correction:request');
    if (!CORRECTABLE.includes(i.field)) throw new AppError('field', `Campo não corrigível: ${i.field}`, 422);
    if (i.justification.trim().length < 10) throw new AppError('justification', 'Justificativa obrigatória (mín. 10 caracteres)', 422);
    if (!i.expectedValue.trim()) throw new AppError('value', 'Valor esperado obrigatório', 422);
    if (i.field === 'dueDate' && (!/^\d{4}-\d{2}-\d{2}$/.test(i.expectedValue) || Number.isNaN(Date.parse(i.expectedValue))))
      throw new AppError('value', 'dueDate deve ser YYYY-MM-DD válido', 422);
    const rec = await this.repo.getRecord(recordId);
    if (!rec) throw new AppError('not_found', 'Registro não encontrado', 404);
    const op = (await this.repo.listWriteOps(recordId)).find((o) => o.actionId === i.actionId && o.astreaId);
    if (!op) throw new AppError('no_target', 'Não há agendamento do robô vinculado a esta providência; só registros gravados pelo robô são corrigíveis', 422);
    let to;
    try { to = transition(rec.state, 'request_correction'); } catch (e) { throw new AppError('invalid_transition', (e as Error).message, 409); }
    await this.repo.updateRecord(recordId, { state: to }, rec.version);
    const c: Correction = {
      id: randomUUID(), recordId, actionId: i.actionId, field: i.field, expectedValue: i.expectedValue.trim(),
      justification: i.justification.trim(), requestedBy: actor.username, authorizedBy: null, status: 'requested', result: null, createdAt: new Date().toISOString(),
    };
    await this.repo.addCorrection(c);
    await this.repo.appendAudit({ actor: actor.username, action: 'correction.requested', entityType: 'record', entityId: recordId, data: { correctionId: c.id, field: c.field, expectedValue: c.expectedValue, justification: c.justification, astreaId: op.astreaId } });
    return i.authorize && can(actor.role, 'correction:authorize') ? this.authorize(c.id, actor) : c;
  }

  async authorize(correctionId: string, actor: Actor): Promise<Correction> {
    requirePerm(actor.role, 'correction:authorize');
    const c = await this.repo.getCorrection(correctionId);
    if (!c) throw new AppError('not_found', 'Correção não encontrada', 404);
    if (c.status !== 'requested') throw new AppError('invalid_status', `Correção em status ${c.status}`, 409);
    const rec = (await this.repo.getRecord(c.recordId))!;
    await this.repo.updateRecord(rec.id, { state: transition(rec.state, 'authorize_correction') }, rec.version);
    const n = await this.repo.updateCorrection(c.id, { status: 'authorized', authorizedBy: actor.username });
    await this.repo.appendAudit({ actor: actor.username, action: 'correction.authorized', entityType: 'record', entityId: c.recordId, data: { correctionId: c.id, field: c.field } });
    return n;
  }

  async apply(correctionId: string, actor: Actor): Promise<Correction> {
    requirePerm(actor.role, 'write:execute');
    if (!this.cfg.writeEnabled) throw new AppError('write_disabled', 'Escrita desabilitada (NGA_WRITE_ENABLED=false).', 403);
    const c = await this.repo.getCorrection(correctionId);
    if (!c) throw new AppError('not_found', 'Correção não encontrada', 404);
    if (c.status !== 'authorized' || !c.authorizedBy) throw new AppError('not_authorized', 'Correção sem autorização', 403);
    const rec = (await this.repo.getRecord(c.recordId))!;
    if (rec.state !== 'correction_authorized') throw new AppError('invalid_transition', `Estado ${rec.state}`, 409);
    if (!(await hasActiveWriteAuthorization(this.repo, rec.processNumber))) throw new AppError('no_write_authorization', 'Sem autorização de escrita ativa para o processo', 403);
    const op = (await this.repo.listWriteOps(rec.id)).find((o) => o.actionId === c.actionId && o.astreaId)!;
    const target = op.astreaId!;

    const fail = async (reason: string, extra: unknown = {}) => {
      const n = await this.repo.updateCorrection(c.id, { status: 'failed', result: { reason, ...(extra as object) } });
      await this.repo.updateRecord(rec.id, { state: transition(rec.state, 'correction_failed') }, rec.version);
      await this.repo.appendAudit({ actor: actor.username, action: 'correction.failed', entityType: 'record', entityId: rec.id, data: { correctionId: c.id, reason, ...(extra as object) } });
      return n;
    };

    try {
      const before = await this.astrea.readSchedule(target);
      if (!before || before.processNumber !== rec.processNumber) return fail('agendamento alvo não encontrado ou de outro processo');
      let value = c.expectedValue;
      if (c.field === 'description' && !value.includes(markerFor(op.key))) value = `${value} ${markerFor(op.key)}`;
      await this.astrea.updateSchedule(target, { [c.field]: value } as Partial<AstreaSchedule>);
      const after = await this.astrea.readSchedule(target);
      if (!after) return fail('releitura falhou após edição');
      const others = (['title', 'description', 'dueDate', 'responsible'] as const).filter((k) => k !== c.field && before[k] !== after[k]);
      if (after[c.field] !== value) return fail('valor lido difere do esperado', { read: after[c.field], expected: value });
      if (others.length) return fail('campos não autorizados foram alterados', { others });
      const n = await this.repo.updateCorrection(c.id, { status: 'applied', result: { before: before[c.field], after: after[c.field], astreaId: target } });
      await this.repo.updateRecord(rec.id, { state: transition(rec.state, 'correction_applied') }, rec.version);
      await this.repo.appendAudit({ actor: actor.username, action: 'correction.applied', entityType: 'record', entityId: rec.id, data: { correctionId: c.id, field: c.field, astreaId: target, before: before[c.field], after: after[c.field] } });
      return n;
    } catch (e) {
      return fail((e as Error).message);
    }
  }
}
