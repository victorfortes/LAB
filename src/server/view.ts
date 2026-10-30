import type { Rec } from '../store/models.ts';
import { detectAto, detectClasse, scheduleNotes, scheduleTitle } from '../writer/format.ts';

const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 86_400_000;
/** Dias corridos entre duas datas ISO (b − a). */
export const diffDays = (a: string, b: string) => Math.round(day(b) - day(a));

/**
 * Resumo "para leitura humana" de um registro: o que a pessoa precisa ver na lista sem abrir o texto.
 * O prazo é sempre expresso também em DIAS CORRIDOS (da disponibilização até o vencimento), mesmo quando a contagem foi em dias úteis.
 */
export function summarize(rec: Rec) {
  const acts = rec.analysis.actions;
  const main = acts.find((a) => a.kind === 'prazo' && a.deadline && !a.notOurs) ?? acts.find((a) => a.kind === 'audiencia') ?? acts[0]!;
  const d = main.deadline;
  const text = rec.fullText;
  const orgao = /Órgão:\s*(.+)/.exec(text)?.[1]?.trim() ?? /Vara:\s*(.+?)(?:\s+-\s+Comarca|$)/m.exec(text)?.[1]?.trim() ?? null;
  const quote = main.evidence[0]?.quote ?? null;
  return {
    id: rec.id, runId: rec.runId, publicationId: rec.externalId, processNumber: rec.processNumber, clientName: rec.clientName, state: rec.state,
    availabilityDate: rec.availabilityDate, summary: rec.analysis.summary,
    confidence: rec.analysis.confidence, flags: rec.analysis.flags, actions: acts.length,
    ambiguous: acts.some((a) => a.ambiguous),
    /** Providência indicada (o "o que fazer"). */
    providencia: main.description,
    providenciaKind: main.kind,
    notOurs: acts.some((a) => a.notOurs),
    responsible: main.responsible,
    prazo: d ? {
      amount: d.amount, unit: d.unit, startTerm: d.startTerm, endTerm: d.endTerm,
      // Prazo em DIAS CORRIDOS: o próprio número quando a contagem é corrida; em dias úteis, a janela de calendário da contagem (início → vencimento).
      calendarDays: d.unit === 'dias_corridos' ? d.amount : d.endTerm && d.unit === 'dias_uteis' ? diffDays(d.startTerm, d.endTerm) + 1 : null,
      basis: d.basis,
    } : null,
    eventAt: main.eventAt,
    /** Vencimento do prazo PRÓPRIO (o que o robô pode agendar); null quando só há prazo de terceiro ou nada. */
    ownDeadline: acts.filter((a) => a.kind === 'prazo' && !a.notOurs).map((a) => a.deadline?.endTerm).filter(Boolean).sort()[0] ?? null,
    canSchedule: acts.some((a) => a.kind === 'prazo' && !a.notOurs && !!a.deadline?.endTerm),
    /** O que será criado no Astrea (já considerando edições humanas): usado para preencher o formulário de edição. */
    launch: (() => { const a = acts.find((x) => x.kind === 'prazo' && !x.notOurs && x.deadline?.endTerm); return a ? { actionId: a.id, title: scheduleTitle(rec, a), notes: scheduleNotes(rec, a), amount: a.deadline!.amount, unit: a.deadline!.unit, edited: !!a.edit } : null; })(),
    ambiguityReasons: [...new Set(acts.flatMap((a) => a.ambiguityReasons))],
    defaultDeadline: rec.analysis.flags.includes('prazo_padrao_5_dias'),
    nextDeadline: acts.map((a) => a.deadline?.endTerm).filter(Boolean).sort()[0] ?? null,
    ato: detectAto(quote ?? '') ?? detectAto(text.slice(0, 20_000).replace(/Tipo de comunica[cç][ãa]o:[^\n]*/gi, '')),
    classe: detectClasse(text),
    orgao: orgao ? orgao.slice(0, 90) : null,
    astreaDue: rec.hints?.find((h) => h.dueDate)?.dueDate ?? null,
    astreaDivergent: rec.analysis.flags.includes('sugestao_astrea_divergente'),
    quote,
    approvedBy: rec.approvedBy, auditedBy: rec.auditedBy,
  };
}
