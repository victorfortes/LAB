import { followUpPlan, taskKey } from './tasks.ts';
import { workflowName, workflowSizeFor } from '../astrea/port.ts';
import { createHash } from 'node:crypto';
import { markerFor, type AstreaPort, type AstreaSchedule } from '../astrea/port.ts';
import type { ProposedAction } from '../domain/types.ts';
import { transition } from '../domain/states.ts';
import { require as requirePerm } from '../security/rbac.ts';
import type { Rec, WriteOp } from '../store/models.ts';
import type { Repo } from '../store/repo.ts';
import { AppError } from '../runner/errors.ts';
import type { Actor } from '../runner/runner.ts';
import { hasActiveWriteAuthorization } from '../runner/workflow.ts';
import { scheduleNotes, scheduleTitle } from './format.ts';

export interface WriteOutcome {
  recordId: string;
  state: Rec['state'];
  /** Só é true quando TODAS as providências foram relidas do Astrea e conferem. */
  confirmedInAstrea: boolean;
  /** Publicação marcada como TRATADA no Astrea ao final (só quando a gravação foi confirmada). */
  treated?: boolean;
  treatedNote?: string;
  /** Resultado das tarefas de acompanhamento criadas depois do prazo. */
  tasks?: string[];
  items: Array<{ actionId: string; status: WriteOp['status'] | 'skipped'; astreaId: string | null; adopted: boolean; note?: string }>;
}

export const idempotencyKey = (r: Pick<Rec, 'processNumber' | 'externalId'>, a: ProposedAction) =>
  createHash('sha256').update([r.processNumber, r.externalId, a.id, a.deadline?.endTerm, a.description].join('|')).digest('hex').slice(0, 24);

/** Quantidade que o formulário do Astrea precisa receber para ELE mesmo calcular o vencimento do robô (dias corridos antecipados ⇒ menos dias). */
export function liveAmount(d: { amount: number; unit: string; startTerm: string; endTerm: string | null }) {
  if (d.unit !== 'dias_corridos' || !d.endTerm) return d.amount;
  const days = Math.round((Date.parse(d.endTerm) - Date.parse(d.startTerm)) / 86_400_000) + 1;
  return days > 0 && days < d.amount ? days : d.amount;
}

export function expectedSchedule(r: Rec, a: ProposedAction, key: string, titlePrefix = '') {
  return {
    title: `${titlePrefix}${scheduleTitle(r, a)}`,
    description: `${scheduleNotes(r, a)} ${markerFor(key)}`,
    dueDate: a.deadline!.endTerm!,
    responsible: a.responsible,
    processNumber: r.processNumber,
  };
}

const same = (exp: Record<string, unknown>, got: AstreaSchedule | null) => {
  if (!got) return { ok: false, diffs: ['agendamento não encontrado na leitura'] };
  const diffs = (['title', 'description', 'dueDate', 'responsible', 'processNumber'] as const)
    .filter((k) => (exp[k] ?? null) !== (got[k] ?? null)).map((k) => `${k}: esperado≠lido`);
  return { ok: diffs.length === 0, diffs };
};

/**
 * Escrita idempotente no Astrea com leitura posterior e reconciliação (Fase 4).
 * Pré-condições (todas obrigatórias): NGA_WRITE_ENABLED, permissão, registro aprovado,
 * processo autorizado, autorização de escrita ativa (escopo + validade), responsável definido.
 * Sucesso só é declarado após readSchedule() confirmar os campos esperados.
 */
export class Writer {
  constructor(
    private repo: Repo,
    private astrea: AstreaPort,
    private cfg: { writeEnabled: boolean; writeOnlyPublications?: string[]; allowThirdPartyPublications?: string[]; productionWrite?: boolean; concludePublication?: boolean; followUpTasks?: boolean; followUpMode?: 'workflow' | 'tasks' | 'no'; protocolResponsible?: string; holidays?: ReadonlySet<string>; maxRealWrites?: number | null; titlePrefix?: string; kanbanBoard?: string | null; kanbanColumn?: string | null; alertDays?: number | null },
  ) {}

