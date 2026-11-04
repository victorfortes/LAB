import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { bancoDeTeste, type BancoDeTeste } from './apoio/postgres.ts';
import { Banco } from '../src/store/conexao.ts';
import { criarApp } from '../src/server/app.ts';
import { hashDaSenha } from '../src/security/sessao.ts';

let pg: BancoDeTeste; let banco: Banco; let app: ReturnType<typeof criarApp>;
const NGA = '11111111-1111-1111-1111-111111111111'; const SOCIO = 'aaaaaaaa-0000-4000-8000-000000000001'; const ESTAG = 'aaaaaaaa-0000-4000-8000-000000000002'; const SENHA = 'uma-senha-bem-longa';
let tS: string; let tE: string; let tA: string; let tB: string; let projA: string; let projB: string;
const req = (t: string, url: string, init: RequestInit = {}) => app(new Request(`http://x${url}`, { ...init, headers: { 'content-type': 'application/json', cookie: `nga_sessao=${t}` } }));
const entrar = async (email: string, senha: string) => { const r = await app(new Request('http://x/api/sessao', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, senha }) })); return /nga_sessao=([^;]+)/.exec(r.headers.get('set-cookie')!)![1]!; };

beforeAll(async () => {
  pg = await bancoDeTeste(); await pg.dono.query(`ALTER ROLE nga_app PASSWORD 'nga_app'`);
  banco = new Banco({ host: 'localhost', port: pg.porta, user: 'nga_app', password: 'nga_app', database: 'nga_teste' }); app = criarApp({ banco });
  const h = await hashDaSenha(SENHA);
  await pg.dono.query(`INSERT INTO organizacoes (id,tipo,nome) VALUES ($1,'escritorio','NGA')`, [NGA]);
  await pg.dono.query(`INSERT INTO usuarios (id,email,nome,senha_hash) VALUES ($1,'s@nga.adv.br','Sócio',$3),($2,'e@nga.adv.br','Estag',$3)`, [SOCIO, ESTAG, h]);
  await pg.dono.query(`INSERT INTO vinculos (usuario_id,organizacao_id,papel) VALUES ($1,$3,'socio_administrador'),($2,$3,'estagiario')`, [SOCIO, ESTAG, NGA]);
  tS = await entrar('s@nga.adv.br', SENHA); tE = await entrar('e@nga.adv.br', SENHA);
  const novo = async (nome: string, empresa: string, email: string) => {
    const p = await (await req(tS, '/api/projetos', { method: 'POST', body: JSON.stringify({ nome, tipo: 'reestruturacao' }) })).json();
    const c = await (await req(tS, `/api/projetos/${p.id}/portal/convites`, { method: 'POST', body: JSON.stringify({ nome: 'Dir', email, organizacao: empresa }) })).json();
    return { id: p.id as string, t: await entrar(email, c.senhaTemporaria) };
  };
  const a = await novo('Caso A', 'Empresa A', 'a@a.com'); const b = await novo('Caso B', 'Empresa B', 'b@b.com');
  projA = a.id; tA = a.t; projB = b.id; tB = b.t;
}, 180_000);
afterAll(async () => { await banco?.encerrar(); await pg?.encerrar(); });

const nova = (t: string, proj: string, corpo: object) => req(t, `/api/projetos/${proj}/negociacoes`, { method: 'POST', body: JSON.stringify(corpo) });

describe('negociações', () => {
  test('quadro: criar, mover entre colunas, concluir com desfecho e reabrir', async () => {
    const r = await nova(tS, projA, { titulo: 'Banco X — renegociação', contraparte: 'Banco X S.A.', valor: '150000000', notasInternas: 'aceitar até 40% de deságio' });
    expect(r.status).toBe(201); const { id } = await r.json();
    expect((await req(tS, `/api/negociacoes/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'stand_by' }) })).status).toBe(200);
    let l = await (await req(tS, `/api/projetos/${projA}/negociacoes`)).json();
    expect(l.resumo).toMatchObject({ emNegociacao: 0, standBy: 1, concluidas: 0 });
    await req(tS, `/api/negociacoes/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'concluida', desfecho: 'acordo' }) });
    l = await (await req(tS, `/api/projetos/${projA}/negociacoes`)).json();
    expect(l.negociacoes[0]).toMatchObject({ status: 'concluida', desfecho: 'acordo' }); expect(l.negociacoes[0].concluidaEm).not.toBeNull();
    await req(tS, `/api/negociacoes/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'em_negociacao' }) });
    l = await (await req(tS, `/api/projetos/${projA}/negociacoes`)).json();
    expect(l.negociacoes[0]).toMatchObject({ status: 'em_negociacao', desfecho: null, concluidaEm: null });
  });

  test('o cliente só vê o que foi publicado, e NUNCA as notas internas', async () => {
    const oculta = await (await nova(tS, projA, { titulo: 'Estratégia reservada', notasInternas: 'SEGREDO-INTERNO' })).json();
    const publica = await (await nova(tS, projA, { titulo: 'Fornecedor Y', contraparte: 'Y Ltda', notasInternas: 'SEGREDO-INTERNO-2', resumoCliente: 'Estamos negociando o parcelamento em 24 meses.', visivelAoCliente: true })).json();
    expect(oculta.id).toBeTruthy();
    const vistas = await (await req(tA, `/api/portal/projetos/${projA}/negociacoes`)).json();
    expect(vistas.map((v: { id: string }) => v.id)).toEqual([publica.id]);
    expect(JSON.stringify(vistas)).not.toContain('SEGREDO');
    expect(vistas[0].resumo).toContain('parcelamento');
    // a tabela em si não tem caminho para o cliente
    expect((await req(tA, `/api/projetos/${projA}/negociacoes`)).status).toBe(403);
    expect((await req(tA, `/api/negociacoes/${oculta.id}`, { method: 'PATCH', body: JSON.stringify({ visivelAoCliente: true }) })).status).toBe(403);
  });

  test('o cliente B não vê negociações do cliente A (nem publicadas)', async () => {
    expect(await (await req(tB, `/api/portal/projetos/${projA}/negociacoes`)).json()).toEqual([]);
  });

  test('"mostrar ao cliente" exige o texto escrito e a permissão de publicar', async () => {
    const sem = await nova(tS, projA, { titulo: 'x', visivelAoCliente: true });
    expect(sem.status).toBe(400);
    const estag = await nova(tE, projA, { titulo: 'Estagiário tenta publicar', resumoCliente: 'texto suficientemente longo', visivelAoCliente: true });
    expect(estag.status).toBe(403);
    // negociação carrega estratégia: estagiário lê, mas não cria
    expect((await nova(tE, projA, { titulo: 'Estagiário não cria' })).status).toBe(403);
    expect((await req(tE, `/api/projetos/${projA}/negociacoes`)).status).toBe(200);
  });
});
