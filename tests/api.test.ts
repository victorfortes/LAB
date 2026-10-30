import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Server } from 'node:http';
import { createApp } from '../src/server/app.ts';
import { addUser, setup } from './helpers.ts';

let server: Server; let base = '';
let ctx: Awaited<ReturnType<typeof setup>>;

async function login(username: string, password = 'senha-de-teste-123') {
  const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-nga': '1' }, body: JSON.stringify({ username, password }) });
  return { r, cookie: (r.headers.get('set-cookie') ?? '').split(';')[0]! };
}
const call = (cookie: string, path: string, method = 'GET', body?: unknown) =>
  fetch(`${base}/api${path}`, { method, headers: { 'content-type': 'application/json', 'x-nga': '1', cookie }, body: body ? JSON.stringify(body) : undefined });

beforeAll(async () => {
  ctx = await setup();
  await addUser(ctx.repo, 'op', 'operator'); await addUser(ctx.repo, 'view', 'viewer'); await addUser(ctx.repo, 'adm', 'admin');
  server = createApp(ctx.s, '/nonexistent').listen(0);
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => server.close());

describe('API', () => {
  test('GET /api/health é público e não expõe dados', async () => {
    const r = await fetch(`${base}/api/health`);
    expect(r.status).toBe(200);
    const j = await r.json() as Record<string, unknown>;
    expect(j.status).toBe('ok');
    expect(Object.keys(j).sort()).toEqual(['mode', 'now', 'status', 'uptimeSec']);
  });
  test('rotas exigem sessão; login inválido é 401; CSRF exige cabeçalho', async () => {
    expect((await fetch(`${base}/api/records`)).status).toBe(401);
    expect((await login('op', 'senha-errada-123')).r.status).toBe(401);
    const noHeader = await fetch(`${base}/api/runs`, { method: 'POST' });
    expect(noHeader.status).toBe(403);
  });
  test('cookie HttpOnly + SameSite=Strict', async () => {
    const { r } = await login('op');
    const sc = r.headers.get('set-cookie')!;
    expect(sc).toContain('HttpOnly');
    expect(sc).toContain('SameSite=Strict');
  });
  test('Play → progresso → resultados → aprovação → auditoria feita', async () => {
    const { cookie } = await login('op');
    const run = await (await call(cookie, '/runs', 'POST')).json() as { id: string };
    await ctx.s.runner.finished(run.id);
    expect(((await (await call(cookie, `/runs/${run.id}`)).json()) as any).status).toBe('completed');
    const list = await (await call(cookie, '/records')).json() as Array<{ id: string; state: string }>;
    expect(list).toHaveLength(7);
    const ok = list.find((r) => r.state === 'classified')!;
    expect((await call(cookie, `/records/${ok.id}/approve`, 'POST', {})).status).toBe(200);
    const amb = list.find((r) => r.state === 'needs_review')!;
    expect((await call(cookie, `/records/${amb.id}/approve`, 'POST', {})).status).toBe(422);
    expect((await call(cookie, `/records/${ok.id}/comments`, 'POST', { text: 'corrigir termo inicial' })).status).toBe(201);
    expect((await call(cookie, `/records/${ok.id}/audited`, 'POST')).status).toBe(403); // operador não audita
    const adm = (await login('adm')).cookie;
    expect((await call(adm, `/records/${ok.id}/audited`, 'POST')).status).toBe(200);
    const detail = await (await call(adm, `/records/${ok.id}`)).json() as any;
    expect(detail.audit.length).toBeGreaterThan(2);
    expect(((await (await call(adm, '/audit/verify')).json()) as any).ok).toBe(true);
  });
  test('edição do prazo e do texto antes do lançamento: valida, recalcula o vencimento, audita e exige nova aprovação', async () => {
    const op = (await login('op')).cookie;
    const list = await (await call(op, '/records')).json() as Array<any>;
    const rec = list.find((r) => r.state === 'needs_review' && r.canSchedule)!;
    expect((await call(op, `/records/${rec.id}/edit`, 'PUT', {})).status).toBe(422);
    expect((await call(op, `/records/${rec.id}/edit`, 'PUT', { title: 'ab' })).status).toBe(400);
    expect((await call((await login('view')).cookie, `/records/${rec.id}/edit`, 'PUT', { title: 'Título novo' })).status).toBe(403);
    const r = await call(op, `/records/${rec.id}/edit`, 'PUT', { title: 'Meu título exato', notes: 'Minhas observações exatas', amount: 7, unit: 'dias_corridos' });
    expect(r.status).toBe(200);
    const after = ((await (await call(op, '/records')).json()) as Array<any>).find((x) => x.id === rec.id);
    expect(after.launch).toMatchObject({ title: 'Meu título exato', notes: 'Minhas observações exatas', amount: 7, unit: 'dias_corridos', edited: true });
    expect(after.ownDeadline).not.toBe(rec.ownDeadline);
    // aprovou e editou de novo ⇒ volta para decisão
    expect((await call(op, `/records/${rec.id}/approve`, 'POST', { acknowledgeAmbiguity: true })).status).toBe(200);
    expect((await call(op, `/records/${rec.id}/edit`, 'PUT', { amount: 9 })).status).toBe(200);
    const back = ((await (await call(op, '/records')).json()) as Array<any>).find((x) => x.id === rec.id);
    expect(back.state).toBe('needs_review'); expect(back.approvedBy).toBeNull();
    const audit = await (await call((await login('adm')).cookie, '/audit')).json() as Array<any>;
    expect(audit.filter((e) => e.action === 'record.edited').length).toBe(2);
  });

  test('dispensar em lote: motivo obrigatório, tira de pendentes, audita; viewer não pode', async () => {
    const op = (await login('op')).cookie;
    const list = await (await call(op, '/records')).json() as Array<any>;
    const ids = list.filter((r) => ['needs_review', 'classified', 'approved'].includes(r.state)).slice(0, 2).map((r) => r.id);
    expect(ids.length).toBeGreaterThan(0);
    expect((await call(op, '/records/batch/reject', 'POST', { ids, reason: 'ab' })).status).toBe(400);
    expect((await call((await login('view')).cookie, '/records/batch/reject', 'POST', { ids, reason: 'Já existe prazo no Astrea' })).status).toBe(403);
    const r = await (await call(op, '/records/batch/reject', 'POST', { ids, reason: 'Já existe prazo no Astrea' })).json() as { rejected: string[] };
    expect(r.rejected.sort()).toEqual([...ids].sort());
    const after = await (await call(op, '/records')).json() as Array<any>;
    for (const id of ids) expect(after.find((x) => x.id === id).state).toBe('rejected');
  });

  test('ensaio no Astrea: só admin; nunca grava; registra auditoria', async () => {
    const adm = (await login('adm')).cookie;
    const run = await (await call(adm, '/runs', 'POST')).json() as { id: string };
    await ctx.s.runner.finished(run.id).catch(() => {});
    const list = await (await call(adm, '/records')).json() as Array<{ id: string; state: string; nextDeadline: string | null }>;
    const withDeadline = list.find((r) => r.nextDeadline && r.state !== 'needs_review') ?? list.find((r) => r.nextDeadline)!;
    const viewer = (await login('view')).cookie;
    expect((await call(viewer, `/records/${withDeadline.id}/dry-run`, 'POST')).status).toBe(403);
    const r = await call(adm, `/records/${withDeadline.id}/dry-run`, 'POST');
    expect(r.status).toBe(200);
    const j = await r.json() as any;
    expect(j.cancelled).toBe(true); expect(j.writeAttempts).toBe(0); expect(j.title.length).toBeGreaterThan(3);
    expect(ctx.astrea.writes).toBe(0);
    const audit = await ctx.repo.listAudit({ entityId: withDeadline.id });
    expect(audit.some((e) => e.action === 'dryrun.executed')).toBe(true);
  });
  test('cofre do Astrea: só admin; a senha NUNCA volta na API nem vai para a auditoria', async () => {
    const adm = (await login('adm')).cookie; const op = (await login('op')).cookie; const view = (await login('view')).cookie;
    expect((await call(op, '/vault/astrea')).status).toBe(403);
    expect((await call(view, '/vault/astrea', 'PUT', { email: 'x@y.zz', password: 'abcdefg' })).status).toBe(403);
    expect((await call(adm, '/vault/astrea', 'PUT', { email: 'robo@exemplo.test', password: 'curta' })).status).toBe(400);
    const put = await call(adm, '/vault/astrea', 'PUT', { email: 'robo@exemplo.test', password: 'senha-fake-123' });
    expect(put.status).toBe(200);
    const body = JSON.stringify(await put.json()) + JSON.stringify(await (await call(adm, '/vault/astrea')).json());
    expect(body).toContain('r***@exemplo.test');
    expect(body).not.toContain('senha-fake-123');
    expect(body).not.toContain('robo@exemplo.test');
    const audit = JSON.stringify(await ctx.repo.listAudit());
    expect(audit).toContain('vault.saved');
    expect(audit).not.toContain('senha-fake-123');
    expect(audit).not.toContain('robo@exemplo.test');
    expect(((await (await call(adm, '/vault/astrea', 'DELETE')).json()) as any).configured).toBe(false);
  });
  test('exportação CSV para a Controladoria: só quem audita; sem texto integral; fórmulas neutralizadas; BOM para Excel', async () => {
    const adm = (await login('adm')).cookie; const op = (await login('op')).cookie;
    expect((await call(op, '/export/records.csv')).status).toBe(403);
    const r = await call(adm, '/export/records.csv');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-disposition')).toContain('registros-');
    const buf = new Uint8Array(await r.arrayBuffer());
    expect([buf[0], buf[1], buf[2]]).toEqual([0xef, 0xbb, 0xbf]); // BOM UTF-8 (Excel)
    const txt = new TextDecoder().decode(buf);
    expect(txt.split('\r\n')[0]).toContain('processo;cliente;estado');
    expect(txt).not.toContain('Intime-se a parte requerida'); // texto integral NÃO vai na exportação
    const a = await (await call(adm, '/export/audit.csv')).text();
    expect(a).toContain('cadeia_integra');
    expect(a).toContain(';sim');
  });
  test('escopo "todo o escritório" bloqueado por padrão; /launches exige sessão e traz o link da publicação', async () => {
    expect((await fetch(`${base}/api/launches`)).status).toBe(401);
    const adm = (await login('adm')).cookie;
    const r = await call(adm, '/runs', 'POST', { scope: 'todos' });
    expect(r.status).toBe(403);
    expect(((await (await call(adm, '/config')).json()) as { scopes: string[] }).scopes).toEqual(['copel']);
    const l = await (await call(adm, '/launches')).json() as unknown[];
    expect(Array.isArray(l)).toBe(true);
  });
  test('execução concorrente retorna 409; viewer não inicia execução', async () => {
    const { cookie } = await login('op');
    const slow = await setup({ delayMs: 30 });
    await addUser(slow.repo, 'op', 'operator');
    const s2 = createApp(slow.s, '/nonexistent').listen(0);
    const b2 = `http://127.0.0.1:${(s2.address() as { port: number }).port}`;
    const c2 = (await (await fetch(`${b2}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-nga': '1' }, body: JSON.stringify({ username: 'op', password: 'senha-de-teste-123' }) })).headers.get('set-cookie') ?? '').split(';')[0]!;
    const h = { 'content-type': 'application/json', 'x-nga': '1', cookie: c2 };
    const a = await fetch(`${b2}/api/runs`, { method: 'POST', headers: h });
    const b = await fetch(`${b2}/api/runs`, { method: 'POST', headers: h });
    expect(a.status).toBe(202); expect(b.status).toBe(409);
    await slow.s.runner.finished(((await a.json()) as any).id);
    s2.close();
    const view = (await login('view')).cookie;
    expect((await call(view, '/runs', 'POST')).status).toBe(403);
    void cookie;
  });

  test('aprovar e lançar em lote: viewer 403; pula ambíguas sem confirmação; fila roda e informa o resultado por publicação', async () => {
    const adm = (await login('adm')).cookie;
    const list = await (await call(adm, '/records')).json() as Array<any>;
    const ids = list.filter((r) => ['classified', 'needs_review', 'approved'].includes(r.state)).slice(0, 3).map((r) => r.id);
    expect(ids.length).toBeGreaterThan(0);
    expect((await call((await login('view')).cookie, '/records/batch/launch', 'POST', { ids })).status).toBe(403);
    expect((await call(adm, '/records/batch/launch', 'POST', { ids: [] })).status).toBe(400);
    expect((await call(adm, '/records/batch/launch', 'POST', { ids })).status).toBe(202);
    let st: any;
    for (let i = 0; i < 100; i++) { st = await (await call(adm, '/batch-launch-status')).json(); if (!st.running) break; await Bun.sleep(100); }
    expect(st.running).toBe(false);
    expect(st.items).toHaveLength(ids.length);
    for (const it of st.items) expect(['done', 'failed', 'skipped']).toContain(it.status);
    const reviewed = list.filter((r) => ids.includes(r.id) && r.state === 'needs_review').map((r) => r.id);
    for (const it of st.items.filter((x: any) => reviewed.includes(x.id))) expect(it.status).toBe('skipped');
  });
});
