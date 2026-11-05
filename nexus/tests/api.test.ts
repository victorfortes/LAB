import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { bancoDeTeste, type BancoDeTeste } from './apoio/postgres.ts';
import { Banco } from '../src/store/conexao.ts';
import { criarApp } from '../src/server/app.ts';
import { hashDaSenha } from '../src/security/sessao.ts';
import { parseReais } from '../src/domain/shared/dinheiro.ts';

let pg: BancoDeTeste;
let tratar: (req: Request) => Promise<Response>;
let banco: Banco;

const NGA = '11111111-1111-1111-1111-111111111111';
const CLIENTE = '22222222-2222-2222-2222-222222222222';
const SOCIO = 'aaaaaaaa-0000-0000-0000-000000000001';
const ESTAGIARIO = 'aaaaaaaa-0000-0000-0000-000000000002';
const SENHA = 'uma-senha-bem-longa';

let projeto: string, credorBanco: string, credorPeq: string, plano: string, assembleia: string;

beforeAll(async () => {
  pg = await bancoDeTeste();
  const db = pg.dono;

  await db.query(`ALTER ROLE nga_app PASSWORD 'nga_app'`);
  banco = new Banco({ host: 'localhost', port: pg.porta, user: 'nga_app', password: 'nga_app', database: 'nga_teste' });
  tratar = criarApp({ banco });

  const hash = await hashDaSenha(SENHA);
  await db.query(`INSERT INTO organizacoes (id,tipo,nome) VALUES ($1,'escritorio','NGA'),($2,'cliente','Grupo X')`, [NGA, CLIENTE]);
  await db.query(`INSERT INTO usuarios (id,email,nome,senha_hash) VALUES ($1,'socio@nga.adv.br','Sócio',$3),($2,'estagio@nga.adv.br','Estagiário',$3)`, [SOCIO, ESTAGIARIO, hash]);
  await db.query(`INSERT INTO vinculos (usuario_id,organizacao_id,papel) VALUES ($1,$3,'socio_administrador'),($2,$3,'estagiario')`, [SOCIO, ESTAGIARIO, NGA]);

  projeto = (await db.query<{id:string}>(`INSERT INTO projetos (organizacao_id,nome,tipo) VALUES ($1,'RJ Grupo X','recuperacao_judicial') RETURNING id`, [NGA])).rows[0]!.id;
  credorBanco = (await db.query<{id:string}>(`INSERT INTO credores (organizacao_id,projeto_id,nome) VALUES ($1,$2,'Banco Y') RETURNING id`, [NGA, projeto])).rows[0]!.id;
  credorPeq = (await db.query<{id:string}>(`INSERT INTO credores (organizacao_id,projeto_id,nome,me_epp) VALUES ($1,$2,'Fornecedora ME',true) RETURNING id`, [NGA, projeto])).rows[0]!.id;
  plano = (await db.query<{id:string}>(`INSERT INTO planos (organizacao_id,projeto_id,titulo,data_base) VALUES ($1,$2,'PRJ','2026-11-01') RETURNING id`, [NGA, projeto])).rows[0]!.id;
  assembleia = (await db.query<{id:string}>(`INSERT INTO assembleias (organizacao_id,projeto_id,plano_id,data_hora) VALUES ($1,$2,$3,'2027-03-01 14:00+00') RETURNING id`, [NGA, projeto, plano])).rows[0]!.id;

  await db.query(`INSERT INTO condicoes_pagamento (plano_id,classe,desagio,carencia_meses,parcelas,periodicidade,juros_ao_ano,sistema)
     VALUES ($1,'II',0.30,12,60,'mensal',0.06,'sac'), ($1,'III',0.60,24,120,'mensal',0.02,'price'), ($1,'IV',0.20,6,24,'mensal',0,'sem_juros')`, [plano]);
}, 120_000);

afterAll(async () => { await banco?.encerrar(); await pg?.encerrar(); });

async function entrar(email: string): Promise<string> {
  const r = await tratar(new Request('http://x/api/sessao', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, senha: SENHA }),
  }));
  expect(r.status).toBe(200);
  const cookie = r.headers.get('set-cookie')!;
  return /nga_sessao=([^;]+)/.exec(cookie)![1]!;
}

