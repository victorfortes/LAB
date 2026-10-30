/** Troca a senha de um usuário existente. Uso: NGA_NEW_PASSWORD=... bun scripts/set-password.ts <usuario> */
import { hashPassword } from '../src/security/auth.ts';
import { makePool, resolveDatabaseUrl } from '../src/store/connect.ts';

const [username] = process.argv.slice(2);
const password = process.env.NGA_NEW_PASSWORD;
const url = resolveDatabaseUrl(process.env);
if (!url || !username || !password || password.length < 12) { console.error('Faltam banco, usuário ou NGA_NEW_PASSWORD (mín. 12 caracteres)'); process.exit(1); }
const pool = makePool(url, process.env);
const r = await pool.query('UPDATE users SET password_hash=$1 WHERE username=$2', [await hashPassword(password), username]);
await pool.end();
console.log(r.rowCount ? `senha de ${username} alterada` : `usuário ${username} não existe`);
