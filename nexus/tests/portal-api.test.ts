import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { bancoDeTeste, type BancoDeTeste } from './apoio/postgres.ts';
import { Banco } from '../src/store/conexao.ts';
import { criarApp } from '../src/server/app.ts';
import { hashDaSenha } from '../src/security/sessao.ts';
import { parseReais } from '../src/domain/shared/dinheiro.ts';

let pg: BancoDeTeste; let banco: Banco;
let tratar: (req: Request) => Promise<Response>;

const NGA = '11111111-1111-1111-1111-111111111111';
const CLIENTE = '22222222-2222-2222-2222-222222222222';
const OUTRO = '33333333-3333-3333-3333-333333333333';
const ADVOGADO = 'aaaaaaaa-0000-0000-0000-000000000001';
const ESTAGIARIO = 'aaaaaaaa-0000-0000-0000-000000000004';
const CLIENTE_USR = 'aaaaaaaa-0000-0000-0000-000000000002';
const OUTRO_USR = 'aaaaaaaa-0000-0000-0000-000000000003';
const SENHA = 'uma-senha-bem-longa';
let projeto: string, projetoOutro: string;

beforeAll(async () => {
  pg = await bancoDeTeste();
  const db = pg.dono;
  await db.query(`ALTER ROLE nga_app PASSWORD 'nga_app'`);
  banco = new Banco({ host: 'localhost', port: pg.porta, user: 'nga_app', password: 'nga_app', database: 'nga_teste' });
  tratar = criarApp({ banco });

  const h = await hashDaSenha(SENHA);
  await db.query(`INSERT INTO organizacoes (id,tipo,nome) VALUES ($1,'escritorio','NGA'),($2,'cliente','Grupo X'),($3,'cliente','Grupo Y')`, [NGA, CLIENTE, OUTRO]);
  await db.query(`INSERT INTO usuarios (id,email,nome,senha_hash) VALUES
    ($1,'adv@nga.adv.br','Advogado',$5),($2,'dir@grupox.com','Diretor X',$5),
    ($3,'dir@grupoy.com','Diretor Y',$5),($4,'est@nga.adv.br','Estagiário',$5)`,
    [ADVOGADO, CLIENTE_USR, OUTRO_USR, ESTAGIARIO, h]);
  await db.query(`INSERT INTO vinculos (usuario_id,organizacao_id,papel) VALUES
    ($1,$5,'advogado'),($2,$6,'cliente_administrador'),($3,$7,'cliente_administrador'),($4,$5,'estagiario')`,
    [ADVOGADO, CLIENTE_USR, OUTRO_USR, ESTAGIARIO, NGA, CLIENTE, OUTRO]);

  projeto = (await db.query<{id:string}>(`INSERT INTO projetos (organizacao_id,nome,tipo)
    VALUES ($1,'RJ Grupo X','recuperacao_judicial') RETURNING id`, [NGA])).rows[0]!.id;
  projetoOutro = (await db.query<{id:string}>(`INSERT INTO projetos (organizacao_id,nome,tipo)
    VALUES ($1,'RJ Grupo Y','recuperacao_judicial') RETURNING id`, [NGA])).rows[0]!.id;
  await db.query(`INSERT INTO portais (projeto_id,organizacao_cliente_id) VALUES ($1,$2),($3,$4)`,
    [projeto, CLIENTE, projetoOutro, OUTRO]);
}, 120_000);

afterAll(async () => { await banco?.encerrar(); await pg?.encerrar(); });

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

let requisitoId: string;

