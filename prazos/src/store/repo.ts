import type { AuditEntry } from '../audit/chain.ts';
import type { AuthorizedProcess } from '../domain/types.ts';
import type { Comment, Correction, Rec, Run, User, WriteAuthorization, WriteOp, LabDelivery } from './models.ts';

export class RunInProgress extends Error {
  constructor(public runId: string) {
    super(`Já existe execução ativa (${runId}). Execução concorrente bloqueada.`);
  }
}
export class VersionConflict extends Error {
  constructor() {
    super('Registro modificado por outra operação (conflito de versão).');
  }
}

export interface AuditInput { actor: string; action: string; entityType: string; entityId: string; data?: unknown }

export interface Repo {
  enqueueLabDelivery(delivery:LabDelivery):Promise<void>;
  listLabDeliveries():Promise<LabDelivery[]>;
  updateLabDelivery(key:string,patch:Partial<LabDelivery>):Promise<void>;

  getUserByName(username: string): Promise<User | null>;
  createUser(u: User): Promise<void>;

  /** Cria a execução apenas se não houver outra ativa (lock atômico). Marca como abandonada a ativa sem heartbeat há `staleMs`. */
  tryStartRun(run: Run, staleMs: number): Promise<void>;
  updateRun(id: string, patch: Partial<Run>): Promise<Run>;
  getRun(id: string): Promise<Run | null>;
  listRuns(limit?: number): Promise<Run[]>;

  listAuthorizedProcesses(): Promise<AuthorizedProcess[]>;
  setAuthorizedProcesses(list: AuthorizedProcess[]): Promise<void>;

  /** Retorna false se já existe registro com o mesmo externalId. */
  insertRecord(r: Rec): Promise<boolean>;
  getRecord(id: string): Promise<Rec | null>;
  /** Atualização com controle otimista de versão. */
  updateRecord(id: string, patch: Partial<Rec>, expectedVersion: number): Promise<Rec>;
  listRecords(f?: { runId?: string; state?: string }): Promise<Rec[]>;
  existsExternalId(externalId: string): Promise<boolean>;

  addComment(c: Comment): Promise<void>;
  listComments(recordId: string): Promise<Comment[]>;

  addWriteAuthorization(a: WriteAuthorization): Promise<void>;
  listWriteAuthorizations(): Promise<WriteAuthorization[]>;
  revokeWriteAuthorization(id: string, at: string): Promise<void>;

  /** Reivindica a chave de idempotência. claimed=false => já existe (retorna existente). */
  claimWriteOp(op: WriteOp): Promise<{ claimed: boolean; existing: WriteOp }>;
  updateWriteOp(key: string, patch: Partial<WriteOp>): Promise<WriteOp>;
  listWriteOps(recordId: string): Promise<WriteOp[]>;
  /** Todos os lançamentos do robô (controle geral). */
  listAllWriteOps(): Promise<WriteOp[]>;

  addCorrection(c: Correction): Promise<void>;
  getCorrection(id: string): Promise<Correction | null>;
  updateCorrection(id: string, patch: Partial<Correction>): Promise<Correction>;
  listCorrections(recordId: string): Promise<Correction[]>;

  /** Append-only. Não existe update/delete de auditoria. */
  appendAudit(i: AuditInput): Promise<AuditEntry>;
  listAudit(f?: { entityId?: string; limit?: number }): Promise<AuditEntry[]>;
  verifyAudit(): Promise<{ ok: boolean; brokenAt?: number; count: number }>;
}
