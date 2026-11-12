/** QGC automático (do balancete) e validado, de ponta a ponta pela API. */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bancoDeTeste, type BancoDeTeste } from './apoio/postgres.ts';
import { Banco } from '../src/store/conexao.ts';
import { criarApp } from '../src/server/app.ts';
import { hashDaSenha } from '../src/security/sessao.ts';
import { ArmazenamentoLocal } from '../src/store/arquivos.ts';
import { deposito as montarDeposito } from '../src/server/arquivos.ts';

let pg: BancoDeTeste; let banco: Banco; let raiz: string;
let tratar: (req: Request) => Promise<Response>;
const NGA = '11111111-1111-1111-1111-111111111111';
const CLIENTE = '22222222-2222-2222-2222-222222222222';
const ADV = 'aaaaaaaa-0000-0000-0000-000000000001';
const DIR = 'aaaaaaaa-0000-0000-0000-000000000002';
const SENHA = 'uma-senha-bem-longa';
let projeto: string; let tAdv: string; let balancete: string; let relacao: string;

const BALANCETE = [
  'Código;Descrição;Saldo anterior;Débito;Crédito;Saldo atual',
  '2;PASSIVO;0,00;0,00;0,00;600.000,00C',
  '2.1;PASSIVO CIRCULANTE;0,00;0,00;0,00;600.000,00C',
  '2.1.1;Fornecedores;0,00;0,00;0,00;300.000,00C',
  '2.1.1.001;ACME AÇO LTDA;0,00;0,00;0,00;300.000,00C',
  '2.1.2;Salários a pagar;0,00;0,00;0,00;100.000,00C',
  '2.1.3;Banco Alfa - capital de giro;0,00;0,00;0,00;200.000,00C',
].join('\n');
const RELACAO = ['Credor;CNPJ;Classe;Valor', 'ACME AÇO LTDA;11.111.111/0001-11;III - Quirografário;300.000,00', 'Novo Credor ME;22.222.222/0001-22;IV;15.000,00'].join('\n');

beforeAll(async () => {
  pg = await bancoDeTeste(); const db = pg.dono;
  banco = new Banco({ host: 'localhost', port: pg.porta, user: 'nga_app', password: 'nga_app', database: 'nga_teste' });
  raiz = await mkdtemp(join(tmpdir(), 'nga-qgc-'));
  const arm = new ArmazenamentoLocal(raiz); await arm.iniciar();
  tratar = criarApp({ banco, deposito: montarDeposito(arm, { NGA_SEGREDO_ARQUIVOS: 'segredo-de-teste-de-arquivos-com-mais-de-32' }) });
  const h = await hashDaSenha(SENHA);
  await db.query(`INSERT INTO organizacoes (id,tipo,nome) VALUES ($1,'escritorio','NGA'),($2,'cliente','Grupo X')`, [NGA, CLIENTE]);
  await db.query(`INSERT INTO usuarios (id,email,nome,senha_hash) VALUES ($1,'adv@nga.adv.br','Advogada',$3),($2,'dir@grupox.com','Diretor',$3)`, [ADV, DIR, h]);
  await db.query(`INSERT INTO vinculos (usuario_id,organizacao_id,papel) VALUES ($1,$3,'advogado'),($2,$4,'cliente_administrador')`, [ADV, DIR, NGA, CLIENTE]);
  projeto = (await db.query<{ id: string }>(`INSERT INTO projetos (organizacao_id,nome,tipo) VALUES ($1,'RJ Grupo X','recuperacao_judicial') RETURNING id`, [NGA])).rows[0]!.id;
  await db.query(`INSERT INTO portais (projeto_id,organizacao_cliente_id) VALUES ($1,$2)`, [projeto, CLIENTE]);
  tAdv = await entrar('adv@nga.adv.br');
  balancete = await enviar(tAdv, 'balancete-2025.csv', BALANCETE);
  relacao = await enviar(tAdv, 'relacao-de-credores-final.csv', RELACAO);
}, 120_000);

afterAll(async () => { await banco?.encerrar(); await pg?.encerrar(); await rm(raiz, { recursive: true, force: true }); });

async function entrar(email: string) {
  const r = await tratar(new Request('http://x/api/sessao', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, senha: SENHA }) }));
  return /nga_sessao=([^;]+)/.exec(r.headers.get('set-cookie')!)![1]!;
}
const req = (t: string, url: string, init: RequestInit = {}) => tratar(new Request(`http://x${url}`, { ...init, headers: { cookie: `nga_sessao=${t}`, 'content-type': 'application/json', ...(init.headers ?? {}) } }));
async function enviar(t: string, nome: string, conteudo: string) {
  const fd = new FormData(); fd.append('arquivo', new File([conteudo], nome, { type: 'text/csv' })); fd.append('titulo', nome); fd.append('categoria', 'Contábil');
  const r = await tratar(new Request(`http://x/api/projetos/${projeto}/documentos`, { method: 'POST', body: fd, headers: { cookie: `nga_sessao=${t}` } }));
  expect(r.status).toBe(201);
  return (await r.json()).documentoId as string;
}

