import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { bancoDeTeste, type BancoDeTeste } from './apoio/postgres.ts';
import { Banco } from '../src/store/conexao.ts';
import { criarApp } from '../src/server/app.ts';
import { hashDaSenha } from '../src/security/sessao.ts';
import { ArmazenamentoLocal } from '../src/store/arquivos.ts';
import { deposito as montarDeposito } from '../src/server/arquivos.ts';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * §6.1: "Um cliente nunca poderá visualizar dados de outro cliente."
 * Dois clientes DIFERENTES (duas empresas, dois projetos) e o teste tenta, com a sessão de um, alcançar tudo do outro.
 */
let pg: BancoDeTeste; let banco: Banco; let app: ReturnType<typeof criarApp>;
const NGA = '11111111-1111-1111-1111-111111111111'; const SOCIO = 'aaaaaaaa-0000-4000-8000-000000000001'; const SENHA = 'uma-senha-bem-longa';
let tSocio: string; let tA: string; let tB: string; let projA: string; let projB: string; let docA: string; let reqA: string;

const req = (t: string, url: string, init: RequestInit = {}) =>
  app(new Request(`http://x${url}`, { ...init, headers: { ...(init.body instanceof FormData ? {} : { 'content-type': 'application/json' }), cookie: `nga_sessao=${t}` } }));
const entrar = async (email: string, senha: string) => {
  const r = await app(new Request('http://x/api/sessao', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, senha }) }));
  return /nga_sessao=([^;]+)/.exec(r.headers.get('set-cookie')!)![1]!;
};

beforeAll(async () => {
  pg = await bancoDeTeste();
  await pg.dono.query(`ALTER ROLE nga_app PASSWORD 'nga_app'`);
  banco = new Banco({ host: 'localhost', port: pg.porta, user: 'nga_app', password: 'nga_app', database: 'nga_teste' });
  const dir = await mkdtemp(join(tmpdir(), 'acervo-'));
  app = criarApp({ banco, deposito: montarDeposito(new ArmazenamentoLocal(dir), { NGA_SEGREDO_ARQUIVOS: 'x'.repeat(40) }) });
  await pg.dono.query(`INSERT INTO organizacoes (id,tipo,nome) VALUES ($1,'escritorio','NGA')`, [NGA]);
  await pg.dono.query(`INSERT INTO usuarios (id,email,nome,senha_hash) VALUES ($1,'socio@nga.adv.br','Sócio',$2)`, [SOCIO, await hashDaSenha(SENHA)]);
  await pg.dono.query(`INSERT INTO vinculos (usuario_id,organizacao_id,papel) VALUES ($1,$2,'socio_administrador')`, [SOCIO, NGA]);
  tSocio = await entrar('socio@nga.adv.br', SENHA);

  const novo = async (nome: string, empresa: string, email: string) => {
    const p = await (await req(tSocio, '/api/projetos', { method: 'POST', body: JSON.stringify({ nome, tipo: 'recuperacao_judicial' }) })).json();
    await req(tSocio, `/api/projetos/${p.id}/checklist`, { method: 'POST', body: '{}' });
    const c = await (await req(tSocio, `/api/projetos/${p.id}/portal/convites`, { method: 'POST', body: JSON.stringify({ nome: `Diretor ${empresa}`, email, organizacao: empresa }) })).json();
    return { id: p.id as string, token: await entrar(email, c.senhaTemporaria) };
  };
  const a = await novo('Teste 01', 'Empresa A', 'a@a.com.br'); const b = await novo('Teste 02', 'Empresa B', 'b@b.com.br');
  projA = a.id; tA = a.token; projB = b.id; tB = b.token;

  // O cliente A manda um documento (item do checklist), uma mensagem; a NGA publica o documento e responde.
  const check = await (await req(tA, `/api/projetos/${projA}/checklist`)).json(); reqA = check.itens[0].id;
  const fd = new FormData(); fd.append('arquivo', new File(['conteudo secreto da empresa A'], 'a.txt', { type: 'text/plain' })); fd.append('titulo', 'Balanço da empresa A'); fd.append('requisitoId', reqA);
  const env = await (await req(tA, `/api/projetos/${projA}/documentos`, { method: 'POST', body: fd })).json(); docA = env.documentoId;
  await req(tSocio, `/api/documentos/${docA}/publicacao`, { method: 'POST', body: '{}' });
  await req(tA, `/api/projetos/${projA}/mensagens`, { method: 'POST', body: JSON.stringify({ texto: 'mensagem privada da empresa A' }) });
  await req(tSocio, `/api/projetos/${projA}/mensagens`, { method: 'POST', body: JSON.stringify({ texto: 'resposta da NGA para a empresa A' }) });
}, 180_000);
afterAll(async () => { await banco?.encerrar(); await pg?.encerrar(); });

