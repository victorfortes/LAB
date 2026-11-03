/**
 * PostgreSQL real e descartável para os testes.
 *
 * Testar schema contra SQLite ou contra mock não prova nada: RLS, CHECK,
 * RULE e BIGINT são exatamente o que precisa ser verificado, e só o
 * PostgreSQL os tem.
 */
import EmbeddedPostgres from 'embedded-postgres';
import { Client } from 'pg';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrar } from '../../src/db/migrar.ts';

export interface BancoDeTeste {
  /** Conexão da APLICAÇÃO: papel comum, sujeito a RLS. É a que os testes usam. */
  readonly cliente: Client;
  /** Conexão de manutenção (dono do schema). Para montar cenário sem RLS. */
  readonly dono: Client;
  readonly porta: number;
  readonly encerrar: () => Promise<void>;
}

let proximaPorta = 54330 + Math.floor(Math.random() * 400);

export async function bancoDeTeste(): Promise<BancoDeTeste> {
  const dir = await mkdtemp(join(tmpdir(), 'nga-pg-'));
  const porta = proximaPorta++;
  const pg = new EmbeddedPostgres({
    databaseDir: dir, user: 'nga', password: 'nga', port: porta, persistent: false,
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('nga_teste');

  const dono = new Client({
    host: 'localhost', port: porta, user: 'nga', password: 'nga', database: 'nga_teste',
  });
  await dono.connect();
  await migrar(dono);
  await dono.query(`ALTER ROLE nga_app PASSWORD 'nga_app'`);

  // A conexão de teste usa o papel da aplicação, sem superusuário: é a única
  // forma de o RLS valer de verdade (ver migração 004).
  const cliente = new Client({
    host: 'localhost', port: porta, user: 'nga_app', password: 'nga_app', database: 'nga_teste',
  });
  await cliente.connect();

  return {
    cliente,
    dono,
    porta,
    encerrar: async () => {
      await cliente.end();
      await dono.end();
      await pg.stop();
      await rm(dir, { recursive: true, force: true });
    },
  };
}
