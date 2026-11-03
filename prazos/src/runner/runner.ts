import { randomUUID } from 'node:crypto';
import { SessionExpiredError, readOnly, type AstreaPort } from '../astrea/port.ts';
import { classify, initialStateFor } from '../domain/classifier.ts';
import { transition } from '../domain/states.ts';
import { log } from '../security/mask.ts';
import { require as requirePerm, type Role } from '../security/rbac.ts';
import type { Rec, Run, RunProgress } from '../store/models.ts';
import type { Repo } from '../store/repo.ts';
import { AppError } from './errors.ts';

export interface Actor { username: string; role: Role }
export interface RunnerOpts {
  limit: number; staleMs: number; holidays: Set<string>; holidaysLoaded: boolean; stepDelayMs: number; defaultDayUnit?: 'dias_uteis' | 'dias_corridos';
  /** Regex (case-insensitive) de clientes autorizados, além da lista explícita de processos. Ex.: "copel". */
  authorizedClientRegex?: string | null;
  allowAllClients?: boolean;
}

const emptyProgress = (): RunProgress => ({ total: 0, processed: 0, classified: 0, needsReview: 0, noAction: 0, duplicates: 0, skippedUnauthorized: 0, stage: 'iniciando', readDone: 0, readTotal: 0 });

/** Executor: captura → normaliza → classifica. SOMENTE LEITURA no Astrea (port envolvido por readOnly). */
/** Mensagem da execução: avisos (filtro do Astrea) + publicações que não puderam ser lidas. */
function runNote(errs: string[]): string | null {
  const warns = errs.filter((e) => e.startsWith('AVISO:')).map((e) => e.slice(6).trim());
  const bad = errs.length - warns.length;
  const parts = [...warns, ...(bad ? [`${bad} publicação(ões) não puderam ser lidas e foram ignoradas (ver auditoria)`] : [])];
  return parts.length ? parts.join(' · ') : null;
}

export class Runner {
  private astrea: AstreaPort;
  private running = new Map<string, Promise<void>>();
  constructor(private repo: Repo, astrea: AstreaPort, private opts: RunnerOpts) {
    this.astrea = readOnly(astrea);
  }

  /** Escopo da execução: "copel" (clientes autorizados) ou "todos" (escritório inteiro; exige liberação explícita). */
  private scope: 'copel' | 'todos' = 'copel';

  async start(actor: Actor, scope: 'copel' | 'todos' = 'copel'): Promise<Run> {
    requirePerm(actor.role, 'run:start');
    if (scope === 'todos' && !this.opts.allowAllClients) throw new AppError('scope_not_allowed', 'Escopo "todo o escritório" não está liberado (NGA_ALLOW_ALL_CLIENTS=yes).', 403);
    if (scope === 'todos') requirePerm(actor.role, 'users:manage');
    this.scope = scope;
    const now = new Date().toISOString();
    const run: Run = {
      id: randomUUID(), status: 'running', mode: this.astrea.mode, startedBy: actor.username,
      startedAt: now, finishedAt: null, heartbeatAt: now, progress: emptyProgress(), error: null,
    };
    await this.repo.tryStartRun(run, this.opts.staleMs); // lança RunInProgress se houver outra ativa
    await this.repo.appendAudit({ actor: actor.username, action: 'run.started', entityType: 'run', entityId: run.id, data: { mode: run.mode, scope } });
    this.launch(run.id, actor.username);
    return run;
  }

  /** Retoma execução pausada por sessão expirada, após o usuário autenticar manualmente de novo. */
  async resume(runId: string, actor: Actor): Promise<void> {
    requirePerm(actor.role, 'run:start');
    const run = await this.repo.getRun(runId);
    if (!run || run.status !== 'awaiting_login') throw new AppError('not_resumable', 'Execução não está aguardando login', 409);
    await this.repo.updateRun(runId, { status: 'running', error: null, heartbeatAt: new Date().toISOString() });
    await this.repo.appendAudit({ actor: actor.username, action: 'run.resumed', entityType: 'run', entityId: runId });
    this.launch(runId, actor.username);
  }

