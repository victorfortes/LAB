/** Mascaramento de dados sensíveis para logs, auditoria e relatórios de reconhecimento. */
const SECRET_KEYS = /pass(word)?|senha|token|secret|cookie|authorization|api[-_]?key|jwt|session/i;
const BULKY_KEYS = /^(fulltext|full_text|texto|text|body|html)$/i;

const PATTERNS: Array<[RegExp, (m: string) => string]> = [
  [/\b[\w.+-]+@[\w-]+(\.[\w-]+)+\b/g, (m) => `${m[0]}***@***`],
  [/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, () => '***.***.***-**'],
  [/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, () => '**.***.***/****-**'],
  // CNJ: NNNNNNN-DD.AAAA.J.TR.OOOO -> mantém apenas dígito verificador/ano/órgão
  [/\b\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}\b/g, (m) => `*******-${m.slice(8)}`],
  [/\(?\b\d{2}\)?\s?9?\d{4}-?\d{4}\b/g, () => '(**) *****-****'],
];

export function maskString(s: string): string {
  return PATTERNS.reduce((acc, [re, f]) => acc.replace(re, f), s);
}

export function maskDeep(v: unknown, key = '', depth = 0): unknown {
  if (depth > 8) return '[depth]';
  if (v == null) return v;
  if (SECRET_KEYS.test(key)) return '[REDACTED]';
  if (BULKY_KEYS.test(key) && typeof v === 'string') return `[texto omitido: ${v.length} chars]`;
  if (typeof v === 'string') return maskString(v);
  if (Array.isArray(v)) return v.map((x) => maskDeep(x, key, depth + 1));
  if (typeof v === 'object') {
    return Object.fromEntries(Object.entries(v as object).map(([k, x]) => [k, maskDeep(x, k, depth + 1)]));
  }
  return v;
}

/** Logger estruturado: toda saída passa por maskDeep. */
export const log = {
  info: (msg: string, data?: unknown) => console.log(JSON.stringify({ lvl: 'info', msg, ...(data ? { data: maskDeep(data) } : {}) })),
  warn: (msg: string, data?: unknown) => console.warn(JSON.stringify({ lvl: 'warn', msg, ...(data ? { data: maskDeep(data) } : {}) })),
  error: (msg: string, data?: unknown) => console.error(JSON.stringify({ lvl: 'error', msg, ...(data ? { data: maskDeep(data) } : {}) })),
};