const comToken = (token: string, url: string, init: RequestInit = {}) =>
  tratar(new Request(`http://x${url}`, {
    ...init,
    headers: { 'content-type': 'application/json', cookie: `nga_sessao=${token}`, ...(init.headers ?? {}) },
  }));

describe('autenticação', () => {
  test('senha errada não entra e não revela se o e-mail existe', async () => {
    const errada = await tratar(new Request('http://x/api/sessao', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'socio@nga.adv.br', senha: 'errada-mas-longa' }) }));
    const inexistente = await tratar(new Request('http://x/api/sessao', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'ninguem@nga.adv.br', senha: 'errada-mas-longa' }) }));
    expect(errada.status).toBe(401);
    expect(inexistente.status).toBe(401);
    expect(await errada.json()).toEqual(await inexistente.json());
  });

  test('sem token, 401', async () => {
    expect((await tratar(new Request('http://x/api/eu'))).status).toBe(401);
  });

  test('token inválido, 401', async () => {
    expect((await comToken('nao-existe', '/api/eu')).status).toBe(401);
  });

  test('login devolve cookie HttpOnly e SameSite', async () => {
    const r = await tratar(new Request('http://x/api/sessao', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'socio@nga.adv.br', senha: SENHA }) }));
    const cookie = r.headers.get('set-cookie')!;
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).not.toContain('Secure');
    const seguro = await tratar(new Request('https://lab.nga.adv.br/api/sessao', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'socio@nga.adv.br', senha: SENHA }) }));
    expect(seguro.status).toBe(200);
    expect(seguro.headers.get('set-cookie')).toContain('Secure;');
    const saiu = await tratar(new Request('https://lab.nga.adv.br/api/sessao', { method: 'DELETE' }));
    expect(saiu.headers.get('set-cookie')).toContain('Secure;');
  });

  test('logout invalida a sessão', async () => {
    const token = await entrar('socio@nga.adv.br');
    expect((await comToken(token, '/api/eu')).status).toBe(200);
    expect((await comToken(token, '/api/sessao', { method: 'DELETE' })).status).toBe(204);
    expect((await comToken(token, '/api/eu')).status).toBe(401);
  });

  test('/api/eu traz papéis e permissões', async () => {
    const token = await entrar('socio@nga.adv.br');
    const corpo = await (await comToken(token, '/api/eu')).json();
    expect(corpo.papeis).toEqual(['socio_administrador']);
    expect(corpo.permissoes).toContain('credito.validar');
    expect(corpo.organizacoes[0].nome).toBe('NGA');
  });
});

