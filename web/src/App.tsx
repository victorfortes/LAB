import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { api, STATE_LABEL } from './api.ts';
import { HealthPill, I, daysLeft, fmtDate, fmtDuration, initials, todayIso, unitLabel, urgencyOf, useHealth, weekday } from './ui.tsx';

type Me = { username: string; role: string; permissions: string[] };
type Cfg = { mode: 'simulated' | 'live'; writeEnabled: boolean; holidaysVerified: boolean; astreaBaseUrl: string; scopes: string[]; scopeRegex: string | null };
const pubLink = (cfg: Cfg, publicationId: string) => `${cfg.astreaBaseUrl.replace(/\/+$/, '')}/#/main/clippings-treatment?id=${publicationId}`;
type Prog = { total: number; processed: number; classified: number; needsReview: number; noAction: number; duplicates: number; skippedUnauthorized: number; stage?: string; readDone?: number; readTotal?: number };
type Run = { id: string; status: string; error: string | null; startedAt: string; finishedAt: string | null; startedBy: string; progress: Prog };
type Prazo = { amount: number; unit: string; startTerm: string; endTerm: string | null; calendarDays: number | null; basis: string };
type Row = {
  id: string; publicationId: string; processNumber: string; clientName: string; state: string; availabilityDate: string; summary: string; confidence: number; flags: string[];
  ambiguous: boolean; providencia: string; providenciaKind: string; notOurs: boolean; responsible: string | null; prazo: Prazo | null; eventAt: string | null;
  nextDeadline: string | null; ownDeadline: string | null; canSchedule: boolean; launch: { actionId: string; title: string; notes: string; amount: number; unit: string; edited: boolean } | null; ambiguityReasons: string[]; defaultDeadline: boolean; ato: string | null; classe: string | null; orgao: string | null; astreaDue: string | null; astreaDivergent: boolean; quote: string | null;
};
type Notify = (m: { kind: 'ok' | 'bad' | 'warn'; text: string }) => void;

const FLAG_LABEL: Record<string, string> = {
  prazo_padrao_5_dias: 'Sem prazo no texto: prazo padrão de 5 dias', feriados_locais_nao_verificados: 'Feriados locais não verificados', responsavel_nao_definido: 'Responsável não definido', multiplas_providencias: 'Várias providências',
  nenhum_padrao_reconhecido: 'Texto sem padrão reconhecido', sugestao_astrea_divergente: 'Data diverge da sugestão do Astrea', texto_possivelmente_truncado: 'Texto possivelmente truncado',
};

