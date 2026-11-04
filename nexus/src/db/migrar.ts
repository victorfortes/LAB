/**
 * Aplicação de migrations, versionada e idempotente.
 *
 * Cada arquivo roda uma vez, em transação própria, e fica registrado. Não há
 * "rodar de novo por via das dúvidas": o §22 exige reversibilidade e histórico
 * antes de qualquer alteração estrutural.
 */
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Client } from 'pg';

// fileURLToPath, nunca `.pathname`: este projeto vive sob um caminho com
// espaço e acento, e `.pathname` devolveria %20 e %CC%81.
const DIRETORIO = fileURLToPath(new URL('./migrations/', import.meta.url));

export interface MigracaoAplicada { readonly nome: string; readonly jaEstava: boolean }

/**
 * `esquema` coloca TUDO (tabelas, funções, registro de migrações) num schema próprio em vez de `public`.
 * Serve a bancos compartilhados com outra aplicação, como o Supabase: os nomes de tabela não colidem
 * e o schema não fica exposto pela API REST do Supabase. As funções SECURITY DEFINER fixam o
 * `search_path` no texto da migração, então ele é reescrito para o schema escolhido.
 */
export async function migrar(cliente: Client, diretorio = DIRETORIO, esquema?: string): Promise<MigracaoAplicada[]> {
  if (esquema) {
    if (!/^[a-z_][a-z0-9_]*$/.test(esquema)) throw new Error('nome de schema inválido');
    await cliente.query(`CREATE SCHEMA IF NOT EXISTS ${esquema}`);
    await cliente.query(`SET search_path = ${esquema}, public`);
  }
  await cliente.query(`
    CREATE TABLE IF NOT EXISTS schema_migracoes (
      nome        TEXT PRIMARY KEY,
      aplicada_em TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const arquivos = (await readdir(diretorio)).filter((f) => f.endsWith('.sql')).sort();
  const { rows } = await cliente.query<{ nome: string }>('SELECT nome FROM schema_migracoes');
  const aplicadas = new Set(rows.map((r) => r.nome));

  const resultado: MigracaoAplicada[] = [];
  for (const nome of arquivos) {
    if (aplicadas.has(nome)) {
      resultado.push({ nome, jaEstava: true });
      continue;
    }
    let sql = await Bun.file(join(diretorio, nome)).text();
    if (esquema) {
      // Os GRANTs "ON ALL TABLES IN SCHEMA public" da 004 dariam ao papel da aplicação acesso às tabelas
      // do OUTRO app que mora em `public`. No schema próprio, os privilégios valem só para ele.
      sql = sql.replaceAll('search_path = public, pg_temp', `search_path = ${esquema}, pg_temp`)
        .replace(/SCHEMA public\b/g, `SCHEMA ${esquema}`);
    }
    try {
      await cliente.query('BEGIN');
      await cliente.query(sql);
      await cliente.query('INSERT INTO schema_migracoes (nome) VALUES ($1)', [nome]);
      await cliente.query('COMMIT');
    } catch (erro) {
      await cliente.query('ROLLBACK');
      throw new Error(`migração ${nome} falhou: ${(erro as Error).message}`, { cause: erro });
    }
    resultado.push({ nome, jaEstava: false });
  }
  return resultado;
}
