// O mesmo script SQL que roda no Supabase real (supabase/tests/rls_producao.sql) é validado aqui, no PostgreSQL local:
// precisa terminar com "falhas: 0" e sem deixar nenhum resíduo (rollback).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('script de RLS de produção: 0 falhas e nenhum resíduo', async () => {
  const db = new PGlite();
  await db.exec(readFileSync(path.join(raiz, 'tests/db/supabase_stub.sql'), 'utf8'));
  for (const f of readdirSync(path.join(raiz, 'supabase/migrations')).sort()) await db.exec(readFileSync(path.join(raiz, 'supabase/migrations', f), 'utf8'));
  const res = await db.exec(readFileSync(path.join(raiz, 'supabase/tests/rls_producao.sql'), 'utf8'));
  const msg = String(res[res.length - 1].rows[0].relatorio);
  console.log(msg);
  assert.match(msg, /RELATORIO RLS \| testes: \d+ \| falhas: 0\b/, 'o relatório deve indicar 0 falhas');
  for (const t of ['documentos', 'perfis', 'documentos_versoes', 'auditoria']) assert.equal((await db.query(`select count(*)::int n from public.${t}`)).rows[0].n, 0, `resíduo em ${t}`);
  assert.equal((await db.query(`select count(*)::int n from auth.users`)).rows[0].n, 0, 'resíduo em auth.users');
});
