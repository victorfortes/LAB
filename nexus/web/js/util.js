/**
 * Utilitários da interface.
 *
 * `html` é um template tag que ESCAPA tudo que é interpolado. O front antigo
 * montava HTML por concatenação de string e dependia de lembrar de chamar
 * `esc()` em cada ponto — um esquecimento e um nome de credor vindo de OCR
 * virava XSS armazenado num sistema de documentos de cliente. Aqui o caminho
 * seguro é o padrão, e o inseguro (`raw`) tem de ser pedido por escrito.
 */
import { ICONES } from './icones.js';

export class Seguro { constructor(s) { this.s = s; } toString() { return this.s; } }
const MAPA = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => MAPA[c]);
const val = (v) => (v instanceof Seguro ? v.s
  : Array.isArray(v) ? v.map(val).join('')
  : (v === null || v === undefined || v === false) ? '' : esc(v));
export const html = (s, ...v) => new Seguro(s.reduce((a, t, i) => a + t + (i < v.length ? val(v[i]) : ''), ''));
export const raw = (s) => new Seguro(String(s));

/** Ícone no traço do LexPane. */
export function icone(nome, cls = '') {
  const d = ICONES[nome] ?? ICONES.dots;
  return raw(`<svg viewBox="0 0 24 24" aria-hidden="true" class="ico ${cls}" fill="none" stroke="currentColor" `
    + `stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`);
}

// ------------------------------------------------------------ formatação ---

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
/** Aceita 'AAAA-MM-DD' ou ISO completo; usa os componentes de data SEM fuso. */
function partes(d) {
  if (!d) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d));
  return m ? { a: +m[1], m: +m[2], d: +m[3] } : null;
}
export const dataBR = (d) => { const p = partes(d); return p ? `${String(p.d).padStart(2, '0')}/${String(p.m).padStart(2, '0')}/${p.a}` : '—'; };
export const dataCurta = (d) => { const p = partes(d); return p ? `${p.d} ${MESES[p.m - 1]}` : '—'; };
export const hojeISO = () => new Date().toLocaleDateString('sv-SE');
export function dataHoraBR(d) {
  if (!d) return '—';
  const x = new Date(d);
  return `${x.toLocaleDateString('pt-BR')} ${x.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
}
export function relativo(d) {
  if (!d) return 'nunca';
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (s < 60) return 'agora há pouco';
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  return `há ${Math.floor(s / 86400)} d`;
}
/** Centavos (string ou número) → "1.234,56". BigInt: valor de passivo não cabe em Number com segurança. */
export function reais(centavos) {
  if (centavos === null || centavos === undefined || centavos === '') return '—';
  const n = BigInt(centavos);
  const neg = n < 0n; const abs = neg ? -n : n;
  const int = (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${neg ? '-' : ''}${int},${(abs % 100n).toString().padStart(2, '0')}`;
}
export function tamanho(bytes) {
  const n = Number(bytes ?? 0);
  if (!n) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(0)} kB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}
export const iniciais = (nome) => String(nome ?? '?').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();

const MATIZES = ['blue', 'purple', 'pink', 'orange', 'green', 'teal', 'indigo', 'yellow'];
/** Mesma pessoa/projeto, mesma cor — em toda tela. */
export function matiz(chave) {
  let h = 0; for (const c of String(chave ?? '')) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return MATIZES[h % MATIZES.length];
}
export const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

/** Avatar de iniciais, com a cor derivada do nome. */
export const avatar = (nome, tam = 'sm') =>
  html`<span class="av av--${tam} av--ini hue--${matiz(nome)}" title="${nome}" aria-hidden="true">${iniciais(nome)}</span>`;
export const pilha = (nomes, max = 4) => html`<span class="av-stack" role="img" aria-label="${nomes.join(', ')}">
  ${nomes.slice(0, max).map((n) => avatar(n))}${nomes.length > max ? html`<span class="av av--sm av--more" aria-hidden="true">+${nomes.length - max}</span>` : ''}</span>`;

export const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
export const debounce = (fn, ms = 200) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
export const $ = (sel, raiz = document) => raiz.querySelector(sel);
export const $$ = (sel, raiz = document) => [...raiz.querySelectorAll(sel)];

/** Delegação: um listener por tipo, em vez de um por botão. */
export function ouvir(raiz, tipo, seletor, fn) {
  raiz.addEventListener(tipo, (ev) => {
    const alvo = ev.target.closest?.(seletor);
    if (alvo && raiz.contains(alvo)) fn(alvo, ev);
  });
}

// ------------------------------------------------------ preferências locais ---

export const guardado = {
  ler(chave, padrao) { try { const v = localStorage.getItem(`nga.${chave}`); return v === null ? padrao : JSON.parse(v); } catch { return padrao; } },
  gravar(chave, valor) { try { localStorage.setItem(`nga.${chave}`, JSON.stringify(valor)); } catch { /* modo privado */ } },
};

/** "1.234,56" → "123456" (centavos como string de dígitos). Devolve null se não for dinheiro. */
export function paraCentavos(texto) {
  const t = String(texto ?? '').replace(/[R$\s]/g, '');
  if (!t) return null;
  if (!/^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+(,\d{1,2})?$/.test(t)) return null;
  const [int, dec = ''] = t.replace(/\./g, '').split(',');
  return `${int}${dec.padEnd(2, '0')}`.replace(/^0+(?=\d)/, '');
}
