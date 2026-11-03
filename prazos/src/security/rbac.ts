export type Role = 'admin' | 'operator' | 'auditor' | 'viewer';
export type Permission =
  | 'records:read' | 'run:start' | 'records:approve' | 'records:comment' | 'records:audit'
  | 'write:authorize' | 'write:execute' | 'correction:request' | 'correction:authorize'
  | 'audit:read' | 'users:manage';

const P: Record<Role, Permission[]> = {
  viewer: ['records:read'],
  operator: ['records:read', 'run:start', 'records:approve', 'records:comment', 'correction:request'],
  auditor: ['records:read', 'records:approve', 'records:comment', 'records:audit', 'correction:request', 'correction:authorize', 'audit:read'],
  admin: ['records:read', 'run:start', 'records:approve', 'records:comment', 'records:audit', 'write:authorize', 'write:execute', 'correction:request', 'correction:authorize', 'audit:read', 'users:manage'],
};

export const can = (role: Role, perm: Permission) => P[role].includes(perm);
export class Forbidden extends Error {
  constructor(public perm: Permission) {
    super(`Permissão insuficiente: ${perm}`);
  }
}
export function require(role: Role, perm: Permission) {
  if (!can(role, perm)) throw new Forbidden(perm);
}
export const ROLE_PERMISSIONS = P;
