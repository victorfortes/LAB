import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { bancoDeTeste, type BancoDeTeste } from './apoio/postgres.ts';
import { Banco } from '../src/store/conexao.ts';
import { criarApp } from '../src/server/app.ts';
import { hashDaSenha } from '../src/security/sessao.ts';

let pg: BancoDeTeste; let banco: Banco; let app: ReturnType<typeof criarApp>; let s = ''; let a = ''; let b = ''; let pA = ''; let pB = '';
const NGA = '11111111-1111-1111-1111-111111111111', U = 'aaaaaaaa-0000-4000-8000-000000000001', SENHA = 'uma-senha-bem-longa';
const req = (t: string, u: string, i: RequestInit = {}) => app(new Request(`http://x${u}`, { ...i, headers: { 'content-type': 'application/json', cookie: `nga_sessao=${t}` } }));
const post = (t: string, u: string, c: unknown) => req(t, u, { method: 'POST', body: JSON.stringify(c) });
const j = async (r: Response | Promise<Response>) => (await r).json();
const entrar = async (e: string, se: string) => /nga_sessao=([^;]+)/.exec((await app(new Request('http://x/api/sessao', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: e, senha: se }) }))).headers.get('set-cookie')!)![1]!;
const PARAM = { marco: '2027-01-15', classes: [{ id: 'III', rotulo: 'III', credito: '2000000000', condicao: { desagio: 0.7, carenciaMeses: 18, parcelas: 36, periodicidade: 'mensal', jurosAoAno: 0 } }], caixa: { saldoInicial: '100000000', inicio: '2027-01-01', receitaMensal: '100000000', despesaMensal: '80000000' }, horizonte: 60 };

beforeAll(async () => {
  pg = await bancoDeTeste(); await pg.dono.query(`ALTER ROLE nga_app PASSWORD 'nga_app'`);
  banco = new Banco({ host: 'localhost', port: pg.porta, user: 'nga_app', password: 'nga_app', database: 'nga_teste' }); app = criarApp({ banco });
  await pg.dono.query(`INSERT INTO organizacoes(id,tipo,nome) VALUES($1,'escritorio','NGA')`, [NGA]);
  await pg.dono.query(`INSERT INTO usuarios(id,email,nome,senha_hash) VALUES($1,'socio@nga.adv.br','Socio',$2)`, [U, await hashDaSenha(SENHA)]);
  await pg.dono.query(`INSERT INTO vinculos(usuario_id,organizacao_id,papel) VALUES($1,$2,'socio_administrador')`, [U, NGA]);
  s = await entrar('socio@nga.adv.br', SENHA);
  const novo = async (n: string, e: string) => { const p = await j(post(s, '/api/projetos', { nome: n, tipo: 'recuperacao_judicial' })); const c = await j(post(s, `/api/projetos/${p.id}/portal/convites`, { nome: 'Dir', email: e, organizacao: n })); return [p.id as string, await entrar(e, c.senhaTemporaria)] as const; };
  [pA, a] = await novo('Empresa A', 'a@a.com'); [pB, b] = await novo('Empresa B', 'b@b.com');
}, 180_000);
afterAll(async () => { await banco?.encerrar(); await pg?.encerrar(); });

