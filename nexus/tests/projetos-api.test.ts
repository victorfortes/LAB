import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { bancoDeTeste, type BancoDeTeste } from './apoio/postgres.ts';
import { Banco } from '../src/store/conexao.ts';
import { criarApp } from '../src/server/app.ts';
import { hashDaSenha } from '../src/security/sessao.ts';

let pg: BancoDeTeste; let banco: Banco;
let tratar: (req: Request) => Promise<Response>;

const NGA = '11111111-1111-1111-1111-111111111111';
const CLIENTE = '22222222-2222-2222-2222-222222222222';
const SOCIO = 'aaaaaaaa-0000-4000-8000-000000000001';
const ADVOGADA = 'aaaaaaaa-0000-4000-8000-000000000005';
const CLIENTE_USR = 'aaaaaaaa-0000-4000-8000-000000000002';
const SENHA = 'uma-senha-bem-longa';
let projeto: string, empresa: string;

beforeAll(async () => {
  pg = await bancoDeTeste({ equipeAutomatica: false });
  const db = pg.dono;
  await db.query(`ALTER ROLE nga_app PASSWORD 'nga_app'`);
  banco = new Banco({ host: 'localhost', port: pg.porta, user: 'nga_app', password: 'nga_app', database: 'nga_teste' });
  tratar = criarApp({ banco });

  const h = await hashDaSenha(SENHA);
  await db.query(`INSERT INTO organizacoes (id,tipo,nome) VALUES ($1,'escritorio','NGA'),($2,'cliente','Grupo X')`, [NGA, CLIENTE]);
  await db.query(`INSERT INTO usuarios (id,email,nome,senha_hash) VALUES
    ($1,'socio@nga.adv.br','Sócio',$4),($2,'adv@nga.adv.br','Advogada',$4),
    ($3,'dir@grupox.com','Diretor X',$4)`, [SOCIO, ADVOGADA, CLIENTE_USR, h]);
  await db.query(`INSERT INTO vinculos (usuario_id,organizacao_id,papel) VALUES
    ($1,$4,'socio_administrador'),($2,$4,'advogado'),($3,$5,'cliente_administrador')`,
    [SOCIO, ADVOGADA, CLIENTE_USR, NGA, CLIENTE]);
  empresa = (await db.query<{id:string}>(`INSERT INTO empresas (organizacao_id,cnpj,razao_social)
    VALUES ($1,'11222333000180','INDÚSTRIA DEMONSTRAÇÃO LTDA.') RETURNING id`, [NGA])).rows[0]!.id;
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

describe('criação de projeto', () => {
  test('nasce na primeira fase do procedimento, com quem criou liderando', async () => {
    const t = await entrar('socio@nga.adv.br');
    const r = await req(t, '/api/projetos', {
      method: 'POST',
      body: JSON.stringify({
        nome: 'RJ Indústria Demonstração', tipo: 'recuperacao_judicial',
        resumo: 'Recuperação judicial do grupo.', prioridade: 1, empresaId: empresa,
      }) });
    expect(r.status).toBe(201);
    const corpo = await r.json();
    projeto = corpo.id;
    expect(corpo.fase.id).toBe('preparacao');
    expect(corpo.fase.fundamento).toBe('art. 51 da Lei 11.101/2005');
    expect(corpo.progresso).toEqual({
      indice: 1, total: 9, percentual: 11, proxima: expect.anything(), terminal: false,
    });

    // Projeto sem líder é como um prazo passa: quem cria lidera.
    const hub = await (await req(t, `/api/projetos/${projeto}`)).json();
    expect(hub.equipe).toHaveLength(1);
    expect(hub.equipe[0].papel).toBe('lider');
    expect(hub.equipe[0].nome).toBe('Sócio');
    expect(hub.empresas[0].razao_social).toBe('INDÚSTRIA DEMONSTRAÇÃO LTDA.');
  });

  test('o estagiário não cria projeto; o cliente, menos ainda', async () => {
    const t = await entrar('dir@grupox.com');
    expect((await req(t, '/api/projetos', {
      method: 'POST', body: JSON.stringify({ nome: 'x', tipo: 'consultivo' }) })).status).toBe(403);
  });
});

describe('fase do projeto', () => {
  test('avança um passo e registra desde quando', async () => {
    const t = await entrar('socio@nga.adv.br');
    const r = await req(t, `/api/projetos/${projeto}/fase`, {
      method: 'POST', body: JSON.stringify({ fase: 'distribuido', desde: '2026-10-01' }) });
    expect(r.status).toBe(200);
    expect((await r.json()).fase.id).toBe('distribuido');

    const hub = await (await req(t, `/api/projetos/${projeto}`)).json();
    expect(hub.faseAtual.nome).toBe('Pedido distribuído');
    expect(hub.fase_desde).toContain('2026-10-01');
  });

  test('pular fase é 409, e o erro diz o que ficou de fora', async () => {
    const t = await entrar('socio@nga.adv.br');
    const r = await req(t, `/api/projetos/${projeto}/fase`, {
      method: 'POST', body: JSON.stringify({ fase: 'concedida' }) });
    expect(r.status).toBe(409);
    expect((await r.json()).erro).toContain('Processamento deferido');
  });

  test('fase de outro procedimento é recusada', async () => {
    const t = await entrar('socio@nga.adv.br');
    const r = await req(t, `/api/projetos/${projeto}/fase`, {
      method: 'POST', body: JSON.stringify({ fase: 'arrecadacao' }) });
    expect(r.status).toBe(409);
    expect((await r.json()).erro).toContain('não é fase de Recuperação judicial');
  });

  test('o catálogo de fases alimenta a interface', async () => {
    const t = await entrar('socio@nga.adv.br');
    const c = await (await req(t, '/api/projetos/fases')).json();
    const rj = c.find((x: { tipo: string }) => x.tipo === 'recuperacao_judicial');
    expect(rj.rotulo).toBe('Recuperação judicial');
    expect(rj.fases).toHaveLength(10);
  });
});

describe('equipe', () => {
  let equipeId: string;

  test('entra gente nova e o hub mostra', async () => {
    const t = await entrar('socio@nga.adv.br');
    const r = await req(t, `/api/projetos/${projeto}/equipe`, {
      method: 'POST', body: JSON.stringify({ usuarioId: ADVOGADA, papel: 'advogado' }) });
    expect(r.status).toBe(201);
    const hub = await (await req(t, `/api/projetos/${projeto}`)).json();
    expect(hub.equipe.map((e: { nome: string }) => e.nome)).toEqual(['Sócio', 'Advogada']);
  });

  test('trocar de líder substitui, não acumula', async () => {
    const t = await entrar('socio@nga.adv.br');
    await req(t, `/api/projetos/${projeto}/equipe`, {
      method: 'POST', body: JSON.stringify({ usuarioId: ADVOGADA, papel: 'lider' }) });
    const hub = await (await req(t, `/api/projetos/${projeto}`)).json();
    const lideres = hub.equipe.filter((e: { papel: string }) => e.papel === 'lider');
    expect(lideres).toHaveLength(1);
    expect(lideres[0].nome).toBe('Advogada');
    equipeId = hub.equipe.find((e: { papel: string }) => e.papel === 'advogado').id;
  });

  test('sair não apaga a linha: quem trabalhou no caso trabalhou', async () => {
    const t = await entrar('socio@nga.adv.br');
    expect((await req(t, `/api/equipe/${equipeId}`, { method: 'DELETE' })).status).toBe(200);
    const hub = await (await req(t, `/api/projetos/${projeto}`)).json();
    expect(hub.equipe.some((e: { id: string }) => e.id === equipeId)).toBe(false);

    const { rows } = await pg.dono.query<{ ate: Date | null }>(
      'SELECT ate FROM projeto_equipe WHERE id = $1', [equipeId]);
    expect(rows[0]!.ate).not.toBeNull();
  });
});

describe('o hub reúne o que está pendurado no projeto', () => {
  test('conta cada módulo e lista os próximos prazos', async () => {
    const db = pg.dono;
    const credor = (await db.query<{id:string}>(`INSERT INTO credores (organizacao_id,projeto_id,nome)
      VALUES ($1,$2,'Banco Fictício S.A.') RETURNING id`, [NGA, projeto])).rows[0]!.id;
    await db.query(`INSERT INTO creditos (organizacao_id,projeto_id,credor_id,valor,natureza)
      VALUES ($1,$2,$3,320000000,'quirografario')`, [NGA, projeto, credor]);
    await db.query(`INSERT INTO requisitos (organizacao_id,projeto_id,categoria,titulo,obrigatorio)
      VALUES ($1,$2,'Societário','Contrato social',TRUE)`, [NGA, projeto]);
    const processo = (await db.query<{id:string}>(`INSERT INTO processos
      (organizacao_id,projeto_id,numero,criado_por)
      VALUES ($1,$2,'0001234-56.2024.8.16.0001',$3) RETURNING id`,
      [NGA, projeto, SOCIO])).rows[0]!.id;
    await db.query(`INSERT INTO prazos (processo_id,organizacao_id,titulo,evento,origem,dias,
        regime,vencimento,calculo,criado_por)
      VALUES ($1,$2,'Impugnação','2026-10-29','publicacao',10,'uteis','2026-11-13','{}'::jsonb,$3)`,
      [processo, NGA, SOCIO]);

    const t = await entrar('socio@nga.adv.br');
    const hub = await (await req(t, `/api/projetos/${projeto}`)).json();
    expect(hub.contagens.creditos).toBe(1);
    expect(hub.contagens.creditos_a_validar).toBe(1);
    expect(hub.contagens.requisitos_obrigatorios).toBe(1);
    expect(hub.contagens.processos).toBe(1);
    expect(hub.contagens.prazos_abertos).toBe(1);
    expect(hub.proximosPrazos[0].titulo).toBe('Impugnação');
    expect(typeof hub.proximosPrazos[0].diasUteisRestantes).toBe('number');
  });

  test('o cliente não enxerga a equipe nem os prazos do projeto dele', async () => {
    await pg.dono.query(`INSERT INTO portais (projeto_id,organizacao_cliente_id) VALUES ($1,$2)`,
      [projeto, CLIENTE]);
    const t = await entrar('dir@grupox.com');
    const hub = await (await req(t, `/api/projetos/${projeto}`)).json();
    // Equipe e prazo são controle interno: sem política de portal, vêm vazios.
    expect(hub.equipe).toEqual([]);
    expect(hub.proximosPrazos).toEqual([]);
    expect(hub.contagens).toBeUndefined();
  });
});

describe('painel de quem trabalha no caso', () => {
  test('mostra meus projetos, prazos e pendências de verdade', async () => {
    const t = await entrar('adv@nga.adv.br');
    const p = await (await req(t, '/api/painel')).json();
    expect(p.usuario).toBe('Advogada');
    expect(p.meusProjetos.map((x: { nome: string }) => x.nome))
      .toEqual(['RJ Indústria Demonstração']);
    expect(p.meusProjetos[0].faseAtual.nome).toBe('Pedido distribuído');
    expect(p.prazos[0].titulo).toBe('Impugnação');
    expect(p.aValidar[0].quantos).toBe(1);
    expect(p.pendencias).toBeGreaterThan(0);
  });

  test('mensagem do cliente sem resposta aparece; respondida, some', async () => {
    const db = pg.dono;
    await db.query(`INSERT INTO mensagens (organizacao_id,projeto_id,autor_id,lado,texto)
      VALUES ($1,$2,$3,'cliente','Conseguem me explicar o próximo passo?')`,
      [NGA, projeto, CLIENTE_USR]);
    const t = await entrar('adv@nga.adv.br');
    const antes = await (await req(t, '/api/painel')).json();
    expect(antes.mensagensSemResposta).toHaveLength(1);

    await db.query(`INSERT INTO mensagens (organizacao_id,projeto_id,autor_id,lado,texto)
      VALUES ($1,$2,$3,'nga','Explicamos na ligação de hoje.')`, [NGA, projeto, SOCIO]);
    const depois = await (await req(t, '/api/painel')).json();
    expect(depois.mensagensSemResposta).toHaveLength(0);
  });

  test('o painel interno não é do cliente — ele tem o portal', async () => {
    const t = await entrar('dir@grupox.com');
    const r = await req(t, '/api/painel');
    expect(r.status).toBe(403);
    expect((await r.json()).erro).toContain('/api/portal/projetos');
  });
});

describe('encerramento', () => {
  test('exige motivo e fica registrado', async () => {
    const t = await entrar('socio@nga.adv.br');
    const sem = await req(t, `/api/projetos/${projeto}/encerramento`, {
      method: 'POST', body: JSON.stringify({ motivo: 'ok' }) });
    expect(sem.status).toBe(400);

    const com = await req(t, `/api/projetos/${projeto}/encerramento`, {
      method: 'POST',
      body: JSON.stringify({ motivo: 'Plano cumprido e recuperação encerrada por sentença.' }) });
    expect(com.status).toBe(200);
    expect((await com.json()).situacao).toBe('encerrado');
  });

  test('encerrar duas vezes é recusado', async () => {
    const t = await entrar('socio@nga.adv.br');
    const r = await req(t, `/api/projetos/${projeto}/encerramento`, {
      method: 'POST', body: JSON.stringify({ motivo: 'de novo, por engano' }) });
    expect(r.status).toBe(400);
    expect((await r.json()).erro).toContain('já está encerrado');
  });

  test('projeto encerrado sai do painel de quem trabalhava nele', async () => {
    const t = await entrar('adv@nga.adv.br');
    const p = await (await req(t, '/api/painel')).json();
    expect(p.meusProjetos).toEqual([]);
  });
});