  /** Criações reais tentadas nesta execução do app (conservador: conta antes de chamar createSchedule). */
  private creations = 0;
  private inflight = new Set<string>();

  async write(recordId: string, actor: Actor): Promise<WriteOutcome> {
    // Verificação SÍNCRONA (antes de qualquer await): um segundo clique durante a gravação é recusado com mensagem clara.
    if (this.inflight.has(recordId)) throw new AppError('write_in_progress', 'Já existe uma gravação em andamento para este registro. Aguarde terminar (1–2 min) e atualize a tela; não clique de novo.', 409);
    this.inflight.add(recordId);
    try { return await this.writeInner(recordId, actor); } finally { this.inflight.delete(recordId); }
  }

  private async writeInner(recordId: string, actor: Actor): Promise<WriteOutcome> {
    requirePerm(actor.role, 'write:execute');
    if (!this.cfg.writeEnabled) throw new AppError('write_disabled', 'Escrita desabilitada (NGA_WRITE_ENABLED=false).', 403);
    let rec = await this.repo.getRecord(recordId);
    if (!rec) throw new AppError('not_found', 'Registro não encontrado', 404);
    // "Gravando…" sem gravação em curso neste processo = o app caiu no meio: marca como falha para permitir reconciliar (a pré-leitura adota o que já existir).
    if (rec.state === 'write_queued') {
      rec = await this.repo.updateRecord(recordId, { state: transition('write_queued', 'write_error') }, rec.version);
      await this.repo.appendAudit({ actor: actor.username, action: 'record.write_recovered', entityType: 'record', entityId: recordId, data: { motivo: 'estado write_queued sem gravação em andamento' } });
    }
    if (!['approved', 'divergent', 'write_failed'].includes(rec.state)) throw new AppError('not_approved', `Estado ${rec.state} não permite gravação`, 409);
    if (!rec.approvedBy) throw new AppError('not_approved', 'Registro sem aprovação humana', 409);
    const procs = await this.repo.listAuthorizedProcesses();
    // Em produção o escopo (cliente autorizado) já filtrou o que foi capturado; fora dela vale a lista de processos autorizados.
    if (!this.cfg.productionWrite && !procs.some((p) => p.processNumber === rec.processNumber)) throw new AppError('process_not_authorized', 'Processo fora da lista autorizada', 403);
    const only = this.cfg.writeOnlyPublications;
    if (only?.length && !only.includes(rec.externalId)) throw new AppError('publication_not_allowed', 'Publicação fora da lista de publicações liberadas para gravação (NGA_WRITE_ONLY_PUBLICATIONS)', 403);
    const auth = await hasActiveWriteAuthorization(this.repo, rec.processNumber);
    if (!auth) throw new AppError('no_write_authorization', 'Sem autorização de escrita ativa para este processo', 403);

    // "Prazo de terceiro" (notOurs) NUNCA é agendado, salvo exceção humana expressa por publicação (registrada na auditoria).
    const thirdPartyOk = (this.cfg.allowThirdPartyPublications ?? []).includes(rec.externalId);
    if (thirdPartyOk && rec.analysis.actions.some((a) => a.notOurs)) await this.repo.appendAudit({ actor: actor.username, action: 'write.third_party_override', entityType: 'record', entityId: recordId, data: { publicationId: rec.externalId } });
    const writable = rec.analysis.actions.filter((a) => a.kind === 'prazo' && a.deadline?.endTerm && (thirdPartyOk || !a.notOurs));
    if (!writable.length) throw new AppError('nothing_to_write', 'Nenhuma providência com prazo calculado para gravar', 422);
    if (writable.some((a) => !a.responsible)) throw new AppError('no_responsible', 'Responsável não definido para a providência', 422);

    // approved|divergent|write_failed --queue_write--> write_queued
    const queued = await this.repo.updateRecord(recordId, { state: transition(rec.state, 'queue_write') }, rec.version);
    await this.repo.appendAudit({ actor: actor.username, action: 'record.queue_write', entityType: 'record', entityId: recordId, data: { from: rec.state, authorizationId: auth.id } });

    const items: WriteOutcome['items'] = [];
    for (const a of rec.analysis.actions) {
      if (!writable.includes(a)) { items.push({ actionId: a.id, status: 'skipped', astreaId: null, adopted: false, note: 'sem prazo gravável (tratar manualmente)' }); continue; }
      items.push(await this.writeOne(rec, a, actor));
    }
    const done = items.filter((i) => i.status !== 'skipped');
    const event = done.every((i) => i.status === 'confirmed') ? 'verify_ok' : done.some((i) => i.status === 'divergent') ? 'verify_mismatch' : 'write_error';
    const to = transition('write_queued', event);
    await this.repo.updateRecord(recordId, { state: to }, queued.version);
    await this.repo.appendAudit({ actor: actor.username, action: `record.${event}`, entityType: 'record', entityId: recordId, data: { to, items } });
    // Gravação confirmada por releitura ⇒ deixa a publicação TRATADA no Astrea. Falha aqui NÃO desfaz nem invalida o prazo já confirmado.
    let treated: boolean | undefined; let treatedNote: string | undefined; let tasks: string[] | undefined;
    // Tarefas de acompanhamento (análise +1 dia útil; conferir protocolo/renúncia depois do fatal). Se faltar alguma, NÃO conclui a publicação: ela continua visível.
    let tasksOk = true;
    const mode = this.cfg.followUpMode ?? 'workflow';
    if (to === 'confirmed' && mode !== 'no') {
      const done = items.find((i) => i.status === 'confirmed');
      const act = done ? rec.analysis.actions.find((x) => x.id === done.actionId) : undefined;
      if (act?.deadline?.endTerm) {
        if (mode === 'workflow' && this.astrea.applyWorkflow) { const r = await this.followUpWorkflow(rec, act, actor); tasks = r.notes; tasksOk = r.ok; }
        else if (mode === 'tasks' && this.astrea.createTask) { const r = await this.followUps(rec, act, actor); tasks = r.notes; tasksOk = r.ok; }
      }
    }
    if (!tasksOk) treatedNote = 'Prazo gravado e conferido, mas o acompanhamento (workflow/tarefas) não foi confirmado: a publicação NÃO foi concluída. Aplique o workflow no prazo, no Astrea, e conclua a publicação.';
    if (to === 'confirmed' && tasksOk && this.cfg.concludePublication !== false && this.astrea.concludePublication) {
      try {
        const r = await this.astrea.concludePublication(rec.externalId);
        treated = r.treated; treatedNote = r.treated ? 'Publicação marcada como TRATADA no Astrea.' : `Prazo gravado e conferido, mas a publicação segue "${r.status}": conclua manualmente.`;
        await this.repo.appendAudit({ actor: actor.username, action: r.treated ? 'write.publication_treated' : 'write.publication_not_treated', entityType: 'record', entityId: recordId, data: { publicationId: rec.externalId, status: r.status } });
      } catch (e) {
        treated = false; treatedNote = `Prazo gravado e conferido, mas não consegui marcar a publicação como tratada (${(e as Error).message.slice(0, 140)}): conclua manualmente.`;
        await this.repo.appendAudit({ actor: actor.username, action: 'write.publication_not_treated', entityType: 'record', entityId: recordId, data: { publicationId: rec.externalId, error: (e as Error).message.slice(0, 300) } });
      }
    }
    return { recordId, state: to, confirmedInAstrea: to === 'confirmed', items, treated: tasksOk ? treated : false, treatedNote, tasks };
  }

