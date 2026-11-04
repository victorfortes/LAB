/**
 * Copia os DADOS do banco local (PostgreSQL embarcado do Mac) para o schema `nga_lab` do Supabase.
 *
 * Só copia; não apaga nada em nenhum dos lados. Idempotente (ON CONFLICT DO NOTHING), então rodar de novo
 * não duplica. Sessões de login não são copiadas: todo mundo entra de novo. Os arquivos do acervo NÃO vão
 * por aqui — ficam no disco (ver README).
 *
 *   NGA_SUPABASE_URL='postgresql://postgres:SENHA@db.<ref>.supabase.co:5432/postgres' bun scripts/copiar-banco.ts
 */
import { Client } from 'pg';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const ESQUEMA = process.env['NGA_ESQUEMA'] ?? 'nga_lab';
const url = process.env['NGA_SUPABASE_URL'];
if (!url) { console.error('Defina NGA_SUPABASE_URL.'); process.exit(1); }
const base = process.env['NGA_BASE'] ?? join(homedir(), 'Library/Application Support/NGA-Nexus');
const cfg = JSON.parse(await readFile(join(base, 'config.json'), 'utf8')) as { senhaAdmin: string };

const origem = new Client({ host: '127.0.0.1', port: Number(process.env['NGA_PG_PORT'] ?? 54320), user: 'postgres', password: cfg.senhaAdmin, database: 'nga_nexus' });
const destino = new Client({ connectionString: url, ssl: { ca: await readFile(process.env['NGA_PG_CA'] ?? join(homedir(), 'Library/Application Support/NGA-Nexus/supabase-ca.crt'), 'utf8'), rejectUnauthorized: true } });
await origem.connect(); await destino.connect();

const IGNORAR = new Set(['schema_migracoes', 'sessoes']);
const tabelas = (await origem.query<{ t: string }>(
  `SELECT table_name t FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY 1`)).rows.map((r) => r.t).filter((t) => !IGNORAR.has(t));

let pendentes = tabelas.filter(() => true); const feitas = new Map<string, number>();
try {
  await destino.query('BEGIN');
  await destino.query(`SET LOCAL search_path = ${ESQUEMA}, public`);
  // Sem ordenar por FK à mão: tenta, e o que falha por chave estrangeira espera a próxima rodada.
  for (let rodada = 0; rodada < 12 && pendentes.length; rodada++) {
    const falhas: string[] = [];
    for (const t of pendentes) {
      const json = (await origem.query<{ j: string }>(`SELECT coalesce(json_agg(x), '[]')::text j FROM "${t}" x`)).rows[0]!.j;
      if (json === '[]') { feitas.set(t, 0); continue; }
      await destino.query('SAVEPOINT s');
      try {
        // Tabelas com RULE (a trilha de auditoria é só-inserção) não aceitam ON CONFLICT: ali a idempotência vem do id.
        const comRegra = (await destino.query(`SELECT 1 FROM pg_rules WHERE schemaname=$1 AND tablename=$2 LIMIT 1`, [ESQUEMA, t])).rowCount! > 0;
        const sql = comRegra
          ? `INSERT INTO ${ESQUEMA}."${t}" SELECT r.* FROM json_populate_recordset(null::${ESQUEMA}."${t}", $1::json) r WHERE NOT EXISTS (SELECT 1 FROM ${ESQUEMA}."${t}" x WHERE x.id = r.id)`
          : `INSERT INTO ${ESQUEMA}."${t}" SELECT * FROM json_populate_recordset(null::${ESQUEMA}."${t}", $1::json) ON CONFLICT DO NOTHING`;
        const r = await destino.query(sql, [json]);
        feitas.set(t, r.rowCount ?? 0); await destino.query('RELEASE SAVEPOINT s');
      } catch (e) {
        await destino.query('ROLLBACK TO SAVEPOINT s');
        if (!/foreign key/i.test((e as Error).message)) throw new Error(`tabela ${t}: ${(e as Error).message}`);
        falhas.push(t);
      }
    }
    pendentes = falhas;
  }
  if (pendentes.length) throw new Error(`sem ordem de FK para: ${pendentes.join(', ')}`);
  // Sequências (ex.: auditoria.id) continuam de onde o banco antigo parou.
  const seqs = (await destino.query<{ t: string; c: string; s: string }>(
    `SELECT c.relname t, a.attname c, pg_get_serial_sequence(format('%I.%I', n.nspname, c.relname), a.attname) s
       FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0
      WHERE n.nspname=$1 AND c.relkind='r' AND pg_get_serial_sequence(format('%I.%I', n.nspname, c.relname), a.attname) IS NOT NULL`, [ESQUEMA])).rows;
  for (const s of seqs) await destino.query(`SELECT setval($1, GREATEST((SELECT COALESCE(max("${s.c}"),0) FROM ${ESQUEMA}."${s.t}"), 1))`, [s.s]);
  await destino.query('COMMIT');
} catch (e) { await destino.query('ROLLBACK').catch(() => {}); console.error('\n  falhou, nada foi gravado:', (e as Error).message); process.exit(1); }

// Conferência: linha a linha de contagem, origem × destino.
let ok = true;
for (const t of tabelas) {
  const a = (await origem.query<{ n: number }>(`SELECT count(*)::int n FROM "${t}"`)).rows[0]!.n;
  const b = (await destino.query<{ n: number }>(`SELECT count(*)::int n FROM ${ESQUEMA}."${t}"`)).rows[0]!.n;
  if (a !== b) { ok = false; console.log(`  DIFERE  ${t}: origem ${a} × destino ${b}`); }
  else if (a > 0) console.log(`  ok      ${t}: ${a}`);
}
console.log(ok ? '\n  Conferência: todas as tabelas batem.\n' : '\n  Há diferenças acima.\n');
await origem.end(); await destino.end();