describe('contas e isolamento', () => {
  let id = '';
  test('o cliente cria título parcelado e o valor fecha', async () => {
    const r = await post(a, `/api/projetos/${pA}/titulos`, { tipo: 'pagar', contraparte: 'ACME', vencimento: '2027-02-10', valor: '100000', parcelas: 3 }); expect(r.status).toBe(201);
    const g = await j(req(a, `/api/projetos/${pA}/gestao`)); expect(g.titulos).toHaveLength(3); expect(g.titulos.reduce((t: bigint, x: { valorAtualizado: string }) => t + BigInt(x.valorAtualizado), 0n)).toBe(100000n); id = g.titulos[0].id;
  });
  test('baixa parcial reduz o comprometido e não conta duas vezes', async () => {
    expect((await post(a, `/api/titulos/${id}/baixa`, { valor: '10000', data: '2027-02-10' })).status).toBe(200);
    const g = await j(req(a, `/api/projetos/${pA}/gestao`)); expect(g.titulos.find((t: { id: string }) => t.id === id).situacao).toBe('parcial'); expect(g.fluxo.aPagar).toBe('90000');
    expect((await post(a, `/api/titulos/${id}/baixa`, { valor: '99999999', data: '2027-02-10' })).status).toBe(400);
  });
  test('outro cliente não vê nem baixa', async () => {
    expect((await j(req(b, `/api/projetos/${pA}/gestao`))).titulos ?? []).toEqual([]);
    expect((await post(b, `/api/titulos/${id}/baixa`, { valor: '1', data: '2027-02-10' })).status).toBe(404);
    expect((await post(b, `/api/projetos/${pA}/titulos`, { tipo: 'pagar', contraparte: 'X', vencimento: '2027-02-10', valor: '1' })).status).toBe(404);
  });
  test('o escritório lê o autorizado, mas não altera o financeiro do cliente', async () => {
    expect((await j(req(s, `/api/projetos/${pA}/gestao`))).titulos).toHaveLength(3);
    expect((await post(s, `/api/projetos/${pA}/titulos`, { tipo: 'pagar', contraparte: 'X', vencimento: '2027-02-10', valor: '1' })).status).toBe(403);
    expect((await post(s, `/api/titulos/${id}/baixa`, { valor: '1', data: '2027-02-10' })).status).toBe(403);
  });
  test('desligar a autorização corta a leitura do escritório', async () => {
    await req(s, `/api/projetos/${pA}/portal`, { method: 'PATCH', body: JSON.stringify({ mostraFinanceiro: false }) });
    expect((await j(req(s, `/api/projetos/${pA}/gestao`))).titulos).toEqual([]);
    await req(s, `/api/projetos/${pA}/portal`, { method: 'PATCH', body: JSON.stringify({ mostraFinanceiro: true }) });
  });
  test('reimportar o mesmo arquivo não duplica', async () => {
    const c = { arquivo: 'x.csv', formato: 'csv', linhas: [{ data: '2027-03-01', valor: '5000', tipo: 'despesa', natureza: 'lancamento', descricao: 'd', contraparte: 'c', categoria: 'x', situacao: 'realizado' }] };
    expect(await j(post(a, `/api/projetos/${pA}/importacoes`, c))).toEqual({ importadas: 1, duplicadas: 0 }); expect(await j(post(a, `/api/projetos/${pA}/importacoes`, c))).toEqual({ importadas: 0, duplicadas: 1 });
  });
  test('prévia por arquivo', async () => { const f = new FormData(); f.append('arquivo', new File(['Data;Valor\n01/02/2027;-10,00\n'], 'a.csv'));
    const r = await app(new Request(`http://x/api/projetos/${pA}/importacoes/previa`, { method: 'POST', body: f, headers: { cookie: `nga_sessao=${a}` } })); expect(r.status).toBe(200); expect((await r.json()).linhas[0].valor).toBe('1000'); });
});

describe('PRJ Studio', () => {
  test('simula e o cenário A do briefing fecha em R$ 6 mi', async () => { const r = await post(s, `/api/projetos/${pA}/prj/simular`, PARAM); expect(r.status).toBe(200); const c = await r.json(); expect(c.indicadores.total).toBe('600000000'); expect(c.sensibilidade).toHaveLength(5); });
  test('salva versões sem sobrescrever e ficam privadas', async () => {
    expect((await j(post(s, `/api/projetos/${pA}/prj/cenarios`, { nome: 'A', parametros: PARAM }))).versao).toBe(1); expect((await j(post(s, `/api/projetos/${pA}/prj/cenarios`, { nome: 'A', parametros: PARAM }))).versao).toBe(2);
    expect(await j(req(s, `/api/projetos/${pA}/prj/cenarios`))).toHaveLength(2);
  });
  test('o cliente não alcança o estúdio', async () => { for (const u of ['base', 'cenarios']) expect((await req(a, `/api/projetos/${pA}/prj/${u}`)).status).toBe(403); expect((await post(a, `/api/projetos/${pA}/prj/simular`, PARAM)).status).toBe(403); });
  test('otimiza dentro de limites', async () => { const r = await post(s, `/api/projetos/${pA}/prj/otimizar`, { parametros: PARAM, classeId: 'III', desagio: [0.5, 0.8], passoDesagio: 0.1, carencia: [12, 24], passoCarencia: 12, parcelas: [36, 60], passoParcelas: 12, reservaMinima: '0' }); expect(r.status).toBe(200); expect((await r.json()).combinacoes).toBe(24); });
  test('o raio X é só do escritório', async () => { expect((await req(a, `/api/projetos/${pA}/raio-x`)).status).toBe(403); expect((await req(s, `/api/projetos/${pA}/raio-x`)).status).toBe(200); });
});