  finished(runId: string) { return this.running.get(runId) ?? Promise.resolve(); }

  private launch(runId: string, actor: string) {
    const p = this.execute(runId, actor).catch((e) => log.error('run.crash', { runId, err: String(e) })).finally(() => this.running.delete(runId));
    this.running.set(runId, p);
  }

  private async execute(runId: string, actor: string) {
    const progress = emptyProgress();
    const existing = await this.repo.listRecords({ runId });
    for (const r of existing) this.count(progress, r.state);
    progress.processed = existing.length;
    let readErrors: string[] = [];
    try {
      progress.stage = 'login';
      await this.repo.updateRun(runId, { progress: { ...progress }, heartbeatAt: new Date().toISOString() });
      await this.astrea.assertSession();
      progress.stage = 'lendo';
      await this.repo.updateRun(runId, { progress: { ...progress }, heartbeatAt: new Date().toISOString() });
      let lastTick = 0;
      const pubs = await this.astrea.listUntreatedPublications({
        limit: this.opts.limit,
        onProgress: (p) => { // atualiza a barra durante a leitura (lenta no Astrea real); sem await para não travar a leitura
          progress.readDone = p.done; progress.readTotal = p.total;
          if (Date.now() - lastTick > 400 || p.done === p.total) { lastTick = Date.now(); void this.repo.updateRun(runId, { progress: { ...progress }, heartbeatAt: new Date().toISOString() }).catch(() => {}); }
        },
      });
      progress.stage = 'classificando';
      readErrors = this.astrea.takeReadErrors?.() ?? [];
      if (readErrors.length) await this.repo.appendAudit({ actor, action: 'run.read_errors', entityType: 'run', entityId: runId, data: { count: readErrors.length, errors: readErrors } });
      const procs = new Map((await this.repo.listAuthorizedProcesses()).map((p) => [p.processNumber, p.responsible]));
      progress.total = pubs.length + existing.length;
      await this.repo.updateRun(runId, { progress: { ...progress } });
      const clientRe = this.opts.authorizedClientRegex ? new RegExp(this.opts.authorizedClientRegex, 'i') : null;
      // Chave do comunicado (processo + comunicacao_id do texto) de TODOS os registros já capturados.
      const commKey = (p: { processNumber: string; fullText: string }) => {
        const m = /comunicacao_id:\s*(\d+)/.exec(p.fullText);
        return m ? `${p.processNumber}|${m[1]}` : null;
      };
      const known = new Map<string, string>();
      for (const r of await this.repo.listRecords()) { const k = commKey(r); if (k) known.set(k, r.id); }
      for (const pub of pubs) {
        if (this.opts.stepDelayMs) await new Promise((r) => setTimeout(r, this.opts.stepDelayMs));
        if (this.scope !== 'todos' && !procs.has(pub.processNumber) && !(clientRe?.test(pub.clientName) ?? false)) {
          // Processo fora do escopo: o texto NÃO é persistido.
          progress.skippedUnauthorized++; progress.processed++;
          await this.repo.appendAudit({ actor, action: 'record.skipped_unauthorized', entityType: 'publication', entityId: pub.externalId, data: { processNumber: pub.processNumber } });
        } else if (await this.repo.existsExternalId(pub.externalId)) {
          if (!existing.some((r) => r.externalId === pub.externalId)) { progress.duplicates++; progress.processed++; }
        } else if (commKey(pub) && known.has(commKey(pub)!)) {
          // Mesmo comunicado (processo + comunicacao_id) recebido por outro advogado/"nome pesquisado": um só registro.
          const first = known.get(commKey(pub)!)!;
          progress.duplicates++; progress.processed++;
          await this.repo.addComment({ id: randomUUID(), recordId: first, author: 'robô', createdAt: new Date().toISOString(), text: `Mesmo comunicado recebido de novo (publicação ${pub.externalId}, outro nome pesquisado): ignorado como duplicata.` });
          await this.repo.appendAudit({ actor, action: 'record.duplicate_communication', entityType: 'record', entityId: first, data: { duplicateExternalId: pub.externalId, processNumber: pub.processNumber } });
        } else {
          const analysis = classify(pub, { holidays: this.opts.holidays, holidaysLoaded: this.opts.holidaysLoaded, defaultDayUnit: this.opts.defaultDayUnit, responsibleFor: (n) => procs.get(n) ?? pub.responsible ?? null });
          const now = new Date().toISOString();
          const rec: Rec = {
            id: randomUUID(), runId, externalId: pub.externalId, processNumber: pub.processNumber, clientName: pub.clientName,
            availabilityDate: pub.availabilityDate, fullText: pub.fullText, analysis, state: initialStateFor(analysis), version: 1,
            approvedBy: null, approvedAt: null, acknowledgedFlags: false, auditedBy: null, auditedAt: null, hints: pub.hints ?? [], createdAt: now, updatedAt: now,
          };
          if (await this.repo.insertRecord(rec)) {
            const k = commKey(pub); if (k) known.set(k, rec.id);
            this.count(progress, rec.state); progress.processed++;
            await this.repo.appendAudit({ actor, action: 'record.captured', entityType: 'record', entityId: rec.id, data: { externalId: rec.externalId, processNumber: rec.processNumber, state: rec.state, classifier: analysis.classifierVersion, actions: analysis.actions.length } });
          } else { progress.duplicates++; progress.processed++; }
        }
        await this.repo.updateRun(runId, { progress: { ...progress }, heartbeatAt: new Date().toISOString() });
      }
      progress.stage = 'concluido';
      // Conciliação: registro pendente cuja publicação NÃO está mais entre as "Não tratadas" foi tratada/descartada por outra pessoa no Astrea
      // (ex.: a Controladoria). Só com leitura limpa (sem erros/avisos) e lista não vazia: encerra o registro para ninguém gravar em cima.
      if (this.astrea.mode === 'live' && pubs.length > 0 && readErrors.length === 0) {
        const seen = new Set(pubs.map((p) => p.externalId));
        for (const r of await this.repo.listRecords()) {
          if (seen.has(r.externalId) || !['classified', 'needs_review', 'no_action', 'approved', 'divergent', 'write_failed'].includes(r.state)) continue;
          try {
            await this.repo.updateRecord(r.id, { state: transition(r.state, 'reject') }, r.version);
            await this.repo.addComment({ id: randomUUID(), recordId: r.id, author: 'robô', createdAt: new Date().toISOString(), text: 'Publicação não está mais entre as "Não tratadas" do Astrea (tratada ou descartada por outra pessoa): registro encerrado para evitar gravação em duplicidade.' });
            await this.repo.appendAudit({ actor, action: 'record.closed_outside', entityType: 'record', entityId: r.id, data: { externalId: r.externalId, from: r.state } });
          } catch { /* versão mudou (alguém mexeu): deixa como está */ }
        }
      }
      await this.repo.updateRun(runId, { status: 'completed', finishedAt: new Date().toISOString(), progress: { ...progress }, error: runNote(readErrors) });
      await this.repo.appendAudit({ actor, action: 'run.completed', entityType: 'run', entityId: runId, data: progress });
    } catch (e) {
      if (e instanceof SessionExpiredError) {
        await this.repo.updateRun(runId, { status: 'awaiting_login', error: e.message && e.message !== 'Sessão do Astrea expirada ou não autenticada' ? e.message : 'Sessão do Astrea expirada: autentique manualmente (ou salve o acesso em "Acesso Astrea") e retome.', progress: { ...progress } });
        await this.repo.appendAudit({ actor, action: 'run.session_expired', entityType: 'run', entityId: runId });
      } else {
        await this.repo.updateRun(runId, { status: 'failed', finishedAt: new Date().toISOString(), error: String((e as Error).message), progress: { ...progress } });
        await this.repo.appendAudit({ actor, action: 'run.failed', entityType: 'run', entityId: runId, data: { error: String((e as Error).message) } });
      }
    }
  }

  private count(p: RunProgress, state: Rec['state']) {
    if (state === 'needs_review') p.needsReview++;
    else if (state === 'no_action') p.noAction++;
    else p.classified++;
  }
}