describe('checklist por procedimento', () => {
  test('a NGA aplica o modelo da RJ', async () => {
    const t = await entrar('adv@nga.adv.br');
    const r = await req(t, `/api/projetos/${projeto}/checklist`, { method: 'POST' });
    expect(r.status).toBe(201);
    const corpo = await r.json();
    expect(corpo.criados).toBeGreaterThan(10);
    expect(corpo.criados).toBe(corpo.total);
  });

  test('aplicar de novo não duplica', async () => {
    const t = await entrar('adv@nga.adv.br');
    const corpo = await (await req(t, `/api/projetos/${projeto}/checklist`, { method: 'POST' })).json();
    expect(corpo.criados).toBe(0);
  });

  test('o cliente vê o checklist com progresso zero e tudo com ele', async () => {
    const t = await entrar('dir@grupox.com');
    const corpo = await (await req(t, `/api/projetos/${projeto}/checklist`)).json();
    expect(corpo.progresso.percentualAprovado).toBe(0);
    expect(corpo.progresso.aguardandoOCliente).toBe(corpo.itens.length);
    expect(corpo.itens[0].rotuloDaSituacao).toBe('Pendente');
    expect(corpo.itens.some((i: {fundamento:string|null}) => i.fundamento?.includes('Art. 51'))).toBe(true);
    requisitoId = corpo.itens[0].id;
  });

  test('o cliente do Grupo Y não vê o checklist do Grupo X', async () => {
    const t = await entrar('dir@grupoy.com');
    const corpo = await (await req(t, `/api/projetos/${projeto}/checklist`)).json();
    expect(corpo.itens).toHaveLength(0);
    expect(corpo.progresso.total).toBe(0);
  });
});

describe('envio e análise: enviar não é aprovar', () => {
  test('o cliente envia o documento', async () => {
    const t = await entrar('dir@grupox.com');
    const r = await req(t, `/api/projetos/${projeto}/documentos`, {
      method: 'POST',
      body: JSON.stringify({ requisitoId, titulo: 'Balanço 2025', caminho: '/doc/1', tipoMime: 'application/pdf' }),
    });
    expect(r.status).toBe(201);
    const corpo = await r.json();
    expect(corpo.situacao).toBe('enviado');
    expect(corpo.rotulo).toBe('Recebido, aguardando análise');
  });

  test('o progresso de ENVIADO sobe, o de APROVADO não', async () => {
    const t = await entrar('dir@grupox.com');
    const p = (await (await req(t, `/api/projetos/${projeto}/checklist`)).json()).progresso;
    expect(p.percentualEnviado).toBeGreaterThan(0);
    expect(p.percentualAprovado).toBe(0);
    expect(p.aguardandoANGA).toBe(1);
    expect(p.concluido).toBe(false);
  });

  test('o documento enviado NÃO aparece para o cliente: está interno', async () => {
    const t = await entrar('dir@grupox.com');
    const docs = await (await req(t, `/api/projetos/${projeto}/documentos`)).json();
    expect(docs).toHaveLength(0);
  });

  test('mas chegou para a NGA', async () => {
    const t = await entrar('adv@nga.adv.br');
    const docs = await (await req(t, `/api/projetos/${projeto}/documentos`)).json();
    expect(docs).toHaveLength(1);
    expect(docs[0].titulo).toBe('Balanço 2025');
    expect(docs[0].visibilidade).toBe('interno');
  });

  test('o cliente não consegue aprovar o próprio documento', async () => {
    const t = await entrar('dir@grupox.com');
    const r = await req(t, `/api/requisitos/${requisitoId}/analise`, {
      method: 'POST', body: JSON.stringify({ situacao: 'aprovado' }) });
    expect(r.status).toBe(403);
  });

  test('o estagiário também não analisa', async () => {
    const t = await entrar('est@nga.adv.br');
    const r = await req(t, `/api/requisitos/${requisitoId}/analise`, {
      method: 'POST', body: JSON.stringify({ situacao: 'aprovado' }) });
    expect(r.status).toBe(403);
  });

  test('a NGA pede complementação, com a razão que o cliente vai ler', async () => {
    const t = await entrar('adv@nga.adv.br');
    const r = await req(t, `/api/requisitos/${requisitoId}/analise`, {
      method: 'POST',
      body: JSON.stringify({ situacao: 'complementacao', observacao: 'Faltam as notas explicativas.' }) });
    expect(r.status).toBe(200);
    expect((await r.json()).rotulo).toBe('Aguardando complementação');
  });

  test('a bola volta para o cliente, com a observação visível', async () => {
    const t = await entrar('dir@grupox.com');
    const corpo = await (await req(t, `/api/projetos/${projeto}/checklist`)).json();
    const item = corpo.itens.find((i: {id:string}) => i.id === requisitoId);
    expect(item.situacao).toBe('complementacao');
    expect(item.observacao).toBe('Faltam as notas explicativas.');
    expect(item.aguardaVoce).toBe(true);
    expect(corpo.progresso.percentualEnviado).toBe(0);
  });

  test('o cliente reenvia e a NGA aprova', async () => {
    const tc = await entrar('dir@grupox.com');
    await req(tc, `/api/projetos/${projeto}/documentos`, {
      method: 'POST', body: JSON.stringify({ requisitoId, titulo: 'Balanço 2025 v2', caminho: '/doc/2' }) });

    const tn = await entrar('adv@nga.adv.br');
    const r = await req(tn, `/api/requisitos/${requisitoId}/analise`, {
      method: 'POST', body: JSON.stringify({ situacao: 'aprovado' }) });
    expect(r.status).toBe(200);

    const p = (await (await req(tc, `/api/projetos/${projeto}/checklist`)).json()).progresso;
    expect(p.aprovados).toBe(1);
    expect(p.percentualAprovado).toBeGreaterThan(0);
  });

  test('transição impossível devolve 409, não 500', async () => {
    const t = await entrar('adv@nga.adv.br');
    // 'aprovado' → 'rejeitado' não é transição permitida.
    const r = await req(t, `/api/requisitos/${requisitoId}/analise`, {
      method: 'POST', body: JSON.stringify({ situacao: 'rejeitado' }) });
    expect(r.status).toBe(409);
    expect((await r.json()).erro).toMatch(/transição inválida/);
  });
});

