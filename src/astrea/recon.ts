import { maskString } from '../security/mask.ts';

/** Normaliza caminho de URL: remove query/hash e troca ids por :id. Nunca guarda query string (pode ter dados/tokens). */
const maskSeg = (s: string) =>
  /^\d+$/.test(s) || /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(s) || /^[0-9a-f]{20,}$/i.test(s) ? ':id' : s;

/**
 * Normaliza URL: remove query, troca ids por :id e MANTÉM a rota por hash de SPAs (#/a/b), que é
 * o que distingue telas no Astrea. Query string nunca é guardada (pode ter dados/tokens).
 */
export function normalizePath(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.split('/').map(maskSeg).join('/');
    const hash = u.hash.startsWith('#/') ? `#${decodeURIComponent(u.hash.slice(1).split('?')[0]!).split('/').map(maskSeg).join('/')}` : '';
    return `${u.host}${path}${hash}`;
  } catch {
    return '[url-invalida]';
  }
}

export interface BlockDecision { block: boolean; reason?: string }

/**
 * Guarda de somente leitura do reconhecimento: bloqueia qualquer método que não seja GET/HEAD/OPTIONS
 * para o host do Astrea, exceto padrões explicitamente liberados (RECON_ALLOW_POST) para leituras
 * que o Astrea faça via POST — a liberação deve ser decidida pelo usuário após inspecionar o bloqueio.
 */
export function guardRequest(method: string, url: string, allow: RegExp[] = []): BlockDecision {
  const m = method.toUpperCase();
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return { block: false };
  if (allow.some((re) => re.test(normalizePath(url)))) return { block: false };
  return { block: true, reason: `método ${m} bloqueado no reconhecimento (somente leitura)` };
}

export const sanitizeText = (s: string, max = 60) => maskString(s.replace(/\s+/g, ' ').trim()).slice(0, max);

export interface ElementInfo {
  tag: string; role: string | null; id: string | null; name: string | null; type: string | null;
  placeholder: string | null; ariaLabel: string | null; testId: string | null; text: string | null;
  href: string | null; visible: boolean; disabled: boolean; dataAttrs: string[];
}

/** Executado no navegador. Coleta apenas atributos estruturais; não lê valores de campos. */
export function inventoryScript(): string {
  return `(() => {
    const sel = 'a,button,input,select,textarea,label,h1,h2,h3,th,[role],[data-testid],[data-test],[data-cy]';
    const noText = new Set(['INPUT','SELECT','TEXTAREA']);
    const out = [];
    for (const el of Array.from(document.querySelectorAll(sel))) {
      if (out.length >= 800) break;
      const r = el.getBoundingClientRect();
      if (!(r.width > 0 && r.height > 0)) continue;
      const a = (n) => el.getAttribute(n);
      out.push({
        tag: el.tagName.toLowerCase(), role: a('role'), id: a('id'), name: a('name'), type: a('type'),
        placeholder: a('placeholder'), ariaLabel: a('aria-label'),
        testId: a('data-testid') || a('data-test') || a('data-cy'),
        text: noText.has(el.tagName) ? null : (el.textContent || '').slice(0, 200),
        href: el.tagName === 'A' ? a('href') : null,
        visible: r.width > 0 && r.height > 0, disabled: el.hasAttribute('disabled') || a('aria-disabled') === 'true',
        dataAttrs: Array.from(el.attributes).map((x) => x.name).filter((n) => n.startsWith('data-')),
      });
    }
    return out;
  })()`;
}

export function sanitizeElements(els: ElementInfo[]): ElementInfo[] {
  return els.map((e) => ({
    ...e,
    text: e.text ? sanitizeText(e.text) : null,
    href: e.href ? normalizePath(new URL(e.href, 'https://x.invalid').href.replace('https://x.invalid', 'https://h')) : null,
    placeholder: e.placeholder ? sanitizeText(e.placeholder) : null,
  }));
}

export interface NetRecord { method: string; path: string; type: string; status: number | null; blocked: boolean }

export const RECON_STEPS = [
  '01-publicacoes-lista',
  '02-nao-tratadas',
  '03-acessar-publicacao',
  '04-tratamentos',
  '05-adicionar-prazo-formulario (NÃO SALVAR)',
  '06-localizar-agendamento',
  '07-editar-agendamento-formulario (NÃO SALVAR)',
  '08-conferir-agendamento',
] as const;
