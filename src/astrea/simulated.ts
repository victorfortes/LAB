import { SessionExpiredError, type AstreaPort, type AstreaSchedule, type DryRunInput, type DryRunResult, type ScheduleInput } from './port.ts';
import type { RawPublication } from '../domain/types.ts';

/** Publicações 100% fictícias (nomes e números inventados) para demonstração e testes. */
export const DEMO_PUBLICATIONS: RawPublication[] = [
  { externalId: 'SIM-001', processNumber: '0001234-56.2025.8.16.0001', clientName: 'Cliente Alfa Ltda (fictício)', availabilityDate: '2026-03-02',
    fullText: 'Intime-se a parte requerida para apresentar contestação no prazo de 15 (quinze) dias úteis, sob pena de revelia.' },
  { externalId: 'SIM-002', processNumber: '0002345-67.2025.8.16.0001', clientName: 'Beta Comércio S/A (fictício)', availabilityDate: '2026-03-03',
    fullText: 'Intimem-se as partes. Ao autor, manifeste-se sobre a contestação e documentos no prazo de 15 dias. Ao réu, especifiquem provas no prazo de 5 dias.' },
  { externalId: 'SIM-003', processNumber: '0003456-78.2025.8.16.0001', clientName: 'Gama Serviços (fictício)', availabilityDate: '2026-03-03',
    fullText: 'Certifico a juntada do AR. Conclusos os autos ao Juízo.' },
  { externalId: 'SIM-004', processNumber: '0004567-89.2025.8.16.0001', clientName: 'Delta Energia (fictício)', availabilityDate: '2026-03-04',
    fullText: 'A Fazenda Pública do Estado deverá apresentar contrarrazões, em prazo em dobro, a contar da intimação pessoal.' },
  { externalId: 'SIM-005', processNumber: '0005678-90.2025.8.16.0001', clientName: 'Épsilon Indústria (fictício)', availabilityDate: '2026-03-05',
    fullText: 'Designo audiência de conciliação para o dia 20/04/2026, às 14h30. Intimem-se.' },
  { externalId: 'SIM-006', processNumber: '0006789-01.2025.8.16.0001', clientName: 'Zeta Transportes (fictício)', availabilityDate: '2026-03-05',
    fullText: 'Cumpra-se no prazo legal, sob as penas da lei.' },
  { externalId: 'SIM-007', processNumber: '0009999-99.2025.8.16.0001', clientName: 'Fora do Escopo (fictício)', availabilityDate: '2026-03-05',
    fullText: 'Manifeste-se a parte autora em 10 dias.' },
  { externalId: 'SIM-008', processNumber: '0007890-12.2025.8.16.0001', clientName: 'Eta Participações (fictício)', availabilityDate: '2026-03-06',
    fullText: 'Recolha-se o preparo recursal no prazo de 5 (cinco) dias, sob pena de deserção.' },
];
export const DEMO_AUTHORIZED = [
  { processNumber: '0001234-56.2025.8.16.0001', responsible: 'Dra. Ana (fictícia)' },
  { processNumber: '0002345-67.2025.8.16.0001', responsible: 'Dr. Bruno (fictício)' },
  { processNumber: '0003456-78.2025.8.16.0001', responsible: 'Dra. Ana (fictícia)' },
  { processNumber: '0004567-89.2025.8.16.0001', responsible: 'Dr. Bruno (fictício)' },
  { processNumber: '0005678-90.2025.8.16.0001', responsible: 'Dra. Ana (fictícia)' },
  { processNumber: '0006789-01.2025.8.16.0001', responsible: null },
  { processNumber: '0007890-12.2025.8.16.0001', responsible: 'Dr. Bruno (fictício)' },
];

export interface SimFaults {
  /** Lança SessionExpiredError após N publicações lidas. */
  expireSessionAfterReads?: number;
  /** Próximo createSchedule grava com dueDate deslocado (simula divergência). */
  driftNextWrite?: boolean;
  /** Próximo createSchedule grava mas lança erro (resultado desconhecido). */
  failAfterWriteOnce?: boolean;
  delayMs?: number;
}

export class SimulatedAstrea implements AstreaPort {
  readonly mode = 'simulated' as const;
  schedules = new Map<string, AstreaSchedule>();
  writes = 0;
  private reads = 0;
  private seq = 100;
  constructor(public publications: RawPublication[] = DEMO_PUBLICATIONS, public faults: SimFaults = {}) {}