describe('publicação: a única porta de saída', () => {
  let documentoId: string;

  test('o estagiário não publica', async () => {
    const tn = await entrar('adv@nga.adv.br');
    const docs = await (await req(tn, `/api/projetos/${projeto}/documentos`)).json();
    documentoId = docs[0].id;

    const te = await entrar('est@nga.adv.br');
    const r = await req(te, `/api/documentos/${documentoId}/publicacao`, { method: 'POST' });
    expect(r.status).toBe(403);
  });

  test('o advogado publica e o cliente passa a ver', async () => {
    const tn = await entrar('adv@nga.adv.br');
    expect((await req(tn, `/api/documentos/${documentoId}/publicacao`, { method: 'POST' })).status).toBe(200);

    const tc = await entrar('dir@grupox.com');
    const docs = await (await req(tc, `/api/projetos/${projeto}/documentos`)).json();
    expect(docs).toHaveLength(1);
    expect(docs[0].id).toBe(documentoId);
  });

  test('a publicação ficou na auditoria com quem publicou', async () => {
    const { rows } = await pg.dono.query(
      `SELECT usuario_id, depois FROM auditoria
        WHERE acao='documento.publicado_para_cliente' AND entidade_id=$1`, [documentoId]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.usuario_id).toBe(ADVOGADO);
  });

  test('despublicar retira do cliente na hora', async () => {
    const tn = await entrar('adv@nga.adv.br');
    expect((await req(tn, `/api/documentos/${documentoId}/publicacao`, { method: 'DELETE' })).status).toBe(200);
    const tc = await entrar('dir@grupox.com');
    expect(await (await req(tc, `/api/projetos/${projeto}/documentos`)).json()).toHaveLength(0);
  });
});

