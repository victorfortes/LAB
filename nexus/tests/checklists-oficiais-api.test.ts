import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { bancoDeTeste, type BancoDeTeste } from './apoio/postgres.ts';
import { Banco } from '../src/store/conexao.ts';
import { criarApp } from '../src/server/app.ts';
import { hashDaSenha } from '../src/security/sessao.ts';

let pg: BancoDeTeste; let banco: Banco; let app: ReturnType<typeof criarApp>; let t: string;
const NGA = '11111111-1111-1111-1111-111111111111'; const SOCIO = 'aaaaaaaa-0000-4000-8000-000000000001'; const SENHA = 'uma-senha-bem-longa';
const req = (url: string, init: RequestInit = {}) => app(new Request(`http://x${url}`, { ...init, headers: { 'content-type': 'application/json', cookie: `nga_sessao=${t}` } }));

beforeAll(async () => {
  pg = await bancoDeTeste();
  await pg.dono.query(`ALTER ROLE nga_app PASSWORD 'nga_app'`);
  banco = new Banco({ host: 'localhost', port: pg.porta, user: 'nga_app', password: 'nga_app', database: 'nga_teste' });
  app = criarApp({ banco });
  await pg.dono.query(`INSERT INTO organizacoes (id,tipo,nome) VALUES ($1,'escritorio','NGA')`, [NGA]);
  await pg.dono.query(`INSERT INTO usuarios (id,email,nome,senha_hash) VALUES ($1,'socio@nga.adv.br','Sócio',$2)`, [SOCIO, await hashDaSenha(SENHA)]);
  await pg.dono.query(`INSERT INTO vinculos (usuario_id,organizacao_id,papel) VALUES ($1,$2,'socio_administrador')`, [SOCIO, NGA]);
  const r = await app(new Request('http://x/api/sessao', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'socio@nga.adv.br', senha: SENHA }) }));
  t = /nga_sessao=([^;]+)/.exec(r.headers.get('set-cookie')!)![1]!;
}, 120_000);
afterAll(async () => { await banco?.encerrar(); await pg?.encerrar(); });

describe('checklists oficiais pela API', () => {
  test('projeto de proteção patrimonial recebe o checklist da planilha, com atribuição, e N/A fica fora da conta', async () => {
    const p = await (await req('/api/projetos', { method: 'POST', body: JSON.stringify({ nome: 'Família Exemplo', tipo: 'protecao_patrimonial' }) })).json();
    const gerado = await req(`/api/projetos/${p.id}/checklist`, { method: 'POST', body: '{}' });
    expect(gerado.status).toBe(201);
    const c = await (await req(`/api/projetos/${p.id}/checklist`)).json();
    expect(c.itens).toHaveLength(27);
    expect(c.itens.every((i: { atribuicao: string }) => i.atribuicao)).toBe(true);
    const opcionais = c.itens.filter((i: { obrigatorio: boolean }) => !i.obrigatorio).length;
    expect(c.progresso.obrigatorios).toBe(27 - opcionais);

    const item = c.itens.find((i: { obrigatorio: boolean }) => i.obrigatorio);
    const na = await req(`/api/requisitos/${item.id}/analise`, { method: 'POST', body: JSON.stringify({ situacao: 'nao_aplicavel', observacao: 'Não há.' }) });
    expect(na.status).toBe(200);
    const depois = await (await req(`/api/projetos/${p.id}/checklist`)).json();
    expect(depois.progresso.obrigatorios).toBe(27 - opcionais - 1);
    const volta = await req(`/api/requisitos/${item.id}/analise`, { method: 'POST', body: JSON.stringify({ situacao: 'pendente' }) });
    expect(volta.status).toBe(200);
  });

  test('projeto de RJ recebe o checklist "RJ e RE" (26 itens)', async () => {
    const p = await (await req('/api/projetos', { method: 'POST', body: JSON.stringify({ nome: 'RJ X', tipo: 'recuperacao_judicial' }) })).json();
    await req(`/api/projetos/${p.id}/checklist`, { method: 'POST', body: '{}' });
    const c = await (await req(`/api/projetos/${p.id}/checklist`)).json();
    expect(c.itens).toHaveLength(26);
    expect(c.itens.some((i: { titulo: string; fundamento: string }) => i.titulo.startsWith('Lista completa de credores') && i.fundamento === 'Art. 51, III')).toBe(true);
  });
});
