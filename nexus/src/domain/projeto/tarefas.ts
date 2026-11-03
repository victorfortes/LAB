/**
 * Tarefas: regra pura, sem banco.
 *
 * O quadro de tarefas é kanban, e kanban se arrasta para qualquer coluna — a
 * regra aqui NÃO é uma máquina de estados rígida como a do checklist (onde o
 * cliente não pode aprovar). Tarefa é trabalho da própria equipe, e obrigar
 * quem tem pressa a passar por "em revisão" antes de concluir só produziria
 * quadro desatualizado. O que a regra garante é o que importa: concluir é ato
 * datado, reabrir limpa a data, e a urgência de uma tarefa vem do PRAZO — não
 * de a pessoa ter marcado "urgente".
 */
import { type DataISO, comparar } from '../shared/datas.ts';
import { diasUteisAte } from '../processo/prazos.ts';

export const STATUS = ['a_fazer', 'em_andamento', 'em_revisao', 'concluida'] as const;
export type StatusDaTarefa = (typeof STATUS)[number];

export const PRIORIDADES = ['baixa', 'media', 'alta', 'urgente'] as const;
export type Prioridade = (typeof PRIORIDADES)[number];

export const ROTULO_DO_STATUS: Readonly<Record<StatusDaTarefa, string>> = Object.freeze({
  a_fazer: 'A fazer', em_andamento: 'Em andamento',
  em_revisao: 'Em revisão', concluida: 'Concluída',
});

export const ROTULO_DA_PRIORIDADE: Readonly<Record<Prioridade, string>> = Object.freeze({
  baixa: 'Baixa', media: 'Média', alta: 'Alta', urgente: 'Urgente',
});

/** Peso para ordenar: o mais urgente primeiro. */
const PESO: Readonly<Record<Prioridade, number>> = Object.freeze({
  urgente: 0, alta: 1, media: 2, baixa: 3,
});

export type SituacaoDoPrazo = 'concluida' | 'atrasada' | 'hoje' | 'esta_semana' | 'adiante' | 'sem_prazo';

export interface TarefaMinima {
  readonly status: StatusDaTarefa;
  readonly prazo: DataISO | null;
  readonly prioridade: Prioridade;
}

/**
 * Onde a tarefa está em relação ao prazo, contando DIAS ÚTEIS FORENSES.
 *
 * Reaproveita a contagem do módulo de processos de propósito: uma tarefa que
 * "vence sexta" não está atrasada no sábado, e "esta semana" não pode contar
 * o fim de semana como dia de trabalho.
 */
export function situacaoDoPrazo(t: TarefaMinima, hoje: DataISO): SituacaoDoPrazo {
  if (t.status === 'concluida') return 'concluida';
  if (!t.prazo) return 'sem_prazo';
  if (comparar(t.prazo, hoje) < 0) return 'atrasada';
  const restantes = diasUteisAte(hoje, t.prazo);
  if (restantes === 0) return 'hoje';
  return restantes <= 5 ? 'esta_semana' : 'adiante';
}

/** Ordem de exibição dentro de uma coluna: atrasadas, depois urgência, depois prazo. */
export function ordenar<T extends TarefaMinima>(tarefas: readonly T[], hoje: DataISO): T[] {
  const peso = (t: T) => {
    const s = situacaoDoPrazo(t, hoje);
    return s === 'atrasada' ? -1 : PESO[t.prioridade];
  };
  return [...tarefas].sort((a, b) => {
    const d = peso(a) - peso(b);
    if (d !== 0) return d;
    if (a.prazo && b.prazo) return comparar(a.prazo, b.prazo);
    if (a.prazo) return -1;
    if (b.prazo) return 1;
    return 0;
  });
}

export interface ResumoDeTarefas {
  readonly total: number;
  readonly abertas: number;
  readonly concluidas: number;
  readonly atrasadas: number;
  readonly percentualConcluido: number;
  readonly porStatus: Readonly<Record<StatusDaTarefa, number>>;
}

export function resumir(tarefas: readonly TarefaMinima[], hoje: DataISO): ResumoDeTarefas {
  const porStatus: Record<StatusDaTarefa, number> = {
    a_fazer: 0, em_andamento: 0, em_revisao: 0, concluida: 0,
  };
  let atrasadas = 0;
  for (const t of tarefas) {
    porStatus[t.status]++;
    if (situacaoDoPrazo(t, hoje) === 'atrasada') atrasadas++;
  }
  const total = tarefas.length;
  const concluidas = porStatus.concluida;
  return {
    total, abertas: total - concluidas, concluidas, atrasadas,
    // Sem tarefa nenhuma NÃO é 100%: é "sem dado". O chamador decide como
    // mostrar; zero aqui evita que um projeto vazio pareça pronto.
    percentualConcluido: total === 0 ? 0 : Math.round((concluidas / total) * 100),
    porStatus,
  };
}
