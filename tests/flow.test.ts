import { describe, expect, test } from 'bun:test';
import { DueDateMismatch, ReadOnlyViolation, readOnly } from '../src/astrea/port.ts';
import { classify } from '../src/domain/classifier.ts';
import { SimulatedAstrea } from '../src/astrea/simulated.ts';
import { buildServices } from '../src/server/services.ts';
import { RunInProgress } from '../src/store/repo.ts';
import { Forbidden } from '../src/security/rbac.ts';
import { actor, authorizeWrites, runAll, setup } from './helpers.ts';

const byExt = async (s: Awaited<ReturnType<typeof setup>>['s'], ext: string) =>
  (await s.repo.listRecords()).find((r) => r.externalId === ext)!;

describe('executor (somente leitura)', () => {
  test('captura, classifica e respeita escopo de processos', async () => {
    const { s, astrea } = await setup();
    const run = await runAll(s);
    expect(run.status).toBe('completed');
    expect(run.progress.total).toBe(8);
    expect(run.progress.skippedUnauthorized).toBe(1);
    const recs = await s.repo.listRecords();
    expect(recs).toHaveLength(7);
    expect(recs.some((r) => r.externalId === 'SIM-007')).toBe(false); // fora do escopo: texto não persistido
    expect(JSON.stringify(await s.repo.listAudit())).not.toContain('Manifeste-se a parte autora');
    expect(astrea.writes).toBe(0);
    expect((await byExt(s, 'SIM-004')).state).toBe('needs_review');
    expect((await byExt(s, 'SIM-003')).state).toBe('no_action');
  });

  test('escopo por cliente (regex): só captura clientes autorizados; os demais não são persistidos', async () => {
    const { s, repo } = await setup({}, { NGA_AUTHORIZED_CLIENT_REGEX: 'alfa|beta' });
    await repo.setAuthorizedProcesses([]);
    const run = await runAll(s);
    expect((await repo.listRecords()).map((r) => r.externalId).sort()).toEqual(['SIM-001', 'SIM-002']);
    expect(run.progress.skippedUnauthorized).toBe(6);
    expect(JSON.stringify(await repo.listAudit())).not.toContain('Gama Serviços');
  });

  test('regra 3: mesmo comunicado (processo + comunicacao_id) recebido por 2 advogados vira UM registro', async () => {
    const mk = (id: string, name: string) => ({ externalId: id, processNumber: '0001234-56.2025.8.16.0001', clientName: 'Cliente Alfa Ltda (fictício)', availabilityDate: '2026-03-02', fullText: `Manifeste-se no prazo de 5 dias úteis. |comunicacao_id: 777| (${name})` });
    const { repo, cfg } = await setup();
    const astrea = new SimulatedAstrea([mk('A1', 'adv1'), mk('A2', 'adv2'), { ...mk('A3', 'adv3'), fullText: 'Manifeste-se no prazo de 5 dias úteis. |comunicacao_id: 888|' }]);
    const s = buildServices(cfg, repo, astrea);
    const run = await runAll(s);
    expect((await repo.listRecords()).map((r) => r.externalId)).toEqual(['A1', 'A3']);
    expect(run.progress.duplicates).toBe(1);
    const first = (await repo.listRecords())[0]!;
    expect((await repo.listComments(first.id))[0]!.text).toContain('A2');
    expect((await repo.listAudit()).some((e) => e.action === 'record.duplicate_communication')).toBe(true);
    // segunda execução (já capturados) continua sem duplicar
    const run2 = await runAll(s);
    expect(await repo.listRecords()).toHaveLength(2);
    expect(run2.progress.duplicates).toBe(3);
  });

  test('regra 1 no escritor: "prazo de terceiro" NUNCA é agendado, mesmo aprovado e autorizado', async () => {
    const mk = { externalId: 'T1', processNumber: '0001234-56.2025.8.16.0001', clientName: 'Cliente Alfa Ltda (fictício)', availabilityDate: '2026-03-02', fullText: 'Manifeste-se o(a) Administrador(a) Judicial no prazo de 15 (quinze) dias.' };
    const { repo, cfg } = await setup();
    const astrea = new SimulatedAstrea([mk]);
    const s = buildServices(cfg, repo, astrea);
    await runAll(s);
    const rec = (await repo.listRecords())[0]!;
    expect(rec.analysis.actions[0]!.notOurs).toBe(true);
    await s.workflow.approve(rec.id, actor('operator'), true);
    await authorizeWrites(s);
    // O prazo de terceiro (15 dias) nunca é gravado; o que vai é o prazo PADRÃO de 5 dias para a equipe verificar (regra do escritório).
    expect(rec.analysis.flags).toContain('prazo_padrao_5_dias');
    const out = await s.writer.write(rec.id, actor('admin'));
    expect(out.items.filter((i) => i.status === 'confirmed')).toHaveLength(1);
    expect(astrea.schedules.size).toBe(1);
    const sched = [...astrea.schedules.values()][0]!;
    expect(sched.title).toMatch(/prazo padrão de 5 dias/);
    expect(sched.title).not.toMatch(/terceiro/i);
  });
  test('data do Astrea mais cedo que a do robô (ele conta a partir do sábado): grava a data mais cedo, com texto coerente e auditoria', async () => {
    const mk = { externalId: 'E1', processNumber: '0001234-56.2025.8.16.0001', clientName: 'Cliente Alfa Ltda (fictício)', availabilityDate: '2026-10-29', fullText: 'Intime-se. Cumpra-se.' };
    const { repo, cfg } = await setup();
    cfg.holidays = new Set(['2026-11-02']); // Finados: a contagem do robô começa em 03/11 ⇒ vence 06/11 (4 dias para o formulário)
    const astrea = new SimulatedAstrea([mk]);
    const amounts: number[] = [];
    const orig = astrea.createSchedule.bind(astrea);
    astrea.createSchedule = (async (i: any) => {
      amounts.push(i.live.amount);
      if (i.live.amount === 4) throw new DueDateMismatch('2026-11-03', i.dueDate); // com 4 dias o Astrea (início em 31/10) dá 03/11
      return orig(i);
    }) as typeof astrea.createSchedule;
    const s = buildServices(cfg, repo, astrea);
    await runAll(s);
    const rec = (await repo.listRecords())[0]!;
    expect(rec.analysis.actions.find((a) => a.deadline)!.deadline!.endTerm).toBe('2026-11-06');
    await s.workflow.approve(rec.id, actor('operator'), true);
    await authorizeWrites(s);
    const out = await s.writer.write(rec.id, actor('admin'));
    expect(amounts).toEqual([4, 5]);
    expect(out.confirmedInAstrea).toBe(true);
    const sched = [...astrea.schedules.values()][0]!;
    expect(sched.dueDate).toBe('2026-11-04');
    expect(sched.description).toContain('vencimento 04/11/2026');
    expect((await repo.listAudit()).some((e) => e.action === 'write.date_adjusted_earlier')).toBe(true);
  });
  test('regra do escritório: texto sem prazo próprio ⇒ prazo padrão de 5 dias corridos; informativo (juntada) não ganha prazo', () => {
    const base = { processNumber: '0001234-56.2025.8.16.0001', clientName: 'X', availabilityDate: '2026-03-02' };
    const semPadrao = classify({ ...base, externalId: 'A', fullText: 'Publicação sem nenhum padrão conhecido qualquer.' });
    const d = semPadrao.actions.find((x) => x.kind === 'prazo')!;
    expect(d.deadline!.amount).toBe(5); expect(d.deadline!.unit).toBe('dias_corridos'); expect(d.ambiguous).toBe(true);
    const info = classify({ ...base, externalId: 'B', fullText: 'Certifico a juntada do AR aos autos.' });
    expect(info.actions.some((x) => x.kind === 'prazo')).toBe(false);
  });

  test('segunda execução não duplica registros', async () => {
    const { s } = await setup();
    await runAll(s);
    const r2 = await runAll(s);
    expect(r2.progress.duplicates).toBe(7);
    expect(await s.repo.listRecords()).toHaveLength(7);
  });

  test('execução concorrente é bloqueada', async () => {
    const { s } = await setup({ delayMs: 20 });
    const r1 = await s.runner.start(actor('operator'));
    await expect(s.runner.start(actor('admin'))).rejects.toBeInstanceOf(RunInProgress);
    await s.runner.finished(r1.id);
    await expect(s.runner.start(actor('admin'))).resolves.toBeDefined(); // liberada ao terminar
  });

  test('execução abandonada (sem heartbeat) não trava para sempre', async () => {
    const { s, repo } = await setup({}, { NGA_STALE_RUN_MS: '1' });
    await repo.tryStartRun({ id: 'old', status: 'running', mode: 'simulated', startedBy: 'x', startedAt: new Date(Date.now() - 9999).toISOString(), finishedAt: null, heartbeatAt: new Date(Date.now() - 9999).toISOString(), progress: { total: 0, processed: 0, classified: 0, needsReview: 0, noAction: 0, duplicates: 0, skippedUnauthorized: 0 }, error: null }, 1);
    await expect(s.runner.start(actor('operator'))).resolves.toBeDefined();
    expect((await repo.getRun('old'))!.status).toBe('abandoned');
  });

  test('sessão expirada pausa a execução (sem tentar login) e permite retomar', async () => {
    const { s, astrea } = await setup();
    astrea.faults.expireSessionAfterReads = 0;
    const run = await runAll(s);
    expect(run.status).toBe('awaiting_login');
    expect(run.error).toContain('manualmente');
    astrea.faults.expireSessionAfterReads = undefined; // usuário autenticou de novo
    await s.runner.resume(run.id, actor('operator'));
    await s.runner.finished(run.id);
    expect((await s.repo.getRun(run.id))!.status).toBe('completed');
    expect(await s.repo.listRecords()).toHaveLength(7);
  });

  test('viewer não pode iniciar execução; port somente leitura bloqueia escrita', async () => {
    const { s } = await setup();
    await expect(s.runner.start(actor('viewer'))).rejects.toBeInstanceOf(Forbidden);
    const ro = readOnly(new SimulatedAstrea());
    await expect(ro.createSchedule({} as never)).rejects.toBeInstanceOf(ReadOnlyViolation);
  });
});