  /** Aplica ao prazo confirmado o workflow "PRAZO N DIAS CORRIDOS" (análise de intimação + conferir protocolo/renúncia). Idempotente. */
  private async followUpWorkflow(rec: Rec, a: ProposedAction, actor: Actor): Promise<{ ok: boolean; notes: string[] }> {
    const d = a.deadline!;
    const prazoKey = idempotencyKey(rec, a);
    const key = taskKey(prazoKey, 0);
    const at = () => new Date().toISOString();
    const wf = workflowName(workflowSizeFor(d.amount));
    const prazoTitle = `${this.cfg.titlePrefix ?? ''}${scheduleTitle(rec, a)}`;
    const claim = await this.repo.claimWriteOp({ key, recordId: rec.id, actionId: a.id, status: 'pending', astreaId: null, expected: { kind: 'workflow', title: wf, dueDate: d.endTerm, responsible: a.responsible, processNumber: rec.processNumber, publicationId: rec.externalId }, readBack: null, adopted: false, error: null, evidence: [{ at: at(), step: 'claimed', detail: { kind: 'workflow' } }], updatedAt: at() });
    if (!claim.claimed && claim.existing.status === 'confirmed') return { ok: true, notes: [`Workflow ${wf} já aplicado ao prazo.`] };
    try {
      const r = await this.astrea.applyWorkflow!({ publicationId: rec.externalId, prazoTitle, amount: d.amount });
      await this.repo.updateWriteOp(key, { status: r.confirmed ? 'confirmed' : 'divergent', astreaId: `${rec.externalId}|WORKFLOW|${r.workflow}`, adopted: r.adopted, error: r.confirmed ? null : r.note ?? 'não confirmado', evidence: [...claim.existing.evidence, { at: at(), step: r.confirmed ? (r.adopted ? 'adopted_existing' : 'applied') : 'unconfirmed', detail: r }] });
      await this.repo.appendAudit({ actor: actor.username, action: r.confirmed ? 'write.workflow_applied' : 'write.workflow_unconfirmed', entityType: 'record', entityId: rec.id, data: { workflow: r.workflow, adopted: r.adopted } });
      return r.confirmed ? { ok: true, notes: [`Workflow ${r.workflow} ${r.adopted ? 'já estava aplicado' : 'aplicado'} ao prazo (análise de intimação e conferência de protocolo/renúncia).`] } : { ok: false, notes: [`Workflow ${r.workflow}: ${r.note ?? 'não confirmado'}.`] };
    } catch (e) {
      const msg = (e as Error).message.split('\n')[0]!.slice(0, 160);
      await this.repo.updateWriteOp(key, { status: 'failed', error: msg, evidence: [...claim.existing.evidence, { at: at(), step: 'error', detail: { message: msg } }] });
      await this.repo.appendAudit({ actor: actor.username, action: 'write.workflow_failed', entityType: 'record', entityId: rec.id, data: { workflow: wf, error: msg } });
      return { ok: false, notes: [`Workflow ${wf} não foi aplicado: ${msg}.`] };
    }
  }

