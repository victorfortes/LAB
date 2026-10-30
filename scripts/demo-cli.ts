/** Demonstração headless em modo simulado: captura → classificação → aprovação → escrita → correção → auditoria. */
import { DEMO_AUTHORIZED, SimulatedAstrea } from '../src/astrea/simulated.ts';
import { loadConfig } from '../src/config.ts';
import { buildServices } from '../src/server/services.ts';
import { MemoryRepo } from '../src/store/memory.ts';
import type { Actor } from '../src/runner/runner.ts';

const op: Actor = { username: 'operador', role: 'operator' };
const adm: Actor = { username: 'admin', role: 'admin' };
const aud: Actor = { username: 'auditor', role: 'auditor' };
const h = (t: string) => console.log(`\n── ${t}`);

const repo = new MemoryRepo();
const astrea = new SimulatedAstrea();
await repo.setAuthorizedProcesses(DEMO_AUTHORIZED);
const s = buildServices(loadConfig({ JWT_SECRET: 'd'.repeat(40), NGA_WRITE_ENABLED: 'true' }, '/none'), repo, astrea);

h('1. Play (somente leitura)');
const run = await s.runner.start(op); await s.runner.finished(run.id);
console.log((await repo.getRun(run.id))!.progress);
for (const r of await repo.listRecords()) {
  const next = r.analysis.actions.map((a) => a.deadline?.endTerm ?? a.eventAt ?? '—').join(', ');
  console.log(`${r.externalId}  ${r.state.padEnd(13)} conf=${r.analysis.confidence.toFixed(2)}  prazo(s)=${next}`);
}
console.log('escritas no Astrea até aqui:', astrea.writes);

h('2. Aprovação: lote recusa ambíguos');
const all = (await repo.listRecords()).map((r) => r.id);
const b = await s.workflow.approveBatch(all, op);
console.log({ aprovadas: b.approved.length, recusadas: b.skipped.length });

h('3. Escrita idempotente com autorização de teste');
const rec = (await repo.listRecords()).find((r) => r.externalId === 'SIM-001')!;
await s.workflow.createWriteAuthorization(adm, { processNumbers: [rec.processNumber], expiresAt: new Date(Date.now() + 3600_000).toISOString(), note: 'demonstração em simulador' });
const w1 = await s.writer.write(rec.id, adm);
console.log('write:', w1.state, 'confirmado por leitura =', w1.confirmedInAstrea, '| agendamentos =', astrea.schedules.size);

h('4. Correção autorizada (apenas dueDate)');
const actionId = rec.analysis.actions[0]!.id;
const c = await s.corrections.request(rec.id, op, { actionId, field: 'dueDate', expectedValue: '2026-03-25', justification: 'Feriado forense local não considerado', authorize: false });
await s.corrections.authorize(c.id, aud);
const applied = await s.corrections.apply(c.id, adm);
console.log('correção:', applied.status, applied.result, '| registro →', (await repo.getRecord(rec.id))!.state);
console.log('Auditoria feita →', (await s.workflow.markAudited(rec.id, aud)).state);

h('5. Trilha de auditoria');
console.log(await repo.verifyAudit());
for (const e of (await repo.listAudit({ entityId: rec.id })).slice(0, 12)) console.log(`#${e.seq} ${e.actor.padEnd(9)} ${e.action}  ${e.hash.slice(0, 8)}`);
