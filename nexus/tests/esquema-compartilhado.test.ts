import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import EmbeddedPostgres from 'embedded-postgres';
import { Client } from 'pg';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrar } from '../src/db/migrar.ts';
import { Banco } from '../src/store/conexao.ts';
import { criarApp } from '../src/server/app.ts';
import { hashDaSenha } from '../src/security/sessao.ts';

// Cenário do Supabase compartilhado: já existe OUTRA aplicação em `public`, com tabela de mesmo nome.
const PORTA = 54800 + Math.floor(Math.random() * 100);
let pg: EmbeddedPostgres; let dir: string; let dono: Client; let banco: Banco;
const NGA = '11111111-1111-1111-1111-111111111111'; const SOCIO = 'aaaaaaaa-0000-4000-8000-000000000001'; const SENHA = 'uma-senha-bem-longa';

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'nga-pg-esq-'));
  pg = new EmbeddedPostgres({ databaseDir: dir, user: 'nga', password: 'nga', port: PORTA, persistent: false });
  await pg.initialise(); await pg.start(); await pg.createDatabase('compartilhado');
  dono = new Client({ host: 'localhost', port: PORTA, user: 'nga', password: 'nga', database: 'compartilhado' });
  await dono.connect();
  await dono.query(`CREATE TABLE public.projetos (id serial primary key, dado_do_gerador_de_relatorios text)`);
  await dono.query(`INSERT INTO public.projetos (dado_do_gerador_de_relatorios) VALUES ('intocavel')`);
  await migrar(dono, undefined, 'nga_lab');
  await dono.query(`ALTER ROLE nga_app PASSWORD 'nga_app'`);
  await dono.query(`ALTER ROLE nga_app SET search_path = nga_lab, public`);
  await dono.query(`GRANT USAGE ON SCHEMA nga_lab TO nga_app`);
  banco = new Banco({ host: 'localhost', port: PORTA, user: 'nga_app', password: 'nga_app', database: 'compartilhado' });
}, 180_000);
afterAll(async () => { await banco?.encerrar(); await dono?.end(); await pg?.stop(); await rm(dir, { recursive: true, force: true }); });

describe('NGA LAB num banco compartilhado, em schema próprio', () => {
  test('não toca na tabela homônima do outro app em public', async () => {
    const r = await dono.query('SELECT dado_do_gerador_de_relatorios FROM public.projetos');
    expect(r.rows).toEqual([{ dado_do_gerador_de_relatorios: 'intocavel' }]);
    const t = await dono.query(`SELECT table_schema FROM information_schema.tables WHERE table_name = 'projetos' ORDER BY 1`);
    expect(t.rows.map((x) => x.table_schema)).toEqual(['nga_lab', 'public']);
  });

  test('o papel da aplicação NÃO ganha acesso às tabelas do outro app', async () => {
    const r = await dono.query(`SELECT has_table_privilege('nga_app', 'public.projetos', 'SELECT') AS le_publico, has_table_privilege('nga_app', 'nga_lab.projetos', 'SELECT') AS le_proprio`);
    expect(r.rows[0]).toEqual({ le_publico: false, le_proprio: true });
  });

  test('o sistema funciona de ponta a ponta (login, RLS, funções SECURITY DEFINER)', async () => {
    await dono.query(`INSERT INTO nga_lab.organizacoes (id,tipo,nome) VALUES ($1,'escritorio','NGA')`, [NGA]);
    await dono.query(`INSERT INTO nga_lab.usuarios (id,email,nome,senha_hash) VALUES ($1,'socio@nga.adv.br','Sócio',$2)`, [SOCIO, await hashDaSenha(SENHA)]);
    await dono.query(`INSERT INTO nga_lab.vinculos (usuario_id,organizacao_id,papel) VALUES ($1,$2,'socio_administrador')`, [SOCIO, NGA]);
    const app = criarApp({ banco });
    const login = await app(new Request('http://x/api/sessao', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'socio@nga.adv.br', senha: SENHA }) }));
    expect(login.status).toBe(200);
    const cookie = /nga_sessao=([^;]+)/.exec(login.headers.get('set-cookie')!)![1]!;
    const criar = await app(new Request('http://x/api/projetos', { method: 'POST', headers: { 'content-type': 'application/json', cookie: `nga_sessao=${cookie}` }, body: JSON.stringify({ nome: 'RJ no Supabase', tipo: 'recuperacao_judicial' }) }));
    expect(criar.status).toBe(201);
    const lista = await (await app(new Request('http://x/api/projetos', { headers: { cookie: `nga_sessao=${cookie}` } }))).json();
    expect(lista.map((p: { nome: string }) => p.nome)).toEqual(['RJ no Supabase']);
    // convite exercita a função SECURITY DEFINER com search_path reescrito
    const projeto = lista[0].id;
    const conv = await app(new Request(`http://x/api/projetos/${projeto}/portal/convites`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: `nga_sessao=${cookie}` }, body: JSON.stringify({ nome: 'Diretora', email: 'dir@cliente.com.br', organizacao: 'Cliente SA' }) }));
    expect(conv.status).toBe(201);
  });
});
