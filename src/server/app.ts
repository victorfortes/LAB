import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import { z, ZodError } from 'zod';
import { InvalidTransition } from '../domain/states.ts';
import { AppError } from '../runner/errors.ts';
import type { Actor } from '../runner/runner.ts';
import { NotMappedError, ReadOnlyViolation, SessionExpiredError } from '../astrea/port.ts';
import { verifyPassword } from '../security/auth.ts';
import { log } from '../security/mask.ts';
import { can as hasPerm, Forbidden, require as requirePerm, ROLE_PERMISSIONS } from '../security/rbac.ts';
import { maskEmail } from '../security/vault.ts';
import { RunInProgress, VersionConflict } from '../store/repo.ts';
import { scheduleNotes, scheduleTitle } from '../writer/format.ts';
import { liveAmount } from '../writer/writer.ts';
import { defaultDeadlineAction } from '../domain/classifier.ts';
import { computeDeadline } from '../domain/deadline.ts';
import { summarize } from './view.ts';
import type { Services } from './services.ts';

const COOKIE = 'nga_session';
type Req = Request & { actor?: Actor & { sub: string } };

function cookie(req: Request, name: string) {
  const m = (req.headers.cookie ?? '').split(';').map((s) => s.trim()).find((s) => s.startsWith(`${name}=`));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : null;
}