describe('QGC automático', () => {
  test('lê o balancete e monta o preliminar com a classe sugerida', async () => {
    const r = await req(tAdv, `/api/projetos/${projeto}/qgc/preliminar`, { method: 'POST', body: JSON.stringify({ documentoId: balancete }) });
    expect(r.status).toBe(201);
    expect((await r.json()).linhas).toBe(3);
    const d = await (await req(tAdv, `/api/projetos/${projeto}/qgc/preliminar`)).json();
    expect(d.linhas.map((l: { credor: string; classe: string }) => [l.credor, l.classe])).toEqual([
      ['Empregados (Salários a pagar)', 'I'], ['ACME AÇO LTDA', 'III'], ['Banco Alfa - capital de giro', 'III']]);
    expect(d.fonte.documentoId).toBe(balancete);
    expect(d.resumo.total).toBe('600.000,00');
  });

  test('editar a natureza recalcula a classe', async () => {
    const d = await (await req(tAdv, `/api/projetos/${projeto}/qgc/preliminar`)).json();
    const banco = d.linhas.find((l: { credor: string }) => l.credor.startsWith('Banco'));
    const r = await (await req(tAdv, `/api/qgc/preliminar/${banco.id}`, { method: 'PATCH', body: JSON.stringify({ natureza: 'garantia_real', valor: '25000000' }) })).json();
    expect(r.classe).toBe('II');
  });

  test('o cliente não vê o rascunho do QGC', async () => {
    const tDir = await entrar('dir@grupox.com');
    expect((await req(tDir, `/api/projetos/${projeto}/qgc/preliminar`)).status).toBe(403);
  });

  test('validar leva a linha para o QGC validado, sem decidir a classe', async () => {
    const d = await (await req(tAdv, `/api/projetos/${projeto}/qgc/preliminar`)).json();
    const acme = d.linhas.find((l: { credor: string }) => l.credor === 'ACME AÇO LTDA');
    expect((await req(tAdv, `/api/qgc/preliminar/${acme.id}/validar`, { method: 'POST' })).status).toBe(200);
    const c = await (await req(tAdv, `/api/projetos/${projeto}/creditos`)).json();
    expect(c.creditos).toHaveLength(1);
    expect(c.creditos[0]).toMatchObject({ credor: 'ACME AÇO LTDA', classe_validada: null });
  });

  test('ler de novo refaz as linhas automáticas e não repete a validada', async () => {
    await req(tAdv, `/api/projetos/${projeto}/qgc/preliminar`, { method: 'POST', body: JSON.stringify({ documentoId: balancete }) });
    const d = await (await req(tAdv, `/api/projetos/${projeto}/qgc/preliminar`)).json();
    expect(d.linhas.filter((l: { credor: string }) => l.credor === 'ACME AÇO LTDA').map((l: { situacao: string }) => l.situacao)).toEqual(['validado']);
  });
});

describe('QGC validado', () => {
  test('popup único: credor novo e crédito de uma vez', async () => {
    const r = await req(tAdv, `/api/projetos/${projeto}/qgc/credito`, { method: 'POST', body: JSON.stringify({ credor: 'João da Silva', natureza: 'trabalhista', valor: '1500000', meEpp: false }) });
    expect(r.status).toBe(201);
  });

  test('relação final do cliente: importa e não duplica o que já está', async () => {
    const r = await (await req(tAdv, `/api/projetos/${projeto}/qgc/relacao-final`, { method: 'POST', body: JSON.stringify({ documentoId: relacao }) })).json();
    expect(r).toMatchObject({ criados: 1, repetidos: 1 });
    const c = await (await req(tAdv, `/api/projetos/${projeto}/creditos`)).json();
    expect(c.creditos.find((x: { credor: string }) => x.credor === 'Novo Credor ME')).toMatchObject({ natureza: 'me_epp' });
  });

  test('trocar a natureza de crédito validado desfaz a validação', async () => {
    const c = await (await req(tAdv, `/api/projetos/${projeto}/creditos`)).json();
    const joao = c.creditos.find((x: { credor: string }) => x.credor === 'João da Silva');
    await req(tAdv, `/api/creditos/${joao.id}/validar`, { method: 'POST', body: JSON.stringify({ classe: 'I', sujeito: true }) });
    const r = await (await req(tAdv, `/api/creditos/${joao.id}`, { method: 'PATCH', body: JSON.stringify({ natureza: 'quirografario' }) })).json();
    expect(r.validacaoDesfeita).toBe(true);
    const depois = (await (await req(tAdv, `/api/projetos/${projeto}/creditos`)).json()).creditos.find((x: { id: string }) => x.id === joao.id);
    expect(depois.classe_validada).toBeNull();
  });

  test('excluir crédito vindo do automático devolve a linha ao rascunho', async () => {
    const c = await (await req(tAdv, `/api/projetos/${projeto}/creditos`)).json();
    const acme = c.creditos.find((x: { credor: string }) => x.credor === 'ACME AÇO LTDA');
    expect((await req(tAdv, `/api/creditos/${acme.id}`, { method: 'DELETE' })).status).toBe(200);
  });
});