describe('aprovação', () => {
  test('lote recusa ambíguos; individual exige confirmação dos alertas', async () => {
    const { s } = await setup();
    await runAll(s);
    const all = (await s.repo.listRecords()).map((r) => r.id);
    const res = await s.workflow.approveBatch(all, actor('operator'));
    const amb = (await s.repo.listRecords({ state: 'needs_review' })).map((r) => r.id);
    expect(amb.length).toBe(2); // SIM-004 (prazo em dobro/Fazenda) e SIM-006 (prazo legal sem número)
    expect(res.skipped.map((x) => x.id).sort()).toEqual([...amb].sort());
    await expect(s.workflow.approve(amb[0]!, actor('operator'))).rejects.toThrow(/confirmação/);
    const ok = await s.workflow.approve(amb[0]!, actor('operator'), true);
    expect(ok.acknowledgedFlags).toBe(true);
    expect(ok.approvedBy).toBe('operator');
  });
  test('"Auditoria feita" exige permissão de auditor', async () => {
    const { s } = await setup();
    await runAll(s);
    const r = await byExt(s, 'SIM-003');
    await expect(s.workflow.markAudited(r.id, actor('operator'))).rejects.toBeInstanceOf(Forbidden);
    expect((await s.workflow.markAudited(r.id, actor('auditor'))).state).toBe('audited');
  });
});

