/**
 * Efeitos: o que faz a interface se mexer.
 *
 * Nada aqui é decoração que esconda dado — contagem animada termina no valor
 * real, anel termina na porcentagem real. E tudo respeita
 * `prefers-reduced-motion`: quem pede menos movimento recebe o valor final
 * direto, sem animação.
 */
import { $, $$, guardado } from './util.js';

export const semMovimento = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Números com `data-n` contam de 0 até o valor. */
export function contar(raiz = document) {
  for (const el of $$('[data-n]', raiz)) {
    const alvo = Number(el.dataset.n);
    if (!Number.isFinite(alvo)) continue;
    if (semMovimento() || alvo === 0) { el.textContent = fmt(alvo, el); continue; }
    const t0 = performance.now(); const dur = 900 + Math.min(600, alvo * 6);
    const passo = (t) => {
      const k = Math.min(1, (t - t0) / dur);
      el.textContent = fmt(Math.round(alvo * (1 - Math.pow(1 - k, 3))), el);
      if (k < 1) requestAnimationFrame(passo);
    };
    requestAnimationFrame(passo);
  }
}
const fmt = (n, el) => (el.dataset.sufixo ? `${n}${el.dataset.sufixo}` : String(n));

/** Anel SVG: nasce vazio e preenche até `pct` quando entra na tela. */
export function anel(pct, { tam = 64, traco = 7, cor = 'var(--hue, var(--lab-amber))', r } = {}) {
  const raio = r ?? (tam / 2 - traco / 2 - 1);
  const c = 2 * Math.PI * raio;
  const p = Math.max(0, Math.min(100, pct));
  const centro = tam / 2;
  return `<svg viewBox="0 0 ${tam} ${tam}" aria-hidden="true">
    <circle cx="${centro}" cy="${centro}" r="${raio}" fill="none" stroke="var(--fill-2)" stroke-width="${traco}"/>
    <circle class="anel-bar" cx="${centro}" cy="${centro}" r="${raio}" fill="none" stroke="${cor}" stroke-width="${traco}"
      stroke-linecap="round" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${c.toFixed(2)}"
      data-alvo="${(c * (1 - p / 100)).toFixed(2)}"/></svg>`;
}
export function animarAneis(raiz = document) {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    for (const c of $$('.anel-bar', raiz)) c.style.strokeDashoffset = c.dataset.alvo;
  }));
}
export function animarBarras(raiz = document) {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    for (const i of $$('[data-h]', raiz)) i.style.height = `${i.dataset.h}%`;
    for (const i of $$('[data-w]', raiz)) i.style.width = `${i.dataset.w}%`;
  }));
}

/** A "lente" de vidro que desliza até o item ativo (sidebar, abas, segmentos). */
export function lente(container, lenteSel, itemSel, ativoFn) {
  const el = $(lenteSel, container); if (!el) return;
  const ativo = $$(itemSel, container).find(ativoFn);
  if (!ativo) { el.style.opacity = 0; return; }
  const c = container.getBoundingClientRect(); const a = ativo.getBoundingClientRect();
  el.style.width = `${a.width}px`; el.style.height = `${a.height}px`;
  el.style.transform = `translate(${a.left - c.left}px, ${a.top - c.top}px)`;
  el.style.opacity = 1; el.classList.add('is-on');
}

/** O brilho que segue o ponteiro nos cards de vidro. */
export function brilho() {
  if (semMovimento()) return;
  document.addEventListener('pointermove', (ev) => {
    const g = ev.target.closest?.('.glass'); if (!g) return;
    const r = g.getBoundingClientRect();
    g.style.setProperty('--gx', `${ev.clientX - r.left}px`);
    g.style.setProperty('--gy', `${ev.clientY - r.top}px`);
  }, { passive: true });
}

