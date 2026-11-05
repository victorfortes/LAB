/**
 * Camada de interface: toasts, modais com formulário, confirmação, menus e a
 * busca ⌘K. Substitui os `prompt()` e `alert()` do front antigo, que eram a
 * parte mais feia e menos usável de todo o sistema.
 */
import { $, $$, esc, html, icone, raw } from './util.js';

// --------------------------------------------------------------- toasts ---

export function toast(msg, tipo = 'ok', ms = 4200) {
  let cx = $('#toasts'); if (!cx) { cx = document.createElement('div'); cx.id = 'toasts'; cx.className = 'toasts'; document.body.append(cx); }
  const t = document.createElement('div'); t.className = `toast ${tipo}`; t.setAttribute('role', tipo === 'erro' ? 'alert' : 'status');
  t.innerHTML = `<i></i><span>${esc(msg)}</span>`; cx.append(t);
  const sai = () => { t.classList.add('sai'); setTimeout(() => t.remove(), 300); };
  t.addEventListener('click', sai); setTimeout(sai, tipo === 'erro' ? ms + 2500 : ms);
}
export const erroDe = (e) => toast(e?.message ?? String(e), 'erro');

// ---------------------------------------------------------------- modal ---

/**
 * Abre um modal. `corpo` é HTML seguro; `acoes` são os botões.
 * Resolve com o `id` da ação escolhida, ou null se fechou.
 */
export function modal({ titulo, subtitulo = '', corpo = '', acoes = [], largo = false, aoAbrir }) {
  return new Promise((resolver) => {
    const el = document.createElement('div'); el.className = 'modal lab-modal'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true');
    el.innerHTML = `<div class="modal__box glass-lite${largo ? ' wide' : ''}">
      <div class="modal__head"><div><h2>${esc(titulo)}</h2>${subtitulo ? `<p>${esc(subtitulo)}</p>` : ''}</div>
        <button class="ibtn ibtn--sm" type="button" data-fechar aria-label="Fechar">${icone('x')}</button></div>
      <div class="modal__body">${corpo}</div>
      <div class="modal__err" role="alert"></div>
      <div class="modal__foot">${acoes.map((a) => `<button type="button" class="btn ${a.tipo === 'primario' ? 'btn--accent' : a.tipo === 'perigo' ? 'btn--ghost perigo-btn' : 'btn--ghost'}" data-acao="${esc(a.id)}">${esc(a.rotulo)}</button>`).join('')}</div></div>`;
    const focoAnterior = document.activeElement; let encerrado = false;
    document.body.append(el);
    const fechar = (valor) => {
      if (encerrado) return; encerrado = true;
      el.remove(); document.removeEventListener('keydown', tecla);
      if (focoAnterior?.isConnected) focoAnterior.focus(); resolver(valor);
    };
    const tecla = (e) => {
      if ([...document.querySelectorAll('.lab-modal')].at(-1) !== el) return;
      if (e.key === 'Escape') { e.preventDefault(); fechar(null); }
      if (e.key === 'Tab') {
        const focaveis = [...el.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]')];
        const primeiro = focaveis[0], ultimo = focaveis.at(-1);
        if (e.shiftKey && document.activeElement === primeiro) { e.preventDefault(); ultimo?.focus(); }
        else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primeiro?.focus(); }
      }
    };
    document.addEventListener('keydown', tecla);
    el.addEventListener('click', (e) => { if (e.target === el) fechar(null); });
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-fechar]')) return fechar(null);
      const b = e.target.closest('[data-acao]'); if (b) el.dispatchEvent(new CustomEvent('acao', { detail: { id: b.dataset.acao, botao: b } }));
    });
    el.fechar = fechar; el.erro = (m) => { $('.modal__err', el).textContent = m ?? ''; };
    aoAbrir?.(el);
    queueMicrotask(() => ($('input, select, textarea, button[data-acao]', el))?.focus());
  });
}