export function createApp(s: Services, webDir = join(import.meta.dir, '..', '..', 'web', 'dist')) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '256kb' }));
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:");
    next();
  });
  // CSRF: cookie SameSite=Strict + cabeçalho customizado obrigatório em métodos mutáveis.
  app.use('/api', (req, res, next) => {
    if (!['GET', 'HEAD'].includes(req.method) && req.headers['x-nga'] !== '1') return res.status(403).json({ error: 'csrf', message: 'Cabeçalho X-NGA ausente' });
    next();
  });

  const api = express.Router();
  app.use('/api', api);

  api.post('/auth/login', async (req, res) => {
    const { username, password } = z.object({ username: z.string().min(1).max(64), password: z.string().min(1).max(200) }).parse(req.body);
    const key = `${username}|${req.ip}`;
    if (s.limiter.blocked(key)) return res.status(429).json({ error: 'rate_limited', message: 'Muitas tentativas. Aguarde.' });
    const u = await s.repo.getUserByName(username);
    const ok = u?.active && (await verifyPassword(password, u.passwordHash));
    if (!u || !ok) {
      s.limiter.fail(key);
      await s.repo.appendAudit({ actor: username.slice(0, 64), action: 'auth.login_failed', entityType: 'user', entityId: username.slice(0, 64) });
      return res.status(401).json({ error: 'invalid_credentials', message: 'Usuário ou senha inválidos' });
    }
    s.limiter.ok(key);
    const token = await s.tokens.sign({ sub: u.id, username: u.username, role: u.role });
    res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
    await s.repo.appendAudit({ actor: u.username, action: 'auth.login', entityType: 'user', entityId: u.id });
    res.json({ username: u.username, role: u.role });
  });
  api.post('/auth/logout', (_req, res) => {
    res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
    res.json({ ok: true });
  });

  // Saúde do serviço (público, sem dados): a interface usa para mostrar "Sistema ativo".
  const startedAt = Date.now();
  api.get('/health', (_req, res) => res.json({ status: 'ok', mode: s.cfg.mode, uptimeSec: Math.round((Date.now() - startedAt) / 1000), now: new Date().toISOString() }));

  api.use(async (req: Req, res, next) => {
    const t = cookie(req, COOKIE);
    const sess = t ? await s.tokens.verify(t) : null;
    if (!sess) return res.status(401).json({ error: 'unauthenticated', message: 'Sessão inválida ou expirada' });
    req.actor = { username: sess.username, role: sess.role, sub: sess.sub };
    next();
  });

  const A = (req: Req) => req.actor!;
  api.get('/me', (req: Req, res) => res.json({ username: A(req).username, role: A(req).role, permissions: ROLE_PERMISSIONS[A(req).role] }));
  api.get('/config', (_req, res) => res.json({ mode: s.cfg.mode, writeEnabled: s.cfg.writeEnabled, holidaysVerified: s.cfg.holidaysLoaded, astreaBaseUrl: s.cfg.astreaBaseUrl, scopes: s.cfg.allowAllClients ? ['copel', 'todos'] : ['copel'], scopeRegex: s.cfg.authorizedClientRegex }));

  // ---- lançamentos do robô (controle do que foi gravado no Astrea)
  api.get('/launches', async (_req, res) => {
    const base = s.cfg.astreaBaseUrl.replace(/\/+$/, '/');
    const ops = await s.repo.listAllWriteOps();
    const recs = new Map((await s.repo.listRecords()).map((r) => [r.id, r]));
    const rows = ops.map((o) => {
      const r = recs.get(o.recordId);
      const e = o.expected as Record<string, string | null>;
      return {
        key: o.key, recordId: o.recordId, publicationId: String(e.publicationId ?? r?.externalId ?? '') || null, processNumber: r?.processNumber ?? String(e.processNumber ?? ''), clientName: r?.clientName ?? '',
        title: e.title ?? '', dueDate: e.dueDate ?? null, responsible: e.responsible ?? null,
        kind: (e.kind as string | undefined) ?? 'prazo', priority: (e.priority as string | undefined) ?? null,
        status: o.status, adopted: o.adopted, astreaId: o.astreaId, error: o.error, updatedAt: o.updatedAt,
        approvedBy: r?.approvedBy ?? null, auditedBy: r?.auditedBy ?? null, recordState: r?.state ?? null,
        link: (e.publicationId ?? r?.externalId) ? `${base}#/main/clippings-treatment?id=${e.publicationId ?? r?.externalId}` : null,
      };
    }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    res.json(rows);
  });

  // ---- execuções
  api.post('/runs', async (req: Req, res) => {
    const { scope } = z.object({ scope: z.enum(['copel', 'todos']).default('copel') }).parse(req.body ?? {});
    res.status(202).json(await s.runner.start(A(req), scope));
  });
  api.post('/runs/:id/resume', async (req: Req, res) => { await s.runner.resume(String(req.params.id), A(req)); res.status(202).json({ ok: true }); });
  api.get('/runs', async (_req, res) => res.json(await s.repo.listRuns()));
  api.get('/runs/:id', async (req, res) => {
    const r = await s.repo.getRun(String(req.params.id));
    r ? res.json(r) : res.status(404).json({ error: 'not_found' });
  });

  // ---- registros
  api.get('/records', async (req: Req, res) => {
    requirePerm(A(req).role, 'records:read');
    const q = z.object({ runId: z.string().optional(), state: z.string().optional() }).parse(req.query);
    const list = await s.repo.listRecords(q);
    res.json(list.map(summarize));
  });
  api.get('/records/:id', async (req: Req, res) => {
    requirePerm(A(req).role, 'records:read');
    const id = String(req.params.id);
    const rec = await s.workflow.get(id);
    res.json({
      record: rec, comments: await s.repo.listComments(id), writeOps: await s.repo.listWriteOps(id),
      corrections: await s.repo.listCorrections(id), audit: await s.repo.listAudit({ entityId: id }),
    });
  });
  api.post('/records/batch/approve', async (req: Req, res) => {
    const { ids } = z.object({ ids: z.array(z.string()).min(1).max(500) }).parse(req.body);
    res.json(await s.workflow.approveBatch(ids, A(req)));
  });
  // "Aprovar e lançar" em lote: fila em segundo plano (cada lançamento leva 1–2 min e o robô só faz um por vez).
  type BatchItem = { id: string; processNumber: string; status: 'waiting' | 'running' | 'done' | 'failed' | 'skipped'; note: string };
  const batch: { running: boolean; startedAt: string | null; items: BatchItem[] } = { running: false, startedAt: null, items: [] };
  api.post('/records/batch/launch', async (req: Req, res) => {
    const { ids, acknowledgeAmbiguity } = z.object({ ids: z.array(z.string()).min(1).max(200), acknowledgeAmbiguity: z.boolean().default(false) }).parse(req.body);
    const actor = A(req);
    requirePerm(actor.role, 'records:approve');
    if (batch.running) throw new AppError('batch_running', 'Já existe um lançamento em lote em andamento. Aguarde terminar.', 409);
    const items: BatchItem[] = [];
    for (const id of ids) {
      const r = await s.workflow.get(id);
      items.push({ id, processNumber: r.processNumber, status: 'waiting', note: '' });
    }
    batch.running = true; batch.startedAt = new Date().toISOString(); batch.items = items;
    void (async () => {
      try {
        for (const it of items) {
          it.status = 'running';
          try {
            let r = await s.workflow.get(it.id);
            if (r.state === 'needs_review' && !acknowledgeAmbiguity) { it.status = 'skipped'; it.note = 'Tem alertas: abra e confirme, ou marque a opção de confirmar alertas.'; continue; }
            if (['classified', 'needs_review'].includes(r.state)) r = await s.workflow.approve(it.id, actor, acknowledgeAmbiguity);
            if (!['approved', 'write_failed', 'divergent'].includes(r.state)) { it.status = 'skipped'; it.note = `Estado "${r.state}" não pode ser lançado.`; continue; }
            if (hasPerm(actor.role, 'write:authorize'))
              await s.workflow.createWriteAuthorization(actor, { processNumbers: [r.processNumber], expiresAt: new Date(Date.now() + 2 * 3600_000).toISOString(), note: 'Escrita autorizada em lote pelo administrador (2 h)' });
            const out = await s.writer.write(it.id, actor);
            if (out.confirmedInAstrea) { it.status = 'done'; it.note = out.treatedNote ?? 'Prazo lançado e conferido no Astrea.'; }
            else { it.status = 'failed'; it.note = `Não confirmado no Astrea. ${out.items?.[0]?.note ?? ''}`.trim(); }
          } catch (e) { it.status = 'failed'; it.note = (e as Error).message; }
        }
      } finally { batch.running = false; }
    })();
    res.status(202).json({ started: true, total: items.length });
  });
  api.get('/batch-launch-status', (_req, res) => res.json(batch));
  // "Dispensar": encerra publicações que não precisam de lançamento (ex.: o prazo já existe no Astrea). Em lote, com motivo obrigatório; fica na auditoria.
  api.post('/records/batch/reject', async (req: Req, res) => {
    requirePerm(A(req).role, 'records:approve');
    const { ids, reason } = z.object({ ids: z.array(z.string()).min(1).max(500), reason: z.string().trim().min(5).max(300) }).parse(req.body);
    const rejected: string[] = []; const skipped: Array<{ id: string; reason: string }> = [];
    for (const id of ids) {
      try { await s.workflow.reject(id, A(req), reason); rejected.push(id); } catch (e) { skipped.push({ id, reason: (e as Error).message }); }
    }
    await s.repo.appendAudit({ actor: A(req).username, action: 'batch.reject', entityType: 'batch', entityId: randomUUID(), data: { rejected: rejected.length, skipped: skipped.length, reason } });
    res.json({ rejected, skipped });
  });
  // Edição humana ANTES do lançamento: título, texto (observações) e/ou prazo (dias + tipo). O vencimento é recalculado pelo motor de prazos.
  api.put('/records/:id/edit', async (req: Req, res) => {
    requirePerm(A(req).role, 'records:approve');
    const body = z.object({ title: z.string().trim().min(3).max(110).optional(), notes: z.string().trim().min(3).max(2000).optional(), amount: z.number().int().min(1).max(365).optional(), unit: z.enum(['dias_corridos', 'dias_uteis']).optional() }).parse(req.body ?? {});
    if (!Object.keys(body).length) throw new AppError('nothing_to_edit', 'Nada para alterar', 422);
    const rec = await s.workflow.get(String(req.params.id));
    if (!['classified', 'needs_review', 'approved', 'write_failed', 'divergent'].includes(rec.state)) throw new AppError('bad_state', `Registro em "${rec.state}" não pode mais ser editado antes do lançamento`, 409);
    const target = rec.analysis.actions.find((x) => x.kind === 'prazo' && !x.notOurs && x.deadline?.endTerm);
    if (!target) throw new AppError('no_schedulable', 'Não há prazo nosso para editar. Use "Agendar prazo padrão de 5 dias" primeiro.', 422);
    const before = { due: target.deadline!.endTerm, amount: target.deadline!.amount, unit: target.deadline!.unit };
    let deadline = target.deadline!;
    if (body.amount !== undefined || body.unit !== undefined) {
      deadline = computeDeadline({ availabilityDate: rec.availabilityDate, amount: body.amount ?? deadline.amount, unit: body.unit ?? (deadline.unit === 'dias_uteis' ? 'dias_uteis' : 'dias_corridos'), holidays: s.cfg.holidays });
      deadline.basis = `Prazo ajustado manualmente por ${A(req).username} (${deadline.amount} ${deadline.unit === 'dias_corridos' ? 'dias corridos' : 'dias úteis'}). ${deadline.basis}${s.cfg.holidaysLoaded ? '' : ' ATENÇÃO: feriados/suspensões locais não verificados.'}`;
    }
    const edit = { ...(target.edit ?? {}), ...(body.title ? { title: body.title } : {}), ...(body.notes ? { notes: body.notes } : {}), ...(body.amount !== undefined ? { amount: body.amount } : {}), ...(body.unit ? { unit: body.unit } : {}), by: A(req).username, at: new Date().toISOString() };
    const actions = rec.analysis.actions.map((x) => (x === target ? { ...x, deadline, edit } : x));
    // Editou depois de aprovar: a aprovação vale para o que foi aprovado, então volta para decisão (nova aprovação).
    const reapprove = ['approved', 'write_failed', 'divergent'].includes(rec.state);
    const upd = await s.repo.updateRecord(rec.id, { analysis: { ...rec.analysis, actions }, ...(reapprove ? { state: 'needs_review' as const, approvedBy: null, approvedAt: null } : {}) }, rec.version);
    await s.repo.appendAudit({ actor: A(req).username, action: 'record.edited', entityType: 'record', entityId: rec.id, data: { campos: Object.keys(body), antes: before, depois: { due: deadline.endTerm, amount: deadline.amount, unit: deadline.unit }, voltouParaDecisao: reapprove } });
    res.json(upd);
  });

  // "Agendar prazo padrão de 5 dias": para registro sem prazo próprio (informativo, prazo de terceiro, sem padrão). Exige aprovação humana depois, como qualquer outro.
  api.post('/records/:id/default-deadline', async (req: Req, res) => {
    requirePerm(A(req).role, 'records:approve');
    const rec = await s.workflow.get(String(req.params.id));
    if (!['classified', 'needs_review', 'no_action'].includes(rec.state)) throw new AppError('bad_state', `Registro em "${rec.state}" não aceita prazo padrão`, 409);
    if (rec.analysis.actions.some((a) => a.kind === 'prazo' && !a.notOurs && a.deadline?.endTerm)) throw new AppError('already_has_deadline', 'Este registro já tem prazo próprio', 409);
    const responsible = rec.analysis.actions.find((a) => a.responsible)?.responsible ?? null;
    const act = defaultDeadlineAction(rec, responsible, { holidays: s.cfg.holidays, holidaysLoaded: s.cfg.holidaysLoaded });
    const analysis = { ...rec.analysis, actions: [...rec.analysis.actions.filter((a) => a.kind !== 'sem_providencia'), act], flags: [...new Set([...rec.analysis.flags, 'prazo_padrao_5_dias'])] };
    const upd = await s.repo.updateRecord(rec.id, { analysis, state: 'needs_review' }, rec.version);
    await s.repo.appendAudit({ actor: A(req).username, action: 'record.default_deadline_added', entityType: 'record', entityId: rec.id, data: { from: rec.state, dueDate: act.deadline?.endTerm } });
    res.json(upd);
  });
  api.post('/records/:id/approve', async (req: Req, res) => {
    const { acknowledgeAmbiguity } = z.object({ acknowledgeAmbiguity: z.boolean().optional() }).parse(req.body ?? {});
    res.json(await s.workflow.approve(String(req.params.id), A(req), acknowledgeAmbiguity));
  });
  api.post('/records/:id/reject', async (req: Req, res) => {
    const { reason } = z.object({ reason: z.string() }).parse(req.body);
    res.json(await s.workflow.reject(String(req.params.id), A(req), reason));
  });
  api.post('/records/:id/comments', async (req: Req, res) => {
    const { text } = z.object({ text: z.string().max(4000) }).parse(req.body);
    res.status(201).json(await s.workflow.comment(String(req.params.id), A(req), text));
  });
  api.post('/records/:id/audited', async (req: Req, res) => res.json(await s.workflow.markAudited(String(req.params.id), A(req))));
  api.post('/records/:id/write', async (req: Req, res) => res.json(await s.writer.write(String(req.params.id), A(req))));

  // ---- exportação para a Controladoria (CSV; sem texto integral das publicações)
  const csv = (rows: unknown[][]) => '\ufeff' + rows.map((r) => r.map((c) => {
    let v = c == null ? '' : String(c);
    if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`; // evita injeção de fórmula em Excel/Sheets
    return /[",;\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  }).join(';')).join('\r\n');
  const sendCsv = (res: Response, name: string, rows: unknown[][]) => {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${name}-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(csv(rows));
  };
  api.get('/export/records.csv', async (req: Req, res) => {
    requirePerm(A(req).role, 'audit:read');
    const out: unknown[][] = [['id', 'publicacao_astrea', 'processo', 'cliente', 'estado', 'proximo_prazo', 'confianca', 'alertas', 'aprovado_por', 'aprovado_em', 'auditado_por', 'auditado_em', 'agendamento_astrea', 'gravacao']];
    for (const r of await s.repo.listRecords()) {
      const ops = await s.repo.listWriteOps(r.id);
      out.push([r.id, r.externalId, r.processNumber, r.clientName, r.state, r.analysis.actions.map((a) => a.deadline?.endTerm).filter(Boolean).sort()[0] ?? '', r.analysis.confidence,
        r.analysis.flags.join(','), r.approvedBy, r.approvedAt, r.auditedBy, r.auditedAt, ops.map((o) => o.astreaId).filter(Boolean).join(' | '), ops.map((o) => o.status).join(',')]);
    }
    sendCsv(res, 'registros', out);
  });
  api.get('/export/audit.csv', async (req: Req, res) => {
    requirePerm(A(req).role, 'audit:read');
    const v = await s.repo.verifyAudit();
    const out: unknown[][] = [['seq', 'data_hora', 'usuario', 'acao', 'entidade', 'id_entidade', 'hash', 'cadeia_integra']];
    for (const e of await s.repo.listAudit()) out.push([e.seq, e.ts, e.actor, e.action, e.entityType, e.entityId, e.hash, v.ok ? 'sim' : `NÃO (quebra em ${v.brokenAt})`]);
    sendCsv(res, 'auditoria', out);
  });

  // ---- cofre de credenciais do Astrea (só admin; a senha NUNCA é devolvida nem logada)
  const vaultStatus = async () => {
    try { const c = await s.vault.load('astrea'); return { configured: !!c, email: c ? maskEmail(c.email) : null }; }
    catch { return { configured: s.vault.has('astrea'), email: null, error: 'Cofre ilegível (chave ausente ou incorreta)' }; }
  };
  api.get('/vault/astrea', async (req: Req, res) => { requirePerm(A(req).role, 'users:manage'); res.json(await vaultStatus()); });
  api.put('/vault/astrea', async (req: Req, res) => {
    requirePerm(A(req).role, 'users:manage');
    const b = z.object({ email: z.string().email().max(200), password: z.string().min(6).max(200) }).parse(req.body);
    await s.vault.save('astrea', { email: b.email, password: b.password });
    await s.repo.appendAudit({ actor: A(req).username, action: 'vault.saved', entityType: 'vault', entityId: 'astrea', data: { emailMasked: maskEmail(b.email) } });
    res.json(await vaultStatus());
  });
  api.delete('/vault/astrea', async (req: Req, res) => {
    requirePerm(A(req).role, 'users:manage');
    s.vault.remove('astrea');
    await s.repo.appendAudit({ actor: A(req).username, action: 'vault.removed', entityType: 'vault', entityId: 'astrea' });
    res.json({ configured: false, email: null });
  });

  // ---- aprendizado do endpoint de gravação (só método + caminho normalizado; nunca o conteúdo)
  api.get('/live/observed-writes', async (req: Req, res) => {
    requirePerm(A(req).role, 'write:authorize');
    const live = s.astrea as unknown as { observedWrites?: string[]; blockedMutations?: string[] };
    res.json({ observedWrites: live.observedWrites ?? [], blockedMutations: live.blockedMutations ?? [] });
  });

  // ---- ensaio no Astrea (preenche e CANCELA; não grava)
  api.post('/records/:id/dry-run', async (req: Req, res) => {
    requirePerm(A(req).role, 'write:execute');
    const rec = await s.workflow.get(String(req.params.id));
    const a = rec.analysis.actions.find((x) => x.kind === 'prazo' && x.deadline?.endTerm && !x.notOurs && (x.deadline.unit === 'dias_uteis' || x.deadline.unit === 'dias_corridos'));
    if (!a) throw new AppError('nothing_to_dry_run', 'Nenhuma providência com prazo próprio e calculado para ensaiar', 422);
    if (!s.astrea.dryRunSchedule) throw new AppError('not_available', 'Este adaptador não suporta ensaio', 501);
    const title = scheduleTitle(rec, a);
    const r = await s.astrea.dryRunSchedule({
      publicationId: rec.externalId, title, amount: liveAmount(a.deadline!), unit: a.deadline!.unit as 'dias_uteis' | 'dias_corridos', expectedDueDate: a.deadline!.endTerm,
    });
    await s.repo.appendAudit({ actor: A(req).username, action: 'dryrun.executed', entityType: 'record', entityId: rec.id, data: { ok: r.ok, matches: r.matches, cancelled: r.cancelled, writeAttempts: r.writeAttempts, reason: r.reason } });
    res.json({ ...r, title, notes: scheduleNotes(rec, a), expectedDueDate: a.deadline!.endTerm });
  });

  // ---- correções
  api.post('/records/:id/corrections', async (req: Req, res) => {
    const b = z.object({
      actionId: z.string(), field: z.enum(['dueDate', 'title', 'responsible', 'description']),
      expectedValue: z.string().max(2000), justification: z.string().max(2000), authorize: z.boolean().optional(),
    }).parse(req.body);
    res.status(201).json(await s.corrections.request(String(req.params.id), A(req), b));
  });
  api.post('/corrections/:id/authorize', async (req: Req, res) => res.json(await s.corrections.authorize(String(req.params.id), A(req))));
  api.post('/corrections/:id/apply', async (req: Req, res) => res.json(await s.corrections.apply(String(req.params.id), A(req))));

  // ---- autorização de escrita / auditoria
  api.get('/write-authorizations', async (req: Req, res) => { requirePerm(A(req).role, 'write:authorize'); res.json(await s.repo.listWriteAuthorizations()); });
  api.post('/write-authorizations', async (req: Req, res) => {
    const b = z.object({ processNumbers: z.array(z.string()).min(1), expiresAt: z.string(), note: z.string() }).parse(req.body);
    res.status(201).json(await s.workflow.createWriteAuthorization(A(req), b));
  });
  api.delete('/write-authorizations/:id', async (req: Req, res) => { await s.workflow.revokeWriteAuthorization(A(req), String(req.params.id)); res.json({ ok: true }); });
  api.get('/audit', async (req: Req, res) => { requirePerm(A(req).role, 'audit:read'); res.json(await s.repo.listAudit({ limit: 500 })); });
  api.get('/audit/verify', async (req: Req, res) => { requirePerm(A(req).role, 'audit:read'); res.json(await s.repo.verifyAudit()); });

  if (existsSync(webDir)) {
    app.use(express.static(webDir));
    app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(join(webDir, 'index.html')));
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const send = (status: number, error: string, message: string) => res.status(status).json({ error, message });
    if (err instanceof AppError) return send(err.status, err.code, err.message);
    if (err instanceof Forbidden) return send(403, 'forbidden', err.message);
    if (err instanceof RunInProgress) return send(409, 'run_in_progress', err.message);
    if (err instanceof VersionConflict || err instanceof InvalidTransition) return send(409, 'conflict', err.message);
    if (err instanceof ZodError) return send(400, 'validation', err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
    if (err instanceof SessionExpiredError) return send(401, 'astrea_session_expired', err.message);
    if (err instanceof NotMappedError || err instanceof ReadOnlyViolation) return send(501, 'not_available', err.message);
    log.error('unhandled', { err: String((err as Error)?.stack ?? err) });
    if (/ETIMEDOUT|ECONNRESET|Connection terminated|connection timeout/i.test(String((err as Error)?.message ?? err))) return send(503, 'db_unavailable', 'A conexão com o banco falhou por um instante. Clique de novo.');
    return send(500, 'internal', 'Erro interno');
  });
  return app;
}