  /** Cria as tarefas de acompanhamento do prazo confirmado. Idempotente: cada tarefa tem chave própria e é adotada se já existir na publicação. */
  private async followUps(rec: Rec, a: ProposedAction, actor: Actor): Promise<{ ok: boolean; notes: string[] }> {
    const d = a.deadline!;
    const prazoKey = idempotencyKey(rec, a);
    const plan = followUpPlan({ amount: d.amount, endTerm: d.endTerm! }, a.responsible, { holidays: this.cfg.holidays ?? new Set(), protocolResponsible: this.cfg.protocolResponsible ?? 'Camilla Rodrigues' });
    const br = (iso: string) => iso.split('-').reverse().join('/');
    const notes: string[] = []; let ok = true;
    for (const t of plan) {
      const key = taskKey(prazoKey, t.n);
      const at = () => new Date().toISOString();
      const expected = { kind: 'task', title: t.title, dueDate: t.dueDate, responsible: t.responsible, priority: t.priority, processNumber: rec.processNumber, publicationId: rec.externalId };
      const claim = await this.repo.claimWriteOp({ key, recordId: rec.id, actionId: a.id, status: 'pending', astreaId: null, expected, readBack: null, adopted: false, error: null, evidence: [{ at: at(), step: 'claimed', detail: { kind: 'task' } }], updatedAt: at() });
      if (!claim.claimed && claim.existing.status === 'confirmed') { notes.push(`Tarefa "${t.title}" já criada (${br(t.dueDate)}).`); continue; }
      try {
        let id: string; let confirmed: boolean; let adopted = false; let note: string | undefined;
        if (this.astrea.taskExists && (await this.astrea.taskExists(rec.externalId, t.title))) { adopted = true; confirmed = true; id = `${rec.externalId}|TAREFA|${t.dueDate}|${t.title}`; }
        else {
          const r = await this.astrea.createTask!({ publicationId: rec.externalId, title: t.title, dueDate: t.dueDate, responsible: t.responsible, priority: t.priority, kanban: this.cfg.kanbanBoard && this.cfg.kanbanColumn ? { board: this.cfg.kanbanBoard, column: this.cfg.kanbanColumn } : null });
          id = r.id; confirmed = r.confirmed; note = r.note;
        }
        await this.repo.updateWriteOp(key, { status: confirmed ? 'confirmed' : 'divergent', astreaId: id, adopted, error: confirmed ? null : note ?? 'não confirmada', evidence: [...claim.existing.evidence, { at: at(), step: confirmed ? (adopted ? 'adopted_existing' : 'created') : 'unconfirmed', detail: { id, note } }] });
        await this.repo.appendAudit({ actor: actor.username, action: confirmed ? 'write.task_created' : 'write.task_unconfirmed', entityType: 'record', entityId: rec.id, data: { title: t.title, dueDate: t.dueDate, responsible: t.responsible, adopted } });
        if (confirmed) notes.push(`Tarefa "${t.title}" para ${br(t.dueDate)} (${t.responsible ?? 'sem responsável'})${adopted ? ' — já existia' : ''}.`);
        else { ok = false; notes.push(`Tarefa "${t.title}": ${note ?? 'não confirmada'}.`); }
      } catch (e) {
        ok = false;
        const msg = (e as Error).message.split('\n')[0]!.slice(0, 160);
        await this.repo.updateWriteOp(key, { status: 'failed', error: msg, evidence: [...claim.existing.evidence, { at: at(), step: 'error', detail: { message: msg } }] });
        await this.repo.appendAudit({ actor: actor.username, action: 'write.task_failed', entityType: 'record', entityId: rec.id, data: { title: t.title, error: msg } });
        notes.push(`Tarefa "${t.title}" não foi criada: ${msg}.`);
      }
    }
    return { ok, notes };
  }

