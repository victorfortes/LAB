import type { ProposedAction } from '../domain/types.ts';
import type { Rec } from '../store/models.ts';

/**
 * Padrão de TÍTULO e OBSERVAÇÕES dos prazos criados pelo robô, derivado da leitura da publicação.
 *
 *   Título:       <Providência> — <Ato> (<Classe>)        ex.: "Manifestar-se — Decisão (Recuperação Judicial)"
 *   Observações:  texto padronizado + fundamento do cálculo + trecho-evidência + id da publicação + marcador [NGA:chave]
 */
const ATOS: Array<[RegExp, string]> = [
  [/\bac[óo]rd[ãa]o\b/i, 'Acórdão'],
  [/\bsenten[cç]a\b/i, 'Sentença'],
  [/\bdecis[ãa]o interlocut[óo]ria\b/i, 'Decisão interlocutória'],
  [/\bdecis[ãa]o\b/i, 'Decisão'],
  [/\bdespacho\b/i, 'Despacho'],
  [/\bintima[cç][ãa]o\b/i, 'Intimação'],
];
const SMALL = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'em']);

export function titleCase(s: string): string {
  return s.toLowerCase().split(/\s+/).filter(Boolean).map((w, i) => (i > 0 && SMALL.has(w) ? w : w[0]!.toUpperCase() + w.slice(1))).join(' ');
}

export function detectAto(text: string): string | null {
  for (const [re, label] of ATOS) if (re.test(text)) return label;
  return null;
}

export function detectClasse(text: string): string | null {
  const m = /Classe:\s*(.+?)(?:\n|\s+Conte[úu]do:|$)/.exec(text);
  if (!m) return null;
  // A classe real pode ser uma lista longa ("FALÊNCIA DE EMPRESÁRIOS, SOCIEDADES EMPRESÁRIAIS, MICROEMPRESAS…"): usa só o 1º termo.
  const first = m[1]!.split(/[,;(]/)[0]!.trim();
  return first ? titleCase(first).slice(0, 50) : null;
}

const clean = (s: string) => s.replace(/\s*\(prazo presumido\)\s*/i, '').replace(/\s+—\s+não agendar$/i, '').trim();
const br = (iso: string) => iso.split('-').reverse().join('/');

export function scheduleTitle(rec: Pick<Rec, 'fullText'>, a: ProposedAction): string {
  if (a.edit?.title) return a.edit.title.slice(0, 110); // texto definido por uma pessoa vale exatamente como digitado
  // Prazo de terceiro autorizado por exceção humana: título neutro ("Prazo da Recuperanda"), sem a etiqueta interna do classificador.
  const base = clean(a.description).replace(/^Prazo de terceiro \(([^)]+)\)/i, 'Prazo da $1');
  // 1º o ato citado no trecho-evidência; 2º o texto SEM a linha "Tipo de comunicação: Intimação" (presente em quase todas).
  const quotes = a.evidence.map((e) => e.quote).join(' ');
  const ato = detectAto(quotes) ?? detectAto(rec.fullText.slice(0, 20_000).replace(/Tipo de comunica[cç][ãa]o:[^\n]*/gi, ''));
  const classe = detectClasse(rec.fullText);
  const t = ato && !base.toLowerCase().includes(ato.toLowerCase()) ? `${base} — ${ato}` : base;
  return (classe ? `${t} (${classe})` : t).slice(0, 110);
}

export function scheduleNotes(rec: Pick<Rec, 'externalId' | 'availabilityDate'>, a: ProposedAction): string {
  if (a.edit?.notes) return a.edit.notes.slice(0, 2000);
  const d = a.deadline!;
  const quote = (a.evidence[0]?.quote ?? '').replace(/\s+/g, ' ').slice(0, 160);
  return [
    'Prazo proposto pelo robô NGA Prazos — sujeito à auditoria da Controladoria.',
    `Providência: ${clean(a.description)}${a.ambiguous ? ' (REVISADO COM ALERTAS)' : ''}.`,
    `Contagem: ${d.amount} ${d.unit === 'dias_corridos' ? 'dias corridos' : 'dias úteis'}, início ${br(d.startTerm)}, vencimento ${d.endTerm ? br(d.endTerm) : '—'}.`,
    quote ? `Trecho: “${quote}”.` : '',
    `Publicação Astrea ${rec.externalId}, disponibilizada em ${br(rec.availabilityDate)}.`,
  ].filter(Boolean).join(' ');
}
