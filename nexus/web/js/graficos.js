/** Gráficos SVG do estúdio. Eixo único, leitura por hover e foco; todo valor está também na tabela. */
const NS = 'http://www.w3.org/2000/svg';
const el = (n, a = {}, pai) => { const e = document.createElementNS(NS, n); for (const k in a) e.setAttribute(k, a[k]); pai?.appendChild(e); return e; };
export const CORES = { I: 'var(--s1)', II: 'var(--s2)', III: 'var(--s3)', IV: 'var(--s4)' };
export const corDaClasse = (id, i) => CORES[id] ?? ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)'][i % 4];
export const moeda = (c) => { const n = Number(c) / 100; const a = Math.abs(n); const s = a >= 1e9 ? `${(a / 1e9).toFixed(1)} bi` : a >= 1e6 ? `${(a / 1e6).toFixed(2)} mi` : a >= 1e3 ? `${(a / 1e3).toFixed(0)} mil` : a.toFixed(0); return `${n < 0 ? '−' : ''}R$ ${s.replace('.', ',')}`; };
const rotMes = (m) => { const [a, b] = m.split('-'); return `${b}/${a.slice(2)}`; };
const L = 720, A = 240, M = { t: 12, r: 10, b: 24, l: 62 };

function tip(alvo) { const t = document.createElement('div'); t.className = 'graf__tip'; t.hidden = true; alvo.appendChild(t); return t; }
function preencher(t, titulo, linhas) { t.replaceChildren(); const h = document.createElement('b'); h.textContent = titulo; t.appendChild(h); for (const [r, v] of linhas) { const d = document.createElement('div'); const a = document.createElement('span'); a.textContent = r; const b = document.createElement('span'); b.textContent = v; d.append(a, b); t.appendChild(d); } }
function escala(min, max) { if (min === max) { min -= 1; max += 1; } const y = (v) => M.t + (A - M.t - M.b) * (1 - (v - min) / (max - min)); return y; }
function grade(svg, y, min, max) { for (let i = 0; i <= 3; i++) { const v = min + ((max - min) * i) / 3; el('line', { x1: M.l, x2: L - M.r, y1: y(v), y2: y(v), stroke: 'rgba(255,255,255,.07)' }, svg); const t = el('text', { x: M.l - 8, y: y(v) + 4, 'text-anchor': 'end' }, svg); t.textContent = moeda(v); } }
function eixoX(svg, serie, x) { const p = Math.max(1, Math.ceil(serie.length / 8)); serie.forEach((s, i) => { if (i % p) return; const t = el('text', { x: x(i), y: A - 6, 'text-anchor': 'middle' }, svg); t.textContent = rotMes(s.mes); }); }

