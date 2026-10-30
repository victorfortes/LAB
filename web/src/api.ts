export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export async function api<T = any>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const r = await fetch(`/api${path}`, {
    method, headers: { 'content-type': 'application/json', 'x-nga': '1' }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(r.status, j.error ?? 'error', j.message ?? `Erro ${r.status}`);
  return j as T;
}

export const STATE_LABEL: Record<string, string> = {
  classified: 'Classificada', needs_review: 'Análise humana', no_action: 'Sem providência', approved: 'Aprovada',
  rejected: 'Rejeitada', write_queued: 'Gravando…', confirmed: 'Confirmada no Astrea', divergent: 'Divergente',
  write_failed: 'Falha na gravação', correction_requested: 'Correção solicitada', correction_authorized: 'Correção autorizada',
  revalidation_pending: 'Revalidar', audited: 'Auditada',
};
