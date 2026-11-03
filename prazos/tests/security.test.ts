import { describe, expect, test } from 'bun:test';
import { nextEntry, verifyChain, type AuditEntry } from '../src/audit/chain.ts';
import { LoginLimiter, Tokens, hashPassword, verifyPassword } from '../src/security/auth.ts';
import { maskDeep, maskString } from '../src/security/mask.ts';
import { can, require as req, Forbidden } from '../src/security/rbac.ts';

describe('mask', () => {
  test('CPF, CNPJ, e-mail, CNJ', () => {
    const s = maskString('CPF 123.456.789-09 cnpj 12.345.678/0001-90 a@b.com proc 0001234-56.2025.8.16.0001');
    expect(s).not.toContain('123.456.789-09');
    expect(s).not.toContain('12.345.678/0001-90');
    expect(s).not.toContain('a@b.com');
    expect(s).not.toContain('0001234-56');
  });
  test('chaves secretas e texto integral nunca vão a logs', () => {
    const m = maskDeep({ password: 'x', nested: { Authorization: 'Bearer y', fullText: 'segredo de justiça' }, ok: 'visível' }) as any;
    expect(m.password).toBe('[REDACTED]');
    expect(m.nested.Authorization).toBe('[REDACTED]');
    expect(m.nested.fullText).toContain('omitido');
    expect(m.ok).toBe('visível');
  });
});

describe('auth', () => {
  test('hash/verify e senha curta rejeitada', async () => {
    const h = await hashPassword('uma-senha-longa-123');
    expect(await verifyPassword('uma-senha-longa-123', h)).toBe(true);
    expect(await verifyPassword('errada-errada-123', h)).toBe(false);
    await expect(hashPassword('curta')).rejects.toThrow();
  });
  test('JWT assina/verifica e rejeita adulterado/segredo fraco', async () => {
    const t = new Tokens('s'.repeat(40));
    const tok = await t.sign({ sub: '1', username: 'u', role: 'admin' });
    expect((await t.verify(tok))?.role).toBe('admin');
    expect(await t.verify(tok.slice(0, -2) + 'xx')).toBeNull();
    expect(() => new Tokens('curto')).toThrow();
    expect(await new Tokens('z'.repeat(40)).verify(tok)).toBeNull();
  });
  test('limitador bloqueia após 5 falhas', () => {
    const l = new LoginLimiter(5, 1000);
    for (let i = 0; i < 5; i++) l.fail('k', 0);
    expect(l.blocked('k', 500)).toBe(true);
    expect(l.blocked('k', 2000)).toBe(false);
  });
});

describe('rbac', () => {
  test('viewer não aprova; operator não autoriza escrita; só admin executa escrita', () => {
    expect(can('viewer', 'records:approve')).toBe(false);
    expect(can('operator', 'write:authorize')).toBe(false);
    expect(can('auditor', 'write:execute')).toBe(false);
    expect(can('admin', 'write:execute')).toBe(true);
    expect(() => req('viewer', 'run:start')).toThrow(Forbidden);
  });
});

describe('audit chain', () => {
  const build = () => {
    const l: AuditEntry[] = [];
    for (let i = 0; i < 4; i++) l.push(nextEntry(l.at(-1) ?? null, { actor: 'a', action: 'x', entityType: 'e', entityId: String(i), data: { n: i, cpf: '123.456.789-09' } }));
    return l;
  };
  test('cadeia íntegra e dados mascarados', () => {
    const l = build();
    expect(verifyChain(l).ok).toBe(true);
    expect(JSON.stringify(l)).not.toContain('123.456.789-09');
  });
  test('adulteração e remoção são detectadas', () => {
    const l = build();
    (l[1]!.data as any).n = 99;
    expect(verifyChain(l)).toEqual({ ok: false, brokenAt: 2 });
    const m = build(); m.splice(1, 1);
    expect(verifyChain(m).ok).toBe(false);
  });
});
