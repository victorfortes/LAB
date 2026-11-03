export type Unit = 'dias_uteis' | 'dias_corridos' | 'horas' | 'meses' | 'anos';
export type ActionKind = 'prazo' | 'audiencia' | 'sem_providencia';

export interface Evidence {
  rule: string;
  quote: string;
  start: number;
  end: number;
}

export interface DeadlineCalc {
  amount: number;
  unit: Unit;
  /** Data (YYYY-MM-DD) a partir da qual o prazo começa a correr (1º dia contado). */
  startTerm: string;
  /** Data (YYYY-MM-DD) do vencimento calculado. */
  /** Null quando a unidade não é calculável automaticamente (horas/meses/anos). */
  endTerm: string | null;
  /** Fundamento legível do cálculo. */
  basis: string;
}

export interface ProposedAction {
  id: string;
  kind: ActionKind;
  description: string;
  deadline: DeadlineCalc | null;
  /** Para audiência: data/hora indicada no texto. */
  eventAt: string | null;
  responsible: string | null;
  confidence: number; // 0..1
  ambiguous: boolean;
  ambiguityReasons: string[];
  evidence: Evidence[];
  /** Ordem dirigida a terceiro (Administrador Judicial, Recuperanda, MP): nunca é agendada pelo robô. */
  notOurs?: boolean;
  /** Edição humana antes do lançamento: título/observações exatos e/ou prazo (dias e tipo). */
  edit?: { title?: string; notes?: string; amount?: number; unit?: 'dias_corridos' | 'dias_uteis'; by: string; at: string };
}

export interface Analysis {
  summary: string;
  actions: ProposedAction[];
  confidence: number;
  flags: string[];
  classifierVersion: string;
}

/** Sugestão de prazo exibida pelo próprio Astrea (IA/detecção). Serve só como conferência cruzada. */
export interface AstreaHint {
  title: string | null;
  dueDate: string | null; // YYYY-MM-DD
  responsible: string | null;
}

export interface RawPublication {
  externalId: string;
  processNumber: string;
  clientName: string;
  /** Data de disponibilização (YYYY-MM-DD). */
  availabilityDate: string;
  fullText: string;
  /** Responsável do processo segundo o Astrea (opcional). */
  responsible?: string | null;
  /** Sugestões do Astrea (opcional; somente leitura). */
  hints?: AstreaHint[];
}

export interface AuthorizedProcess {
  processNumber: string;
  responsible: string | null;
}