function campoHtml(c) {
  const id = `f_${c.nome}`; const v = c.valor ?? '';
  let ctrl;
  if (c.tipo === 'textarea') ctrl = `<textarea class="textarea" id="${id}" name="${c.nome}" ${c.obrigatorio ? 'required' : ''} placeholder="${esc(c.placeholder ?? '')}">${esc(v)}</textarea>`;
  else if (c.tipo === 'select') ctrl = `<select class="select" id="${id}" name="${c.nome}" ${c.obrigatorio ? 'required' : ''}>${(c.opcoes ?? []).map((o) => `<option value="${esc(o.v)}" ${String(o.v) === String(v) ? 'selected' : ''}>${esc(o.t)}</option>`).join('')}</select>`;
  else ctrl = `<input class="input" id="${id}" name="${c.nome}" type="${c.tipo ?? 'text'}" value="${esc(v)}" ${c.obrigatorio ? 'required' : ''} placeholder="${esc(c.placeholder ?? '')}" ${c.autocomplete ? `autocomplete="${c.autocomplete}"` : ''} ${c.min !== undefined ? `min="${c.min}"` : ''}>`;
  return `<label class="field"><span>${esc(c.rotulo)}${c.obrigatorio ? ' *' : ''}</span>${ctrl}${c.dica ? `<small class="dica">${esc(c.dica)}</small>` : ''}</label>`;
}

/**
 * Modal com formulário. `enviar(valores)` pode lançar: a mensagem aparece no
 * modal, que continua aberto — o usuário não perde o que digitou por causa de
 * uma recusa do servidor.
 */
export async function formulario({ titulo, subtitulo, campos, enviar, rotulo = 'Salvar', largo, depois }) {
  const linhas = []; let par = [];
  for (const c of campos) {
    if (c.metade) { par.push(c); if (par.length === 2) { linhas.push(`<div class="row2">${par.map(campoHtml).join('')}</div>`); par = []; } }
    else { if (par.length) { linhas.push(`<div class="row2">${par.map(campoHtml).join('')}</div>`); par = []; } linhas.push(campoHtml(c)); }
  }
  if (par.length) linhas.push(`<div class="row2">${par.map(campoHtml).join('')}</div>`);

  let resultado = null;
  await modal({
    titulo, subtitulo, largo, corpo: `<form id="mf" novalidate>${linhas.join('')}</form>`,
    acoes: [{ id: 'cancelar', rotulo: 'Cancelar' }, { id: 'ok', rotulo, tipo: 'primario' }],
    aoAbrir(el) {
      const form = $('#mf', el);
      const coletar = () => Object.fromEntries(campos.map((c) => {
        const x = form.elements[c.nome]; let v = x.value.trim();
        if (c.tipo === 'number') v = v === '' ? undefined : Number(v);
        return [c.nome, v === '' ? undefined : v];
      }));
      let salvando = false;
      const submeter = async () => {
        if (salvando) return;
        const falta = campos.find((c) => c.obrigatorio && !String(form.elements[c.nome].value).trim());
        if (falta) { el.erro(`Preencha: ${falta.rotulo}`); form.elements[falta.nome].focus(); return; }
        salvando = true;
        const btn = $('[data-acao=ok]', el); btn.disabled = true; btn.textContent = 'Salvando…'; el.erro('');
        try { resultado = await enviar(coletar()) ?? true; el.fechar(true); }
        catch (e) { salvando = false; el.erro(e.message); btn.disabled = false; btn.textContent = rotulo; }
      };
      form.addEventListener('submit', (e) => { e.preventDefault(); submeter(); });
      el.addEventListener('acao', (e) => { if (e.detail.id === 'cancelar') el.fechar(null); else submeter(); });
      depois?.(el, form);
    },
  });
  return resultado;
}

export async function confirmar(titulo, texto, { rotulo = 'Confirmar', perigo = false } = {}) {
  let ok = false;
  await modal({
    titulo, corpo: `<p class="dica" style="font-size:14.5px;line-height:1.55;margin:0">${esc(texto)}</p>`,
    acoes: [{ id: 'n', rotulo: 'Cancelar' }, { id: 's', rotulo, tipo: perigo ? 'perigo' : 'primario' }],
    aoAbrir(el) { el.addEventListener('acao', (e) => { ok = e.detail.id === 's'; el.fechar(ok); }); },
  });
  return ok;
}

// ---------------------------------------------------------------- menu ---

export function menu(ancora, itens) {
  $$('.menu').forEach((m) => m.remove());
  const m = document.createElement('div'); m.className = 'menu glass-lite';
  m.innerHTML = itens.map((i, n) => i === '-' ? '<div class="sep"></div>'
    : `<button type="button" data-i="${n}" class="${i.perigo ? 'perigo' : ''}">${i.icone ? icone(i.icone) : ''}${esc(i.rotulo)}</button>`).join('');
  document.body.append(m);
  const r = ancora.getBoundingClientRect();
  const w = m.offsetWidth; const h = m.offsetHeight;
  m.style.left = `${Math.max(10, Math.min(innerWidth - w - 10, r.right - w))}px`;
  m.style.top = `${r.bottom + 8 + h > innerHeight ? Math.max(10, r.top - h - 8) : r.bottom + 8}px`;
  const fechar = () => { m.remove(); document.removeEventListener('mousedown', fora, true); document.removeEventListener('keydown', esc_); };
  const fora = (e) => { if (!m.contains(e.target)) fechar(); };
  const esc_ = (e) => { if (e.key === 'Escape') fechar(); };
  setTimeout(() => { document.addEventListener('mousedown', fora, true); document.addEventListener('keydown', esc_); });
  m.addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b) { fechar(); itens[+b.dataset.i].acao?.(); } });
}

