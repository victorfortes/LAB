/**
 * Migração 048: cada pessoa vê só os projetos em que trabalha.
 * Administrador, sócio, coordenação e controladoria continuam vendo tudo.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Client } from 'pg';
import { bancoDeTeste, type BancoDeTeste } from './apoio/postgres.ts';

let pg: BancoDeTeste; let db: Client; let app: Client;

const NGA = '11111111-1111-1111-1111-111111111111';
const ADMIN = 'aaaaaaaa-0000-0000-0000-000000000001';
const COORD = 'aaaaaaaa-0000-0000-0000-000000000002';
const ANA = 'aaaaaaaa-0000-0000-0000-000000000003';
const BRUNO = 'aaaaaaaa-0000-0000-0000-000000000004';
const ESTAGIARIA = 'aaaaaaaa-0000-0000-0000-000000000005';
const CONTROLADORIA = 'aaaaaaaa-0000-0000-0000-000000000006';

let doAna: string, doBruno: string, semEquipe: string;

beforeAll(async () => {
  pg = await bancoDeTeste({ equipeAutomatica: false }); db = pg.dono; app = pg.cliente;
  await db.query(`INSERT INTO organizacoes (id,tipo,nome) VALUES ($1,'escritorio','NGA')`, [NGA]);
  const pessoas: [string, string, string][] = [
    [ADMIN, 'admin@nga.adv.br', 'socio_administrador'], [COORD, 'coord@nga.adv.br', 'coordenacao'],
    [ANA, 'ana@nga.adv.br', 'advogado'], [BRUNO, 'bruno@nga.adv.br', 'advogado'],
    [ESTAGIARIA, 'est@nga.adv.br', 'estagiario'], [CONTROLADORIA, 'ctrl@nga.adv.br', 'controladoria'],
  ];
  for (const [id, email, papel] of pessoas) {
    await db.query(`INSERT INTO usuarios (id,email,nome,senha_hash) VALUES ($1,$2,$2,'x')`, [id, email]);
    await db.query(`INSERT INTO vinculos (usuario_id,organizacao_id,papel) VALUES ($1,$2,$3)`, [id, NGA, papel]);
  }
  const novo = async (nome: string) => (await db.query<{ id: string }>(
    `INSERT INTO projetos (organizacao_id,nome,tipo) VALUES ($1,$2,'recuperacao_judicial') RETURNING id`, [NGA, nome])).rows[0]!.id;
  doAna = await novo('RJ da Ana'); doBruno = await novo('RJ do Bruno'); semEquipe = await novo('RJ sem equipe');
  await db.query(`INSERT INTO projeto_equipe (projeto_id,organizacao_id,usuario_id,papel) VALUES
    ($1,$3,$4,'lider'),($2,$3,$5,'lider'),($2,$3,$6,'apoio')`, [doAna, doBruno, NGA, ANA, BRUNO, ESTAGIARIA]);
  await db.query(`INSERT INTO documentos (organizacao_id,projeto_id,titulo,caminho) VALUES
    ($1,$2,'Balanço da Ana','/a'),($1,$3,'Balanço do Bruno','/b')`, [NGA, doAna, doBruno]);
}, 120_000);

afterAll(async () => { await pg?.encerrar(); });

async function como<T>(usuario: string, fn: () => Promise<T>): Promise<T> {
  await app.query('BEGIN');
  await app.query('SELECT set_config($1,$2,true)', ['app.usuario_id', usuario]);
  try { const r = await fn(); await app.query('COMMIT'); return r; }
  catch (e) { await app.query('ROLLBACK'); throw e; }
}
const projetos = (u: string) => como(u, async () => (await app.query<{ nome: string }>('SELECT nome FROM projetos ORDER BY nome')).rows.map((r) => r.nome));

describe('quem vê o quê', () => {
  test('administrador, coordenação e controladoria veem todos os projetos', async () => {
    for (const u of [ADMIN, COORD, CONTROLADORIA]) expect(await projetos(u)).toHaveLength(3);
  });

  test('o advogado vê só os projetos da sua equipe', async () => {
    expect(await projetos(ANA)).toEqual(['RJ da Ana']);
    expect(await projetos(BRUNO)).toEqual(['RJ do Bruno']);
  });

  test('a estagiária vê o projeto em que está como apoio', async () => {
    expect(await projetos(ESTAGIARIA)).toEqual(['RJ do Bruno']);
  });

  test('a trava vale para o que pende do projeto, não só para a lista', async () => {
    const docs = await como(ANA, async () => (await app.query<{ titulo: string }>('SELECT titulo FROM documentos')).rows.map((r) => r.titulo));
    expect(docs).toEqual(['Balanço da Ana']);
  });

  test('o advogado não grava em projeto alheio', async () => {
    const r = await como(ANA, async () => (await app.query('UPDATE projetos SET resumo = $2 WHERE id = $1', [doBruno, 'x'])).rowCount);
    expect(r).toBe(0);
    await expect(como(ANA, () => app.query(`INSERT INTO documentos (organizacao_id,projeto_id,titulo,caminho) VALUES ($1,$2,'intruso','/x')`, [NGA, doBruno]))).rejects.toThrow();
  });

  test('ao sair da equipe, o projeto some da tela da pessoa', async () => {
    await db.query(`UPDATE projeto_equipe SET ate = CURRENT_DATE WHERE projeto_id = $1 AND usuario_id = $2`, [doBruno, ESTAGIARIA]);
    expect(await projetos(ESTAGIARIA)).toEqual([]);
  });

  test('quem é responsável pelo projeto o vê mesmo antes de entrar na equipe', async () => {
    await db.query(`UPDATE projetos SET responsavel_id = $2 WHERE id = $1`, [semEquipe, ANA]);
    expect(await projetos(ANA)).toEqual(['RJ da Ana', 'RJ sem equipe']);
  });
});