describe('o cliente B não alcança NADA do cliente A', () => {
  test('o cliente A enxerga o que é dele (controle: o teste não passa por estar vazio)', async () => {
    expect((await (await req(tA, `/api/projetos/${projA}/documentos`)).json()).length).toBe(1);
    expect((await (await req(tA, `/api/projetos/${projA}/mensagens`)).json()).length).toBe(2);
  });

  test('lista de projetos e portais: só o próprio', async () => {
    const portais = await (await req(tB, '/api/portal/projetos')).json();
    expect(portais.map((p: { projeto_id: string }) => p.projeto_id)).toEqual([projB]);
    const projetos = await (await req(tB, '/api/projetos')).json();
    expect(projetos.map((p: { id: string }) => p.id)).toEqual([projB]);
  });

  test('documentos, mensagens, checklist, obrigações, financeiro e hub do projeto A: vazios ou negados', async () => {
    expect(await (await req(tB, `/api/projetos/${projA}/documentos`)).json()).toEqual([]);
    expect(await (await req(tB, `/api/projetos/${projA}/mensagens`)).json()).toEqual([]);
    const check = await (await req(tB, `/api/projetos/${projA}/checklist`)).json();
    expect(check.itens).toEqual([]);
    const ob = await req(tB, `/api/projetos/${projA}/obrigacoes`); const fin = await req(tB, `/api/projetos/${projA}/financeiro`);
    for (const r of [ob, fin]) { if (r.status === 200) { const j = await r.json(); expect(JSON.stringify(j)).not.toContain('empresa A'); } }
    const hub = await req(tB, `/api/projetos/${projA}`); expect([403, 404]).toContain(hub.status);
  });

  test('baixar o arquivo do cliente A pelo id: negado', async () => {
    const r = await req(tB, `/api/documentos/${docA}/link`, { method: 'POST', body: '{}' });
    expect(r.status).not.toBe(200);
  });

  test('escrever no projeto A: negado (mensagem, envio de arquivo, análise do item)', async () => {
    const msg = await req(tB, `/api/projetos/${projA}/mensagens`, { method: 'POST', body: JSON.stringify({ texto: 'intruso' }) });
    expect(msg.status).not.toBe(201);
    const fd = new FormData(); fd.append('arquivo', new File(['x'], 'x.txt', { type: 'text/plain' })); fd.append('titulo', 'intruso');
    const env = await req(tB, `/api/projetos/${projA}/documentos`, { method: 'POST', body: fd });
    expect(env.status).not.toBe(201);
    const ana = await req(tB, `/api/requisitos/${reqA}/analise`, { method: 'POST', body: JSON.stringify({ situacao: 'aprovado' }) });
    expect(ana.status).toBe(403);
  });

  test('o que a NGA vê de cada projeto fica no projeto certo (nenhuma mensagem/documento atravessa)', async () => {
    expect((await (await req(tSocio, `/api/projetos/${projB}/mensagens`)).json())).toEqual([]);
    expect((await (await req(tSocio, `/api/projetos/${projB}/documentos`)).json())).toEqual([]);
    expect((await (await req(tSocio, `/api/projetos/${projA}/mensagens`)).json()).length).toBe(2);
  });

  test('portal do projeto A só tem pessoas da empresa A', async () => {
    const portal = await (await req(tSocio, `/api/projetos/${projA}/portal`)).json();
    expect(portal.usuarios.map((u: { email: string }) => u.email)).toEqual(['a@a.com.br']);
  });
});
