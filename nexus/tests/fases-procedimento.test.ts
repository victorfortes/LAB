import { afterAll, beforeAll, expect, test } from 'bun:test';
import { bancoDeTeste, type BancoDeTeste } from './apoio/postgres.ts';
import { Banco } from '../src/store/conexao.ts';
import { criarApp } from '../src/server/app.ts';
import { hashDaSenha } from '../src/security/sessao.ts';

let pg: BancoDeTeste; let banco: Banco; let app: ReturnType<typeof criarApp>; let t: string;
const NGA = '11111111-1111-1111-1111-111111111111'; const SOCIO = 'aaaaaaaa-0000-4000-8000-000000000001'; const SENHA = 'uma-senha-bem-longa';
const req = (url: string, init: RequestInit = {}) => app(new Request(`http://x${url}`, { ...init, headers: { 'content-type': 'application/json', cookie: `nga_sessao=${t}` } }));

beforeAll(async () => {
  pg = await bancoDeTeste(); await pg.dono.query(`ALTER ROLE nga_app PASSWORD 'nga_app'`);
  banco = new Banco({ host: 'localhost', port: pg.porta, user: 'nga_app', password: 'nga_app', database: 'nga_teste' }); app = criarApp({ banco });
  await pg.dono.query(`INSERT INTO organizacoes (id,tipo,nome) VALUES ($1,'escritorio','NGA')`, [NGA]);
  await pg.dono.query(`INSERT INTO usuarios (id,email,nome,senha_hash) VALUES ($1,'s@nga.adv.br','Sócio',$2)`, [SOCIO, await hashDaSenha(SENHA)]);
  await pg.dono.query(`INSERT INTO vinculos (usuario_id,organizacao_id,papel) VALUES ($1,$2,'socio_administrador')`, [SOCIO, NGA]);
  const r = await app(new Request('http://x/api/sessao', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 's@nga.adv.br', senha: SENHA }) }));
  t = /nga_sessao=([^;]+)/.exec(r.headers.get('set-cookie')!)![1]!;
}, 120_000);
afterAll(async () => { await banco?.encerrar(); await pg?.encerrar(); });

test('projetos preservam as fases sem criar tarefas por modelo', async () => {
  const response = await req('/api/projetos', { method: 'POST', body: JSON.stringify({ nome: 'Caso', tipo: 'recuperacao_judicial' }) });
  expect(response.status).toBe(201);
  const { id } = await response.json();
  const base = '/api/projetos/' + id;
  const mudanca = await req(base + '/fase', { method: 'POST', body: JSON.stringify({ fase: 'distribuido' }) });
  expect(mudanca.status).toBe(200);
  expect((await mudanca.json()).fase.id).toBe('distribuido');
  expect((await (await req('/api/tarefas?projeto=' + id)).json()).tarefas).toEqual([]);
  expect((await req('/api/admin/playbooks')).status).toBe(404);
  expect((await req(base + '/fluxo')).status).toBe(404);
  expect((await req(base + '/playbook', { method: 'POST', body: '{}' })).status).toBe(404);
});