describe('créditos: sugestão da máquina × validação humana', () => {
  let creditoGarantia: string;

  test('criar crédito devolve enquadramento SUGERIDO, nunca definitivo', async () => {
    const token = await entrar('socio@nga.adv.br');
    const r = await comToken(token, `/api/projetos/${projeto}/creditos`, {
      method: 'POST',
      body: JSON.stringify({ credorId: credorBanco, valor: parseReais('1.000.000,00').toString(), natureza: 'garantia_real', valorBemGravado: parseReais('600.000,00').toString() }),
    });
    expect(r.status).toBe(201);
    const corpo = await r.json();
    creditoGarantia = corpo.id;
    expect(corpo.enquadramentoSugerido.classe).toBe('II');
    expect(corpo.enquadramentoSugerido.exigeValidacaoHumana).toBe(true);
    expect(corpo.definitivo).toBe(false);
    expect(corpo.enquadramentoSugerido.ressalvas.some((x: string) => x.includes('Garantia insuficiente'))).toBe(true);
  });

  test('estagiário cria crédito mas NÃO valida enquadramento', async () => {
    const token = await entrar('estagio@nga.adv.br');
    const criar = await comToken(token, `/api/projetos/${projeto}/creditos`, {
      method: 'POST', body: JSON.stringify({ credorId: credorPeq, valor: parseReais('80.000,00').toString(), natureza: 'quirografario' }),
    });
    expect(criar.status).toBe(201);
    // ME/EPP: o domínio sugere classe IV mesmo com natureza quirografária.
    expect((await criar.json()).enquadramentoSugerido.classe).toBe('IV');

    const validar = await comToken(token, `/api/creditos/${creditoGarantia}/validar`, {
      method: 'POST', body: JSON.stringify({ classe: 'II', sujeito: true }),
    });
    expect(validar.status).toBe(403);
  });

  test('o sócio valida e o crédito vira definitivo', async () => {
    const token = await entrar('socio@nga.adv.br');
    const r = await comToken(token, `/api/creditos/${creditoGarantia}/validar`, {
      method: 'POST', body: JSON.stringify({ classe: 'II', sujeito: true, observacao: 'Garantia conferida na matrícula.' }),
    });
    expect(r.status).toBe(200);
    expect((await r.json()).definitivo).toBe(true);
  });

  test('a validação ficou na trilha de auditoria', async () => {
    const { rows } = await pg.dono.query(
      `SELECT acao, depois FROM auditoria WHERE entidade_id=$1 AND acao='credito.validado'`, [creditoGarantia]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.depois.classe).toBe('II');
    expect(rows[0]!.depois.observacao).toContain('matrícula');
  });

  test('listagem consolida por classe com o desdobramento do art. 41, § 2º', async () => {
    const token = await entrar('socio@nga.adv.br');
    const corpo = await (await comToken(token, `/api/projetos/${projeto}/creditos`)).json();
    const porClasse = Object.fromEntries(corpo.consolidado.map((c: {classe:string}) => [c.classe, c]));
    // Banco: 600k na II, 400k na III. ME/EPP: 80k na IV.
    expect(porClasse.II.valorFormatado).toBe('600.000,00');
    expect(porClasse.III.valorFormatado).toBe('400.000,00');
    expect(porClasse.IV.valorFormatado).toBe('80.000,00');
    expect(corpo.pendentesDeValidacao).toBe(1);
  });

  test('valor inválido é recusado antes de chegar ao banco', async () => {
    const token = await entrar('socio@nga.adv.br');
    const r = await comToken(token, `/api/projetos/${projeto}/creditos`, {
      method: 'POST', body: JSON.stringify({ credorId: credorBanco, valor: '1000,50', natureza: 'quirografario' }),
    });
    expect(r.status).toBe(400);
  });

  test('centavos trafegam como string e não perdem precisão', async () => {
    const token = await entrar('socio@nga.adv.br');
    const enorme = '900719925474099301';
    const r = await comToken(token, `/api/projetos/${projeto}/creditos`, {
      method: 'POST', body: JSON.stringify({ credorId: credorBanco, valor: enorme, natureza: 'quirografario' }),
    });
    const id = (await r.json()).id;
    const { rows } = await pg.dono.query<{valor:string}>('SELECT valor FROM creditos WHERE id=$1', [id]);
    expect(rows[0]!.valor).toBe(enorme);
    await pg.dono.query('DELETE FROM creditos WHERE id=$1', [id]);
  });
});

describe('cronograma do plano', () => {
  test('só gera obrigação para crédito VALIDADO e reporta o que ficou de fora', async () => {
    const token = await entrar('socio@nga.adv.br');
    const r = await comToken(token, `/api/planos/${plano}/cronograma`, { method: 'POST' });
    expect(r.status).toBe(201);
    const corpo = await r.json();
    // Só o crédito com garantia real foi validado (classe II, 60 parcelas).
    expect(corpo.creditosProcessados).toBe(1);
    expect(corpo.obrigacoesGeradas).toBe(60);
    expect(corpo.creditosPendentesDeValidacao).toBe(1);
  });

  test('as obrigações gravadas fecham o saldo em zero', async () => {
    const { rows } = await pg.dono.query<{ soma: string; ultimo: string }>(
      `SELECT sum(amortizacao)::text AS soma,
              (SELECT saldo_final::text FROM obrigacoes WHERE plano_id=$1 ORDER BY numero DESC LIMIT 1) AS ultimo
         FROM obrigacoes WHERE plano_id=$1`, [plano]);
    // 1.000.000,00 com 30 % de deságio = 700.000,00.
    expect(rows[0]!.soma).toBe(parseReais('700.000,00').toString());
    expect(rows[0]!.ultimo).toBe('0');
  });

  test('regerar é idempotente: não duplica obrigação', async () => {
    const token = await entrar('socio@nga.adv.br');
    await comToken(token, `/api/planos/${plano}/cronograma`, { method: 'POST' });
    const { rows } = await pg.dono.query<{count:string}>('SELECT count(*)::text FROM obrigacoes WHERE plano_id=$1', [plano]);
    expect(rows[0]!.count).toBe('60');
  });
});

