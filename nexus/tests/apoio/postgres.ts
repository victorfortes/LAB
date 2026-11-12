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

/**
 * Desde a migração 048, advogado, estagiário e administrativo só veem os projetos
 * em que estão na equipe. Os testes escritos antes disso montam o cenário direto
 * no banco e tratam essas pessoas como parte de todos os casos; para eles, a
 * equipe é preenchida automaticamente. Os testes da regra de visibilidade
 * (`visibilidade-equipe.test.ts`) desligam isso com `{ equipeAutomatica: false }`.
 */
export async function bancoDeTeste(opcoes: { equipeAutomatica?: boolean } = {}): Promise<BancoDeTeste> {
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
  if (opcoes.equipeAutomatica !== false) {
    await dono.query(`
      CREATE FUNCTION teste_equipe_por_projeto() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
      BEGIN
        INSERT INTO projeto_equipe (projeto_id, organizacao_id, usuario_id, papel)
        SELECT NEW.id, NEW.organizacao_id, v.usuario_id, 'apoio' FROM vinculos v
         WHERE v.organizacao_id = NEW.organizacao_id AND v.revogado_em IS NULL
           AND v.papel IN ('advogado','estagiario','administrativo')
           AND v.usuario_id IS DISTINCT FROM NEW.responsavel_id;
        RETURN NEW;
      END $$;
      CREATE FUNCTION teste_equipe_por_vinculo() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
      BEGIN
        IF NEW.papel IN ('advogado','estagiario','administrativo') THEN
          INSERT INTO projeto_equipe (projeto_id, organizacao_id, usuario_id, papel)
          SELECT p.id, p.organizacao_id, NEW.usuario_id, 'apoio' FROM projetos p
           WHERE p.organizacao_id = NEW.organizacao_id
             AND NOT EXISTS (SELECT 1 FROM projeto_equipe e WHERE e.projeto_id = p.id AND e.usuario_id = NEW.usuario_id AND e.ate IS NULL);
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER teste_equipe_projeto AFTER INSERT ON projetos FOR EACH ROW EXECUTE FUNCTION teste_equipe_por_projeto();
      CREATE TRIGGER teste_equipe_vinculo AFTER INSERT ON vinculos FOR EACH ROW EXECUTE FUNCTION teste_equipe_por_vinculo();`);
  }

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
