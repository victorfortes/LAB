import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault, maskEmail } from '../src/security/vault.ts';

const keyA = async () => Buffer.alloc(32, 7);
const keyB = async () => Buffer.alloc(32, 9);
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'nga-vault-')); return { d, f: join(d, 'v.json') }; };

describe('cofre de credenciais', () => {
  test('cifra: o arquivo NÃO contém e-mail nem senha em texto claro; round-trip ok', async () => {
    const { d, f } = tmp();
    const v = new Vault(f, keyA);
    await v.save('astrea', { email: 'robo@exemplo.test', password: 'senha-fake-123' });
    const raw = readFileSync(f, 'utf8');
    expect(raw).not.toContain('robo@exemplo.test');
    expect(raw).not.toContain('senha-fake-123');
    expect(await v.load('astrea')).toEqual({ email: 'robo@exemplo.test', password: 'senha-fake-123' });
    expect(v.has('astrea')).toBe(true);
    rmSync(d, { recursive: true });
  });
  test('arquivo com permissão 600', async () => {
    const { d, f } = tmp();
    await new Vault(f, keyA).save('astrea', { email: 'a@b.c', password: 'xxxxxx' });
    expect((statSync(f).mode & 0o777).toString(8)).toBe('600');
    rmSync(d, { recursive: true });
  });
  test('chave errada ou arquivo adulterado ⇒ erro (nunca devolve lixo)', async () => {
    const { d, f } = tmp();
    await new Vault(f, keyA).save('astrea', { email: 'a@b.c', password: 'xxxxxx' });
    await expect(new Vault(f, keyB).load('astrea')).rejects.toThrow(/corrompido|incorreta/);
    const j = JSON.parse(readFileSync(f, 'utf8'));
    const ct = Buffer.from(j.entries.astrea.ct, 'base64'); ct[0] = ct[0]! ^ 1; j.entries.astrea.ct = ct.toString('base64');
    writeFileSync(f, JSON.stringify(j));
    await expect(new Vault(f, keyA).load('astrea')).rejects.toThrow();
    rmSync(d, { recursive: true });
  });
  test('o segredo só decifra sob o MESMO nome (AAD)', async () => {
    const { d, f } = tmp();
    const v = new Vault(f, keyA);
    await v.save('astrea', { email: 'a@b.c', password: 'xxxxxx' });
    const j = JSON.parse(readFileSync(f, 'utf8')); j.entries.outro = j.entries.astrea; writeFileSync(f, JSON.stringify(j));
    await expect(v.load('outro')).rejects.toThrow();
    rmSync(d, { recursive: true });
  });
  test('remover; ausente ⇒ null; máscara de e-mail', async () => {
    const { d, f } = tmp();
    const v = new Vault(f, keyA);
    expect(await v.load('astrea')).toBeNull();
    await v.save('astrea', { email: 'a@b.c', password: 'xxxxxx' });
    v.remove('astrea');
    expect(v.has('astrea')).toBe(false);
    expect(maskEmail('victor@nga.adv.br')).toBe('v***@nga.adv.br');
    rmSync(d, { recursive: true });
  });
});