describe('financeiro da recuperanda', () => {
  test('o cliente lança e o fluxo reflete', async () => {
    const t = await entrar('dir@grupox.com');
    const lancamentos = [
      { data: '2026-11-10', tipo: 'receita', situacao: 'realizado', valor: parseReais('150.000,00').toString(), categoria: 'Vendas' },
      { data: '2026-11-20', tipo: 'despesa', situacao: 'realizado', valor: parseReais('90.000,00').toString(), categoria: 'Folha' },
      { data: '2026-12-20', tipo: 'despesa', situacao: 'previsto', valor: parseReais('200.000,00').toString(), categoria: 'Fornecedores' },
    ];
    for (const l of lancamentos) {
      const r = await req(t, `/api/projetos/${projeto}/financeiro`, { method: 'POST', body: JSON.stringify(l) });
      expect(r.status).toBe(201);
    }

    const f = await (await req(t, `/api/projetos/${projeto}/financeiro?de=2026-11-01&ate=2026-12-31`)).json();
    expect(f.totalDeLancamentos).toBe(3);
    // 0 + 150 − 90 − 200 = −140 mil projetado
    expect(f.fluxo.saldoFinalProjetadoFormatado).toBe('-140.000,00');
    expect(f.fluxo.saldoFinalRealizadoFormatado).toBe('60.000,00');
    expect(f.fluxo.periodosNegativos).toContain('dez/2026');
  });

  test('a NGA lê o caixa autorizado pelo portal', async () => {
    const t = await entrar('adv@nga.adv.br');
    const f = await (await req(t, `/api/projetos/${projeto}/financeiro?de=2026-11-01&ate=2026-12-31`)).json();
    expect(f.totalDeLancamentos).toBe(3);
  });

  test('e deixa de ler quando o cliente revoga', async () => {
    await pg.dono.query(`UPDATE portais SET mostra_financeiro=false WHERE projeto_id=$1`, [projeto]);
    const t = await entrar('adv@nga.adv.br');
    const f = await (await req(t, `/api/projetos/${projeto}/financeiro?de=2026-11-01&ate=2026-12-31`)).json();
    expect(f.totalDeLancamentos).toBe(0);
    await pg.dono.query(`UPDATE portais SET mostra_financeiro=true WHERE projeto_id=$1`, [projeto]);
  });

  test('o cliente do Grupo Y não vê o caixa do Grupo X', async () => {
    const t = await entrar('dir@grupoy.com');
    const f = await (await req(t, `/api/projetos/${projeto}/financeiro?de=2026-11-01&ate=2026-12-31`)).json();
    expect(f.totalDeLancamentos).toBe(0);
  });

  test('valor com vírgula é recusado', async () => {
    const t = await entrar('dir@grupox.com');
    const r = await req(t, `/api/projetos/${projeto}/financeiro`, { method: 'POST',
      body: JSON.stringify({ data: '2026-11-01', tipo: 'receita', situacao: 'previsto', valor: '100,50', categoria: 'X' }) });
    expect(r.status).toBe(400);
  });
});

describe('mensagens', () => {
  test('o lado vem do papel, não do corpo da requisição', async () => {
    const tc = await entrar('dir@grupox.com');
    await req(tc, `/api/projetos/${projeto}/mensagens`, { method: 'POST',
      body: JSON.stringify({ texto: 'Enviei o balanço revisado.', lado: 'nga' }) });

    const tn = await entrar('adv@nga.adv.br');
    const msgs = await (await req(tn, `/api/projetos/${projeto}/mensagens`)).json();
    const minha = msgs.find((m: {texto:string}) => m.texto.includes('balanço revisado'));
    // Mandou 'nga' no corpo, mas foi gravada como 'cliente'.
    expect(minha.lado).toBe('cliente');
  });

  test('o cliente do Grupo Y não lê as mensagens do Grupo X', async () => {
    const t = await entrar('dir@grupoy.com');
    expect(await (await req(t, `/api/projetos/${projeto}/mensagens`)).json()).toHaveLength(0);
  });
});

describe('meus portais', () => {
  test('cada cliente vê só o seu', async () => {
    const tx = await entrar('dir@grupox.com');
    const px = await (await req(tx, '/api/portal/projetos')).json();
    expect(px).toHaveLength(1);
    expect(px[0].nome).toBe('RJ Grupo X');

    const ty = await entrar('dir@grupoy.com');
    const py = await (await req(ty, '/api/portal/projetos')).json();
    expect(py.map((p: {nome:string}) => p.nome)).toEqual(['RJ Grupo Y']);
  });

  test('a equipe da NGA não tem portal: ela usa o ambiente interno', async () => {
    const t = await entrar('adv@nga.adv.br');
    expect(await (await req(t, '/api/portal/projetos')).json()).toHaveLength(0);
  });
});