/** Rede de partículas do fundo, no ciano e âmbar do NGA Lab. */
export function fundo() {
  const cv = $('#fx'); if (!cv) return;
  if (guardado.ler('efeitos', 'auto') === 'leve') { document.documentElement.classList.add('leve'); return; }
  const ctx = cv.getContext('2d'); let w, h, nos = [], mouse = { x: -999, y: -999 }, vivo = true;
  const ajustar = () => {
    const dpr = 1;   // fundo é ornamento: meia resolução em tela Retina custa 4x de pintura sem ganho visível
    w = cv.width = innerWidth * dpr; h = cv.height = innerHeight * dpr;
    cv.style.width = `${innerWidth}px`; cv.style.height = `${innerHeight}px`;
    const n = Math.min(34, Math.floor((innerWidth * innerHeight) / 45000));
    nos = Array.from({ length: n }, () => ({
      x: Math.random() * w, y: Math.random() * h, vx: (Math.random() - .5) * .22 * dpr, vy: (Math.random() - .5) * .22 * dpr,
      r: (Math.random() * 1.4 + .5) * dpr, cor: Math.random() < .3 ? '240,163,46' : '76,201,240',
    }));
  };
  ajustar(); addEventListener('resize', ajustar);
  addEventListener('pointermove', (e) => { mouse = { x: e.clientX, y: e.clientY }; }, { passive: true });
  document.addEventListener('visibilitychange', () => { vivo = !document.hidden; if (vivo) quadro(); });
  const alcance = () => 150;
  // Limite de ~30 quadros e autodiagnóstico: o fundo anima por baixo de dezenas de
  // vidros, então um quadro caro vira lentidão na tela inteira. Se a máquina não
  // sustenta 40 fps, o fundo animado é desligado sozinho ("modo leve").
  let ultimo = 0; let marca = performance.now(); let contados = 0; let ruins = 0; let janelas = 0;
  // Qualquer troca de visibilidade/foco invalida a janela de medição: aba em segundo plano
  // roda a ~1 fps e isso NÃO significa que o computador seja lento.
  const reiniciar = () => { marca = performance.now(); contados = 0; ruins = 0; };
  document.addEventListener('visibilitychange', reiniciar); addEventListener('blur', reiniciar); addEventListener('focus', reiniciar);
  const quadro = (agora = performance.now()) => {
    if (!vivo) return;
    if (document.documentElement.classList.contains('leve')) return;
    contados++;                                   // conta quadros do NAVEGADOR (não só os desenhados)
    if (agora - ultimo < 32) { requestAnimationFrame(quadro); return; }
    ultimo = agora;
    if (janelas < 3 && agora - marca > 2500) {
      const fps = (contados * 1000) / (agora - marca);
      if (document.visibilityState === 'visible' && document.hasFocus() && guardado.ler('efeitos', 'auto') === 'auto') {
        ruins = fps < 30 ? ruins + 1 : 0; janelas++;
        if (ruins >= 2) { document.documentElement.classList.add('leve'); ctx.clearRect(0, 0, w, h); return; }
      }
      marca = agora; contados = 0;
    }
    ctx.clearRect(0, 0, w, h);
    const L = alcance();
    for (const a of nos) {
      if (!semMovimento()) {
        a.x += a.vx; a.y += a.vy;
        if (a.x < 0 || a.x > w) a.vx *= -1; if (a.y < 0 || a.y > h) a.vy *= -1;
        const dx = a.x - mouse.x; const dy = a.y - mouse.y; const d2 = dx * dx + dy * dy;
        if (d2 < 14000) { a.x += dx * .004; a.y += dy * .004; }
      }
      ctx.beginPath(); ctx.arc(a.x, a.y, a.r, 0, 6.283); ctx.fillStyle = `rgba(${a.cor},.55)`; ctx.fill();
    }
    for (let i = 0; i < nos.length; i++) for (let j = i + 1; j < nos.length; j++) {
      const a = nos[i], b = nos[j]; const dx = a.x - b.x; const dy = a.y - b.y; const d = Math.hypot(dx, dy);
      if (d < L) { ctx.strokeStyle = `rgba(${a.cor},${(1 - d / L) * .16})`; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
    }
    if (!semMovimento()) requestAnimationFrame(quadro);
  };
  quadro();
}

/**
 * Arrastar entre colunas, genérico.
 *
 * `aoSoltar(idDoItem, idDaColuna, elItem, colunaOrigem)` devolve uma Promise: se
 * rejeitar, o cartão VOLTA para onde estava e treme — o servidor é quem decide
 * se a mudança é válida (pular fase, por exemplo, é recusado), e a tela não
 * pode ficar mostrando um estado que o banco não aceitou.
 */
export function quadroArrastavel(raiz, { item, coluna, lista, aoSoltar }) {
  let arrastado = null; let origem = null; let irmao = null;
  raiz.addEventListener('dragstart', (e) => {
    const c = e.target.closest?.(item); if (!c) return;
    arrastado = c; origem = c.parentElement; irmao = c.nextElementSibling;
    c.classList.add('arrastando');
    e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', c.dataset.id ?? '');
  });
  raiz.addEventListener('dragend', () => {
    arrastado?.classList.remove('arrastando'); $$(coluna, raiz).forEach((c) => c.classList.remove('over'));
    arrastado = null;
  });
  raiz.addEventListener('dragover', (e) => {
    const col = e.target.closest?.(coluna); if (!col || !arrastado) return;
    e.preventDefault(); e.dataTransfer.dropEffect = 'move';
    $$(coluna, raiz).forEach((c) => c.classList.toggle('over', c === col));
  });
  raiz.addEventListener('dragleave', (e) => {
    const col = e.target.closest?.(coluna);
    if (col && !col.contains(e.relatedTarget)) col.classList.remove('over');
  });
  raiz.addEventListener('drop', async (e) => {
    const col = e.target.closest?.(coluna); if (!col || !arrastado) return;
    e.preventDefault(); col.classList.remove('over');
    const card = arrastado; const dest = $(lista, col);
    if (dest === origem) return;
    const de = origem; const antes = irmao;
    dest.prepend(card);                      // otimista: mexe já
    try {
      await aoSoltar(card.dataset.id, dest.dataset.col ?? col.dataset.fase, card, de.closest(coluna));
      atualizarContagens(raiz, coluna, lista);
    } catch (erro) {
      de.insertBefore(card, antes);          // o servidor recusou: volta
      card.classList.remove('volta'); void card.offsetWidth; card.classList.add('volta');
      // Sem rethrow: o chamador já avisou o usuário no `aoSoltar`.
      void erro;
    }
  });
}
function atualizarContagens(raiz, coluna, lista) {
  for (const c of $$(coluna, raiz)) {
    const n = $$('[draggable=true]', $(lista, c)).length; const el = $('.tk-col__count', c); if (el) el.textContent = n;
  }
}

// ---------------------------------------------------- interatividade geral ---

/**
 * Pequenas respostas ao ponteiro, delegadas no documento (um ouvinte só, sem
 * custo por cartão): holofote nos vidros, inclinação leve nos cartões de
 * projeto e ferramenta, ondulação nos botões e o brilho do fundo seguindo o
 * mouse. Tudo respeita `prefers-reduced-motion`.
 */
export function interatividade() {
  if (semMovimento()) return;
  let quadro = 0; let ultimo = null;
  const aplicar = () => {
    quadro = 0; if (!ultimo) return;
    const { x, y, alvo } = ultimo;
    const vidro = alvo.closest?.('.glass, .tk-card, .stat');
    if (vidro) {
      const r = vidro.getBoundingClientRect();
      vidro.style.setProperty('--mx', `${x - r.left}px`); vidro.style.setProperty('--my', `${y - r.top}px`);
      const incl = alvo.closest?.('.pcard, .tool');
      if (incl) {
        const rx = ((y - r.top) / r.height - 0.5) * -5; const ry = ((x - r.left) / r.width - 0.5) * 6;
        incl.style.transform = `perspective(900px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg) translateY(-3px)`;
      }
    }
  };
  document.addEventListener('pointermove', (e) => { ultimo = { x: e.clientX, y: e.clientY, alvo: e.target }; if (!quadro) quadro = requestAnimationFrame(aplicar); }, { passive: true });
  document.addEventListener('pointerout', (e) => {
    const c = e.target.closest?.('.pcard, .tool'); if (c && !c.contains(e.relatedTarget)) c.style.transform = '';
  }, { passive: true });
  document.addEventListener('pointerdown', (e) => {
    const b = e.target.closest?.('.btn, .ibtn, .tbtn'); if (!b) return;
    const r = b.getBoundingClientRect(); const o = document.createElement('span'); o.className = 'onda';
    o.style.cssText = `left:${e.clientX - r.left}px;top:${e.clientY - r.top}px`; b.append(o); setTimeout(() => o.remove(), 650);
  }, { passive: true });
}