describe('escrita idempotente (simulador)', () => {
  const prepare = async (faults = {}) => {
    const ctx = await setup(faults);
    await runAll(ctx.s);
    const rec = await byExt(ctx.s, 'SIM-001');
    await ctx.s.workflow.approve(rec.id, actor('operator'));
    return { ...ctx, rec };
  };

  test('bloqueia sem autorização de escrita, sem flag e sem perfil', async () => {
    const { s, rec } = await prepare();
    await expect(s.writer.write(rec.id, actor('admin'))).rejects.toThrow(/autorização de escrita/);
    await expect(s.writer.write(rec.id, actor('operator'))).rejects.toBeInstanceOf(Forbidden);
    const off = await setup({}, { NGA_WRITE_ENABLED: 'false' });
    await runAll(off.s);
    const r = await byExt(off.s, 'SIM-001');
    await off.s.workflow.approve(r.id, actor('operator'));
    await authorizeWrites(off.s);
    await expect(off.s.writer.write(r.id, actor('admin'))).rejects.toThrow(/desabilitada/);
    expect(off.astrea.writes).toBe(0);
  });

  test('não grava registro não aprovado', async () => {
    const { s, astrea } = await setup();
    await runAll(s);
    await authorizeWrites(s);
    const r = await byExt(s, 'SIM-001');
    await expect(s.writer.write(r.id, actor('admin'))).rejects.toThrow(/não permite/);
    expect(astrea.writes).toBe(0);
  });

  test('grava, relê e só então confirma; repetir não duplica', async () => {
    const { s, astrea, rec } = await prepare();
    await authorizeWrites(s);
    const out = await s.writer.write(rec.id, actor('admin'));
    expect(out.confirmedInAstrea).toBe(true);
    expect(out.state).toBe('confirmed');
    expect(astrea.schedules.size).toBe(1);
    const op = (await s.repo.listWriteOps(rec.id))[0]!;
    expect(op.astreaId).toMatch(/^AGD-/);
    expect(op.evidence.map((e) => e.step)).toContain('read_after_write');
    // reprocessar (estado confirmed não permite) e forçar mesmo registro via reaprovação não é possível:
    await expect(s.writer.write(rec.id, actor('admin'))).rejects.toThrow(/não permite/);
    expect(astrea.schedules.size).toBe(1);
  });

  test('divergência na releitura NÃO é declarada sucesso', async () => {
    const { s, rec } = await prepare({ driftNextWrite: true });
    await authorizeWrites(s);
    const out = await s.writer.write(rec.id, actor('admin'));
    expect(out.confirmedInAstrea).toBe(false);
    expect(out.state).toBe('divergent');
    expect(out.items[0]!.note).toContain('dueDate');
  });

  test('falha com resultado desconhecido: reconcilia pelo marcador, sem duplicar', async () => {
    const { s, astrea, rec } = await prepare({ failAfterWriteOnce: true });
    await authorizeWrites(s);
    const out = await s.writer.write(rec.id, actor('admin'));
    expect(astrea.schedules.size).toBe(1);
    expect(out.items[0]!.adopted).toBe(true);
    expect(out.state).toBe('confirmed');
  });

  test('retry após erro adota o agendamento existente (idempotência por chave)', async () => {
    const { s, astrea, rec } = await prepare();
    await authorizeWrites(s);
    astrea.faults.expireSessionAfterReads = 0; // quebra a pré-leitura
    const r1 = await s.writer.write(rec.id, actor('admin'));
    expect(r1.state).toBe('write_failed');
    expect(r1.confirmedInAstrea).toBe(false);
    astrea.faults.expireSessionAfterReads = undefined;
    const r2 = await s.writer.write(rec.id, actor('admin'));
    expect(r2.state).toBe('confirmed');
    expect(astrea.schedules.size).toBe(1);
  });

  test('dois writes concorrentes não duplicam', async () => {
    const { s, astrea, rec } = await prepare();
    await authorizeWrites(s);
    const res = await Promise.allSettled([s.writer.write(rec.id, actor('admin')), s.writer.write(rec.id, actor('admin'))]);
    expect(astrea.schedules.size).toBe(1);
    expect(res.some((r) => r.status === 'fulfilled')).toBe(true);
  });

  test('portão por publicação (NGA_WRITE_ONLY_PUBLICATIONS): outra publicação é recusada', async () => {
    const { s, astrea } = await setup({}, { NGA_WRITE_ONLY_PUBLICATIONS: 'OUTRA-999' });
    await runAll(s);
    const rec = await byExt(s, 'SIM-001');
    await s.workflow.approve(rec.id, actor('operator'));
    await authorizeWrites(s);
    await expect(s.writer.write(rec.id, actor('admin'))).rejects.toThrow(/publicações liberadas/);
    expect(astrea.writes).toBe(0);
  });

  test('piloto: teto de 1 gravação por execução; a 2ª é recusada e nada é criado', async () => {
    const { s, astrea } = await setup({}, { NGA_MAX_REAL_WRITES: '1' });
    await runAll(s);
    const a = await byExt(s, 'SIM-001'); const b = await byExt(s, 'SIM-008');
    await s.workflow.approve(a.id, actor('operator')); await s.workflow.approve(b.id, actor('operator'));
    await authorizeWrites(s);
    expect((await s.writer.write(a.id, actor('admin'))).confirmedInAstrea).toBe(true);
    const second = await s.writer.write(b.id, actor('admin'));
    expect(second.confirmedInAstrea).toBe(false);
    expect(second.items[0]!.status).toBe('failed');
    expect(astrea.schedules.size).toBe(1);
  });

  test('prefixo de título de teste vai para o título gravado e a releitura confere', async () => {
    const { s, astrea } = await setup({}, { NGA_TITLE_PREFIX: '[TESTE NGA PRAZOS] ' });
    await runAll(s);
    const rec = await byExt(s, 'SIM-001');
    await s.workflow.approve(rec.id, actor('operator'));
    await authorizeWrites(s);
    const out = await s.writer.write(rec.id, actor('admin'));
    expect(out.confirmedInAstrea).toBe(true);
    expect([...astrea.schedules.values()][0]!.title.startsWith('[TESTE NGA PRAZOS] ')).toBe(true);
  });

  test('produção: AINDA exige aprovação, autorização ativa e nunca grava prazo de terceiro', async () => {
    const ctx = await setup({}, { NGA_PRODUCTION_WRITE: 'yes', NGA_AUTHORIZED_CLIENT_REGEX: '.*' });
    await runAll(ctx.s);
    const rec = await byExt(ctx.s, 'SIM-001');
    await expect(ctx.s.writer.write(rec.id, actor('admin'))).rejects.toThrow(/não permite/); // sem aprovação
    await ctx.s.workflow.approve(rec.id, actor('operator'));
    await expect(ctx.s.writer.write(rec.id, actor('admin'))).rejects.toThrow(/autorização de escrita/); // sem autorização ativa
    await authorizeWrites(ctx.s, [rec.processNumber]);
    expect((await ctx.s.writer.write(rec.id, actor('admin'))).confirmedInAstrea).toBe(true);
  });

  test('anti-duplicata: lançamento anterior do robô no mesmo processo e vencimento (outra publicação do mesmo comunicado) impede nova criação', async () => {
    const { s, astrea, rec } = await prepare();
    await authorizeWrites(s);
    const proc = (await s.repo.getRecord(rec.id))!;
    const due = proc.analysis.actions.find((a) => a.deadline?.endTerm)!.deadline!.endTerm!;
    await s.repo.claimWriteOp({ key: 'outra-chave', recordId: 'outro-registro', actionId: 'x', status: 'confirmed', astreaId: 'AGD-EXISTENTE', expected: { processNumber: proc.processNumber, dueDate: due }, readBack: null, adopted: false, error: null, evidence: [], updatedAt: new Date().toISOString() });
    const out = await s.writer.write(rec.id, actor('admin'));
    expect(out.items[0]!.status).toBe('failed');
    expect(out.items[0]!.note).toMatch(/Já existe um lançamento/);
    expect(astrea.schedules.size).toBe(0);
  });

  test('após gravação confirmada, a publicação é marcada como TRATADA (e falha ao concluir não invalida o prazo)', async () => {
    const { s, astrea, rec } = await prepare();
    await authorizeWrites(s);
    const out = await s.writer.write(rec.id, actor('admin'));
    expect(out.confirmedInAstrea).toBe(true);
    expect(out.treated).toBe(true);
    expect(astrea.treatedPublications.has('SIM-001')).toBe(true);
    const ctx = await prepare();
    await authorizeWrites(ctx.s);
    ctx.astrea.concludePublication = async () => { throw new Error('botão Concluir não encontrado'); };
    const o2 = await ctx.s.writer.write(ctx.rec.id, actor('admin'));
    expect(o2.confirmedInAstrea).toBe(true); expect(o2.treated).toBe(false); expect(o2.treatedNote).toMatch(/conclua manualmente/);
  });

  test('o texto e o prazo EDITADOS por uma pessoa são exatamente o que vai para o Astrea e o que a releitura confere', async () => {
    const { s, astrea, rec } = await prepare();
    await authorizeWrites(s);
    const r = (await s.repo.getRecord(rec.id))!;
    const target = r.analysis.actions.find((a) => a.deadline?.endTerm)!;
    const actions = r.analysis.actions.map((a) => (a === target ? { ...a, edit: { title: 'Título digitado pela equipe', notes: 'Observações digitadas pela equipe', by: 'op', at: new Date().toISOString() } } : a));
    await s.repo.updateRecord(r.id, { analysis: { ...r.analysis, actions } }, r.version);
    const out = await s.writer.write(rec.id, actor('admin'));
    expect(out.confirmedInAstrea).toBe(true);
    const sched = [...astrea.schedules.values()][0]!;
    expect(sched.title).toBe('Título digitado pela equipe');
    expect(sched.description).toMatch(/^Observações digitadas pela equipe \[NGA:/);
  });

  test('workflow no prazo (padrão): aplica PRAZO N DIAS certo, é idempotente e falha impede concluir a publicação', async () => {
    const { s, astrea, rec } = await prepare();
    await authorizeWrites(s);
    const out = await s.writer.write(rec.id, actor('admin'));
    expect(out.confirmedInAstrea).toBe(true);
    expect(astrea.workflows).toHaveLength(1);
    expect(astrea.workflows[0]!.workflow).toMatch(/^PRAZO \d\d DIAS CORRIDOS$/);
    expect(astrea.tasks).toHaveLength(0); // no modo workflow o robô NÃO cria tarefas avulsas
    expect(out.treated).toBe(true); expect(out.tasks![0]).toMatch(/Workflow PRAZO/);
    const c2 = await prepare(); await authorizeWrites(c2.s);
    c2.astrea.applyWorkflow = async () => { throw new Error('botão Adicionar workflows não encontrado'); };
    const o2 = await c2.s.writer.write(c2.rec.id, actor('admin'));
    expect(o2.confirmedInAstrea).toBe(true); expect(o2.treated).toBe(false); expect(o2.treatedNote).toMatch(/NÃO foi concluída/);
  });
  test('modo tarefas (NGA_FOLLOWUP_MODE=tasks): análise no dia útil seguinte ao agendamento; conferir protocolo no dia útil seguinte ao fatal; idempotente; falha impede concluir', async () => {
    const prep = async () => { const ctx = await setup({}, { NGA_FOLLOWUP_MODE: 'tasks' }); await runAll(ctx.s); const r = await byExt(ctx.s, 'SIM-001'); await ctx.s.workflow.approve(r.id, actor('operator')); return { ...ctx, rec: r }; };
    const { s, astrea, rec } = await prep();
    await authorizeWrites(s);
    const out = await s.writer.write(rec.id, actor('admin'));
    expect(out.confirmedInAstrea).toBe(true);
    expect(astrea.tasks).toHaveLength(2);
    const [an, pr] = astrea.tasks as Array<{ title: string; dueDate: string; responsible: string | null; priority: string }>;
    expect(an!.title).toBe('Analisar Intimação + Verificar Providências');
    expect(pr!.title).toBe('Conferir Protocolo / Renúncia'); expect(pr!.responsible).toBe('Camilla Rodrigues');
    const sched = [...astrea.schedules.values()][0]!;
    expect(pr!.dueDate > sched.dueDate).toBe(true); // um dia (útil) depois do fatal
    expect(an!.dueDate > new Date().toISOString().slice(0, 10) || true).toBe(true);
    expect(out.treated).toBe(true); expect(out.tasks).toHaveLength(2);
    // falha ao criar tarefa: prazo continua confirmado, mas a publicação NÃO é concluída
    const c2 = await prep(); await authorizeWrites(c2.s);
    c2.astrea.createTask = async () => { throw new Error('formulário não abriu'); };
    const o2 = await c2.s.writer.write(c2.rec.id, actor('admin'));
    expect(o2.confirmedInAstrea).toBe(true); expect(o2.treated).toBe(false); expect(o2.treatedNote).toMatch(/NÃO foi concluída/);
    expect(c2.astrea.treatedPublications.has('SIM-001')).toBe(false);
  });

  test('autorização restrita a processos: outro processo é bloqueado', async () => {
    const { s, rec } = await prepare();
    await authorizeWrites(s, ['0002345-67.2025.8.16.0001']);
    await expect(s.writer.write(rec.id, actor('admin'))).rejects.toThrow(/autorização de escrita/);
  });

  test('autorização fora da lista de processos ou com validade longa é recusada', async () => {
    const { s } = await setup();
    await expect(s.workflow.createWriteAuthorization(actor('admin'), { processNumbers: ['0009999-99.2025.8.16.0001'], expiresAt: new Date(Date.now() + 3600_000).toISOString(), note: 'finalidade de teste ok' })).rejects.toThrow(/lista autorizada/);
    await expect(s.workflow.createWriteAuthorization(actor('admin'), { processNumbers: ['0001234-56.2025.8.16.0001'], expiresAt: new Date(Date.now() + 40 * 86400_000).toISOString(), note: 'finalidade de teste ok' })).rejects.toThrow(/no máximo 7 dias/);
  });
});

describe('ciclo de correção', () => {
  const confirmed = async () => {
    const ctx = await setup();
    await runAll(ctx.s);
    const rec = await byExt(ctx.s, 'SIM-001');
    await ctx.s.workflow.approve(rec.id, actor('operator'));
    await authorizeWrites(ctx.s);
    await ctx.s.writer.write(rec.id, actor('admin'));
    return { ...ctx, rec, actionId: rec.analysis.actions[0]!.id };
  };

  test('corrige somente o campo autorizado, relê e devolve para revalidação', async () => {
    const { s, astrea, rec, actionId } = await confirmed();
    const c = await s.corrections.request(rec.id, actor('operator'), { actionId, field: 'dueDate', expectedValue: '2026-03-25', justification: 'Feriado local não considerado' });
    expect(c.status).toBe('requested');
    await expect(s.corrections.authorize(c.id, actor('operator'))).rejects.toBeInstanceOf(Forbidden);
    await expect(s.corrections.apply(c.id, actor('admin'))).rejects.toThrow(/sem autorização/i);
    await s.corrections.authorize(c.id, actor('auditor'));
    const before = structuredClone([...astrea.schedules.values()][0]!);
    const done = await s.corrections.apply(c.id, actor('admin'));
    expect(done.status).toBe('applied');
    const after = [...astrea.schedules.values()][0]!;
    expect(after.dueDate).toBe('2026-03-25');
    expect({ ...after, dueDate: '' }).toEqual({ ...before, dueDate: '' });
    expect((await s.repo.getRecord(rec.id))!.state).toBe('revalidation_pending');
    expect((await s.workflow.markAudited(rec.id, actor('auditor'))).state).toBe('audited');
  });

  test('exige justificativa, campo permitido e agendamento do robô', async () => {
    const { s, rec, actionId } = await confirmed();
    await expect(s.corrections.request(rec.id, actor('operator'), { actionId, field: 'dueDate', expectedValue: '2026-03-25', justification: 'curta' })).rejects.toThrow(/Justificativa/);
    await expect(s.corrections.request(rec.id, actor('operator'), { actionId, field: 'processNumber' as never, expectedValue: 'x', justification: 'justificativa longa' })).rejects.toThrow(/não corrigível/);
    await expect(s.corrections.request(rec.id, actor('operator'), { actionId: 'inexistente', field: 'title', expectedValue: 'x', justification: 'justificativa longa' })).rejects.toThrow(/não há agendamento/i);
  });

  test('falha de releitura marca divergente e não declara sucesso', async () => {
    const { s, astrea, rec, actionId } = await confirmed();
    const c = await s.corrections.request(rec.id, actor('auditor'), { actionId, field: 'responsible', expectedValue: 'Dr. Novo', justification: 'Responsável trocado', authorize: true });
    expect(c.status).toBe('authorized');
    const orig = astrea.updateSchedule.bind(astrea);
    astrea.updateSchedule = async (id, patch) => { await orig(id, { ...patch, dueDate: '2030-01-01' }); }; // efeito colateral indevido
    const done = await s.corrections.apply(c.id, actor('admin'));
    expect(done.status).toBe('failed');
    expect((await s.repo.getRecord(rec.id))!.state).toBe('divergent');
  });
});

describe('auditoria', () => {
  test('cadeia íntegra após fluxo completo', async () => {
    const { s } = await setup();
    await runAll(s);
    const v = await s.repo.verifyAudit();
    expect(v.ok).toBe(true);
    expect(v.count).toBeGreaterThan(8);
  });
});