  private async writeOne(rec: Rec, a: ProposedAction, actor: Actor): Promise<WriteOutcome['items'][number]> {
    const key = idempotencyKey(rec, a);
    const expected = expectedSchedule(rec, a, key, this.cfg.titlePrefix ?? '');
    const now = () => new Date().toISOString();
    const claim = await this.repo.claimWriteOp({
      key, recordId: rec.id, actionId: a.id, status: 'pending', astreaId: null, expected, readBack: null,
      adopted: false, error: null, evidence: [{ at: now(), step: 'claimed', detail: { actor: actor.username } }], updatedAt: now(),
    });
    if (!claim.claimed && claim.existing.status === 'confirmed')
      return { actionId: a.id, status: 'confirmed', astreaId: claim.existing.astreaId, adopted: claim.existing.adopted, note: 'já confirmada anteriormente (idempotente, nada gravado)' };

    const ev = (step: string, detail: unknown) => ({ at: now(), step, detail });
    const evidence = [...claim.existing.evidence];
    let astreaId: string | null = claim.existing.astreaId;
    let adopted = false;
    try {
      // Pré-leitura: evita duplicata mesmo após falha com resultado desconhecido.
      // No Astrea real a fonte principal é o cartão "Tratamentos" da própria publicação; senão, a lista do processo.
      const readList = async () => (this.astrea.listPublicationSchedules
        ? this.astrea.listPublicationSchedules(rec.externalId, rec.processNumber)
        : this.astrea.findSchedules(rec.processNumber));
      const find = async () => (await readList()).find((s) => s.description.includes(markerFor(key)));
      const readOne = async (id: string) => (this.astrea.listPublicationSchedules ? (await readList()).find((s) => s.id === id) ?? null : this.astrea.readSchedule(id));
      const existing = astreaId ? await readOne(astreaId) : await find();
      if (existing) { astreaId = existing.id; adopted = true; evidence.push(ev('adopted_existing', { astreaId })); }
      else {
        try {
          // Anti-duplicata entre publicações do MESMO comunicado: se a agenda do processo já tem um prazo do robô
          // ([NGA:…]) com o mesmo vencimento, NÃO cria outro (a chave de idempotência é por publicação, não por processo).
          // Checagem instantânea no histórico do robô (banco): outro lançamento do mesmo processo e vencimento.
          const prior = (await this.repo.listAllWriteOps()).find((o) => o.key !== key && o.astreaId && (o.expected as Record<string, unknown>).kind !== 'task' && ['confirmed', 'divergent'].includes(o.status) && (o.expected as Record<string, unknown>).processNumber === expected.processNumber && (o.expected as Record<string, unknown>).dueDate === expected.dueDate);
          if (prior) throw new AppError('possible_duplicate', `Já existe um lançamento do robô neste processo com vencimento ${expected.dueDate} (${prior.astreaId}); não será criado outro. Confira no Astrea.`, 409);
          const cap = this.cfg.maxRealWrites;
          if (cap != null && this.creations >= cap) throw new AppError('write_cap', `Teto de ${cap} gravação(ões) por execução atingido (piloto): reinicie o app para liberar`, 429);
          this.creations++;
          const created = await this.astrea.createSchedule({
            ...expected, idempotencyKey: key,
            live: {
              publicationId: rec.externalId, amount: liveAmount(a.deadline!), unit: a.deadline!.unit as 'dias_uteis' | 'dias_corridos',
              kanban: this.cfg.kanbanBoard && this.cfg.kanbanColumn ? { board: this.cfg.kanbanBoard, column: this.cfg.kanbanColumn } : null,
              alertDays: this.cfg.alertDays ?? null,
            },
          });
          astreaId = created.id; evidence.push(ev('created', { astreaId }));
        } catch (e) {
          const late = await find(); // resultado desconhecido: reconciliar antes de declarar falha
          if (!late) throw e;
          astreaId = late.id; adopted = true; evidence.push(ev('create_error_but_found', { astreaId, error: (e as Error).message }));
        }
      }
      const readBack = await readOne(astreaId!);
      const cmp = same(expected, readBack);
      evidence.push(ev('read_after_write', { astreaId, ok: cmp.ok, diffs: cmp.diffs, readBack }));
      const status = cmp.ok ? 'confirmed' : 'divergent';
      await this.repo.updateWriteOp(key, { status, astreaId, adopted, readBack: readBack as unknown as Record<string, unknown>, evidence, error: cmp.ok ? null : cmp.diffs.join('; ') });
      await this.repo.appendAudit({ actor: actor.username, action: `write.${status}`, entityType: 'record', entityId: rec.id, data: { actionId: a.id, astreaId, adopted, diffs: cmp.diffs } });
      return { actionId: a.id, status, astreaId, adopted, note: cmp.ok ? undefined : cmp.diffs.join('; ') };
    } catch (e) {
      evidence.push(ev('error', { message: (e as Error).message }));
      await this.repo.updateWriteOp(key, { status: 'failed', astreaId, evidence, error: (e as Error).message });
      await this.repo.appendAudit({ actor: actor.username, action: 'write.failed', entityType: 'record', entityId: rec.id, data: { actionId: a.id, error: (e as Error).message } });
      return { actionId: a.id, status: 'failed', astreaId, adopted, note: `${(e as Error).message.split('\n')[0]!.slice(0, 220)} — se necessário, confira no Astrea antes de reprocessar` };
    }
  }
}
