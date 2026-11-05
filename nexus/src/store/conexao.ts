/**
 * Acesso ao banco com contexto de RLS por requisição.
 *
 * Toda consulta de usuário passa por `comoUsuario`, que abre transação e
 * define `app.usuario_id` com SET LOCAL. O escopo é a transação: não vaza para
 * a próxima requisição que pegar a mesma conexão do pool — que é o erro que
 * transforma pool + RLS em vazamento entre clientes.
 */
import { Pool, type PoolClient } from 'pg';
import { AsyncLocalStorage } from 'node:async_hooks';
export const contextoBanco = new AsyncLocalStorage<PoolClient>();

export interface OpcoesConexao {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
  readonly database: string;
  readonly max?: number;
  /** Credencial de infraestrutura: TODA transação assume nga_app antes de consultar dados. */
  readonly connectionString?: string;
  readonly papelAplicacao?: 'nga_app';
  readonly esquema?: string;
  /** Bancos gerenciados (Supabase) exigem TLS; com `ca`, a cadeia do servidor é VERIFICADA. */
  readonly ssl?: { ca: string; rejectUnauthorized: true };
}

export class Banco {
  readonly #pool: Pool;
  readonly #papel: 'nga_app' | undefined;
  readonly #esquema: string | undefined;

  constructor(opcoes: OpcoesConexao) {
    if (opcoes.user === 'postgres' || opcoes.user.endsWith('_owner')) {
      // Superusuário ou dono do schema fura RLS (ver migração 004). Falhar aqui
      // é muito melhor do que descobrir em produção que o isolamento não vale.
      throw new Error(
        `a aplicação não pode conectar como "${opcoes.user}": use um papel comum (nga_app), ` +
          'sob pena de o RLS ser ignorado e um cliente enxergar dados de outro',
      );
    }
    if (opcoes.connectionString && opcoes.papelAplicacao !== 'nga_app') throw new Error('Conexão delegada exige papel nga_app obrigatório');
    if (opcoes.esquema && !/^[a-z_][a-z0-9_]*$/.test(opcoes.esquema)) throw new Error('schema inválido');
    this.#papel = opcoes.papelAplicacao; this.#esquema = opcoes.esquema;
    const { papelAplicacao, esquema, ...pool } = opcoes;
    this.#pool = new Pool({ ...pool, max: opcoes.max ?? 10 });
  }

  /**
   * Executa `fn` numa transação com o contexto de RLS do usuário.
   * Faz COMMIT no sucesso e ROLLBACK em qualquer erro.
   */
  async comoUsuario<T>(usuarioId: string, fn: (db: PoolClient) => Promise<T>): Promise<T> {
    const db = await this.#pool.connect();
    try {
      await db.query('BEGIN');
      if (this.#papel) await db.query('SET LOCAL ROLE nga_app');
      if (this.#esquema) await db.query(`SET LOCAL search_path = ${this.#esquema}, public`);
      // SET LOCAL via set_config(..., true): morre no fim da transação.
      await db.query('SELECT set_config($1, $2, true)', ['app.usuario_id', usuarioId]);
      const resultado = await contextoBanco.run(db, () => fn(db));
      await db.query('COMMIT');
      return resultado;
    } catch (erro) {
      await db.query('ROLLBACK').catch(() => {});
      throw erro;
    } finally {
      db.release();
    }
  }

  /**
   * Transação SEM contexto de usuário, para o que acontece antes do login
   * (autenticar, criar sessão). Vê apenas tabelas sem RLS de leitura própria.
   */
  async semContexto<T>(fn: (db: PoolClient) => Promise<T>): Promise<T> {
    const db = await this.#pool.connect();
    try {
      await db.query('BEGIN');
      if (this.#papel) await db.query('SET LOCAL ROLE nga_app');
      if (this.#esquema) await db.query(`SET LOCAL search_path = ${this.#esquema}, public`);
      const resultado = await contextoBanco.run(db, () => fn(db));
      await db.query('COMMIT');
      return resultado;
    } catch (erro) {
      await db.query('ROLLBACK').catch(() => {});
      throw erro;
    } finally {
      db.release();
    }
  }

  async encerrar(): Promise<void> { await this.#pool.end(); }
}

/** Registra um evento na trilha de auditoria. Nunca falha a operação principal. */
export async function auditar(
  db: PoolClient,
  evento: {
    organizacaoId: string | null; usuarioId: string | null; acao: string;
    entidade: string; entidadeId?: string | null;
    antes?: unknown; depois?: unknown; origem?: string;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO auditoria (organizacao_id, usuario_id, acao, entidade, entidade_id, antes, depois, origem)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      evento.organizacaoId, evento.usuarioId, evento.acao, evento.entidade,
      evento.entidadeId ?? null,
      evento.antes === undefined ? null : JSON.stringify(evento.antes),
      evento.depois === undefined ? null : JSON.stringify(evento.depois),
      evento.origem ?? 'api',
    ],
  );
}
