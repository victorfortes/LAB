import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { SignJWT, jwtVerify } from 'jose';
import type { Role } from './rbac.ts';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export async function hashPassword(pw: string): Promise<string> {
  if (pw.length < 12) throw new Error('Senha deve ter ao menos 12 caracteres');
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt, 64);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [alg, s, k] = stored.split('$');
  if (alg !== 'scrypt' || !s || !k) return false;
  const expected = Buffer.from(k, 'base64');
  const key = await scrypt(pw, Buffer.from(s, 'base64'), expected.length);
  return timingSafeEqual(key, expected);
}

export interface Session {
  sub: string;
  username: string;
  role: Role;
}

export class Tokens {
  private key: Uint8Array;
  constructor(secret: string, private ttlSeconds = 8 * 3600) {
    if (Buffer.byteLength(secret) < 32) throw new Error('JWT_SECRET precisa ter >= 32 bytes');
    this.key = new TextEncoder().encode(secret);
  }
  sign(s: Session) {
    return new SignJWT({ username: s.username, role: s.role })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(s.sub)
      .setIssuedAt()
      .setExpirationTime(`${this.ttlSeconds}s`)
      .sign(this.key);
  }
  async verify(token: string): Promise<Session | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, { algorithms: ['HS256'] });
      return { sub: String(payload.sub), username: String(payload.username), role: payload.role as Role };
    } catch {
      return null;
    }
  }
}

/** Limitador simples de tentativas de login (por usuário+IP), em memória. */
export class LoginLimiter {
  private hits = new Map<string, { n: number; until: number }>();
  constructor(private max = 5, private windowMs = 15 * 60_000) {}
  blocked(key: string, now = Date.now()) {
    const h = this.hits.get(key);
    return !!h && h.n >= this.max && now < h.until;
  }
  fail(key: string, now = Date.now()) {
    const h = this.hits.get(key);
    if (!h || now >= h.until) this.hits.set(key, { n: 1, until: now + this.windowMs });
    else h.n++;
  }
  ok(key: string) {
    this.hits.delete(key);
  }
}
