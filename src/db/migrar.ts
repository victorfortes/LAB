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

export async function migrar(cliente: Client, diretorio = DIRETORIO): Promise<MigracaoAplicada[]> {
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
    const sql = await Bun.file(join(diretorio, nome)).text();
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
