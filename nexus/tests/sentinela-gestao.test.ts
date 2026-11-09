import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { bancoDeTeste, type BancoDeTeste } from './apoio/postgres.ts';
import { Banco } from '../src/store/conexao.ts';
import { criarApp } from '../src/server/app.ts';
import { hashDaSenha } from '../src/security/sessao.ts';
import { analisarPorRegras, CONFIG_PADRAO, intervalosDeLacuna, piorStatus, statusDaChave, valorDaCausa } from '../src/server/sentinela_regras.ts';
import { rotinaSentinela } from '../src/server/sentinela.ts';
import { escoposFaltantes, explicarErroGoogle, linkDoMeet, precisaPedirMeet } from '../src/server/google.ts';

const NGA = '11111111-1111-1111-1111-111111111111', SOCIO = 'aaaaaaaa-0000-4000-8000-000000000001', SENHA = 'uma-senha-bem-longa';
let pg: BancoDeTeste; let banco: Banco; let tratar: (r: Request) => Promise<Response>; let t: string;
const req = (url: string, init: RequestInit = {}) => tratar(new Request(`http://x${url}`, { ...init, headers: { 'content-type': 'application/json', cookie: `nga_sessao=${t}` } }));
const get = async (url: string) => { const r = await req(url); expect(r.status).toBe(200); return r.json() as Promise<any>; };
const post = (url: string, b: unknown = {}) => req(url, { method: 'POST', body: JSON.stringify(b) });
beforeAll(async () => {
  pg = await bancoDeTeste(); const db = pg.dono; await db.query(`ALTER ROLE nga_app PASSWORD 'nga_app'`);
  banco = new Banco({ host: 'localhost', port: pg.porta, user: 'nga_app', password: 'nga_app', database: 'nga_teste' }); tratar = criarApp({ banco });
  await db.query(`INSERT INTO organizacoes (id,tipo,nome) VALUES ($1,'escritorio','NGA')`, [NGA]);
  await db.query(`INSERT INTO usuarios (id,email,nome,senha_hash) VALUES ($1,'socio@nga.adv.br','Sócia',$2)`, [SOCIO, await hashDaSenha(SENHA)]);
  await db.query(`INSERT INTO vinculos (usuario_id,organizacao_id,papel) VALUES ($1,$2,'socio_administrador')`, [SOCIO, NGA]);
  const r = await tratar(new Request('http://x/api/sessao', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'socio@nga.adv.br', senha: SENHA }) }));
  t = /nga_sessao=([^;]+)/.exec(r.headers.get('set-cookie')!)![1]!;
}, 120_000);
afterAll(async () => { await banco?.encerrar(); await pg?.encerrar(); });

describe('Google: retorno e diagnóstico', () => {
  test('o retorno do OAuth redireciona para a tela, sem servir HTML pela função Edge', async () => {
    const r = await tratar(new Request('http://x/api/google/callback?code=abc%2F1&state=xyz'));
    expect(r.status).toBe(303); expect(r.headers.get('location')).toBe('/#/ajustes?googleCode=abc%2F1&googleState=xyz'); expect(r.headers.get('content-type')).toBeNull();
    const n = await tratar(new Request('http://x/api/google/callback?error=access_denied')); expect(n.status).toBe(303); expect(n.headers.get('location')).toContain('googleErro=');
  });
  test('concluir exige sessão e POST', async () => {
    expect((await tratar(new Request('http://x/api/google/finalizar', { method: 'POST', body: '{}' }))).status).toBe(401);
    expect((await post('/api/google/finalizar', {})).status).toBe(400);
  });
  test('escopo antigo é detectado; escopo ausente no registro não acusa falso', () => {
    expect(escoposFaltantes('https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/drive.file')).toEqual(['https://www.googleapis.com/auth/drive']);
    expect(escoposFaltantes('https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/drive')).toEqual([]); expect(escoposFaltantes(undefined)).toEqual([]);
  });
  test('Meet: evento sem sala pede criação, sala pendente espera', () => {
    expect(precisaPedirMeet(true, {})).toBe(true); expect(precisaPedirMeet(false, {})).toBe(false); expect(precisaPedirMeet(true, { hangoutLink: 'https://meet.google.com/a' })).toBe(false);
    expect(precisaPedirMeet(true, { conferenceData: { createRequest: { status: { statusCode: 'pending' } } } })).toBe(false);
    expect(linkDoMeet({ conferenceData: { entryPoints: [{ entryPointType: 'phone', uri: 'x' }, { entryPointType: 'video', uri: 'y' }] } })).toBe('y');
  });
  test('erro do Google diz o motivo e mantém o código HTTP', async () => {
    const m = await explicarErroGoogle(new Response(JSON.stringify({ error: { message: 'Google Drive API has not been used', errors: [{ reason: 'accessNotConfigured' }] } }), { status: 403 }));
    expect(m).toContain('HTTP 403'); expect(m).toContain('Google Drive API não está habilitada');
  });
});

