import { afterAll, beforeAll, expect, test } from 'bun:test';
import { bancoDeTeste, type BancoDeTeste } from './apoio/postgres.ts';
import { Banco } from '../src/store/conexao.ts';
import { criarApp } from '../src/server/app.ts';
import { hashDaSenha } from '../src/security/sessao.ts';
import { ProvedorAusente } from '../src/ai/provedor.ts';

let pg: BancoDeTeste, banco: Banco, app: ReturnType<typeof criarApp>;
const org = 'f0700000-0000-4000-8000-000000000001', coord = 'f0700000-0000-4000-8000-000000000002', adv = 'f0700000-0000-4000-8000-000000000003';
const senha = 'Senha de teste segura 123';
let tc = '', ta = '', projeto = '';
const req = (token: string, url: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') =>
  app(new Request('http://x' + url, { method, headers: { 'content-type': 'application/json', cookie: `nga_sessao=${token}` }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
const j = async (r: Response | Promise<Response>) => (await r).json();
async function entrar(email: string) {
  const r = await app(new Request('http://x/api/sessao', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, senha }) }));
  return /nga_sessao=([^;]+)/.exec(r.headers.get('set-cookie') ?? '')?.[1] ?? '';
}
beforeAll(async () => {
  pg = await bancoDeTeste();
  banco = new Banco({ host: 'localhost', port: pg.porta, user: 'nga_app', password: 'nga_app', database: 'nga_teste' });
  app = criarApp({ banco, provedor: new ProvedorAusente('teste sem modelo') });
  const hash = await hashDaSenha(senha);
  await pg.dono.query("INSERT INTO organizacoes(id,tipo,nome) VALUES($1,'escritorio','NGA')", [org]);
  await pg.dono.query("INSERT INTO usuarios(id,nome,email,senha_hash) VALUES($1,'Coordenadora','coord@nga.adv.br',$3),($2,'Advogado','adv@nga.adv.br',$3)", [coord, adv, hash]);
  await pg.dono.query("INSERT INTO vinculos(usuario_id,organizacao_id,papel) VALUES($1,$3,'coordenacao'),($2,$3,'advogado')", [coord, adv, org]);
  tc = await entrar('coord@nga.adv.br'); ta = await entrar('adv@nga.adv.br');
  projeto = (await j(req(tc, '/api/projetos', { nome: 'Cliente Pauta', tipo: 'consultivo', semPlaybook: true }))).id;
  await pg.dono.query('INSERT INTO projeto_equipe(projeto_id,organizacao_id,usuario_id,papel,desde) VALUES($1,$2,$3,\'membro\',current_date)', [projeto, org, adv]).catch(() => undefined);
}, 180_000);
afterAll(async () => { await banco?.encerrar(); await pg?.encerrar(); });

test('advogado não acessa a gestão de pauta', async () => {
  expect((await req(ta, '/api/pautas')).status).toBe(403);
  expect((await req(ta, `/api/pautas/projetos/${projeto}`)).status).toBe(403);
});

test('item → reunião → tarefa → ata; o que fica aberto volta na próxima', async () => {
  const a = await j(req(tc, `/api/pautas/projetos/${projeto}/itens`, { titulo: 'Contraproposta do banco', prioridade: 'alta', categoria: 'negociacao' }));
  const b = await j(req(tc, `/api/pautas/projetos/${projeto}/itens`, { titulo: 'Documentos do balanço' }));
  const painel = await j(req(tc, '/api/pautas'));
  const c = painel.clientes.find((x: { id: string }) => x.id === projeto);
  expect(c).toMatchObject({ abertos: 2, criticos: 1, saude: 'critico', ultima: null });

  const r = await j(req(tc, `/api/pautas/projetos/${projeto}/reunioes`, { titulo: 'Reunião de pauta', data: '2026-11-16' }));
  const t = await req(tc, `/api/pautas/itens/${a.id}/tarefa`, { prazo: '2026-11-20' });
  expect(t.status).toBe(201);
  const { tarefaId } = await t.json();
  const { rows: [tarefa] } = await pg.dono.query('SELECT origem, titulo, prazo::text FROM tarefas WHERE id = $1', [tarefaId]);
  expect(tarefa).toMatchObject({ origem: 'pauta', titulo: 'Contraproposta do banco', prazo: '2026-11-20' });
  expect((await req(tc, `/api/pautas/itens/${a.id}/tarefa`, {})).status).toBe(400);
  await req(tc, `/api/pautas/itens/${b.id}`, { decisao: 'Cliente envia até sexta', situacao: 'discutido' }, 'PATCH');

  const fim = await j(req(tc, `/api/pautas/reunioes/${r.id}/encerrar`, { resumo: 'Reunião produtiva' }));
  expect(fim).toMatchObject({ itens: 2, encaminhados: 1 });
  const { rows: [ata] } = await pg.dono.query('SELECT decisoes, encaminhamentos, publicada FROM atas WHERE id = $1', [fim.ataId]);
  expect(ata.decisoes).toContain('Cliente envia até sexta');
  expect(ata.encaminhamentos).toContain('Contraproposta do banco');
  expect(ata.publicada).toBe(false);

  const d = await j(req(tc, `/api/pautas/projetos/${projeto}`));
  const itemB = d.itens.find((x: { id: string }) => x.id === b.id);
  expect(itemB).toMatchObject({ situacao: 'discutido', reuniaoId: null, vezesEmPauta: 1 });
  expect((await req(tc, `/api/pautas/reunioes/${r.id}/encerrar`, {})).status).toBe(400);
});
