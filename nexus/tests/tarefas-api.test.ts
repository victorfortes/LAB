import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { bancoDeTeste, type BancoDeTeste } from './apoio/postgres.ts';
import { Banco } from '../src/store/conexao.ts';
import { criarApp } from '../src/server/app.ts';
import { hashDaSenha } from '../src/security/sessao.ts';
import { ordenar, resumir, situacaoDoPrazo } from '../src/domain/projeto/tarefas.ts';

let pg: BancoDeTeste; let banco: Banco;
let tratar: (req: Request) => Promise<Response>;

const NGA = '11111111-1111-1111-1111-111111111111';
const SOCIO = 'aaaaaaaa-0000-4000-8000-000000000001';
const ESTAG = 'aaaaaaaa-0000-4000-8000-000000000002';
const SENHA = 'uma-senha-bem-longa';
let projeto: string;

beforeAll(async () => {
  pg = await bancoDeTeste();
  const db = pg.dono;
  await db.query(`ALTER ROLE nga_app PASSWORD 'nga_app'`);
  banco = new Banco({ host: 'localhost', port: pg.porta, user: 'nga_app', password: 'nga_app', database: 'nga_teste' });
  tratar = criarApp({ banco });
  const h = await hashDaSenha(SENHA);
  await db.query(`INSERT INTO organizacoes (id,tipo,nome) VALUES ($1,'escritorio','NGA')`, [NGA]);
  await db.query(`INSERT INTO usuarios (id,email,nome,senha_hash) VALUES
    ($1,'socio@nga.adv.br','Sócio',$3),($2,'est@nga.adv.br','Estagiário',$3)`, [SOCIO, ESTAG, h]);
  await db.query(`INSERT INTO vinculos (usuario_id,organizacao_id,papel) VALUES
    ($1,$3,'socio_administrador'),($2,$3,'estagiario')`, [SOCIO, ESTAG, NGA]);
}, 120_000);
afterAll(async () => { await banco?.encerrar(); await pg?.encerrar(); });

async function entrar(email: string): Promise<string> {
  const r = await tratar(new Request('http://x/api/sessao', { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, senha: SENHA }) }));
  return /nga_sessao=([^;]+)/.exec(r.headers.get('set-cookie')!)![1]!;
}
const req = (t: string, url: string, init: RequestInit = {}) =>
  tratar(new Request(`http://x${url}`, { ...init,
    headers: { 'content-type': 'application/json', cookie: `nga_sessao=${t}`, ...(init.headers ?? {}) } }));

describe('regra pura de tarefa', () => {
  const t = (status: 'a_fazer' | 'concluida', prazo: string | null, prioridade: 'baixa' | 'alta' | 'urgente' = 'baixa') =>
    ({ status, prazo, prioridade });

  test('urgência vem do prazo, não de a pessoa ter marcado "urgente"', () => {
    expect(situacaoDoPrazo(t('a_fazer', '2026-11-02'), '2026-11-04')).toBe('atrasada');
    expect(situacaoDoPrazo(t('a_fazer', '2026-11-04'), '2026-11-04')).toBe('hoje');
    expect(situacaoDoPrazo(t('a_fazer', '2026-11-06'), '2026-11-04')).toBe('esta_semana');
    expect(situacaoDoPrazo(t('a_fazer', '2026-12-30'), '2026-11-04')).toBe('adiante');
    expect(situacaoDoPrazo(t('a_fazer', null), '2026-11-04')).toBe('sem_prazo');
    expect(situacaoDoPrazo(t('concluida', '2020-01-01'), '2026-11-04')).toBe('concluida');
  });

  test('o prazo conta dias úteis forenses: o fim de semana não é dia de trabalho', () => {
    // Sexta 06/11 → segunda 09/11 está a 1 dia útil, não 3.
    expect(situacaoDoPrazo(t('a_fazer', '2026-11-09'), '2026-11-06')).toBe('esta_semana');
    // 02/11 (segunda) → 20/11 (feriado, sexta): bem além de 5 dias úteis.
    expect(situacaoDoPrazo(t('a_fazer', '2026-11-20'), '2026-11-02')).toBe('adiante');
  });

  test('atrasada vem primeiro, depois urgência', () => {
    const lista = [
      { id: 'a', ...t('a_fazer', '2026-11-20', 'urgente') },
      { id: 'b', ...t('a_fazer', '2026-11-01', 'baixa') },
      { id: 'c', ...t('a_fazer', '2026-11-20', 'alta') },
    ];
    expect(ordenar(lista, '2026-11-04').map((x) => x.id)).toEqual(['b', 'a', 'c']);
  });

  test('projeto sem tarefa não é "100% concluído"', () => {
    expect(resumir([], '2026-11-04').percentualConcluido).toBe(0);
    expect(resumir([t('concluida', null)], '2026-11-04').percentualConcluido).toBe(100);
  });
});