describe('Sentinela: regras', () => {
  test('cobertura segue o original: lacuna, incompleto, provisório, coberto', () => {
    const h = '2026-11-09', l = [{ inicio: '2026-11-05', fim: '2026-11-06', status: 'ok', lido: '2026-11-09' }, { inicio: '2026-11-08', fim: '2026-11-08', status: 'truncada', lido: '2026-11-09' }, { inicio: '2026-11-09', fim: '2026-11-09', status: 'ok', lido: '2026-11-09' }];
    const s = statusDaChave(l, h, 7);
    expect(s).toEqual({ '2026-11-03': 'sem_historico', '2026-11-04': 'sem_historico', '2026-11-05': 'coberto', '2026-11-06': 'coberto', '2026-11-07': 'lacuna', '2026-11-08': 'incompleto', '2026-11-09': 'provisorio' });
    expect(intervalosDeLacuna(s, h)).toEqual([['2026-11-07', '2026-11-08']]); expect(piorStatus(['coberto', 'lacuna', 'sem_historico'])).toBe('lacuna'); expect(piorStatus(['sem_historico'])).toBe('sem_historico');
  });
  test('análise separa fonte de inferência e não inventa pedidos', () => {
    expect(valorDaCausa('Valor da causa: R$ 1.500.000,00')).toBe(1_500_000);
    const r = analisarPorRegras({ numero_processo: '1', tribunal: 'TJPR', orgao: null, classe: 'Execução Fiscal', data_ajuizamento: null, assuntos: [], polo: 'P' }, [{ texto: 'Defiro a liminar. Valor da causa: R$ 1.500.000,00', tipo: 'Intimação', tribunal: 'TJPR', data_disponibilizacao: '2026-11-01', destinatarios: [{ nome: 'ACME', polo: 'P' }] }], CONFIG_PADRAO.prioridade, '2026-11-09');
    expect(r.prioridade).toBe('alta'); expect(r.campos.valor_causa).toMatchObject({ valor: 1_500_000, origem: 'fonte' }); expect(r.campos.pedidos).toMatchObject({ valor: null, origem: 'nao_verificado' }); expect(r.campos.reu!.valor).toEqual(['ACME']);
  });
});

