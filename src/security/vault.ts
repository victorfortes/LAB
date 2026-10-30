import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Cofre de credenciais (AES-256-GCM). O arquivo no disco só contém texto cifrado; a CHAVE nunca fica no repositório nem no arquivo:
 *  - `NGA_VAULT_KEY` (base64 de 32 bytes), ou
 *  - Keychain do macOS (serviço "nga-prazos-vault", conta "key"), criada na 1ª gravação.
 * Sem chave não há fallback em texto claro: a operação falha.
 * Os segredos NUNCA são logados (maskDeep redige chaves "password/senha"), nem devolvidos pela API.
 */
export interface VaultSecret { email: string; password: string }

interface VaultFile { v: 1; entries: Record<string, { iv: string; tag: string; ct: string }> }

export type KeyProvider = (create: boolean) => Promise<Buffer>;

const SERVICE = 'nga-prazos-vault';

async function sh(cmd: string[], input?: string): Promise<{ code: number; out: string }> {
  const p = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'pipe', stdin: input ? new TextEncoder().encode(input) : undefined });
  const [out] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  return { code: await p.exited, out: out.trim() };
}

/** Chave do ambiente ou do Keychain do macOS. `create=true` gera e guarda uma chave nova no Keychain se não existir. */
export const defaultKeyProvider: KeyProvider = async (create) => {
  const env = process.env.NGA_VAULT_KEY;
  if (env) {
    const k = Buffer.from(env, 'base64');
    if (k.length !== 32) throw new Error('NGA_VAULT_KEY deve ser base64 de 32 bytes (ex.: openssl rand -base64 32)');
    return k;
  }
  if (process.platform !== 'darwin') throw new Error('Sem chave do cofre: defina NGA_VAULT_KEY (base64 de 32 bytes)');
  const got = await sh(['security', 'find-generic-password', '-s', SERVICE, '-a', 'key', '-w']);
  if (got.code === 0 && got.out) return Buffer.from(got.out, 'base64');
  if (!create) throw new Error('Cofre sem chave no Keychain');
  const key = randomBytes(32);
  const add = await sh(['security', 'add-generic-password', '-s', SERVICE, '-a', 'key', '-w', key.toString('base64'), '-U']);
  if (add.code !== 0) throw new Error('Não foi possível guardar a chave do cofre no Keychain');
  return key;
};

export class Vault {
  constructor(private file: string, private keys: KeyProvider = defaultKeyProvider) {}

  private read(): VaultFile {
    return existsSync(this.file) ? (JSON.parse(readFileSync(this.file, 'utf8')) as VaultFile) : { v: 1, entries: {} };
  }
  private write(f: VaultFile) {
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(f), { mode: 0o600 });
    chmodSync(this.file, 0o600);
  }

  async save(name: string, secret: VaultSecret): Promise<void> {
    const key = await this.keys(true);
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', key, iv);
    c.setAAD(Buffer.from(name)); // o segredo só decifra sob o MESMO nome
    const ct = Buffer.concat([c.update(JSON.stringify(secret), 'utf8'), c.final()]);
    const f = this.read();
    f.entries[name] = { iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), ct: ct.toString('base64') };
    this.write(f);
  }

  has(name: string): boolean {
    return !!this.read().entries[name];
  }

  async load(name: string): Promise<VaultSecret | null> {
    const e = this.read().entries[name];
    if (!e) return null;
    const key = await this.keys(false);
    const d = createDecipheriv('aes-256-gcm', key, Buffer.from(e.iv, 'base64'));
    d.setAAD(Buffer.from(name));
    d.setAuthTag(Buffer.from(e.tag, 'base64'));
    try {
      return JSON.parse(Buffer.concat([d.update(Buffer.from(e.ct, 'base64')), d.final()]).toString('utf8')) as VaultSecret;
    } catch {
      throw new Error('Cofre corrompido ou chave incorreta');
    }
  }

  remove(name: string): void {
    const f = this.read();
    delete f.entries[name];
    this.write(f);
  }
}

/** "victor@nga.adv.br" → "v***@nga.adv.br" (para exibir na tela sem expor o e-mail inteiro). */
export function maskEmail(email: string): string {
  const [u, d] = email.split('@');
  return u && d ? `${u[0]}***@${d}` : '***';
}