describe('API de tarefas', () => {
  test('cria projeto e tarefa; o responsável padrão é quem cria', async () => {
    const tk = await entrar('socio@nga.adv.br');
    const p = await (await req(tk, '/api/projetos', { method: 'POST', body: JSON.stringify({
      nome: 'RJ Teste', tipo: 'recuperacao_judicial',
      cliente: { razaoSocial: 'INDÚSTRIA DEMO LTDA.', cnpj: '33.000.167/0001-01' } }) })).json();
    projeto = p.id;
    const r = await req(tk, `/api/projetos/${projeto}/tarefas`, { method: 'POST',
      body: JSON.stringify({ titulo: 'Revisar minuta do plano', prioridade: 'alta', prazo: '2026-11-20' }) });
    expect(r.status).toBe(201);

    const lista = await (await req(tk, '/api/tarefas')).json();
    expect(lista.tarefas).toHaveLength(1);
    expect(lista.tarefas[0].responsavel).toBe('Sócio');
    expect(lista.tarefas[0].projeto).toBe('RJ Teste');
  });

  test('o cliente é criado junto com o projeto, e o CNPJ errado é recusado', async () => {
    const tk = await entrar('socio@nga.adv.br');
    const hub = await (await req(tk, `/api/projetos/${projeto}`)).json();
    expect(hub.empresas[0].razao_social).toBe('INDÚSTRIA DEMO LTDA.');
    expect(hub.empresas[0].papel).toBe('recuperanda');

    const ruim = await req(tk, '/api/projetos', { method: 'POST', body: JSON.stringify({
      nome: 'X', tipo: 'consultivo', cliente: { razaoSocial: 'Fulano', cnpj: '33.000.167/0001-99' } }) });
    expect(ruim.status).toBe(400);
    expect((await ruim.json()).erro).toContain('dígito verificador');
  });

  test('arrastar para "concluída" data a conclusão; reabrir limpa', async () => {
    const tk = await entrar('socio@nga.adv.br');
    const id = (await (await req(tk, '/api/tarefas')).json()).tarefas[0].id;

    await req(tk, `/api/tarefas/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'concluida' }) });
    let t = (await (await req(tk, '/api/tarefas')).json()).tarefas[0];
    expect(t.status).toBe('concluida');
    expect(t.concluidaEm).not.toBeNull();
    expect(t.situacaoDoPrazo).toBe('concluida');

    await req(tk, `/api/tarefas/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'em_andamento' }) });
    t = (await (await req(tk, '/api/tarefas')).json()).tarefas[0];
    expect(t.concluidaEm).toBeNull();
  });

  test('PATCH vazio e status inventado são recusados', async () => {
    const tk = await entrar('socio@nga.adv.br');
    const id = (await (await req(tk, '/api/tarefas')).json()).tarefas[0].id;
    expect((await req(tk, `/api/tarefas/${id}`, { method: 'PATCH', body: '{}' })).status).toBe(400);
    expect((await req(tk, `/api/tarefas/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'quase' }) })).status).toBe(400);
  });

  test('a equipe aparece para atribuir; integração e cliente não', async () => {
    const tk = await entrar('socio@nga.adv.br');
    const eq = await (await req(tk, '/api/escritorio/equipe')).json();
    expect(eq.map((x: { nome: string }) => x.nome)).toEqual(['Estagiário', 'Sócio']);
  });

  test('credor entra pelo projeto', async () => {
    const tk = await entrar('socio@nga.adv.br');
    const r = await req(tk, `/api/projetos/${projeto}/credores`, { method: 'POST',
      body: JSON.stringify({ nome: 'Banco Fictício S.A.', documento: '33000167000101' }) });
    expect(r.status).toBe(201);
    const lista = await (await req(tk, `/api/projetos/${projeto}/credores`)).json();
    expect(lista).toHaveLength(1);
  });

  test('excluir apaga e audita', async () => {
    const tk = await entrar('socio@nga.adv.br');
    const id = (await (await req(tk, '/api/tarefas')).json()).tarefas[0].id;
    expect((await req(tk, `/api/tarefas/${id}`, { method: 'DELETE' })).status).toBe(200);
    expect((await (await req(tk, '/api/tarefas')).json()).tarefas).toHaveLength(0);
    const { rows } = await pg.dono.query(`SELECT 1 FROM auditoria WHERE acao = 'tarefa.excluida'`);
    expect(rows).toHaveLength(1);
  });
});

describe('convite de cliente', () => {
  let senha = '';
  test('a equipe convida e a senha temporária aparece uma vez', async () => {
    const tk = await entrar('socio@nga.adv.br');
    const r = await req(tk, `/api/projetos/${projeto}/portal/convites`, { method: 'POST',
      body: JSON.stringify({ nome: 'Diretora Financeira', email: 'DIRETORA@grupo.com.br', organizacao: 'Grupo Demonstração' }) });
    expect(r.status).toBe(201);
    const c = await r.json();
    senha = c.senhaTemporaria;
    expect(c.email).toBe('diretora@grupo.com.br');          // normalizado
    expect(senha).toHaveLength(14);
    expect(c.aviso).toContain('uma vez');
  });

  test('a senha NÃO fica na auditoria', async () => {
    const { rows } = await pg.dono.query(`SELECT depois FROM auditoria WHERE acao = 'portal.cliente_convidado'`);
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0])).not.toContain(senha);
  });

  test('o cliente convidado entra e cai no portal, no projeto certo', async () => {
    const tk = await entrar('socio@nga.adv.br');
    const r = await tratar(new Request('http://x/api/sessao', { method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'diretora@grupo.com.br', senha }) }));
    expect(r.status).toBe(200);
    const ck = /nga_sessao=([^;]+)/.exec(r.headers.get('set-cookie')!)![1]!;
    const eu = await (await req(ck, '/api/eu')).json();
    expect(eu.ehCliente).toBe(true);
    const meus = await (await req(ck, '/api/portal/projetos')).json();
    expect(meus.map((p: { nome: string }) => p.nome)).toEqual(['RJ Teste']);
    // E a equipe enxerga quem tem acesso.
    const portal = await (await req(tk, `/api/projetos/${projeto}/portal`)).json();
    expect(portal.existe).toBe(true);
    expect(portal.usuarios[0].email).toBe('diretora@grupo.com.br');
  });

  test('um segundo convite entra na MESMA organização cliente', async () => {
    const tk = await entrar('socio@nga.adv.br');
    await req(tk, `/api/projetos/${projeto}/portal/convites`, { method: 'POST',
      body: JSON.stringify({ nome: 'Contador', email: 'contador@grupo.com.br' }) });
    const { rows } = await pg.dono.query(`SELECT count(*) AS n FROM organizacoes WHERE tipo = 'cliente'`);
    expect(Number((rows[0] as { n: string }).n)).toBe(1);
    const portal = await (await req(tk, `/api/projetos/${projeto}/portal`)).json();
    expect(portal.usuarios).toHaveLength(2);
  });

  test('e-mail repetido é recusado com motivo', async () => {
    const tk = await entrar('socio@nga.adv.br');
    const r = await req(tk, `/api/projetos/${projeto}/portal/convites`, { method: 'POST',
      body: JSON.stringify({ nome: 'Outra', email: 'contador@grupo.com.br' }) });
    expect(r.status).toBe(400);
    expect((await r.json()).erro).toContain('já tem cadastro');
  });

  test('o estagiário não convida cliente; desligar o portal barra o acesso na hora', async () => {
    const est = await entrar('est@nga.adv.br');
    expect((await req(est, `/api/projetos/${projeto}/portal/convites`, { method: 'POST',
      body: JSON.stringify({ nome: 'X', email: 'x@y.com' }) })).status).toBe(403);

    const tk = await entrar('socio@nga.adv.br');
    await req(tk, `/api/projetos/${projeto}/portal`, { method: 'PATCH', body: JSON.stringify({ ativo: false }) });
    const { rows } = await pg.dono.query(`SELECT ativo FROM portais`);
    expect(rows[0]).toEqual({ ativo: false });
  });
});