  private sleep() { return this.faults.delayMs ? new Promise((r) => setTimeout(r, this.faults.delayMs)) : Promise.resolve(); }

  async assertSession() {
    if (this.faults.expireSessionAfterReads !== undefined && this.reads >= this.faults.expireSessionAfterReads) throw new SessionExpiredError();
  }
  async listUntreatedPublications({ limit, onProgress }: { limit: number; onProgress?: (p: { stage: 'lendo'; done: number; total: number }) => void }) {
    await this.assertSession();
    this.reads++;
    await this.sleep();
    const out = structuredClone(this.publications.slice(0, limit));
    onProgress?.({ stage: 'lendo', done: out.length, total: out.length });
    return out;
  }
  async findSchedules(processNumber: string) {
    await this.assertSession();
    return structuredClone([...this.schedules.values()].filter((s) => s.processNumber === processNumber));
  }
  treatedPublications = new Set<string>();
  workflows: Array<{ publicationId: string; prazoTitle: string; workflow: string }> = [];
  async applyWorkflow(i: import('./port.ts').WorkflowInput) { await this.assertSession(); const { workflowName, workflowSizeFor } = await import('./port.ts'); const name = workflowName(workflowSizeFor(i.amount)); const had = this.workflows.some((w) => w.publicationId === i.publicationId && w.prazoTitle === i.prazoTitle); if (!had) this.workflows.push({ publicationId: i.publicationId, prazoTitle: i.prazoTitle, workflow: name }); return { workflow: name, confirmed: true, adopted: had }; }
  tasks: Array<{ publicationId: string; title: string; dueDate: string; responsible: string | null; priority: string }> = [];
  async taskExists(publicationId: string, title: string) { await this.assertSession(); return this.tasks.some((t) => t.publicationId === publicationId && t.title === title); }
  async createTask(i: import('./port.ts').TaskInput) { await this.assertSession(); this.tasks.push({ publicationId: i.publicationId, title: i.title, dueDate: i.dueDate, responsible: i.responsible, priority: i.priority }); return { id: `TAREFA-${this.tasks.length}`, confirmed: true }; }
  async concludePublication(publicationId: string) { await this.assertSession(); this.treatedPublications.add(publicationId); return { treated: true, status: 'TRATADA' }; }
  async readSchedule(id: string) { await this.assertSession(); return structuredClone(this.schedules.get(id) ?? null); }

  /** Ensaio simulado: devolve o resultado "ideal" (cálculo confere, sem escrita). */
  async dryRunSchedule(i: DryRunInput): Promise<DryRunResult> {
    await this.assertSession();
    return {
      ok: true, matches: !!i.expectedDueDate, cancelled: true, writeAttempts: 0, multipleAlerts: false,
      astrea: { publicationDate: null, startDate: null, dueDate: i.expectedDueDate, holidays: [] },
      kanban: { boards: ['Kanban Padrão', 'FLUXO NGA'], columns: { 'Kanban Padrão': ['A Fazer', 'Fazendo', 'Concluído'], 'FLUXO NGA': ['A Fazer', 'Fazendo', 'Concluído'] } },
    };
  }

  async createSchedule(i: ScheduleInput) {
    await this.assertSession();
    await this.sleep();
    const id = `AGD-${++this.seq}`;
    const drift = this.faults.driftNextWrite; this.faults.driftNextWrite = false;
    const due = drift ? new Date(Date.parse(`${i.dueDate}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10) : i.dueDate;
    this.schedules.set(id, { id, processNumber: i.processNumber, title: i.title, description: i.description, dueDate: due, responsible: i.responsible });
    this.writes++;
    if (this.faults.failAfterWriteOnce) { this.faults.failAfterWriteOnce = false; throw new Error('timeout após envio (resultado desconhecido)'); }
    return { id };
  }
  async updateSchedule(id: string, patch: Partial<AstreaSchedule>) {
    await this.assertSession();
    const s = this.schedules.get(id); if (!s) throw new Error(`agendamento ${id} inexistente`);
    const { id: _ignore, processNumber: _p, ...safe } = patch as AstreaSchedule;
    Object.assign(s, safe); this.writes++;
  }
}
