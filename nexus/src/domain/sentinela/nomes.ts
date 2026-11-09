/** Normalização e comparação de nomes de partes. Mesmo comportamento do Sentinela original (Python). */
const SUFIXOS = new Set(['LTDA', 'SA', 'SIA', 'EIRELI', 'ME', 'EPP', 'SLU', 'LTD', 'CIA', 'COMPANHIA']);
const RUIDO = [/\bEM RECUPERACAO JUDICIAL\b/g, /\bEM RECUPERACAO EXTRAJUDICIAL\b/g, /\bEM FALENCIA\b/g, /\bMASSA FALIDA( DE)?\b/g, /\bEM LIQUIDACAO( JUDICIAL| EXTRAJUDICIAL)?\b/g];
const ascii = (s: string) => s.normalize('NFKD').replace(/[^\x00-\x7f]/g, '');

export function normalizar(nome: string | null | undefined): string {
  let s = ascii(nome ?? '').toUpperCase().replaceAll('&', ' E ');
  s = s.replace(/\bS\s*[/.]\s*A\b\.?/g, ' SA ').replace(/[^A-Z0-9 ]/g, ' ');
  for (const r of RUIDO) s = s.replace(r, ' ');
  const t = s.split(/\s+/).filter(Boolean);
  while (t.length && SUFIXOS.has(t[t.length - 1]!)) t.pop();
  return t.join(' ');
}

/** difflib.SequenceMatcher.ratio() (sem "junk": nomes têm menos de 200 caracteres). */
export function razao(a: string, b: string): number {
  const b2j = new Map<string, number[]>();
  [...b].forEach((c, j) => { const l = b2j.get(c); if (l) l.push(j); else b2j.set(c, [j]); });
  const maior = (al: number, ah: number, bl: number, bh: number): [number, number, number] => {
    let bi = al, bj = bl, bs = 0; let j2 = new Map<number, number>();
    for (let i = al; i < ah; i++) {
      const n = new Map<number, number>();
      for (const j of b2j.get(a[i]!) ?? []) { if (j < bl) continue; if (j >= bh) break; const k = (j2.get(j - 1) ?? 0) + 1; n.set(j, k); if (k > bs) { bi = i - k + 1; bj = j - k + 1; bs = k; } }
      j2 = n;
    }
    return [bi, bj, bs];
  };
  let m = 0; const fila: [number, number, number, number][] = [[0, a.length, 0, b.length]];
  while (fila.length) { const [al, ah, bl, bh] = fila.pop()!; const [i, j, k] = maior(al, ah, bl, bh); if (k) { m += k; if (al < i && bl < j) fila.push([al, i, bl, j]); if (i + k < ah && j + k < bh) fila.push([i + k, ah, j + k, bh]); } }
  return a.length + b.length ? (2 * m) / (a.length + b.length) : 1;
}
export function similaridade(a: string, b: string): number { const x = normalizar(a), y = normalizar(b); return x && y ? razao(x, y) : 0; }

const RUIDO_INI = /\b(EM RECUPERACAO JUDICIAL|EM FALENCIA|EM LIQUIDACAO|RECUPERACAO JUDICIAL)\b/g;
const LIGACAO = new Set(['DE', 'DA', 'DO', 'DAS', 'DOS', 'E']);
export function iniciais(nome: string): string {
  const s = ascii(nome ?? '').toUpperCase().replace(/\bS\s*[/.]\s*A\b\.?/g, ' S A ').replace(/[^A-Z0-9 ]/g, ' ').replace(RUIDO_INI, ' ');
  const l: string[] = []; for (const t of s.split(/\s+/).filter(Boolean)) { if (LIGACAO.has(t)) continue; if (t === 'SA') l.push('S', 'A'); else l.push(t[0]!); }
  return l.length >= 4 ? l.map((x) => `${x}.`).join(' ') : '';
}
export const eAbreviacao = (nome: string): boolean => { const t = (nome ?? '').toUpperCase().match(/[A-Z0-9]+/g) ?? []; return t.length >= 4 && t.every((x) => x.length === 1); };
export const normalizarIniciais = (nome: string): string => ((nome ?? '').toUpperCase().match(/[A-Z]/g) ?? []).join('');