describe('PMT', () => {
  let neg = '';
  test('Price: R$ 10.000, 1% a.m., 12x dá PMT de R$ 888,49', async () => {
    neg = (await j(post(s, `/api/projetos/${pA}/negociacoes`, { titulo: 'Banco X' }))).id;
    const r = await j(post(s, `/api/negociacoes/${neg}/pmts`, { principal: '1000000', parcelas: 12, primeiroVencimento: '2020-01-10', jurosAoMes: 0.01, sistema: 'price' })); expect(r.primeira).toBe('88849');
  });
  test('painel aponta vencida, baixa e recusa refazer por cima do pago', async () => {
    const p = await j(req(s, `/api/projetos/${pA}/pmts`)); expect(p.resumo.qtdVencidas).toBe(12); expect(p.itens[0].vencimento).toBe('2020-01-10');
    expect((await req(s, `/api/pmts/${p.itens[0].id}`, { method: 'PATCH', body: JSON.stringify({ valorPago: '88849', pagoEm: '2020-01-10' }) })).status).toBe(200);
    expect((await j(req(s, `/api/projetos/${pA}/pmts`))).resumo.qtdVencidas).toBe(11);
    expect((await post(s, `/api/negociacoes/${neg}/pmts`, { principal: '1', parcelas: 1, primeiroVencimento: '2020-01-10' })).status).toBe(400);
  });
  test('o cliente não vê PMT', async () => { expect((await req(a, `/api/projetos/${pA}/pmts`)).status).toBe(403); });
});

describe('árvore, atas e chat', () => {
  test('tarefa e subtarefa ficam na fase', async () => {
    const m = await j(post(s, `/api/projetos/${pA}/tarefas`, { titulo: 'Mãe', fase: 'distribuido' })); await post(s, `/api/projetos/${pA}/tarefas`, { titulo: 'Filha', fase: 'distribuido', paiId: m.id });
    const t = (await j(req(s, `/api/tarefas?projeto=${pA}`))).tarefas; const f = t.find((x: { titulo: string }) => x.titulo === 'Filha'); expect(f.fase).toBe('distribuido'); expect(f.paiId).toBe(m.id);
  });
  test('ata interna não chega ao cliente; a publicada chega; encaminhamentos viram tarefas', async () => {
    const at = await j(post(s, `/api/projetos/${pA}/atas`, { titulo: 'Kickoff interna', realizadaEm: '2027-01-10' })); expect(await j(req(a, `/api/projetos/${pA}/atas`))).toEqual([]);
    await req(s, `/api/atas/${at.id}`, { method: 'PATCH', body: JSON.stringify({ titulo: 'Kickoff', realizadaEm: '2027-01-10', publicada: true }) }); expect(await j(req(a, `/api/projetos/${pA}/atas`))).toHaveLength(1); expect(await j(req(b, `/api/projetos/${pA}/atas`))).toEqual([]);
    expect(await j(post(s, `/api/atas/${at.id}/tarefas`, { tarefas: [{ titulo: 'Enviar minuta' }] }))).toEqual({ criadas: 1 });
  });
  test('leitura: a NGA marca a do cliente, sem abrir escrita ao cliente', async () => {
    await post(a, `/api/projetos/${pA}/mensagens`, { texto: 'oi' }); expect((await j(req(s, '/api/conversas'))).find((c: { id: string }) => c.id === pA).nao_lidas).toBe(1);
    await post(s, `/api/projetos/${pA}/mensagens/lidas`, {}); expect((await j(req(s, '/api/conversas'))).find((c: { id: string }) => c.id === pA).nao_lidas).toBe(0);
    expect((await post(b, `/api/projetos/${pA}/mensagens/lidas`, {})).status).toBeGreaterThanOrEqual(400); expect((await req(a, '/api/conversas')).status).toBe(403);
  });
});

