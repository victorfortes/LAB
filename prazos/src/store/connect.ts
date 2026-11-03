import { readFileSync } from 'node:fs';
import pg from 'pg';

/** DATABASE_URL do ambiente ou, no macOS, do Keychain (serviço nga-prazos-db, gravado por scripts/set-db-url.sh). */
export function resolveDatabaseUrl(env: Record<string, string | undefined>): string | null {
  if (env.DATABASE_URL) return env.DATABASE_URL;
  if (process.platform === 'darwin') {
    const k = Bun.spawnSync(['security', 'find-generic-password', '-s', 'nga-prazos-db', '-w']);
    if (k.exitCode === 0) return k.stdout.toString().trim() || null;
  }
  return null;
}

/** Fora da máquina local a conexão é sempre TLS COM verificação do certificado (CA própria, ex.: Supabase, em NGA_DB_CA). */
export function makePool(url: string, env: Record<string, string | undefined>): pg.Pool {
  const local = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url);
  const ca = env.NGA_DB_CA ?? (!local ? 'config/supabase-ca.pem' : undefined);
  const ssl = local ? undefined : { rejectUnauthorized: true, ...(ca ? { ca: readFileSync(ca, 'utf8') } : {}) };
  const pool = new pg.Pool({
    connectionString: url.replace(/[?&]sslmode=[^&]*/g, ''), ssl, max: 5,
    // Conexões ociosas são derrubadas pela rede/pooler do Supabase: descarta cedo, mantém vivas as ativas e não deixa a falha de uma conexão ociosa derrubar o app.
    keepAlive: true, keepAliveInitialDelayMillis: 10_000, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 15_000,
  });
  pool.on('error', (e) => console.error(JSON.stringify({ lvl: 'warn', msg: 'conexão ociosa com o banco caiu (será refeita)', err: String(e.message).slice(0, 120) })));
  return pool;
}