export function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const load = useCallback(async () => {
    try { const [m, c] = await Promise.all([api('/me'), api('/config')]); setCfg(c); setMe(m); } catch { setMe(null); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  if (me === undefined) return null;
  if (!me) return <Login onDone={load} />;
  return <Dashboard me={me} cfg={cfg!} onLogout={async () => { await api('/auth/logout', 'POST'); setMe(null); }} />;
}

// ───────────────────────── Login ─────────────────────────
function Login({ onDone }: { onDone: () => void }) {
  const [u, setU] = useState(''); const [p, setP] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const h = useHealth();
  return (
    <div className="login">
      <div className="login-art">
        <img src="/brand/nga-adv-branco.png" alt="NGA Advogados" />
        <div>
          <div className="eyebrow">NGA LAB <span style={{ color: 'var(--faint)' }}>//</span> LEGAL OPS</div>
          <h1>Prazos</h1>
          <p>O robô lê as publicações do Astrea, sugere o prazo e a providência. A equipe decide. Nada é lançado sem aprovação e tudo fica na trilha de auditoria.</p>
        </div>
        <div className="small" style={{ fontFamily: 'var(--mono)', letterSpacing: '.2em' }}>NGA ADV // USO INTERNO</div>
      </div>
      <div className="login-form">
        <div className="login-card">
          <img className="mono-logo" src="/brand/nga-monograma.png" alt="" />
          <h2>Entrar</h2>
          <div className="muted">Use seu usuário do sistema.</div>
          <form onSubmit={async (e) => { e.preventDefault(); setBusy(true); try { await api('/auth/login', 'POST', { username: u, password: p }); onDone(); } catch (x) { setErr((x as Error).message); } finally { setBusy(false); } }}>
            <label>Usuário<input className="field" value={u} onChange={(e) => setU(e.target.value)} autoComplete="username" autoFocus /></label>
            <label>Senha<input className="field" type="password" value={p} onChange={(e) => setP(e.target.value)} autoComplete="current-password" /></label>
            {err && <div className="callout bad"><I n="alert" s={18} /><div>{err}</div></div>}
            <button className="btn primary" style={{ height: 44 }} disabled={busy || !u || !p}>{busy ? 'Entrando…' : 'Entrar'}</button>
          </form>
          <div className="login-foot"><HealthPill h={h} onDark={false} /></div>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────── Progresso ─────────────────────────
const STEPS = ['Conexão com o Astrea', 'Leitura das publicações', 'Classificação', 'Concluído'];
function computeProgress(run: Run | null, now: number) {
  if (!run) return { pct: 0, idx: -1, mode: 'idle' as const, title: 'Pronto para executar', detail: 'Aperte Play para capturar e classificar as publicações pendentes.', eta: '' };
  const p = run.progress; const start = Date.parse(run.startedAt); const end = run.finishedAt ? Date.parse(run.finishedAt) : now;
  const elapsed = fmtDuration(end - start);
  if (run.status === 'completed') return { pct: 100, idx: 3, mode: 'ok' as const, title: 'Execução concluída', detail: `${p.processed} publicação(ões) processada(s) em ${elapsed}.`, eta: '' };
  if (run.status === 'failed' || run.status === 'abandoned') return { pct: 40, idx: Math.max(0, ['login', 'lendo', 'classificando'].indexOf(p.stage ?? 'login')), mode: 'bad' as const, title: run.status === 'failed' ? 'Execução falhou' : 'Execução abandonada', detail: run.error ?? '', eta: '' };
  if (run.status === 'awaiting_login') return { pct: 6, idx: 0, mode: 'wait' as const, title: 'Aguardando login no Astrea', detail: run.error ?? 'Conclua o login e retome.', eta: '' };
  const st = p.stage ?? 'iniciando';
  if (st === 'lendo') {
    const rt = p.readTotal ?? 0, rd = p.readDone ?? 0;
    const eta = rd > 0 && rt > rd ? `~${fmtDuration(((end - start) / rd) * (rt - rd))} restantes` : '';
    return { pct: 8 + (rt ? 57 * (rd / rt) : 0), idx: 1, mode: 'run' as const, title: 'Lendo publicações no Astrea', detail: rt ? `Publicação ${Math.min(rd + 1, rt)} de ${rt} · ${elapsed} decorridos` : `Abrindo a lista de publicações · ${elapsed}`, eta };
  }
  if (st === 'classificando') return { pct: 65 + (p.total ? 35 * (p.processed / p.total) : 0), idx: 2, mode: 'run' as const, title: 'Classificando e calculando prazos', detail: `${p.processed} de ${p.total} · ${elapsed}`, eta: '' };
  return { pct: 4, idx: 0, mode: 'run' as const, title: 'Conectando ao Astrea', detail: `Verificando a sessão (login automático se necessário) · ${elapsed}`, eta: '' };
}

const QUEUES: Array<{ key: string; label: string; hint: string; states: string[] }> = [
  { key: 'decidir', label: 'Aguardando decisão', hint: 'Publicações que precisam da sua decisão: aprovar ou rejeitar.', states: ['classified', 'needs_review'] },
  { key: 'lancar', label: 'Aprovadas — lançar no Astrea', hint: 'Já aprovadas. Falta lançar o prazo no Astrea.', states: ['approved', 'write_queued', 'write_failed', 'divergent'] },
  { key: 'lancadas', label: 'Já lançadas', hint: 'Prazos que o robô lançou e conferiu no Astrea.', states: ['confirmed', 'audited', 'revalidation_pending', 'correction_requested', 'correction_authorized'] },
  { key: 'sem', label: 'Sem prazo', hint: 'Publicações informativas: não exigem prazo.', states: ['no_action'] },
  { key: 'encerradas', label: 'Encerradas', hint: 'Rejeitadas ou já tratadas por outra pessoa no Astrea.', states: ['rejected'] },
];
const STATUS_PLAIN: Record<string, { t: string; c: string }> = {
  classified: { t: 'Aguardando decisão', c: 'wait' }, needs_review: { t: 'Aguardando decisão', c: 'wait' }, approved: { t: 'Aprovada — falta lançar', c: 'go' },
  write_queued: { t: 'Lançando…', c: 'go' }, write_failed: { t: 'Não lançou — tentar de novo', c: 'bad' }, divergent: { t: 'Divergente — conferir', c: 'bad' },
  confirmed: { t: 'Lançada no Astrea', c: 'ok' }, audited: { t: 'Lançada e auditada', c: 'ok' }, revalidation_pending: { t: 'Lançada — revalidar', c: 'ok' },
  correction_requested: { t: 'Correção pedida', c: 'wait' }, correction_authorized: { t: 'Correção autorizada', c: 'wait' },
  no_action: { t: 'Sem prazo (informativa)', c: 'muted' }, rejected: { t: 'Encerrada', c: 'muted' },
};

function StepsPanel({ run, active, canRun, onPlay, onResume, now, scopes, scope, onScope, nDecidir, nLancar, nLancadas, goTo }: { run: Run | null; active: boolean; canRun: boolean; onPlay: () => void; onResume: () => void; now: number; scopes: string[]; scope: string; onScope: (s: string) => void; nDecidir: number; nLancar: number; nLancadas: number; goTo: (q: string) => void }) {
  const pr = computeProgress(run, now);
  const last = run?.finishedAt ? new Date(run.finishedAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : null;
  return (
    <section className="steps3">
      <div className="st">
        <div className="st-n">01 <span>// buscar</span></div>
        <div className="st-b">
          <h3>Buscar publicações</h3>
          <p className="muted">O robô lê no Astrea as publicações ainda não tratadas.</p>
          <button className="btn gold big" disabled={!canRun || active} onClick={onPlay}>{active ? <><I n="spinner" s={18} cls="spin" />Buscando…</> : <><I n="play" s={18} />Buscar publicações no Astrea</>}</button>
          {scopes.length > 1 && <label className="row small" style={{ marginTop: 8, gap: 8 }}>Escopo
            <select className="field" style={{ width: 'auto', height: 30, padding: '0 8px' }} value={scope} onChange={(e) => onScope(e.target.value)} disabled={active}><option value="copel">Somente COPEL</option><option value="todos">Todo o escritório</option></select></label>}
          <div className="bar-s"><div className={`bar ${pr.mode === 'run' ? 'running' : pr.mode === 'bad' ? 'fail' : pr.mode === 'wait' ? 'wait' : ''}`}><i style={{ width: `${Math.max(active || run ? 3 : 0, pr.pct)}%` }} /></div></div>
          <div className={`small ${pr.mode === 'bad' ? 'bad-t' : ''}`}>{active ? `${pr.title} — ${pr.detail}${pr.eta ? ` · ${pr.eta}` : ''}` : run ? (pr.mode === 'bad' ? `Não deu certo: ${pr.detail}` : `Última busca: ${last ?? ''} · ${run.progress.processed} publicação(ões) lida(s)`) : 'Ainda não buscou nada.'}</div>
          {run?.status === 'awaiting_login' && <button className="btn gold sm" style={{ marginTop: 8 }} onClick={onResume}>Já fiz o login — continuar</button>}
        </div>
      </div>
      <div className="st">
        <div className="st-n">02 <span>// decidir</span></div>
        <div className="st-b">
          <h3>Decidir</h3>
          <div className="bignum"><b>{nDecidir}</b><span>{nDecidir === 1 ? 'publicação aguarda' : 'publicações aguardam'} a sua decisão</span></div>
          <p className="muted">Abra cada uma, confira o prazo sugerido e aprove ou rejeite.</p>
          <button className="btn primary" onClick={() => goTo('decidir')}>Ver o que decidir</button>
        </div>
      </div>
      <div className="st">
        <div className="st-n">03 <span>// lançar</span></div>
        <div className="st-b">
          <h3>Lançar no Astrea</h3>
          <div className="bignum"><b>{nLancar}</b><span>{nLancar === 1 ? 'aprovada espera' : 'aprovadas esperam'} o lançamento</span></div>
          <p className="muted">{nLancadas} já {nLancadas === 1 ? 'lançada' : 'lançadas'} e conferida(s) no Astrea.</p>
          <button className="btn primary" onClick={() => goTo('lancar')}>Ver o que lançar</button>
        </div>
      </div>
    </section>
  );
}

// ───────────────────────── Painel principal ─────────────────────────
type Sort = 'prazo' | 'recentes';
const DISMISS_REASONS = ['Já existe prazo no Astrea', 'Não precisa de prazo', 'Tratada fora do sistema'];

function Dashboard({ me, cfg, onLogout }: { me: Me; cfg: Cfg; onLogout: () => void }) {
  const [run, setRun] = useState<Run | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [queue, setQueue] = useState<string | null>(null);
  const [q, setQ] = useState(''); const [sort, setSort] = useState<Sort>('prazo');
  const [open, setOpen] = useState<string | null>(null);
  const [vaultOpen, setVaultOpen] = useState(false);
  const [view, setView] = useState<'pub' | 'lanc'>('pub');
  const [scope, setScope] = useState('copel');
  const [day, setDay] = useState('');
  const [dismissWhy, setDismissWhy] = useState(DISMISS_REASONS[0]!);
  const [launches, setLaunches] = useState<Launch[]>([]);
  const [toasts, setToasts] = useState<Array<{ id: number; kind: string; text: string }>>([]);
  const [now, setNow] = useState(Date.now());
  const [bl, setBl] = useState<{ running: boolean; items: Array<{ id: string; processNumber: string; status: string; note: string }> }>({ running: false, items: [] });
  const [ackAmb, setAckAmb] = useState(false);
  const h = useHealth();
  const can = (p: string) => me.permissions.includes(p);
  const notify: Notify = useCallback((m) => { const id = Date.now() + Math.random(); setToasts((t) => [...t, { id, ...m }]); setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 8000); }, []);

  const refresh = useCallback(async () => {
    const runs: Run[] = await api('/runs');
    setRun(runs[0] ?? null);
    setRows(await api('/records'));
    setLaunches(await api('/launches'));
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const active = run?.status === 'running';
  useEffect(() => { void api('/batch-launch-status').then(setBl).catch(() => {}); }, []);
  useEffect(() => {
    if (!bl.running) return;
    const t = setInterval(async () => { try { const b = await api('/batch-launch-status'); setBl(b); if (!b.running) void refresh(); } catch { /* tenta de novo */ } }, 3000);
    return () => clearInterval(t);
  }, [bl.running, refresh]);
  useEffect(() => { if (!active) return; const t = setInterval(() => { setNow(Date.now()); void refresh(); }, 1000); return () => clearInterval(t); }, [active, refresh]);

  const act = async (fn: () => Promise<any>, ok?: string) => {
    try { const r = await fn(); if (ok) notify({ kind: 'ok', text: ok }); await refresh(); return r; } catch (e) { notify({ kind: 'bad', text: (e as Error).message }); }
  };

  const rowsD = useMemo(() => (day ? rows.filter((r) => r.availabilityDate === day) : rows), [rows, day]);
  const count = (key: string) => rowsD.filter((r) => QUEUES.find((x) => x.key === key)!.states.includes(r.state)).length;
  const nDecidir = count('decidir'), nLancar = count('lancar'), nLancadas = count('lancadas');
  // Abre na fila que pede ação: primeiro "Aguardando decisão", senão "Aprovadas", senão a primeira com itens.
  useEffect(() => { if (queue === null && rows.length) setQueue(nDecidir ? 'decidir' : nLancar ? 'lancar' : QUEUES.find((x) => count(x.key) > 0)?.key ?? 'decidir'); }, [rows]); // eslint-disable-line
  const cur = QUEUES.find((x) => x.key === (queue ?? 'decidir'))!;

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = rowsD.filter((r) => cur.states.includes(r.state) && (!needle || [r.processNumber, r.clientName, r.providencia, r.responsible ?? '', r.ato ?? '', r.classe ?? ''].join(' ').toLowerCase().includes(needle)));
    const key = (r: Row) => r.ownDeadline ?? '9999-99-99';
    return [...list].sort((a, b) => (sort === 'prazo' ? key(a).localeCompare(key(b)) : b.availabilityDate.localeCompare(a.availabilityDate)));
  }, [rowsD, cur, q, sort]);

  const urg = useMemo(() => {
    const u = { late: 0, d3: 0, d7: 0 };
    for (const r of rowsD) { if (!r.ownDeadline || !['classified', 'needs_review', 'approved', 'write_failed', 'divergent'].includes(r.state)) continue; const d = daysLeft(r.ownDeadline); if (d <= 0) u.late++; else if (d <= 3) u.d3++; else if (d <= 7) u.d7++; }
    return u;
  }, [rowsD]);
  // Dias disponíveis na fila atual (mais recente primeiro), para o filtro de dia.
  const dayChips = useMemo(() => { const m = new Map<string, number>(); for (const r of rows) if (cur.states.includes(r.state)) m.set(r.availabilityDate, (m.get(r.availabilityDate) ?? 0) + 1); return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 8); }, [rows, cur]);
  const dayLabel = (d: string) => (d === todayIso() ? 'Hoje' : daysLeft(d) === -1 ? 'Ontem' : `${weekday(d)} ${fmtDate(d).slice(0, 5)}`);

  return (
    <>
      <header className="topbar">
        <div className="topbar-in">
          <div className="brand"><img src="/brand/nga-adv-branco.png" alt="NGA Advogados" /><span className="sep" /><span className="name">Prazos</span></div>
          <div className="spacer" />
          <div className="row hide-sm" style={{ gap: 8, flexWrap: 'nowrap' }}>
            <HealthPill h={h} />
            <span className={`pill ${cfg.mode === 'simulated' ? 'gold' : ''}`}>{cfg.mode === 'simulated' ? 'Dados de teste' : 'Astrea real'}</span>
            <span className={`pill ${cfg.writeEnabled ? 'gold' : ''}`} title={cfg.writeEnabled ? 'O robô lança prazos no Astrea depois da aprovação' : 'Neste modo o robô só lê; não lança nada'}>{cfg.writeEnabled ? 'Lançamento liberado' : 'Somente leitura'}</span>
            {!cfg.holidaysVerified && <span className="pill gold" title="A lista de feriados forenses ainda não foi conferida pela Controladoria: confira as datas antes de aprovar"><I n="alert" s={13} />Conferir feriados</span>}
          </div>
          {can('audit:read') && <><a className="btn ghost hide-sm" href="/api/export/records.csv" download><I n="download" s={15} />Planilha</a><a className="btn ghost hide-sm" href="/api/export/audit.csv" download><I n="download" s={15} />Auditoria</a></>}
          {can('users:manage') && cfg.mode === 'live' && <button className="btn ghost" onClick={() => setVaultOpen(true)}><I n="key" s={15} />Acesso Astrea</button>}
          <div className="userchip"><div className="who"><b>{me.username}</b><span>{me.role}</span></div><span className="avatar lg">{initials(me.username)}</span></div>
          <button className="btn ghost" onClick={onLogout} aria-label="Sair"><I n="logout" s={15} /></button>
        </div>
      </header>

      <main className="container">
        <StepsPanel run={run} active={active} canRun={can('run:start')} now={now} scopes={cfg.scopes} scope={scope} onScope={setScope} nDecidir={nDecidir} nLancar={nLancar} nLancadas={nLancadas}
          goTo={(k) => { setView('pub'); setQueue(k); }}
          onPlay={() => act(() => api('/runs', 'POST', { scope }), 'Busca iniciada')} onResume={() => run && act(() => api(`/runs/${run.id}/resume`, 'POST'), 'Continuando…')} />

        {run?.status === 'awaiting_login' && <div className="callout warn"><I n="lock" s={20} /><div><b>É preciso entrar no Astrea.</b> {run.error}</div></div>}
        {run?.status === 'completed' && run.error && <div className="callout warn"><I n="alert" s={20} /><div>{run.error}</div></div>}

        <nav className="views">
          <button className={view === 'pub' ? 'on' : ''} onClick={() => setView('pub')}>Publicações<span className="c">{rows.length}</span></button>
          <button className={view === 'lanc' ? 'on' : ''} onClick={() => setView('lanc')}>Lançamentos do robô<span className="c">{launches.length}</span></button>
        </nav>

        {view === 'lanc' && <Launches rows={launches} cfg={cfg} onOpen={(id) => { setView('pub'); setOpen(id); }} />}

        {view === 'pub' && <section className="panel">
          <div className="panel-head">
            <h3>{cur.label}</h3><span className="small">{day ? `${fmtDate(day)} · ` : ''}{shown.length} {shown.length === 1 ? 'publicação' : 'publicações'}</span>
            <div className="spacer" />
            <div className="search"><I n="search" s={16} /><input className="field" placeholder="Buscar por processo, cliente ou responsável…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
            <select className="field" style={{ width: 'auto' }} value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Ordenar">
              <option value="prazo">Vence primeiro no topo</option><option value="recentes">Mais recentes no topo</option>
            </select>
          </div>
          <div className="tabs">
            {QUEUES.map((f) => <button key={f.key} className={`tab ${cur.key === f.key ? 'on' : ''}`} onClick={() => { setQueue(f.key); setSel(new Set()); }}>{f.label}<span className="c">{count(f.key)}</span></button>)}
          </div>
          <div className="days">
            <span className="dl">Dia da publicação</span>
            <button className={`dc ${day === '' ? 'on' : ''}`} onClick={() => setDay('')}>Todos os dias</button>
            {dayChips.map(([d, n]) => <button key={d} className={`dc ${day === d ? 'on' : ''}`} onClick={() => setDay(day === d ? '' : d)}>{dayLabel(d)} · {n}</button>)}
            <input className="field" type="date" value={day} onChange={(e) => setDay(e.target.value)} aria-label="Escolher outro dia" title="Escolher outro dia" />
            {day && <button className="dc" onClick={() => setDay('')}>Limpar dia</button>}
          </div>
          <div className="hintline">{cur.hint}{cur.key === 'decidir' && (urg.late + urg.d3 + urg.d7) > 0 && <> {urg.late > 0 && <span className="tag bad">{urg.late} vencido(s) ou vencendo hoje</span>} {urg.d3 > 0 && <span className="tag warn">{urg.d3} vencem em até 3 dias</span>} {urg.d7 > 0 && <span className="tag info">{urg.d7} vencem em até 7 dias</span>}</>}</div>
          {shown.length === 0 ? (
            <div className="empty">
              <I n="inbox" s={46} />
              <h4>{rows.length ? 'Nada nesta lista' : 'Nenhuma publicação ainda'}</h4>
              <div>{rows.length ? (cur.key === 'decidir' ? 'Tudo decidido por aqui. Veja as "Aprovadas — lançar no Astrea".' : 'Quando houver publicações nesta situação, elas aparecem aqui.') : 'Clique em "Buscar publicações no Astrea" para começar.'}</div>
            </div>
          ) : (
            <table className="grid">
              <thead><tr><th style={{ width: 40 }}></th><th style={{ width: '22%' }}>Publicação</th><th>O que fazer</th><th style={{ width: 210 }}>Prazo</th><th style={{ width: 150 }}>Responsável</th><th style={{ width: 190 }}>Situação</th><th style={{ width: 150 }}></th></tr></thead>
              <tbody>
                {shown.map((r) => {
                  const u = r.ownDeadline ? urgencyOf(r.ownDeadline) : null; const st = STATUS_PLAIN[r.state] ?? { t: STATE_LABEL[r.state] ?? r.state, c: '' };
                  const cta = ['classified', 'needs_review'].includes(r.state) ? 'Revisar e decidir' : ['approved', 'write_failed', 'divergent'].includes(r.state) ? 'Lançar no Astrea' : 'Ver detalhes';
                  return (
                    <tr key={r.id} className={u && ['classified', 'needs_review', 'approved', 'write_failed'].includes(r.state) ? u.row : ''} onClick={() => setOpen(r.id)}>
                      <td onClick={(e) => e.stopPropagation()}>{['classified', 'needs_review', 'approved', 'write_failed', 'divergent'].includes(r.state) && <input type="checkbox" style={{ width: 16, height: 16, accentColor: '#F0A32E' }} checked={sel.has(r.id)} onChange={(e) => { const n = new Set(sel); if (e.target.checked) n.add(r.id); else n.delete(r.id); setSel(n); }} />}</td>
                      <td><div className="proc mono">{r.processNumber} <a className="ext" href={pubLink(cfg, r.publicationId)} target="_blank" rel="noreferrer" title="Abrir a publicação no Astrea" onClick={(e) => e.stopPropagation()}><I n="link" s={13} /></a></div><div className="cli">{r.clientName}</div><div className="cli faint">Publicada em {fmtDate(r.availabilityDate)}</div></td>
                      <td>
                        <div className="prov">{r.providencia}</div>
                        <div className="prov-sub">{[r.ato, r.classe].filter(Boolean).join(' · ') || (r.orgao ?? '')}</div>
                        <div className="tags">
                          {r.defaultDeadline && <span className="tag info">Sem prazo no texto: prazo padrão de 5 dias</span>}
                          {r.notOurs && <span className="tag">Há prazo de terceiro (não é nosso)</span>}
                          {r.astreaDivergent && <span className="tag warn">Astrea sugere {fmtDate(r.astreaDue)}</span>}
                          {r.flags.includes('texto_possivelmente_truncado') && <span className="tag">Texto cortado</span>}
                        </div>
                      </td>
                      <td>{r.canSchedule && r.prazo ? <><div className="prazo-big">{unitLabel(r.prazo.unit, r.prazo.amount)}</div><div className="venc"><span className="d">vence {fmtDate(r.ownDeadline)} ({weekday(r.ownDeadline!)})</span></div>{u && <span className={`chip-u ${u.cls}`}>{u.label}</span>}</> : <span className="faint">Nenhum prazo nosso</span>}</td>
                      <td><Resp name={r.responsible} /></td>
                      <td><span className={`sit ${st.c}`}>{st.t}</span></td>
                      <td onClick={(e) => e.stopPropagation()}><button className={`btn sm ${['Revisar e decidir', 'Lançar no Astrea'].includes(cta) ? 'primary' : ''}`} onClick={() => setOpen(r.id)}>{cta}</button></td>
                    </tr>);
                })}
              </tbody>
            </table>)}
        </section>}
      </main>

      {sel.size > 0 && (
        <div className="batchbar"><b>{sel.size}</b> selecionada(s)
          {['decidir', 'lancar'].includes(cur.key) && <button className="btn primary sm" disabled={!can('records:approve') || bl.running} onClick={() => act(async () => {
            const b = await api('/records/batch/launch', 'POST', { ids: [...sel], acknowledgeAmbiguity: ackAmb }); setSel(new Set());
            setBl(await api('/batch-launch-status'));
            notify({ kind: 'ok', text: `Lançamento em lote iniciado: ${b.total} publicação(ões), uma por vez (1 a 2 min cada). Acompanhe no painel.` });
          })}>{cur.key === 'decidir' ? 'Aprovar e lançar no Astrea' : 'Lançar no Astrea'}</button>}
          {cur.key === 'decidir' && <label className="small" style={{ display: 'flex', gap: 5, alignItems: 'center' }}><input type="checkbox" checked={ackAmb} onChange={(e) => setAckAmb(e.target.checked)} />Confirmo os alertas das que têm ambiguidade</label>}
          {cur.key === 'decidir' && <button className="btn gold sm" disabled={!can('records:approve')} onClick={() => act(async () => {
            const r = await api('/records/batch/approve', 'POST', { ids: [...sel] }); setSel(new Set());
            notify({ kind: r.skipped.length ? 'warn' : 'ok', text: `${r.approved.length} aprovada(s); ${r.skipped.length} precisam ser abertas e aprovadas uma a uma` });
          })}>Aprovar as selecionadas</button>}
          <select className="field" style={{ width: 'auto', height: 30, padding: '0 8px' }} value={dismissWhy} onChange={(e) => setDismissWhy(e.target.value)} aria-label="Motivo">
            {DISMISS_REASONS.map((x) => <option key={x}>{x}</option>)}</select>
          <button className="btn sm" disabled={!can('records:approve')} onClick={() => act(async () => {
            const r = await api('/records/batch/reject', 'POST', { ids: [...sel], reason: dismissWhy }); setSel(new Set());
            notify({ kind: r.skipped.length ? 'warn' : 'ok', text: `${r.rejected.length} dispensada(s) — não aparecem mais para lançar${r.skipped.length ? `; ${r.skipped.length} não puderam ser dispensadas` : ''}` });
          })}>Dispensar as selecionadas</button>
          <button className="btn ghost sm" onClick={() => setSel(new Set())}>Limpar</button></div>)}

      {bl.items.length > 0 && (() => {
        const done = bl.items.filter((i) => ['done', 'failed', 'skipped'].includes(i.status)).length;
        return <div className="batchbar" style={{ bottom: sel.size ? 64 : 16, flexDirection: 'column', alignItems: 'stretch', maxWidth: 560, maxHeight: '45vh', overflow: 'auto' }}>
          <div className="row"><b>{bl.running ? `Lançando… ${done} de ${bl.items.length}` : `Lote finalizado: ${bl.items.filter((i) => i.status === 'done').length} lançada(s), ${bl.items.filter((i) => i.status === 'failed').length} com erro, ${bl.items.filter((i) => i.status === 'skipped').length} puladas`}</b><div className="spacer" />
            {!bl.running && <button className="btn ghost sm" onClick={() => setBl({ running: false, items: [] })}>Fechar</button>}</div>
          {bl.items.map((i) => <div key={i.id} className="small"><span className="mono">{i.processNumber}</span> — {({ waiting: 'aguardando', running: 'lançando…', done: 'lançada ✓', failed: 'ERRO', skipped: 'pulada' } as Record<string, string>)[i.status]}{i.note ? ` · ${i.note}` : ''}</div>)}
        </div>;
      })()}

      <div className="toasts">{toasts.map((t) => <div key={t.id} className={`toast ${t.kind}`} onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}>{t.text}</div>)}</div>
      {vaultOpen && <VaultModal onClose={() => setVaultOpen(false)} notify={notify} />}
      {open && <Detail row={rows.find((r) => r.id === open)!} me={me} cfg={cfg} onClose={() => setOpen(null)} onChange={refresh} notify={notify} />}
    </>
  );
}

type Launch = { kind?: string; priority?: string | null; key: string; recordId: string; publicationId: string | null; processNumber: string; clientName: string; title: string; dueDate: string | null; responsible: string | null; status: string; adopted: boolean; error: string | null; updatedAt: string; approvedBy: string | null; auditedBy: string | null; recordState: string | null; link: string | null };
const LAUNCH_STATUS: Record<string, [string, string]> = {
  confirmed: ['Confirmado por releitura no Astrea', 'ok'], divergent: ['Divergente — conferir no Astrea', 'bad'],
  failed: ['Não confirmado — conferir no Astrea antes de repetir', 'warn'], pending: ['Em andamento', ''],
};
function Launches({ rows, cfg, onOpen }: { rows: Launch[]; cfg: Cfg; onOpen: (recordId: string) => void }) {
  const n = (s: string) => rows.filter((r) => r.status === s).length;
  return (
    <section className="panel">
      <div className="panel-head"><h3>Lançamentos do robô</h3><span className="small">tudo o que o robô gravou, ou tentou gravar, no Astrea nesta sessão</span></div>
      <div className="urgency">
        <span className="tag ok">{n('confirmed')} confirmado(s)</span>
        {n('failed') > 0 && <span className="tag warn">{n('failed')} sem confirmação</span>}
        {n('divergent') > 0 && <span className="tag bad">{n('divergent')} divergente(s)</span>}
      </div>
      {rows.length === 0 ? (
        <div className="empty"><I n="inbox" s={40} /><h4>Nenhum lançamento ainda</h4><div>Quando uma publicação aprovada for gravada no Astrea, ela aparece aqui com o link para conferir.</div></div>
      ) : (
        <table className="grid">
          <thead><tr><th style={{ width: 150 }}>Lançado em</th><th>Processo e prazo lançado</th><th style={{ width: 130 }}>Vencimento</th><th style={{ width: 150 }}>Responsável</th><th style={{ width: 230 }}>Situação no Astrea</th><th style={{ width: 150 }}>Aprovação / auditoria</th><th style={{ width: 150 }}></th></tr></thead>
          <tbody>
            {rows.map((l) => { const [txt, cls] = LAUNCH_STATUS[l.status] ?? [l.status, '']; return (
              <tr key={l.key} onClick={() => onOpen(l.recordId)}>
                <td className="small">{new Date(l.updatedAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</td>
                <td><div className="proc mono">{l.processNumber}</div><div className="prov" style={{ marginTop: 3 }}>{l.kind === 'task' && <span className="tag info" style={{ marginRight: 8, verticalAlign: 'middle' }}>Tarefa</span>}{l.kind === 'workflow' && <span className="tag info" style={{ marginRight: 8, verticalAlign: 'middle' }}>Workflow</span>}{l.title}</div><div className="cli">{l.clientName}{l.publicationId ? ` · publicação ${l.publicationId}` : ''}</div></td>
                <td>{l.dueDate ? <><b>{fmtDate(l.dueDate)}</b><div className="cli">{weekday(l.dueDate)}</div></> : '—'}</td>
                <td><Resp name={l.responsible} /></td>
                <td><span className={`tag ${cls}`}>{txt}</span>{l.adopted && <div className="cli">Já existia no Astrea (adotado, não duplicado)</div>}{l.error && l.status !== 'confirmed' && <div className="cli">{l.error.slice(0, 120)}</div>}</td>
                <td className="small">{l.approvedBy ? `Aprovado por ${l.approvedBy}` : '—'}<br />{l.auditedBy ? `Auditado por ${l.auditedBy}` : 'Auditoria pendente'}</td>
                <td onClick={(e) => e.stopPropagation()}>{l.link && <a className="btn sm" href={l.link} target="_blank" rel="noreferrer"><I n="link" s={13} />Abrir no Astrea</a>}</td>
              </tr>); })}
          </tbody>
        </table>)}
    </section>
  );
}

function Resp({ name }: { name: string | null }) {
  return name ? <div className="resp"><span className="avatar">{initials(name)}</span><div><b style={{ fontSize: 13 }}>{name}</b></div></div>
    : <div className="resp"><span className="avatar none">?</span><span className="tag warn">Não definido</span></div>;
}

function Prazo({ r, u }: { r: Row; u: ReturnType<typeof urgencyOf> }) {
  if (r.providenciaKind === 'audiencia' && r.eventAt) return <><div className="prazo-big">Audiência</div><div className="venc"><span className="d">{fmtDate(r.eventAt)}{r.eventAt.includes('T') ? ` · ${r.eventAt.slice(11)}` : ''}</span></div></>;
  if (!r.prazo) return <div className="prazo-sub">Sem prazo identificado</div>;
  const p = r.prazo; const corr = p.unit === 'dias_corridos';
  return (
    <>
      <div className="prazo-big">{unitLabel(p.unit, p.amount)}</div>
      {!corr && p.calendarDays != null && <div className="prazo-sub">= {p.calendarDays} dias corridos de contagem</div>}
      {p.endTerm
        ? <div className="venc"><span className="d">{fmtDate(p.endTerm)} <span className="faint">({weekday(p.endTerm)})</span></span>{u && !r.notOurs && <span className={`chip-u ${u.cls}`}>{u.label}</span>}</div>
        : <div className="prazo-sub">Vencimento não calculado</div>}
      {r.notOurs && <div className="prazo-sub" style={{ color: 'var(--bad)' }}>dirigido a terceiro</div>}
    </>
  );
}

// ───────────────────────── Acesso ao Astrea ─────────────────────────
function VaultModal({ onClose, notify }: { onClose: () => void; notify: Notify }) {
  const [st, setSt] = useState<{ configured: boolean; email: string | null; error?: string } | null>(null);
  const [email, setEmail] = useState(''); const [pw, setPw] = useState('');
  useEffect(() => { void api('/vault/astrea').then(setSt).catch((e) => notify({ kind: 'bad', text: (e as Error).message })); }, [notify]);
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" style={{ width: 'min(520px, 100%)' }}>
        <div className="drawer-head"><div className="row"><h2>Acesso ao Astrea</h2><div className="spacer" /><button className="btn ghost sm" onClick={onClose}><I n="x" s={15} /></button></div>
          <div className="cli">Login automático criptografado</div></div>
        <div className="drawer-body">
          <div className={`callout ${st?.configured ? 'ok' : 'warn'}`}><I n={st?.configured ? 'shield' : 'lock'} s={20} /><div>{st ? (st.configured ? <>Acesso configurado: <b>{st.email ?? '—'}</b></> : <b>Nenhum acesso salvo</b>) : 'Carregando…'}{st?.error ? ` — ${st.error}` : ''}</div></div>
          <div className="muted" style={{ fontSize: 13 }}>As credenciais ficam <b>criptografadas</b> (AES-256-GCM) neste computador, com a chave no Keychain, e só são usadas para o login automático quando você aperta Play. Se o Astrea pedir verificação (MFA/CAPTCHA), o robô <b>para</b> e pede o login manual. Recomenda-se um usuário próprio do robô.</div>
          <form style={{ display: 'grid', gap: 10 }} autoComplete="off" onSubmit={async (e) => {
            e.preventDefault();
            try { setSt(await api('/vault/astrea', 'PUT', { email, password: pw })); setPw(''); setEmail(''); notify({ kind: 'ok', text: 'Acesso salvo (criptografado)' }); } catch (x) { notify({ kind: 'bad', text: (x as Error).message }); }
          }}>
            <input className="field" placeholder="E-mail do Astrea" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
            <input className="field" placeholder="Senha do Astrea" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
            <div className="row"><button className="btn primary" disabled={!email || pw.length < 6}>Salvar criptografado</button>
              <button type="button" className="btn danger" disabled={!st?.configured} onClick={async () => { setSt(await api('/vault/astrea', 'DELETE')); notify({ kind: 'ok', text: 'Acesso removido' }); }}>Remover</button></div>
          </form>
        </div>
      </aside>
    </>
  );
}

// ───────────────────────── Detalhes ─────────────────────────
function Highlighted({ text, ev }: { text: string; ev: Array<{ start: number; end: number }> }) {
  const sorted = [...ev].sort((a, b) => a.start - b.start);
  const out: React.ReactNode[] = []; let at = 0;
  sorted.forEach((e, i) => { if (e.start < at) return; out.push(text.slice(at, e.start), <mark key={i}>{text.slice(e.start, e.end)}</mark>); at = e.end; });
  out.push(text.slice(at));
  return <div className="pubtext">{out.map((n, i) => <Fragment key={i}>{n}</Fragment>)}</div>;
}

function Detail({ row, me, cfg, onClose, onChange, notify }: { row: Row; me: Me; cfg: Cfg; onClose: () => void; onChange: () => Promise<void>; notify: Notify }) {
  const id = row.id;
  const [d, setD] = useState<any>(null);
  const [tab, setTab] = useState<'decisao' | 'resumo' | 'texto' | 'acoes' | 'auditoria'>('decisao');
  const [rejecting, setRejecting] = useState(false); const [dismissWhy2, setDismissWhy2] = useState(DISMISS_REASONS[0]!);
  const [editOpen, setEditOpen] = useState(false); const [ef, setEf] = useState<{ title: string; notes: string; amount: number; unit: string } | null>(null);
  const [comment, setComment] = useState(''); const [reason, setReason] = useState(''); const [ack, setAck] = useState(false);
  const [corr, setCorr] = useState({ actionId: '', field: 'dueDate', expectedValue: '', justification: '', authorize: false });
  const [dry, setDry] = useState<any>(null); const [dryBusy, setDryBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const can = (p: string) => me.permissions.includes(p);
  const load = useCallback(async () => setD(await api(`/records/${id}`)), [id]);
  useEffect(() => { void load(); }, [load]);
  if (!row || !d) return null;
  const r = d.record; const evid = r.analysis.actions.flatMap((a: any) => a.evidence);
  const run = async (fn: () => Promise<any>, ok: string) => { if (busy) return; setBusy(true); try { const x = await fn(); notify({ kind: 'ok', text: ok }); await load(); await onChange(); return x; } catch (e) { notify({ kind: 'bad', text: (e as Error).message }); await load().catch(() => {}); await onChange().catch(() => {}); } finally { setBusy(false); } };
  const written = d.writeOps.filter((o: any) => o.astreaId);
  const p = row.prazo; const own = row.ownDeadline; const u = own ? urgencyOf(own) : null;
  const tabs: Array<[typeof tab, string]> = [['decisao', 'O que fazer'], ['resumo', 'Detalhes do prazo'], ['texto', 'Texto da publicação'], ['acoes', 'Mais opções'], ['auditoria', 'Histórico']];

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer">
        <div className="drawer-head">
          <div className="row"><h2 className="mono" style={{ fontSize: 19 }}>{r.processNumber}</h2><span className={`state ${r.state}`}>{(STATUS_PLAIN[r.state] ?? { t: STATE_LABEL[r.state] }).t}</span><div className="spacer" /><a className="btn ghost sm" href={pubLink(cfg, r.externalId)} target="_blank" rel="noreferrer"><I n="link" s={14} />Abrir no Astrea</a><button className="btn ghost sm" onClick={onClose} aria-label="Fechar"><I n="x" s={15} /></button></div>
          <div className="cli" style={{ marginTop: 4 }}>{r.clientName} · disponibilizada em {fmtDate(r.availabilityDate)}{row.orgao ? ` · ${row.orgao}` : ''}</div>
        </div>
        <div className="dtabs">{tabs.map(([k, l]) => <button key={k} className={`dtab ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>{l}</button>)}</div>

        <div className="drawer-body">
          {tab === 'decisao' && (() => {
            const closed = ['rejected'].includes(r.state);
            const decided = ['approved', 'write_failed', 'divergent', 'write_queued'].includes(r.state);
            const done = ['confirmed', 'audited', 'revalidation_pending', 'correction_requested', 'correction_authorized'].includes(r.state);
            const pend = ['classified', 'needs_review', 'no_action'].includes(r.state);
            const stepN = done ? 4 : decided ? 3 : closed ? 0 : 2;
            const reasons: string[] = row.ambiguityReasons ?? [];
            const flags: string[] = r.analysis.flags.filter((f: string) => !['responsavel_nao_definido'].includes(f) || !row.responsible);
            const needAck = r.state === 'needs_review';
            const launch = () => run(async () => {
              if (can('write:authorize')) await api('/write-authorizations', 'POST', { processNumbers: [r.processNumber], expiresAt: new Date(Date.now() + 2 * 3600_000).toISOString(), note: 'Escrita autorizada pelo administrador (2 h)' });
              const out = await api(`/records/${id}/write`, 'POST');
              if (!out.confirmedInAstrea) throw new Error(`O prazo NÃO foi confirmado no Astrea. ${out.items?.[0]?.note ?? 'Veja os detalhes.'}`);
              if (out.tasks?.length) notify({ kind: out.treated === false ? 'warn' : 'ok', text: out.tasks.join(' ') });
              if (out.treatedNote) notify({ kind: out.treated ? 'ok' : 'warn', text: out.treatedNote });
            }, 'Prazo lançado e conferido no Astrea');
            return <>
              <ol className="flow">
                {['Conferir a sugestão', 'Aprovar', 'Lançar no Astrea'].map((t, i) => <li key={t} className={closed ? '' : stepN > i + 1 ? 'done' : stepN === i + 1 || (i === 0 && stepN === 2) ? 'now' : ''}><span>{stepN > i + 1 && !closed ? <I n="check" s={13} /> : i + 1}</span>{t}</li>)}
              </ol>

              <div className="sug">
                <div className="sug-k">O que o robô sugere</div>
                {row.canSchedule && row.prazo && row.ownDeadline
                  ? <div className="sug-v">Criar no Astrea o prazo <b>“{row.providencia}”</b> para <b>{weekday(row.ownDeadline)}, {fmtDate(row.ownDeadline)}</b> <span className="faint">({u?.label ?? ''})</span>, responsável <b>{row.responsible ?? 'não definido'}</b>.
                    <div className="small" style={{ marginTop: 6 }}>{unitLabel(row.prazo.unit, row.prazo.amount)}, contados a partir de {fmtDate(row.prazo.startTerm)}.{row.defaultDeadline ? ' A publicação não traz prazo: foi aplicado o prazo padrão de 5 dias.' : ''}</div></div>
                  : <div className="sug-v">Nenhum prazo <b>nosso</b> nesta publicação{row.notOurs ? ' — o prazo existente é de outra parte (terceiro)' : ''}. O robô não lançaria nada.</div>}
              </div>

              {row.launch && !done && !closed && can('records:approve') && (
                <div className="sec"><div className="in">
                  {!editOpen ? (
                    <div className="row"><button className="btn" onClick={() => { setEf({ title: row.launch!.title, notes: row.launch!.notes, amount: row.launch!.amount, unit: row.launch!.unit === 'dias_uteis' ? 'dias_uteis' : 'dias_corridos' }); setEditOpen(true); }}><I n="file" s={15} />Editar prazo e texto antes de lançar</button>
                      {row.launch.edited && <span className="tag info">Já editado por uma pessoa</span>}</div>
                  ) : ef && (
                    <>
                      <label className="fld">Título do prazo (é assim que aparece no Astrea)<input className="field" maxLength={110} value={ef.title} onChange={(e) => setEf({ ...ef, title: e.target.value })} /></label>
                      <div className="row">
                        <label className="fld" style={{ width: 130 }}>Prazo (dias)<input className="field" type="number" min={1} max={365} value={ef.amount} onChange={(e) => setEf({ ...ef, amount: Number(e.target.value) })} /></label>
                        <label className="fld" style={{ width: 190 }}>Contagem<select className="field" value={ef.unit} onChange={(e) => setEf({ ...ef, unit: e.target.value })}><option value="dias_corridos">dias corridos</option><option value="dias_uteis">dias úteis</option></select></label>
                        <span className="small" style={{ flex: 1 }}>O vencimento é recalculado ao salvar (a contagem começa em {row.prazo ? fmtDate(row.prazo.startTerm) : '—'}). Se cair em dia não útil, em dias corridos, é antecipado para o dia útil anterior.</span>
                      </div>
                      <label className="fld">Texto do prazo (campo Observações no Astrea)<textarea className="field" rows={7} value={ef.notes} onChange={(e) => setEf({ ...ef, notes: e.target.value })} /></label>
                      <div className="row">
                        <button className="btn primary" disabled={busy || ef.title.trim().length < 3 || ef.notes.trim().length < 3 || !(ef.amount >= 1)} onClick={() => {
                          const l = row.launch!; const body: Record<string, unknown> = {};
                          if (ef.title.trim() !== l.title) body.title = ef.title.trim();
                          if (ef.notes.trim() !== l.notes) body.notes = ef.notes.trim();
                          if (ef.amount !== l.amount) body.amount = ef.amount;
                          if (ef.unit !== l.unit) body.unit = ef.unit;
                          if (!Object.keys(body).length) { setEditOpen(false); return; }
                          void run(() => api(`/records/${id}/edit`, 'PUT', body), decided ? 'Alterações salvas. Aprove de novo para liberar o lançamento.' : 'Alterações salvas.').then(() => setEditOpen(false));
                        }}>Salvar alterações</button>
                        <button className="btn" onClick={() => setEditOpen(false)}>Cancelar</button>
                      </div>
                      {decided && <div className="small">Esta publicação já estava aprovada: depois de salvar, será preciso aprovar de novo.</div>}
                    </>)}
                </div></div>)}

              {(reasons.length > 0 || flags.length > 0) && !closed && !done && (
                <div className="callout warn"><I n="alert" s={20} /><div><b>Antes de decidir, confira:</b>
                  <ul className="alerts">{reasons.map((x) => <li key={x}>{x}</li>)}{flags.filter((f: string) => FLAG_LABEL[f] && !reasons.some((x) => x.includes('padrão de 5'))).map((f: string) => <li key={f}>{FLAG_LABEL[f]}</li>)}</ul></div></div>)}

              {pend && !row.canSchedule && can('records:approve') && (
                <div className="sec"><div className="in">
                  <div><b>Quer agendar mesmo assim?</b> <span className="muted">Se a equipe precisa acompanhar esta publicação, o robô agenda o prazo padrão de <b>5 dias corridos</b>.</span></div>
                  <div><button className="btn primary" disabled={busy} onClick={() => run(() => api(`/records/${id}/default-deadline`, 'POST'), 'Prazo padrão de 5 dias incluído. Agora é só aprovar.')}>Agendar prazo padrão de 5 dias</button></div>
                </div></div>)}

              {pend && row.canSchedule && (
                <div className="sec"><div className="in">
                  {needAck && <label className="check bigcheck"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />Conferi os alertas acima e a sugestão está correta</label>}
                  <div className="row">
                    <button className="btn primary big" disabled={busy || !can('records:approve') || (needAck && !ack)} onClick={() => run(() => api(`/records/${id}/approve`, 'POST', { acknowledgeAmbiguity: ack }), 'Aprovada! Agora clique em "Lançar no Astrea".')}><I n="check" s={18} />Aprovar sugestão</button>
                    <button className="btn big" disabled={busy || !can('records:approve')} onClick={() => setRejecting(true)}>Rejeitar</button>
                  </div>
                  {needAck && !ack && <div className="small">Para liberar o botão, marque “Conferi os alertas”.</div>}
                  {rejecting && <div className="row"><input className="field" style={{ flex: 1, minWidth: 220 }} placeholder="Por que está rejeitando? (mín. 5 letras)" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
                    <button className="btn danger" disabled={busy || reason.trim().length < 5} onClick={() => run(() => api(`/records/${id}/reject`, 'POST', { reason }), 'Publicação rejeitada')}>Confirmar rejeição</button></div>}
                </div></div>)}

              {pend && !row.canSchedule && !row.defaultDeadline && can('records:approve') && (
                <div className="row"><button className="btn" disabled={busy} onClick={() => setRejecting(true)}>Encerrar sem agendar</button>
                  {rejecting && <><input className="field" style={{ flex: 1, minWidth: 220 }} placeholder="Motivo (mín. 5 letras)" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /><button className="btn danger" disabled={busy || reason.trim().length < 5} onClick={() => run(() => api(`/records/${id}/reject`, 'POST', { reason }), 'Publicação encerrada')}>Confirmar</button></>}</div>)}

              {decided && (
                <div className="sec"><div className="in">
                  <div><b>Aprovada.</b> Falta lançar o prazo no Astrea. O robô cria o prazo, confere lendo de volta e deixa a publicação como tratada.</div>
                  {r.state === 'write_failed' && <div className="callout bad"><I n="alert" s={18} /><div>A última tentativa não deu certo. Se o prazo já existir no Astrea, não lance de novo: abra a publicação no Astrea e confira.</div></div>}
                  {cfg.writeEnabled && can('write:execute')
                    ? <div className="row"><button className="btn gold big" disabled={busy || dryBusy} onClick={launch}>{busy ? <><I n="spinner" s={18} cls="spin" />Lançando… aguarde 1 a 2 minutos</> : <><I n="bolt" s={18} />Lançar no Astrea</>}</button>{busy && <span className="small">Não feche nem clique de novo.</span>}</div>
                    : <div className="small">{cfg.writeEnabled ? 'Só administradores lançam no Astrea. Peça a um administrador.' : 'Neste modo o sistema só lê; o lançamento está desligado.'}</div>}
                </div></div>)}

              {done && <div className="callout ok"><I n="check" s={20} /><div><b>Prazo lançado e conferido no Astrea.</b> <a href={pubLink(cfg, r.externalId)} target="_blank" rel="noreferrer">Abrir a publicação no Astrea</a>{can('records:audit') && r.state !== 'audited' && <div style={{ marginTop: 8 }}><button className="btn sm" disabled={busy} onClick={() => run(() => api(`/records/${id}/audited`, 'POST'), 'Auditoria registrada')}><I n="shield" s={14} />Marcar auditoria feita</button></div>}</div></div>}
              {(pend || decided) && r.state !== 'write_queued' && can('records:approve') && (
                <div className="sec"><div className="in">
                  <div><b>Já tem prazo no Astrea ou não precisa lançar?</b> <span className="muted">Dispense esta publicação: ela sai da lista de pendentes e nada é lançado.</span></div>
                  <div className="row"><select className="field" style={{ width: 'auto' }} value={dismissWhy2} onChange={(e) => setDismissWhy2(e.target.value)}>{DISMISS_REASONS.map((x) => <option key={x}>{x}</option>)}</select>
                    <button className="btn" disabled={busy} onClick={() => run(() => api(`/records/${id}/reject`, 'POST', { reason: dismissWhy2 }), 'Publicação dispensada: não aparece mais como pendente')}>Dispensar esta publicação</button></div>
                </div></div>)}
              {closed && <div className="callout"><div><b>Esta publicação foi encerrada.</b> Ou foi rejeitada, ou já foi tratada por outra pessoa no Astrea. Nada será lançado.</div></div>}
            </>;
          })()}

          {tab === 'resumo' && <>
            <div className="facts">
              <div className="fact hi"><div className="k"><I n="scale" s={14} />Providência indicada</div><div className="v">{row.providencia}</div><div className="s">{[row.ato, row.classe].filter(Boolean).join(' · ') || '—'}</div></div>
              <div className="fact"><div className="k"><I n="clock" s={14} />Prazo</div><div className="v">{p ? unitLabel(p.unit, p.amount) : 'Sem prazo'}</div><div className="s">{p && p.unit !== 'dias_corridos' && p.calendarDays != null ? `= ${p.calendarDays} dias corridos de contagem` : p ? `Início da contagem ${fmtDate(p.startTerm)}` : '—'}</div></div>
              <div className="fact"><div className="k"><I n="cal" s={14} />Vencimento</div><div className="v">{own ? <>{fmtDate(own)} <span className="faint" style={{ fontWeight: 600, fontSize: 13 }}>({weekday(own)})</span></> : row.notOurs ? 'Prazo de terceiro' : '—'}</div><div className="s">{u ? u.label : row.notOurs ? 'Não é prazo do cliente' : '—'}</div></div>
              <div className="fact"><div className="k"><I n="user" s={14} />Responsável</div><div className="v" style={{ display: 'flex', alignItems: 'center', gap: 9 }}>{row.responsible ? <><span className="avatar lg">{initials(row.responsible)}</span><span style={{ fontSize: 15 }}>{row.responsible}</span></> : <span style={{ color: 'var(--warn)' }}>Não definido</span>}</div></div>
            </div>

            {(row.astreaDue || row.astreaDivergent) && (
              <div className="sec"><h4><I n="shield" s={14} />Conferência com a sugestão do Astrea</h4><div className="in">
                <div className="cmp">
                  <div><div className="small">Cálculo do robô</div><div className="big">{fmtDate(own)}</div><div className="small">{p ? unitLabel(p.unit, p.amount) : ''}</div></div>
                  <div className={row.astreaDivergent ? 'bad' : ''}><div className="small">Sugestão do Astrea (IA)</div><div className="big">{fmtDate(row.astreaDue)}</div>
                    <div className="small">{own && row.astreaDue ? (() => { const dd = Math.round((Date.parse(row.astreaDue) - Date.parse(own)) / 86_400_000); return dd === 0 ? 'Mesma data' : `${Math.abs(dd)} dia(s) ${dd > 0 ? 'depois' : 'antes'} do robô`; })() : ''}</div></div>
                </div>
                {row.astreaDivergent && <div className="callout warn"><I n="alert" s={18} /><div>As datas divergem. O Astrea costuma contar em <b>dias úteis</b>; a regra do escritório para prazos sem modalidade no texto é <b>dias corridos</b>. Confirme antes de aprovar.</div></div>}
              </div></div>)}

            {r.analysis.flags.length > 0 && <div className="row">{r.analysis.flags.map((f: string) => <span key={f} className="tag warn"><I n="alert" s={12} />{FLAG_LABEL[f] ?? f}</span>)}</div>}

            <div className="sec"><h4><I n="file" s={14} />Providências detectadas ({r.analysis.actions.length})</h4><div className="in">
              {r.analysis.actions.map((a: any) => (
                <div key={a.id} className={`action ${a.ambiguous ? 'amb' : ''}`}>
                  <div className="row"><b style={{ fontSize: 15 }}>{a.description}</b>{a.notOurs && <span className="tag bad">Terceiro · não agendar</span>}<div className="spacer" /><span className="small">Confiança {Math.round(a.confidence * 100)}%</span></div>
                  <dl className="kv" style={{ marginTop: 10 }}>
                    {a.deadline && <><dt>Prazo</dt><dd>{unitLabel(a.deadline.unit, a.deadline.amount)}</dd><dt>Início da contagem</dt><dd className="mono">{fmtDate(a.deadline.startTerm)}</dd><dt>Vencimento</dt><dd className="mono">{a.deadline.endTerm ? fmtDate(a.deadline.endTerm) : 'não calculado'}</dd><dt>Fundamento</dt><dd>{a.deadline.basis}</dd></>}
                    {a.eventAt && <><dt>Data e hora</dt><dd className="mono">{a.eventAt.replace('T', ' ')}</dd></>}
                    <dt>Responsável</dt><dd>{a.responsible ?? <span className="tag warn">Não definido</span>}</dd>
                    <dt>Evidência no texto</dt><dd>{a.evidence.map((e: any) => `“${e.quote}”`).join('; ') || '—'}</dd>
                  </dl>
                  {a.ambiguityReasons.map((x: string) => <div key={x} className="callout warn" style={{ marginTop: 8 }}><I n="alert" s={16} /><div>{x}</div></div>)}
                </div>))}
            </div></div>
          </>}

          {tab === 'texto' && <div className="sec"><h4><I n="file" s={14} />Texto integral · evidências em destaque</h4><Highlighted text={r.fullText} ev={evid} /></div>}

          {tab === 'acoes' && <>
            {can('write:execute') && (
              <div className="sec"><h4><I n="eye" s={14} />Ensaio no Astrea</h4><div className="in">
                {row.canSchedule && <div className="row">
                  <button className="btn" disabled={dryBusy || busy} onClick={async () => { setDryBusy(true); setDry(null); try { setDry(await api(`/records/${id}/dry-run`, 'POST')); } catch (e) { notify({ kind: 'bad', text: (e as Error).message }); } finally { setDryBusy(false); } }}><I n="eye" s={16} />{dryBusy ? 'Ensaiando no Astrea…' : 'Ensaio no Astrea (não grava)'}</button>
                  <span className="small">Preenche o formulário, confere a data calculada e cancela.</span></div>}
                {dry && (
                  <div className={`callout ${dry.ok && dry.matches && dry.writeAttempts === 0 ? 'ok' : 'warn'}`}><I n={dry.ok && dry.matches ? 'check' : 'alert'} s={20} /><div>
                    <b>{dry.ok ? (dry.matches ? 'A data confere com a calculadora do Astrea' : 'A DATA DIVERGE da calculadora do Astrea — não gravar') : `Ensaio falhou: ${dry.reason}`}</b>
                    <div className="small" style={{ marginTop: 4 }}>Astrea: limite {fmtDate(dry.astrea.dueDate)} · Robô: {fmtDate(dry.expectedDueDate)} · formulário cancelado: {dry.cancelled ? 'sim' : 'NÃO'} · tentativas de escrita: {dry.writeAttempts}</div>
                    <div className="small">Título que seria usado: “{dry.title}”</div>
                    <div className="small">Kanban: {dry.kanban.boards.map((b: string) => `${b} [${(dry.kanban.columns[b] ?? []).join(' / ')}]`).join(' · ') || '—'}</div>
                  </div></div>)}
                {!cfg.writeEnabled && <div className="small">A escrita está <b>desligada</b> neste modo de execução.</div>}
              </div></div>)}

            {written.length > 0 && <div className="sec"><h4><I n="cal" s={14} />Agendamentos no Astrea</h4><div className="in">
              {written.map((o: any) => <div key={o.key} className="action"><div className="row"><b className="mono">{o.astreaId}</b><span className={`state ${o.status === 'confirmed' ? 'confirmed' : 'divergent'}`}>{o.status === 'confirmed' ? 'Confirmado por releitura' : o.status}</span>{o.adopted && <span className="tag">adotado (já existia)</span>}</div>
                <div className="small" style={{ marginTop: 6 }}>{o.evidence.map((e: any) => e.step).join(' → ')}</div>{o.error && <div className="callout bad" style={{ marginTop: 8 }}><div>{o.error}</div></div>}</div>)}
              <div className="small" style={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em' }}>Solicitar correção</div>
              <div className="row"><select className="field" style={{ flex: 1 }} value={corr.actionId} onChange={(e) => setCorr({ ...corr, actionId: e.target.value })}><option value="">Providência…</option>{written.map((o: any) => <option key={o.actionId} value={o.actionId}>{o.astreaId}</option>)}</select>
                <select className="field" style={{ flex: 1 }} value={corr.field} onChange={(e) => setCorr({ ...corr, field: e.target.value })}><option value="dueDate">Data de vencimento</option><option value="title">Título</option><option value="responsible">Responsável</option><option value="description">Descrição</option></select></div>
              <input className="field" placeholder={corr.field === 'dueDate' ? 'Valor esperado (AAAA-MM-DD)' : 'Valor esperado'} value={corr.expectedValue} onChange={(e) => setCorr({ ...corr, expectedValue: e.target.value })} />
              <textarea className="field" placeholder="Justificativa (obrigatória)" value={corr.justification} onChange={(e) => setCorr({ ...corr, justification: e.target.value })} />
              <label className="check"><input type="checkbox" checked={corr.authorize} disabled={!can('correction:authorize')} onChange={(e) => setCorr({ ...corr, authorize: e.target.checked })} />Autorizo o robô a editar SOMENTE este campo neste agendamento</label>
              <div><button className="btn" disabled={!can('correction:request') || !corr.actionId || !corr.expectedValue || corr.justification.length < 10} onClick={() => run(() => api(`/records/${id}/corrections`, 'POST', corr), 'Correção registrada')}>Solicitar correção</button></div>
            </div></div>}

            {d.corrections.length > 0 && <div className="sec"><h4>Correções</h4><div className="in">{d.corrections.map((c: any) => <div key={c.id} className="action"><div className="row"><b>{c.field} → {c.expectedValue}</b><span className="tag">{c.status}</span><div className="spacer" />
              {c.status === 'requested' && <button className="btn sm" disabled={!can('correction:authorize')} onClick={() => run(() => api(`/corrections/${c.id}/authorize`, 'POST'), 'Correção autorizada')}>Autorizar</button>}
              {c.status === 'authorized' && <button className="btn primary sm" disabled={!can('write:execute') || !cfg.writeEnabled} onClick={() => run(() => api(`/corrections/${c.id}/apply`, 'POST'), 'Correção aplicada e relida')}>Aplicar</button>}</div>
              <div className="small" style={{ marginTop: 6 }}>{c.justification} — por {c.requestedBy}{c.authorizedBy ? `, autorizada por ${c.authorizedBy}` : ''}</div></div>)}</div></div>}

            <div className="sec"><h4>Comentários ({d.comments.length})</h4><div className="in">
              {d.comments.map((c: any) => <div key={c.id} className="action"><div className="small"><b style={{ color: 'var(--text)' }}>{c.author}</b> · {new Date(c.createdAt).toLocaleString('pt-BR')}</div><div style={{ marginTop: 4 }}>{c.text}</div></div>)}
              <textarea className="field" placeholder="Comentário ou instrução de correção" value={comment} onChange={(e) => setComment(e.target.value)} />
              <div><button className="btn" disabled={!can('records:comment') || !comment.trim()} onClick={async () => { await run(() => api(`/records/${id}/comments`, 'POST', { text: comment }), 'Comentário salvo'); setComment(''); }}>Comentar</button></div>
            </div></div>
          </>}

          {tab === 'auditoria' && <div className="sec"><h4><I n="shield" s={14} />Trilha de auditoria (imutável, encadeada por hash)</h4><div className="in"><div className="timeline">
            {d.audit.map((a: any) => <div key={a.seq} className="tl"><span className="b" /><div><div className="t">{a.action}</div><div className="m"><b>{a.actor}</b> · {new Date(a.ts).toLocaleString('pt-BR')} · <span className="mono">#{a.seq} {a.hash.slice(0, 10)}</span></div></div></div>)}
          </div></div></div>}
        </div>
      </aside>
    </>
  );
}
