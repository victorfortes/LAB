/**
 * Leva o banco do NGA Nexus para um Postgres compartilhado (o Supabase do gerador de relatórios).
 *
 * SEGURO POR PADRÃO:
 *   - Sem `--aplicar`, só LÊ metadados (versão, schemas, nomes de tabela) e mostra o que faria.
 *   - Com `--aplicar`, cria o schema `nga_lab` e roda as migrações DENTRO dele. Nada em `public`
 *     é alterado, então o gerador de relatórios não é tocado.
 *   - A senha do banco vem do ambiente (NGA_SUPABASE_URL), nunca de argumento nem de arquivo.
 *
 * Uso:
 *   NGA_SUPABASE_URL='postgresql://postgres:SENHA@db.<ref>.supabase.co:5432/postgres' bun scripts/migrar-supabase.ts
 *   NGA_SUPABASE_URL='...' bun scripts/migrar-supabase.ts --aplicar
 */
import { Client } from 'pg';
import { migrar } from '../src/db/migrar.ts';
import { readFile, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ESQUEMA = process.env['NGA_ESQUEMA'] ?? 'nga_lab';
const url = process.env['NGA_SUPABASE_URL'];
const aplicar = process.argv.includes('--aplicar');
if (!url) {
  console.error('Defina NGA_SUPABASE_URL (string de conexão direta do Supabase: Project Settings → Database).');
  process.exit(1);
}

const cliente = new Client({ connectionString: url, ssl: { ca: await readFile(process.env['NGA_PG_CA'] ?? join(homedir(), 'Library/Application Support/NGA-Nexus/supabase-ca.crt'), 'utf8'), rejectUnauthorized: true } });
await cliente.connect();
try {
  const versao = (await cliente.query<{ v: string }>('SHOW server_version')).rows[0]!.v;
  const esquemas = (await cliente.query<{ schema_name: string }>(
    `SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT IN ('pg_catalog','information_schema','pg_toast') AND schema_name NOT LIKE 'pg_temp%' ORDER BY 1`)).rows.map((r) => r.schema_name);
  const publicas = (await cliente.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY 1`)).rows.map((r) => r.table_name);
  const ja = (await cliente.query(`SELECT 1 FROM information_schema.schemata WHERE schema_name = $1`, [ESQUEMA])).rowCount ?? 0;
  const roleExiste = ((await cliente.query(`SELECT 1 FROM pg_roles WHERE rolname = 'nga_app'`)).rowCount ?? 0) > 0;
  const arquivos = (await readdir(fileURLToPath(new URL('../src/db/migrations/', import.meta.url)))).filter((f) => f.endsWith('.sql')).sort();

  console.log(`\n  PostgreSQL ${versao}`);
  console.log(`  schemas existentes: ${esquemas.join(', ')}`);
  console.log(`  tabelas em public (NÃO serão tocadas): ${publicas.length ? publicas.join(', ') : '(nenhuma)'}`);
  console.log(`  schema "${ESQUEMA}" ${ja ? 'JÁ EXISTE' : 'será criado'} · papel nga_app ${roleExiste ? 'já existe' : 'será criado'} · ${arquivos.length} migrações`);

  if (!aplicar) {
    console.log('\n  Nada foi alterado (execução de leitura). Para aplicar: acrescente --aplicar.\n');
  } else {
    const r = await migrar(cliente, undefined, ESQUEMA);
    const novas = r.filter((x) => !x.jaEstava).length;
    // O app conecta como nga_app (sem privilégio de ignorar RLS) e enxerga o schema pelo search_path do papel.
    // A senha só é definida quando o papel acabou de ser criado OU quando NGA_APP_SENHA é informada: rodar o
    // script de novo (migrações novas) NÃO pode trocar a senha de um sistema que já está no ar.
    const trocarSenha = !roleExiste || !!process.env['NGA_APP_SENHA'];
    const senhaApp = process.env['NGA_APP_SENHA'] ?? crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '').slice(0, 8);
    if (trocarSenha) await cliente.query(`ALTER ROLE nga_app PASSWORD '${senhaApp.replaceAll("'", "''")}'`);
    await cliente.query(`ALTER ROLE nga_app SET search_path = ${ESQUEMA}, public`);
    await cliente.query(`GRANT USAGE ON SCHEMA ${ESQUEMA} TO nga_app`);
    console.log(`\n  ${novas} migração(ões) aplicada(s) em "${ESQUEMA}" (${r.length - novas} já estavam).`);
    if (trocarSenha && !process.env['NGA_APP_SENHA']) console.log(`  senha do papel nga_app (aparece só agora, guarde): ${senhaApp}`);
    console.log('  Para o servidor usar este banco: NGA_PG_HOST, NGA_PG_PORT, NGA_PG_USER=nga_app, NGA_PG_PASSWORD, NGA_PG_DATABASE=postgres\n');
  }
} finally {
  await cliente.end();
}