export function graficoSaldo(alvo, serie, reserva = 0) {
  alvo.replaceChildren(); if (!serie.length) return; alvo.classList.add('graf');
  const v = serie.map((s) => Number(s.saldo)); const min = Math.min(0, ...v, reserva), max = Math.max(0, ...v, reserva);
  const svg = el('svg', { viewBox: `0 0 ${L} ${A}`, role: 'img', 'aria-label': 'Saldo de caixa projetado por mês' }, alvo); const y = escala(min, max); grade(svg, y, min, max);
  const x = (i) => M.l + ((L - M.l - M.r) * i) / Math.max(1, v.length - 1); eixoX(svg, serie, x);
  el('line', { x1: M.l, x2: L - M.r, y1: y(0), y2: y(0), stroke: 'rgba(255,255,255,.35)' }, svg);
  if (reserva) el('line', { x1: M.l, x2: L - M.r, y1: y(reserva), y2: y(reserva), stroke: 'var(--lab-amber)', 'stroke-dasharray': '5 5' }, svg);
  const d = v.map((n, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(n).toFixed(1)}`).join('');
  const clipId = `c${Math.random().toString(36).slice(2)}`; const defs = el('defs', {}, svg); const cp = el('clipPath', { id: clipId }, defs); el('rect', { x: 0, y: y(0), width: L, height: A }, cp);
  el('path', { d, fill: 'none', stroke: 'var(--lab-cy)', 'stroke-width': 2, 'stroke-linejoin': 'round' }, svg);
  el('path', { d, fill: 'none', stroke: 'var(--lab-red)', 'stroke-width': 2, 'clip-path': `url(#${clipId})` }, svg);
  const mira = el('line', { y1: M.t, y2: A - M.b, stroke: 'rgba(255,255,255,.3)', visibility: 'hidden' }, svg); const pt = el('circle', { r: 5, fill: 'var(--lab-cy)', stroke: '#0b111a', 'stroke-width': 2, visibility: 'hidden' }, svg); const t = tip(alvo);
  const mover = (ev) => { const r = svg.getBoundingClientRect(); const i = Math.round(((ev.clientX - r.left) / r.width * L - M.l) / ((L - M.l - M.r) / Math.max(1, v.length - 1))); const k = Math.max(0, Math.min(v.length - 1, i)); const s = serie[k];
    mira.setAttribute('x1', x(k)); mira.setAttribute('x2', x(k)); mira.setAttribute('visibility', 'visible'); pt.setAttribute('cx', x(k)); pt.setAttribute('cy', y(v[k])); pt.setAttribute('visibility', 'visible');
    preencher(t, rotMes(s.mes), [['Saldo', moeda(s.saldo)], ['Entradas', moeda(s.entradas)], ['Saídas', moeda(s.saidas)], ['PRJ', moeda(s.prj)]]); t.hidden = false; t.style.left = `${(x(k) / L) * 100}%`; t.style.top = `${(y(v[k]) / A) * r.height}px`; };
  svg.addEventListener('pointermove', mover); svg.addEventListener('pointerleave', () => { t.hidden = true; mira.setAttribute('visibility', 'hidden'); pt.setAttribute('visibility', 'hidden'); });
}

export function graficoDesembolso(alvo, serie, classes) {
  alvo.replaceChildren(); alvo.classList.add('graf'); const vis = serie.filter((s, i) => Number(s.prj) > 0 || (i > 0 && Number(serie[i - 1].prj) > 0)); if (!vis.length) { alvo.textContent = 'Nenhuma parcela dentro do horizonte.'; return; }
  const max = Math.max(...vis.map((s) => Number(s.prj))); const svg = el('svg', { viewBox: `0 0 ${L} ${A}`, role: 'img', 'aria-label': 'Desembolso mensal do plano por classe' }, alvo); const y = escala(0, max); grade(svg, y, 0, max);
  const lb = (L - M.l - M.r) / vis.length; const x = (i) => M.l + lb * i + lb / 2; eixoX(svg, vis, x); const t = tip(alvo);
  vis.forEach((s, i) => { let topo = 0; classes.forEach((c, k) => { const v = Number(s.porClasse[c.id] ?? 0); if (!v) return; const y1 = y(topo + v), y0 = y(topo); el('rect', { x: M.l + lb * i + Math.min(1, lb * 0.1), y: y1, width: Math.max(1, lb - Math.min(2, lb * 0.2)), height: Math.max(0, y0 - y1 - (lb > 6 ? 1 : 0)), rx: lb > 8 ? 2 : 0, fill: corDaClasse(c.id, k) }, svg); topo += v; });
    const alvoH = el('rect', { x: M.l + lb * i, y: M.t, width: lb, height: A - M.t - M.b, fill: 'transparent' }, svg);
    alvoH.addEventListener('pointerenter', () => { preencher(t, rotMes(s.mes), [...classes.filter((c) => s.porClasse[c.id]).map((c) => [c.rotulo, moeda(s.porClasse[c.id])]), ['Total', moeda(s.prj)]]); t.hidden = false; t.style.left = `${(x(i) / L) * 100}%`; t.style.top = `${(y(max) / A) * svg.getBoundingClientRect().height + 40}px`; }); });
  svg.addEventListener('pointerleave', () => { t.hidden = true; });
}
