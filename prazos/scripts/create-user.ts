/** Uso: DATABASE_URL=... NGA_NEW_PASSWORD=... bun scripts/create-user.ts <usuario> <admin|operator|auditor|viewer> */
import { randomUUID } from 'node:crypto';
import { makePool, resolveDatabaseUrl } from '../src/store/connect.ts';
import { hashPassword } from '../src/security/auth.ts';
import { PgRepo } from '../src/store/postgres.ts';

const [username, role] = process.argv.slice(2);
const password = process.env.NGA_NEW_PASSWORD;
const url = resolveDatabaseUrl(process.env);
if (!url || !username || !role || !password) { console.error('Faltam DATABASE_URL (ou Keychain), usuario, role ou NGA_NEW_PASSWORD'); process.exit(1); }
const pool = makePool(url, process.env);
await new PgRepo(pool).createUser({ id: randomUUID(), username, role: role as never, passwordHash: await hashPassword(password), active: true });
await pool.end();
console.log('usuário criado:', username);
