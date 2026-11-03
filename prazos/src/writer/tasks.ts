import { createHash } from 'node:crypto';
import { isBusinessDay } from '../domain/deadline.ts';

/** Tarefas de acompanhamento criadas junto com o prazo (espelham os workflows "PRAZO N DIAS CORRIDOS" do Astrea). */
export interface TaskPlan {
  n: number; kind: 'analise' | 'protocolo';
  title: string; dueDate: string; responsible: string | null; priority: 'Baixa' | 'Média' | 'Alta';
}

export const TASK_ANALISE = 'Analisar Intimação + Verificar Providências';
export const TASK_PROTOCOLO = 'Conferir Protocolo / Renúncia';

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const toIso = (d: Date) => d.toISOString().slice(0, 10);
/** Próximo dia ÚTIL depois de `iso` (fim de semana, feriado e recesso pulam). */
export function nextBusinessIso(iso: string, holidays: ReadonlySet<string>): string {
  const d = day(iso);
  do { d.setUTCDate(d.getUTCDate() + 1); } while (!isBusinessDay(d, holidays));
  return toIso(d);
}
export const todayLocalIso = (now = new Date()) => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

/** Prioridade como nos workflows do Astrea: 5 e 15 dias = Média; 10 e 30 = Baixa; demais = Média. */
export const priorityFor = (amount: number): TaskPlan['priority'] => (amount === 10 || amount === 30 ? 'Baixa' : 'Média');

/**
 * 1) Analisar intimação e providências: no dia útil seguinte ao agendamento (hoje → amanhã), responsável do prazo.
 * 2) Conferir protocolo/renúncia: no dia útil seguinte ao vencimento (1 dia depois do fatal), responsável: Controladoria (Camilla).
 */
export function followUpPlan(d: { amount: number; endTerm: string }, responsible: string | null, o: { today?: string; holidays: ReadonlySet<string>; protocolResponsible: string }): TaskPlan[] {
  const today = o.today ?? todayLocalIso();
  const pr = priorityFor(d.amount);
  return [
    { n: 1, kind: 'analise', title: TASK_ANALISE, dueDate: nextBusinessIso(today, o.holidays), responsible, priority: pr },
    { n: 2, kind: 'protocolo', title: TASK_PROTOCOLO, dueDate: nextBusinessIso(d.endTerm, o.holidays), responsible: o.protocolResponsible, priority: pr },
  ];
}

export const taskKey = (prazoKey: string, n: number) => createHash('sha256').update(`${prazoKey}|tarefa|${n}`).digest('hex').slice(0, 24);