describe('apuração da AGC', () => {
  test('apura por classe e registra o resultado', async () => {
    const db = pg.dono;
    const { rows: creditos } = await db.query<{id:string; valor:string; classe_validada:string|null}>(
      'SELECT id, valor, classe_validada FROM creditos WHERE projeto_id=$1 ORDER BY valor DESC', [projeto]);
    const garantia = creditos.find((c) => c.classe_validada === 'II')!;
    const meEpp = creditos.find((c) => c.classe_validada === null)!;

    // O crédito com garantia vota desdobrado: II e III (art. 41, § 2º).
    await db.query(`INSERT INTO votos (assembleia_id,credito_id,classe,valor,voto) VALUES
       ($1,$2,'II',$4,'sim'), ($1,$2,'III',$5,'sim'), ($1,$3,'IV',$6,'nao')`,
      [assembleia, garantia.id, meEpp.id, parseReais('600.000,00').toString(),
       parseReais('400.000,00').toString(), parseReais('80.000,00').toString()]);

    const token = await entrar('socio@nga.adv.br');
    const r = await comToken(token, `/api/assembleias/${assembleia}/apuracao`, { method: 'POST' });
    expect(r.status).toBe(201);
    const corpo = await r.json();

    const porClasse = Object.fromEntries(corpo.classes.map((c: {classe:string}) => [c.classe, c]));
    expect(porClasse.II.aprovada).toBe(true);
    expect(porClasse.III.aprovada).toBe(true);
    expect(porClasse.IV.aprovada).toBe(false);
    expect(corpo.aprovadoPeloArt45).toBe(false);
    // Classe IV rejeitou sem nenhum voto favorável: o inciso III não se atende.
    expect(corpo.cramDown.incisoIII.atendido).toBe(false);
    expect(corpo.cramDown.cabivel).toBe(false);
    expect(corpo.concessaoPossivel).toBe(false);
    expect(corpo.ressalvas.length).toBeGreaterThan(0);
  });

  test('a apuração ficou registrada e é imutável', async () => {
    const { rows } = await pg.dono.query<{aprovado_art45:boolean}>(
      'SELECT aprovado_art45 FROM apuracoes WHERE assembleia_id=$1', [assembleia]);
    expect(rows).toHaveLength(1);
    await pg.dono.query(`UPDATE apuracoes SET aprovado_art45=true WHERE assembleia_id=$1`, [assembleia]);
    const depois = await pg.dono.query<{aprovado_art45:boolean}>(
      'SELECT aprovado_art45 FROM apuracoes WHERE assembleia_id=$1', [assembleia]);
    expect(depois.rows[0]!.aprovado_art45).toBe(false);
  });
});

describe('isolamento via API', () => {
  test('usuário sem vínculo com o projeto não enxerga seus créditos', async () => {
    const db = pg.dono;
    const estranho = 'aaaaaaaa-0000-0000-0000-000000000009';
    await db.query(`INSERT INTO usuarios (id,email,nome,senha_hash) VALUES ($1,'fora@cliente.com',' Fora',$2)`, [estranho, await hashDaSenha(SENHA)]);
    await db.query(`INSERT INTO vinculos (usuario_id,organizacao_id,papel) VALUES ($1,$2,'cliente_administrador')`, [estranho, CLIENTE]);

    const token = await entrar('fora@cliente.com');
    // RBAC barra antes mesmo do RLS: cliente não tem credito.ler.
    expect((await comToken(token, `/api/projetos/${projeto}/creditos`)).status).toBe(403);
    // E o que ele pode ler, vem vazio pelo RLS.
    const projetos = await (await comToken(token, '/api/projetos')).json();
    expect(projetos).toEqual([]);
  });
});
