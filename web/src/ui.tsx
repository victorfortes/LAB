import { useEffect, useState } from 'react';

const P: Record<string, string> = {
  play: '<polygon points="7 4 20 12 7 20 7 4" fill="currentColor"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  alert: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M10.8 12.2 20 3M17 6l3 3"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/>',
  scale: '<path d="M12 3v18M6 21h12M5 7h14"/><path d="M7 7l-3 7a3 3 0 0 0 6 0zM17 7l-3 7a3 3 0 0 0 6 0z"/>',
  pulse: '<polyline points="3 12 7 12 10 4 14 20 17 12 21 12"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  spinner: '<path d="M12 3a9 9 0 1 0 9 9" />',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5h13L22 12v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z"/>',
  eye: '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/>',
  link: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  bolt: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
};

export function I({ n, s = 18, cls = '' }: { n: keyof typeof P | string; s?: number; cls?: string }) {
  return <svg className={`i ${cls}`} width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: P[n] ?? '' }} />;
}

// ───── datas / prazos ─────
const WD = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
export const fmtDate = (iso?: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—');
export const weekday = (iso: string) => WD[new Date(`${iso.slice(0, 10)}T00:00:00Z`).getUTCDay()]!;
const pad = (n: number) => String(n).padStart(2, '0');
export const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const dayNum = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / 86_400_000;
export const daysLeft = (iso: string) => Math.round(dayNum(iso) - dayNum(todayIso()));

export type Urgency = { key: 'late' | 'today' | 'u3' | 'u7' | 'ok'; label: string; cls: '' | 'bad' | 'warn' | 'soon'; row: '' | 'u-bad' | 'u-warn' | 'u-soon' };
export function urgencyOf(endTerm: string | null | undefined): Urgency | null {
  if (!endTerm) return null;
  const d = daysLeft(endTerm);
  if (d < 0) return { key: 'late', label: `Vencido há ${-d} ${-d === 1 ? 'dia' : 'dias'}`, cls: 'bad', row: 'u-bad' };
  if (d === 0) return { key: 'today', label: 'Vence hoje', cls: 'bad', row: 'u-bad' };
  if (d <= 3) return { key: 'u3', label: `Em ${d} ${d === 1 ? 'dia' : 'dias'}`, cls: 'warn', row: 'u-warn' };
  if (d <= 7) return { key: 'u7', label: `Em ${d} dias`, cls: 'soon', row: 'u-soon' };
  return { key: 'ok', label: `Em ${d} dias`, cls: '', row: '' };
}

export const unitLabel = (unit: string, n: number) => (unit === 'dias_corridos' ? `${n} ${n === 1 ? 'dia corrido' : 'dias corridos'}` : unit === 'dias_uteis' ? `${n} ${n === 1 ? 'dia útil' : 'dias úteis'}` : unit === 'horas' ? `${n} horas` : unit === 'meses' ? `${n} meses` : `${n} ${unit}`);

export const initials = (name?: string | null) => (name ? name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('') : '?');
export const fmtDuration = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return s >= 3600 ? `${Math.floor(s / 3600)} h ${pad(Math.floor((s % 3600) / 60))} min` : `${pad(Math.floor(s / 60))}:${pad(s % 60)}`; };

// ───── saúde do sistema ─────
export type Health = { ok: boolean; uptime: number; mode?: string } | null;
export function useHealth(): Health {
  const [h, setH] = useState<Health>(null);
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try { const r = await fetch('/api/health', { cache: 'no-store' }); const j = await r.json(); if (alive) setH({ ok: r.ok && j.status === 'ok', uptime: j.uptimeSec, mode: j.mode }); }
      catch { if (alive) setH({ ok: false, uptime: 0 }); }
    };
    void tick(); const t = setInterval(tick, 5000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  return h;
}

export function HealthPill({ h, onDark = true }: { h: Health; onDark?: boolean }) {
  const ok = h?.ok;
  const cls = onDark ? `pill ${h == null ? '' : ok ? 'good' : 'bad'}` : '';
  return (
    <span className={cls} title="O sistema consulta o servidor a cada 5 s" style={onDark ? undefined : { display: 'inline-flex', alignItems: 'center', gap: 7, fontWeight: 600, color: ok ? 'var(--ok)' : 'var(--bad)' }}>
      <span className={`dot ${ok ? 'live' : ''}`} />
      {h == null ? 'Verificando…' : ok ? `Sistema ativo · ${fmtDuration((h.uptime ?? 0) * 1000)}` : 'Sem conexão com o servidor'}
    </span>
  );
}