describe('Sentinela: fluxo completo sob RLS', () => {
  const ITEM = (id: number, numero: string) => ({ id, numero_processo: numero, siglaTribunal: 'TJPR', tipoComunicacao: 'Intimação', data_disponibilizacao: '2026-11-08', nomeClasse: 'Execução', nomeOrgao: '1ª Vara', link: 'https://x', texto: 'Parte ré ACME TRANSPORTES LTDA, CNPJ 11.222.333/0001-81. Defiro a liminar.', destinatarios: [{ nome: 'ACME TRANSPORTES LTDA', polo: 'P' }] });
  const NUM = '00429103320148160001';
  const f = ((u: string) => Promise.resolve(String(u).includes('datajud') ? new Response(JSON.stringify({ hits: { hits: [{ _source: { numeroProcesso: NUM, dataAjuizamento: '20261108000000', classe: { nome: 'Execução' } } }] } })) : new Response(JSON.stringify({ status: 'success', count: 1, items: [ITEM(1, NUM)] })))) as unknown as typeof fetch;
  let cid: string, aid: string;
  test('cadastro completo enfileira a busca retroativa na hora', async () => {
    const r = await post('/api/sentinela/clientes', { razaoSocial: 'ACME TRANSPORTES LTDA', cnpj: '11.222.333/0001-81', alternativos: ['ACME LOGISTICA'], grupoEconomico: 'Grupo A' }); expect(r.status).toBe(201);
    const c = await r.json() as any; cid = c.id; expect(c.consultas).toBeGreaterThan(20);
    expect((await post('/api/sentinela/clientes', { razaoSocial: 'ACME 2', cnpj: '11.222.333/0001-81' })).status).toBe(400);
    const d = await get(`/api/sentinela/clientes/${cid}`); expect(d.nomes.map((n: any) => n.tipo)).toContain('alternativo'); expect(d.grupo_economico).toBe('Grupo A');
  });
  test('coleta gera achado, análise automática e alerta único', async () => {
    await pg.dono.query(`DELETE FROM sentinela_tarefas WHERE inicio<>(SELECT max(inicio) FROM sentinela_tarefas)`);
    await pg.dono.query(`INSERT INTO rotina_execucoes(rotina,ok,detalhe,duracao_ms) VALUES('sentinela',true,'',1)`);
    await rotinaSentinela(banco, { fetch: f, agora: new Date(), limites: { ms: 60_000, bytes: 5_000_000 } });
    const p = await get('/api/sentinela/processos?limite=10'); expect(p.total).toBe(1); aid = p.itens[0].id; expect(p.itens[0].prioridade).toBe('alta');
    const d = await get(`/api/sentinela/processos/${aid}`); expect(d.analise.modelo).toBe('regras'); expect(d.comunicacoes).toHaveLength(1);
    const al = await get('/api/sentinela/alertas'); expect(al).toHaveLength(1);
    await rotinaSentinela(banco, { fetch: f, agora: new Date() }); expect(await get('/api/sentinela/alertas')).toHaveLength(1);
  });
  test('painel, filtros, equipe, cobertura e fontes respondem', async () => {
    const d = await get('/api/sentinela/dashboard'); expect(d.serie_dias).toHaveLength(30); expect(d.serie_meses).toHaveLength(12); expect(d.clientes_monitorados).toBe(1); expect(d.rotina.ativa).toBe(true); expect(d.ajuizadas_total).toBe(1);
    expect((await get('/api/sentinela/processos?prioridade=baixa')).total).toBe(0); expect((await get(`/api/sentinela/processos?cliente_id=${cid}&valor_min=1`)).total).toBe(0);
    expect((await get('/api/sentinela/equipe')).map((u: any) => u.nome)).toEqual(['Sócia']);
    const c = await get('/api/sentinela/cobertura?dias=14'); expect(c.clientes[0].dias).toHaveLength(14); expect(c.clientes[0].consultas.length).toBeGreaterThan(0);
    expect((await get('/api/sentinela/fontes')).matriz).toHaveLength(2);
  });
  test('atribuição, decisão com histórico e lote exigem o que devem', async () => {
    expect((await post(`/api/sentinela/processos/${aid}/atribuir`, { usuarioId: SOCIO })).status).toBe(200); expect((await get(`/api/sentinela/processos/${aid}`)).responsavel).toBe('Sócia');
    expect((await post('/api/sentinela/achados/lote', { ids: [aid], decisao: 'confirmada' })).status).toBe(400);
    expect((await post('/api/sentinela/achados/lote', { ids: [aid], decisao: 'confirmada', justificativa: 'conferido' })).status).toBe(200);
    expect((await get(`/api/sentinela/processos/${aid}`)).validacoes[0]).toMatchObject({ usuario: 'Sócia', decisao: 'confirmada' });
  });
  test('pesquisa manual devolve à fila; importação não para na linha ruim', async () => {
    await pg.dono.query(`UPDATE sentinela_tarefas SET status='ok'`);
    const r = await post('/api/sentinela/pesquisa', { tipo: 'executar' }); expect(r.status).toBe(201); expect(((await r.json()) as any).consultas).toBeGreaterThan(0);
    expect((await get('/api/sentinela/progresso')).estado).toBe('executando');
    const i = await post('/api/sentinela/clientes/importar', { linhas: [{ razao_social: 'BETA COMERCIO SA', cnpj_matriz: '11.444.777/0001-61' }, { razao_social: 'RUIM', cnpj_matriz: '123' }] });
    const b = await i.json() as any; expect(b.importados).toBe(1); expect(b.erros[0].linha).toBe(3);
  });
  test('processo-controle: capturado sem consultar; desconhecido é checado no DJEN', async () => {
    expect((await post('/api/sentinela/controle', { clienteId: cid, numeroProcesso: '123' })).status).toBe(400);
    expect((await post('/api/sentinela/controle', { clienteId: cid, numeroProcesso: '0042910-33.2014.8.16.0001' })).status).toBe(201);
    expect((await post('/api/sentinela/controle', { clienteId: cid, numeroProcesso: '1111111-11.2020.8.16.0001' })).status).toBe(201);
    await pg.dono.query(`DELETE FROM sentinela_tarefas`);
    const vazio = ((u: string) => Promise.resolve(String(u).includes('datajud') ? new Response('{}') : new Response(JSON.stringify({ status: 'success', count: 0, items: [] })))) as unknown as typeof fetch;
    await rotinaSentinela(banco, { fetch: vazio, agora: new Date('2026-11-09T08:00:00Z') });
    const c = (await get('/api/sentinela/cobertura?dias=7')).controle as any[]; const por = Object.fromEntries(c.map((x) => [x.numero_processo, x.resultado]));
    expect(por['00429103320148160001']).toBe('capturado'); expect(por['11111111120208160001']).toBe('fora_da_fonte');
  });
  test('configuração valida e vale para o escritório', async () => {
    expect((await req('/api/sentinela/config/motor', { method: 'PUT', body: JSON.stringify({ dias_nova_distribuicao: 0, dias_busca_inicial: 90 }) })).status).toBe(400);
    expect((await req('/api/sentinela/config/motor', { method: 'PUT', body: JSON.stringify({ dias_nova_distribuicao: 20, dias_busca_inicial: 30 }) })).status).toBe(200);
    expect((await get('/api/sentinela/config')).motor.dias_nova_distribuicao).toBe(20);
  });
});
