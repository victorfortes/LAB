import type { RawPublication } from '../domain/types.ts';

export class SessionExpiredError extends Error {
  constructor(msg = 'Sessão do Astrea expirada ou não autenticada') { super(msg); }
}
/** Lançado quando um fluxo/seletor ainda não foi mapeado e confirmado por reconhecimento. */
export class NotMappedError extends Error {
  constructor(public what: string) { super(`Não mapeado: ${what}. Execute o reconhecimento (docs/RECON-PLAYBOOK.md).`); }
}
export class ReadOnlyViolation extends Error {
  constructor(op: string) { super(`Operação de escrita bloqueada em modo somente leitura: ${op}`); }
}

export interface AstreaSchedule {
  id: string;
  processNumber: string;
  title: string;
  description: string;
  dueDate: string; // YYYY-MM-DD
  responsible: string | null;
}
export interface TaskInput {
  publicationId: string; title: string; dueDate: string; responsible: string | null; priority: 'Baixa' | 'Média' | 'Alta';
  kanban: { board: string; column: string } | null;
}
export interface WorkflowInput {
  publicationId: string;
  /** Título do prazo no cartão (para achar o cartão certo na publicação). */
  prazoTitle: string;
  /** Quantidade de dias do prazo: escolhe o workflow PRAZO 05/10/15/30 DIAS CORRIDOS. */
  amount: number;
}
export const WORKFLOW_SIZES = [5, 10, 15, 30] as const;
/** Menor workflow com N >= dias do prazo; acima de 30, o de 30. */
export const workflowSizeFor = (amount: number): number => WORKFLOW_SIZES.find((n) => n >= amount) ?? 30;
export const workflowName = (n: number) => `PRAZO ${String(n).padStart(2, '0')} DIAS CORRIDOS`;
export interface ScheduleInput {
  processNumber: string;
  title: string;
  description: string;
  dueDate: string;
  responsible: string | null;
  /** Marcador de idempotência embutido na descrição, para localizar duplicatas. */
  idempotencyKey: string;
  /** Dados extras usados pelo adaptador REAL (formulário do Astrea). O simulador os ignora. */
  live?: {
    publicationId: string;
    amount: number;
    unit: 'dias_uteis' | 'dias_corridos';
    kanban: { board: string; column: string } | null;
    /** Antecedência do alerta (dias). O formulário real tem UM campo de alerta. */
    alertDays: number | null;
  };
}

export interface AstreaReader {
  readonly mode: 'simulated' | 'live';
  /** Verifica sessão. Lança SessionExpiredError se não autenticada. Nunca tenta logar sozinho. */
  assertSession(): Promise<void>;
  listUntreatedPublications(opts: { limit: number; onProgress?: (p: { stage: 'lendo'; done: number; total: number }) => void }): Promise<RawPublication[]>;
  findSchedules(processNumber: string): Promise<AstreaSchedule[]>;
  readSchedule(id: string): Promise<AstreaSchedule | null>;
  /** Opcional: erros por item acumulados na última leitura (esvazia a lista). */
  takeReadErrors?(): string[];
}
export interface AstreaWriter {
  createSchedule(input: ScheduleInput): Promise<{ id: string }>;
  updateSchedule(id: string, patch: Partial<Pick<AstreaSchedule, 'title' | 'description' | 'dueDate' | 'responsible'>>): Promise<void>;
}
/** Ensaio: abre o formulário, preenche, lê o cálculo e CANCELA. Não grava nada (as requisições de escrita são abortadas). */
export interface DryRunInput {
  publicationId: string;
  title: string;
  amount: number;
  unit: 'dias_uteis' | 'dias_corridos';
  /** Vencimento calculado pelo robô (YYYY-MM-DD) para comparar com a calculadora do Astrea. */
  expectedDueDate: string | null;
}
export interface DryRunResult {
  ok: boolean;
  reason?: string;
  astrea: { publicationDate: string | null; startDate: string | null; dueDate: string | null; holidays: Array<{ name: string; date: string }> };
  /** A "Data limite" do Astrea é igual à do robô? Se não, NÃO gravar. */
  matches: boolean;
  kanban: { boards: string[]; columns: Record<string, string[]> };
  multipleAlerts: boolean;
  cancelled: boolean;
  /** Requisições de escrita que a página tentou fazer (devem ser 0 no ensaio). */
  writeAttempts: number;
}

export type AstreaPort = AstreaReader & AstreaWriter & {
  dryRunSchedule?(i: DryRunInput): Promise<DryRunResult>;
  /** Prazos exibidos no cartão "Tratamentos" da própria publicação (fonte principal de releitura/idempotência no Astrea real). */
  listPublicationSchedules?(publicationId: string, processNumber: string): Promise<AstreaSchedule[]>;
  /** Aplica ao PRAZO o workflow "PRAZO N DIAS CORRIDOS" (tela de detalhes do prazo > Adicionar workflows) e confirma lendo as atividades criadas. */
  applyWorkflow?(i: WorkflowInput): Promise<{ workflow: string; confirmed: boolean; adopted: boolean; note?: string }>;
  /** Cria uma TAREFA pela tela da publicação (Tratamentos > Adicionar tarefa) e confirma relendo a publicação. */
  createTask?(i: TaskInput): Promise<{ id: string; confirmed: boolean; note?: string }>;
  /** Já existe, nesta publicação, uma tarefa com esta descrição? (evita duplicar após falha com resultado desconhecido) */
  taskExists?(publicationId: string, title: string): Promise<boolean>;
  /** Marca a publicação como TRATADA no Astrea (botão Concluir) e confirma relendo o status. Só depois do prazo gravado e conferido. */
  concludePublication?(publicationId: string): Promise<{ treated: boolean; status: string }>;
};

/** Marcador usado na descrição para localizar agendamentos criados pelo robô. */
export const markerFor = (key: string) => `[NGA:${key}]`;

/** Envolve um port deixando-o estritamente somente leitura. */
export function readOnly(p: AstreaPort): AstreaPort {
  return {
    get mode() { return p.mode; },
    assertSession: () => p.assertSession(),
    listUntreatedPublications: (o) => p.listUntreatedPublications(o),
    findSchedules: (n) => p.findSchedules(n),
    readSchedule: (i) => p.readSchedule(i),
    takeReadErrors: p.takeReadErrors ? () => p.takeReadErrors!() : undefined,
    createSchedule: async () => { throw new ReadOnlyViolation('createSchedule'); },
    updateSchedule: async () => { throw new ReadOnlyViolation('updateSchedule'); },
  };
}