// -------------------------------------------------------------- ⌘K ---

export function paleta(fonte) {
  if ($('.cmdk')) return;
  const el = document.createElement('div'); el.className = 'cmdk';
  el.innerHTML = `<div class="cmdk__box"><input class="cmdk__in" placeholder="Buscar projeto, tarefa, processo ou ir para…" autocomplete="off" aria-label="Buscar"><div class="cmdk__list"></div></div>`;
  document.body.append(el);
  const inp = $('.cmdk__in', el); const lista = $('.cmdk__list', el); let itens = []; let sel = 0;
  const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
  const desenhar = () => {
    const q = norm(inp.value.trim());
    itens = fonte().filter((i) => !q || norm(`${i.rotulo} ${i.extra ?? ''}`).includes(q)).slice(0, 40);
    sel = Math.min(sel, Math.max(0, itens.length - 1));
    let grupo = null;
    lista.innerHTML = itens.length ? itens.map((i, n) => {
      const cab = i.grupo !== grupo ? `<div class="cmdk__grp">${esc(i.grupo)}</div>` : ''; grupo = i.grupo;
      return `${cab}<button type="button" class="cmdk__item${n === sel ? ' is-on' : ''}" data-n="${n}">${icone(i.icone ?? 'arrowUpRight')}<span>${esc(i.rotulo)}</span>${i.extra ? `<small>${esc(i.extra)}</small>` : ''}</button>`;
    }).join('') : '<div class="empty"><p>Nada encontrado.</p></div>';
    $('.is-on', lista)?.scrollIntoView({ block: 'nearest' });
  };
  const fechar = () => { el.remove(); document.removeEventListener('keydown', tecla, true); };
  const ir = (n) => { const i = itens[n]; if (i) { fechar(); i.acao(); } };
  const tecla = (e) => {
    if (e.key === 'Escape') return fechar();
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(itens.length - 1, sel + 1); desenhar(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); desenhar(); }
    if (e.key === 'Enter') { e.preventDefault(); ir(sel); }
  };
  document.addEventListener('keydown', tecla, true);
  inp.addEventListener('input', () => { sel = 0; desenhar(); });
  el.addEventListener('mousedown', (e) => { if (e.target === el) fechar(); });
  lista.addEventListener('click', (e) => { const b = e.target.closest('[data-n]'); if (b) ir(+b.dataset.n); });
  desenhar(); inp.focus();
}

// ------------------------------------------------------- blocos prontos ---

export const vazio = (ico, titulo, texto, acao = '') => html`<div class="empty"><div class="empty__ico">${icone(ico)}</div>
  <h3>${titulo}</h3><p>${texto}</p>${raw(acao)}</div>`;

export function stats(itens) {
  return html`<dl class="head__stats">${itens.map((s) => html`<div class="stat ${s.tom ? `is-${s.tom}` : ''}"><dt class="stat__label">${s.rotulo}</dt>
    <dd class="stat__value"><b ${typeof s.valor === 'number' ? raw(`data-n="${s.valor}" ${s.sufixo ? `data-sufixo="${s.sufixo}"` : ''}`) : ''}>${typeof s.valor === 'number' ? 0 : s.valor}</b></dd></div>`)}</dl>`;
}

export function cabecalho({ titulo, sub = '', acoes = '', resumo = [] }) {
  const letras = [...titulo].map((c, i) => html`<span class="ch" style="--n:${i}">${c === ' ' ? raw('&nbsp;') : c}</span>`);
  return html`<header class="head"><div class="head__lead"><div class="head__text">
    <h1 class="head__title" tabindex="-1" aria-label="${titulo}"><span class="word">${letras}</span></h1>
    ${sub ? html`<p class="head__sub">${sub}</p>` : ''}</div></div>
    ${acoes ? html`<div class="head__actions">${acoes}</div>` : ''}${resumo.length ? stats(resumo) : ''}</header>`;
}