test('entregas do LAB: só para o dono', async () => { expect((await req(s, '/api/lab/entregas')).status).toBe(404); process.env.NGA_EMAILS_DONO = 'socio@nga.adv.br'; expect((await req(s, '/api/lab/entregas')).status).toBe(200); expect((await req(a, '/api/lab/entregas')).status).toBe(404); delete process.env.NGA_EMAILS_DONO; });

test('relatórios abrem mesmo sem o Gerador neste banco', async () => { await post(s, `/api/projetos/${pB}/portal`, {}); expect((await req(s, `/api/projetos/${pB}/gerador/emissoes`)).status).toBe(200); });

describe('rotinas na nuvem', () => {
  test('a fila inclui documento do escritório e deixa relatório de fora', async () => {
    const doc = async (titulo: string, categoria: string) => { const f = new FormData(); f.append('arquivo', new File([titulo], `${titulo}.txt`, { type: 'text/plain' })); f.append('titulo', titulo); f.append('categoria', categoria); return (await (await app(new Request(`http://x/api/projetos/${pB}/documentos`, { method: 'POST', body: f, headers: { cookie: `nga_sessao=${s}` } }))).json()).documentoId as string; };
    const interno = await doc('escritorio-x', 'Contábil'); const rel = await doc('relatorio-x', 'relatorio_gerador');
    const fila = (await pg.dono.query('SELECT * FROM documentos_de_analise_pendentes(5)')).rows.map((r) => r.documento_id);
    expect(fila).toContain(interno); expect(fila).not.toContain(rel);
  });
  test('PDF que derrubou a execução para após 3 tentativas e informa o motivo', async () => {
    const id = (await pg.dono.query(`SELECT d.id, d.organizacao_id, d.projeto_id FROM documentos d WHERE d.titulo='escritorio-x'`)).rows[0];
    await pg.dono.query(`INSERT INTO documento_processamento(documento_id,organizacao_id,projeto_id,estado,tentativas,atualizado_em) VALUES($1,$2,$3,'lendo',3,now()-interval '1 hour')`, [id.id, id.organizacao_id, id.projeto_id]);
    expect((await pg.dono.query('SELECT * FROM documentos_de_analise_pendentes(5)')).rows.map((r) => r.documento_id)).not.toContain(id.id);
    await pg.dono.query('SELECT encerrar_leituras_travadas()');
    expect((await pg.dono.query('SELECT estado FROM documento_processamento WHERE documento_id=$1', [id.id])).rows[0].estado).toBe('erro');
  });
  test('a aplicação confere a chave, mas não consegue lê-la', async () => {
    const { token } = (await pg.dono.query('SELECT token FROM rotina_chave')).rows[0]; const h = new Bun.CryptoHasher('sha256').update(token).digest('hex');
    expect(await banco.semContexto(async (db) => (await db.query('SELECT rotina_autorizada($1) ok', [h])).rows[0].ok)).toBe(true);
    expect(await banco.semContexto(async (db) => (await db.query('SELECT rotina_autorizada($1) ok', ['0'.repeat(64)])).rows[0].ok)).toBe(false);
    await expect(banco.semContexto((db) => db.query('SELECT token FROM rotina_chave'))).rejects.toThrow();
  });
});

test('PDF acima do limite da nuvem sai com motivo, sem abrir o arquivo', async () => {
  const { extrair } = await import('../src/server/analise_auto.ts');
  expect(await extrair(new Uint8Array(4 * 1024 * 1024), 'application/pdf', { limitePdfBytes: 3 * 1024 * 1024 })).toMatchObject({ vazio: expect.stringContaining('limite') });
});
