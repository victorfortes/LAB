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
import { pdfDeTeste } from './apoio/zip.ts';

let pg: BancoDeTeste; let banco: Banco; let raiz: string;
let tratar: (req: Request) => Promise<Response>;

const NGA = '11111111-1111-1111-1111-111111111111';
const CLIENTE = '22222222-2222-2222-2222-222222222222';
const SOCIA = 'aaaaaaaa-0000-4000-8000-000000000001';
const ADVOGADO = 'aaaaaaaa-0000-4000-8000-000000000002';
const CLIENTE_USR = 'aaaaaaaa-0000-4000-8000-000000000003';
const SENHA = 'uma-senha-bem-longa';
const NUMERO = '0001234-56.2024.8.16.0001';
let projeto: string;
let tokenSentinela = '', tokenPrazos = '', tokenIntegra = '';
let idSentinela = '';

beforeAll(async () => {
  pg = await bancoDeTeste();
  const db = pg.dono;
  await db.query(`ALTER ROLE nga_app PASSWORD 'nga_app'`);
  banco = new Banco({ host: 'localhost', port: pg.porta, user: 'nga_app', password: 'nga_app', database: 'nga_teste' });
  raiz = await mkdtemp(join(tmpdir(), 'nga-int-'));
  const armazenamento = new ArmazenamentoLocal(raiz);
  await armazenamento.iniciar();
  tratar = criarApp({
    banco,
    deposito: montarDeposito(armazenamento,
      { NGA_SEGREDO_ARQUIVOS: 'segredo-de-teste-de-integracoes-com-32+' }),
  });

  const h = await hashDaSenha(SENHA);
  await db.query(`INSERT INTO organizacoes (id,tipo,nome) VALUES ($1,'escritorio','NGA'),($2,'cliente','Grupo X')`, [NGA, CLIENTE]);
  await db.query(`INSERT INTO usuarios (id,email,nome,senha_hash) VALUES
    ($1,'socia@nga.adv.br','Sócia',$4),($2,'adv@nga.adv.br','Advogado',$4),
    ($3,'dir@grupox.com','Diretor X',$4)`, [SOCIA, ADVOGADO, CLIENTE_USR, h]);
  await db.query(`INSERT INTO vinculos (usuario_id,organizacao_id,papel) VALUES
    ($1,$4,'socio_administrador'),($2,$4,'advogado'),($3,$5,'cliente_administrador')`,
    [SOCIA, ADVOGADO, CLIENTE_USR, NGA, CLIENTE]);
  projeto = (await db.query<{id:string}>(`INSERT INTO projetos (organizacao_id,nome,tipo)
    VALUES ($1,'RJ Grupo X','recuperacao_judicial') RETURNING id`, [NGA])).rows[0]!.id;
}, 120_000);

afterAll(async () => {
  await banco?.encerrar(); await pg?.encerrar();
  await rm(raiz, { recursive: true, force: true });
});

async function entrar(email: string): Promise<string> {
  const r = await tratar(new Request('http://x/api/sessao', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, senha: SENHA }) }));
  expect(r.status).toBe(200);
  return /nga_sessao=([^;]+)/.exec(r.headers.get('set-cookie')!)![1]!;
}
const req = (t: string, url: string, init: RequestInit = {}) =>
  tratar(new Request(`http://x${url}`, { ...init,
    headers: { 'content-type': 'application/json', cookie: `nga_sessao=${t}`, ...(init.headers ?? {}) } }));
