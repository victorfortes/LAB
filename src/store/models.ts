import type { Role } from '../security/rbac.ts';
import type { Analysis } from '../domain/types.ts';
import type { RecordState } from '../domain/states.ts';

export interface User { id: string; username: string; passwordHash: string; role: Role; active: boolean }

export type RunStatus = 'running' | 'awaiting_login' | 'completed' | 'failed' | 'abandoned';
export interface RunProgress {
  total: number; processed: number; classified: number; needsReview: number;
  noAction: number; duplicates: number; skippedUnauthorized: number;
  /** Etapa atual da execução (para a barra de andamento). */
  stage?: 'iniciando' | 'login' | 'lendo' | 'classificando' | 'concluido';
  /** Leitura no Astrea: publicações lidas / a ler. */
  readDone?: number; readTotal?: number;
}
export interface Run {
  id: string; status: RunStatus; mode: 'simulated' | 'live'; startedBy: string;
  startedAt: string; finishedAt: string | null; heartbeatAt: string;
  progress: RunProgress; error: string | null;
}

export interface Rec {
  id: string; runId: string; externalId: string; processNumber: string; clientName: string;
  availabilityDate: string; fullText: string; analysis: Analysis; state: RecordState; version: number;
  approvedBy: string | null; approvedAt: string | null; acknowledgedFlags: boolean;
  auditedBy: string | null; auditedAt: string | null;
  /** Sugestões que o próprio Astrea exibiu (IA/detecção): conferência cruzada. */
  hints?: Array<{ title: string | null; dueDate: string | null; responsible: string | null }>;
  createdAt: string; updatedAt: string;
}

export interface Comment { id: string; recordId: string; author: string; text: string; createdAt: string }

export interface WriteAuthorization {
  id: string; createdBy: string; processNumbers: string[]; expiresAt: string;
  revokedAt: string | null; note: string; createdAt: string;
}

export type WriteOpStatus = 'pending' | 'confirmed' | 'divergent' | 'failed';
export interface WriteOp {
  key: string; recordId: string; actionId: string; status: WriteOpStatus;
  astreaId: string | null; expected: Record<string, unknown>;
  readBack: Record<string, unknown> | null; adopted: boolean; error: string | null;
  evidence: Array<{ at: string; step: string; detail: unknown }>; updatedAt: string;
}

export type CorrectionField = 'dueDate' | 'title' | 'responsible' | 'description';
export interface Correction {
  id: string; recordId: string; actionId: string; field: CorrectionField; expectedValue: string;
  justification: string; requestedBy: string; authorizedBy: string | null;
  status: 'requested' | 'authorized' | 'applied' | 'failed'; result: unknown; createdAt: string;
}
