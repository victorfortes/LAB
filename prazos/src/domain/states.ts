/**
 * Máquina de estados de um registro (publicação). Ver docs/STATES.md.
 * Qualquer transição fora desta tabela lança erro.
 */
export type RecordState =
  | 'classified' // classificada, sem alerta; aguarda aprovação
  | 'needs_review' // ambiguidade/baixa confiança; exige análise humana
  | 'no_action' // sem providência/prazo identificado
  | 'approved' // aprovada por humano (ainda não gravada no Astrea)
  | 'rejected'
  | 'write_queued'
  | 'confirmed' // gravada E conferida por leitura posterior no Astrea
  | 'divergent' // lida de volta diferente do esperado
  | 'write_failed' // erro/resultado desconhecido; exige verificação
  | 'correction_requested'
  | 'correction_authorized'
  | 'revalidation_pending' // corrigida e relida; humano precisa revalidar
  | 'audited'; // "Auditoria feita"

export type RecordEvent =
  | 'approve'
  | 'reject'
  | 'reopen'
  | 'queue_write'
  | 'verify_ok'
  | 'verify_mismatch'
  | 'write_error'
  | 'request_correction'
  | 'authorize_correction'
  | 'correction_applied'
  | 'correction_failed'
  | 'mark_audited';

const T: Record<RecordState, Partial<Record<RecordEvent, RecordState>>> = {
  classified: { approve: 'approved', reject: 'rejected' },
  needs_review: { approve: 'approved', reject: 'rejected' },
  no_action: { approve: 'approved', reject: 'rejected', mark_audited: 'audited' },
  approved: { queue_write: 'write_queued', mark_audited: 'audited', reject: 'rejected' },
  rejected: { reopen: 'needs_review' },
  write_queued: { verify_ok: 'confirmed', verify_mismatch: 'divergent', write_error: 'write_failed' },
  confirmed: { request_correction: 'correction_requested', mark_audited: 'audited' },
  divergent: { request_correction: 'correction_requested', queue_write: 'write_queued', reject: 'rejected' },
  write_failed: { queue_write: 'write_queued', reject: 'rejected' },
  correction_requested: { authorize_correction: 'correction_authorized', reject: 'confirmed' },
  correction_authorized: { correction_applied: 'revalidation_pending', correction_failed: 'divergent' },
  revalidation_pending: { mark_audited: 'audited', request_correction: 'correction_requested' },
  audited: { request_correction: 'correction_requested' },
};

export class InvalidTransition extends Error {
  constructor(public from: RecordState, public event: RecordEvent) {
    super(`Transição inválida: ${from} --${event}-->`);
  }
}

export function transition(from: RecordState, event: RecordEvent): RecordState {
  const to = T[from]?.[event];
  if (!to) throw new InvalidTransition(from, event);
  return to;
}

export const canTransition = (from: RecordState, event: RecordEvent) => !!T[from]?.[event];
export const STATE_TABLE = T;