/** As aplicações do Lab não têm cookie: entregam com Bearer. */
const entregar = (token: string, url: string, corpo: unknown) =>
  tratar(new Request(`http://x${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(corpo) }));

describe('credencial de integração', () => {
  test('a sócia cria e o token aparece uma vez só', async () => {
    const t = await entrar('socia@nga.adv.br');
    const r = await req(t, '/api/integracoes', {
      method: 'POST',
      body: JSON.stringify({ nome: 'NGA Sentinela', aplicacao: 'sentinela', escopos: ['processos'] }) });
    expect(r.status).toBe(201);
    const corpo = await r.json();
    tokenSentinela = corpo.token;
    idSentinela = corpo.id;
    expect(tokenSentinela).toStartWith('nga_int_');
    expect(corpo.aviso).toContain('não é exibido outra vez');

    // Só o hash fica: a listagem nunca devolve token.
    const lista = await (await req(t, '/api/integracoes')).json();
    expect(JSON.stringify(lista)).not.toContain(tokenSentinela);
    expect(lista.integracoes[0].nuncaUsada).toBe(true);
  });

  test('o usuário de serviço não entra por senha', async () => {
    // Ele tem senha — um segredo aleatório descartado na criação. Não há o
    // que digitar, e isso não depende de regra de aplicação.
    const { rows } = await pg.dono.query<{ email: string }>(
      `SELECT email FROM usuarios WHERE nome LIKE '%(integração)'`);
    expect(rows).toHaveLength(1);
    const r = await tratar(new Request('http://x/api/sessao', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: rows[0]!.email, senha: SENHA }) }));
    expect(r.status).toBe(401);
  });

  test('só quem administra cria credencial', async () => {
    for (const email of ['adv@nga.adv.br', 'dir@grupox.com']) {
      const t = await entrar(email);
      const r = await req(t, '/api/integracoes', {
        method: 'POST',
        body: JSON.stringify({ nome: 'minha', aplicacao: 'outra', escopos: ['processos'] }) });
      expect(r.status).toBe(403);
    }
  });

  test('cria as outras duas para os demais escopos', async () => {
    const t = await entrar('socia@nga.adv.br');
    tokenPrazos = (await (await req(t, '/api/integracoes', {
      method: 'POST',
      body: JSON.stringify({ nome: 'NGA Prazos', aplicacao: 'prazos', escopos: ['prazos'] }) })).json()).token;
    tokenIntegra = (await (await req(t, '/api/integracoes', {
      method: 'POST',
      body: JSON.stringify({ nome: 'NGA Íntegra', aplicacao: 'integra', escopos: ['documentos'] }) })).json()).token;
    expect(tokenPrazos).not.toBe(tokenIntegra);
  });

  test('token inválido, de sessão ou ausente não passam', async () => {
    expect((await entregar('nga_int_inexistente', '/api/integracao/processos', {})).status).toBe(401);
    const sessao = await entrar('socia@nga.adv.br');
    // Token de sessão não serve para integração: são caminhos distintos.
    expect((await entregar(sessao, '/api/integracao/processos', {})).status).toBe(401);
    expect((await tratar(new Request('http://x/api/integracao/processos', { method: 'POST' }))).status)
      .toBe(401);
  });

  test('o contrato se descreve para quem tem a credencial', async () => {
    const r = await tratar(new Request('http://x/api/integracao/contrato', {
      headers: { authorization: `Bearer ${tokenSentinela}` } }));
    const c = await r.json();
    expect(c.suaCredencial.escopos).toEqual(['processos']);
    // O contrato diz, por aplicação, quem já está ligado e quem não está.
    expect(c.estado.sentinela).toContain('Ligado');
    expect(c.estado.prazos).toContain('fila durável');
    expect(c.naoExercitado).toContain('Íntegra');
  });
});

describe('Sentinela entrega processo e movimentação', () => {
  test('cria o processo e as movimentações', async () => {
    const r = await entregar(tokenSentinela, '/api/integracao/processos', {
      processos: [{
        numero: '00012345620248160001', classe: 'Recuperação Judicial',
        comarca: 'Curitiba', uf: 'PR', projetoId: projeto,
        movimentacoes: [
          { data: '2026-10-20', titulo: 'Distribuição', externoId: 'djen-1' },
          { data: '2026-10-28', titulo: 'Publicação de edital', externoId: 'djen-2' },
        ],
      }],
    });
    expect(r.status).toBe(201);
    const corpo = await r.json();
    expect(corpo).toMatchObject({ criados: 1, atualizados: 0, movimentacoesCriadas: 2, repetidos: 0 });
  });

  test('reentregar o mesmo lote não duplica nada', async () => {
    // Robô roda de novo: por reinício, por retentativa, por clique duplo.
    const r = await entregar(tokenSentinela, '/api/integracao/processos', {
      processos: [{
        numero: NUMERO,
        movimentacoes: [
          { data: '2026-10-20', titulo: 'Distribuição', externoId: 'djen-1' },
          { data: '2026-10-28', titulo: 'Publicação de edital', externoId: 'djen-2' },
          { data: '2026-11-01', titulo: 'Juntada de petição', externoId: 'djen-3' },
        ],
      }],
    });
    const corpo = await r.json();
    expect(corpo).toMatchObject({ criados: 0, atualizados: 1, movimentacoesCriadas: 1, repetidos: 2 });
  });

  test('número com dígito errado é recusado com o motivo', async () => {
    const r = await entregar(tokenSentinela, '/api/integracao/processos', {
      processos: [{ numero: '0001234-99.2024.8.16.0001', movimentacoes: [] }] });
    const corpo = await r.json();
    expect(corpo.criados).toBe(0);
    expect(corpo.recusados[0].motivo).toContain('dígito verificador');
  });

  test('o que o robô entrega NASCE invisível ao cliente', async () => {
    // Publicar continua sendo ato de pessoa, com resumo escrito (§6.3).
    const { rows } = await pg.dono.query<{ visivel: boolean }>(
      `SELECT bool_or(visivel_ao_cliente) AS visivel FROM movimentacoes`);
    expect(rows[0]!.visivel).toBe(false);
  });

  test('a credencial do Sentinela não entrega prazo nem documento', async () => {
    const r = await entregar(tokenSentinela, '/api/integracao/prazos', { prazos: [] });
    expect(r.status).toBe(403);
    expect((await r.json()).erro).toContain('não tem escopo');
  });
});

describe('NGA Prazos entrega prazo do Astrea', () => {
  test('o vencimento é recalculado aqui, pelas regras do CPC', async () => {
    const r = await entregar(tokenPrazos, '/api/integracao/prazos', {
      prazos: [{
        numeroProcesso: NUMERO, titulo: 'Embargos de declaração',
        tipo: 'embargos', evento: '2026-11-06', origem: 'disponibilizacao_dje',
        externoId: 'astrea-77',
      }],
    });
    expect(r.status).toBe(201);
    expect((await r.json()).criados).toBe(1);

    const { rows } = await pg.dono.query<{ vencimento: Date; calculo: Record<string, unknown> }>(
      `SELECT vencimento, calculo FROM prazos WHERE titulo = 'Embargos de declaração'`);
    // DJe sexta 06/11 → publicação segunda 09/11 → 1º dia terça 10/11 → 5 úteis.
    expect(rows[0]!.vencimento.toISOString().slice(0, 10)).toBe('2026-11-16');
    expect(rows[0]!.calculo['recebidoDe']).toBe('NGA Prazos');
    expect(String(rows[0]!.calculo['fundamentoLegal'])).toContain('1.023');
  });

  test('o mesmo prazo aberto não entra duas vezes', async () => {
    const corpo = { prazos: [{ numeroProcesso: NUMERO, titulo: 'Embargos de declaração',
      tipo: 'embargos', evento: '2026-11-06', origem: 'disponibilizacao_dje' as const }] };
    const r = await entregar(tokenPrazos, '/api/integracao/prazos', corpo);
    expect(await r.json()).toMatchObject({ criados: 0, repetidos: 1 });
  });

  test('prazo de processo não cadastrado é recusado, não cria processo', async () => {
    // Vínculo errado espalha prazo em caso que não é o do cliente.
    const r = await entregar(tokenPrazos, '/api/integracao/prazos', {
      prazos: [{ numeroProcesso: '5001234-63.2023.8.16.0014', titulo: 'Contestação',
        tipo: 'contestacao', evento: '2026-11-06' }] });
    const corpo = await r.json();
    expect(corpo.criados).toBe(0);
    expect(corpo.recusados[0].motivo).toContain('não cadastrado');

    const { rows } = await pg.dono.query('SELECT count(*) AS n FROM processos');
    expect(Number((rows[0] as { n: string }).n)).toBe(1);
  });
});

describe('Íntegra entrega as partes dos autos', () => {
  test('o arquivo vai para o acervo, vinculado ao projeto do processo', async () => {
    const pdf = pdfDeTeste();
    const f = new FormData();
    f.append('arquivo', new File([pdf as unknown as BlobPart], 'autos-parte-01.pdf',
      { type: 'application/pdf' }));
    f.append('numeroProcesso', NUMERO);
    f.append('titulo', 'Autos digitalizados — parte 1 de 59');

    const r = await tratar(new Request('http://x/api/integracao/documentos', {
      method: 'POST', headers: { authorization: `Bearer ${tokenIntegra}` }, body: f }));
    expect(r.status).toBe(201);
    const corpo = await r.json();
    expect(corpo.tipo).toBe('application/pdf');
    expect(corpo.nome).toBe('autos-parte-01.pdf');

    const { rows } = await pg.dono.query<{ visibilidade: string; projeto_id: string }>(
      'SELECT visibilidade, projeto_id FROM documentos WHERE id = $1', [corpo.documentoId]);
    expect(rows[0]!.visibilidade).toBe('interno');
    expect(rows[0]!.projeto_id).toBe(projeto);
  });

  test('processo sem projeto vinculado é recusado com o motivo', async () => {
    await pg.dono.query('UPDATE processos SET projeto_id = NULL WHERE numero = $1', [NUMERO]);
    const f = new FormData();
    f.append('arquivo', new File(['x'], 'a.txt', { type: 'text/plain' }));
    f.append('numeroProcesso', NUMERO);
    f.append('titulo', 'qualquer');
    const r = await tratar(new Request('http://x/api/integracao/documentos', {
      method: 'POST', headers: { authorization: `Bearer ${tokenIntegra}` }, body: f }));
    expect(r.status).toBe(400);
    expect((await r.json()).erro).toContain('não está vinculado a projeto');
    await pg.dono.query('UPDATE processos SET projeto_id = $2 WHERE numero = $1', [NUMERO, projeto]);
  });
});

describe('revogação', () => {
  test('o uso fica registrado antes de revogar', async () => {
    const t = await entrar('socia@nga.adv.br');
    const lista = await (await req(t, '/api/integracoes')).json();
    const sentinela = lista.integracoes.find((i: { nome: string }) => i.nome === 'NGA Sentinela');
    expect(sentinela.usos).toBeGreaterThan(0);
    expect(sentinela.nuncaUsada).toBe(false);
    expect(sentinela.ativa).toBe(true);
  });

  test('revogada, a credencial para de valer na hora', async () => {
    const t = await entrar('socia@nga.adv.br');
    expect((await req(t, `/api/integracoes/${idSentinela}`, { method: 'DELETE' })).status).toBe(200);

    const r = await entregar(tokenSentinela, '/api/integracao/processos', {
      processos: [{ numero: NUMERO, movimentacoes: [] }] });
    expect(r.status).toBe(401);
  });

  test('revogar duas vezes é recusado', async () => {
    const t = await entrar('socia@nga.adv.br');
    const r = await req(t, `/api/integracoes/${idSentinela}`, { method: 'DELETE' });
    expect(r.status).toBe(400);
    expect((await r.json()).erro).toContain('já está revogada');
  });
});

describe('§6.1 — a integração não fura o isolamento', () => {
  test('a ingestão roda sob RLS: o processo entregue fica na organização da credencial', async () => {
    const { rows } = await pg.dono.query<{ organizacao_id: string }>(
      'SELECT organizacao_id FROM processos WHERE numero = $1', [NUMERO]);
    expect(rows[0]!.organizacao_id).toBe(NGA);
  });

  test('o cliente não enxerga a lista de credenciais', async () => {
    const t = await entrar('dir@grupox.com');
    expect((await req(t, '/api/integracoes')).status).toBe(403);
  });
});
