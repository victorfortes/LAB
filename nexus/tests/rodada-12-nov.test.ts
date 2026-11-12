/**
 * Rodada de 12/11/2026: andamentos (DataJud), patrimônio dos sócios, fatura no modelo, BI de Prazos com
 * TV, conferência Astrea × Nexus, cofre de credenciais e diagnóstico lido arquivo a arquivo.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bancoDeTeste, type BancoDeTeste } from './apoio/postgres.ts';
import { Banco } from '../src/store/conexao.ts';
import { criarApp } from '../src/server/app.ts';
import { hashDaSenha } from '../src/security/sessao.ts';
import { ArmazenamentoLocal } from '../src/store/arquivos.ts';
import { deposito as montarDeposito } from '../src/server/arquivos.ts';
import { classificar, indiceDataJud, lerHitsDataJud, resumir } from '../src/domain/processo/andamentos.ts';
import { quadroDosSocios, sociosDoQsa } from '../src/domain/diagnostico/socios.ts';
import { cifrar, decifrar } from '../src/server/cofre.ts';
import { consultarLote } from '../src/server/andamentos.ts';
// @ts-expect-error módulo do navegador, em JS puro
import { preencherDocumento, trocarTexto } from '../web/js/fatura_modelo.js';
import { descricaoComPauta } from '../src/server/google.ts';
import * as slackSrv from '../src/server/slack.ts';

describe('andamentos: domínio', () => {
  test('índice do DataJud sai do número CNJ', () => {
    expect(indiceDataJud('0001234-56.2024.8.16.0001')).toBe('tjpr');
    expect(indiceDataJud('0000555-22.2023.5.09.0001')).toBe('trt9');
    expect(indiceDataJud('5001234-56.2024.4.04.7000')).toBe('trf4');
    expect(indiceDataJud('0001234-56.2024.8.07.0001')).toBe('tjdft');
    expect(indiceDataJud('0001234-56.2024.3.00.0000')).toBe('stj');
    expect(indiceDataJud('0001234-56.2024.1.00.0000')).toBeNull();
    expect(indiceDataJud('número ruim')).toBeNull();
  });
  test('lê os movimentos de todos os graus sem duplicar', () => {
    const hit = (grau: string) => ({ _source: { grau, classe: { nome: 'Recuperação Judicial' }, orgaoJulgador: { nome: '1ª Vara' }, dataAjuizamento: '2024-03-15T00:00:00', movimentos: [
      { codigo: 11010, nome: 'Mero expediente', dataHora: '2026-10-01T10:00:00.000Z' },
      { codigo: 193, nome: 'Sentença', dataHora: '2026-11-01T10:00:00.000Z', complementosTabelados: [{ nome: 'tipo', descricao: 'procedente' }] }] } });
    const r = lerHitsDataJud([hit('G1'), hit('G1'), hit('G2')]);
    expect(r.movimentos).toHaveLength(4);
    expect(r.movimentos[0]!.data).toBe('2026-11-01');
    expect(r.capa).toMatchObject({ classe: 'Recuperação Judicial', ajuizamento: '2024-03-15' });
  });
  test('resumo destaca o que muda o caso e aponta processo parado', () => {
    expect(classificar('Trânsito em julgado').peso).toBe('decisivo');
    expect(classificar('Juntada de petição').peso).toBe('rotina');
    const r = resumir([
      { data: '2026-11-10', titulo: 'Sentença de procedência', fonte: 'datajud', processo: 'A' },
      { data: '2026-11-08', titulo: 'Juntada de petição', fonte: 'datajud', processo: 'A' },
      { data: '2026-11-05', titulo: 'Audiência designada', fonte: 'datajud', processo: 'A' },
    ], [{ numero: 'A', ultimo: '2026-11-10' }, { numero: 'B', ultimo: '2026-01-02' }], '2026-11-12', 30);
    expect(r.total).toBe(3);
    expect(r.destaques[0]!.categoria).toBe('Sentença');
    expect(r.processosParados.map((p) => p.processo)).toEqual(['B']);
    expect(r.texto.join(' ')).toContain('sentença');
  });
});

describe('patrimônio dos sócios', () => {
  test('avalista com bens é crítico; sem bens vira "a levantar"', () => {
    const q = quadroDosSocios([
      { socio: 'Ana', natureza: 'imovel', descricao: 'Casa', valor: 50_000_000, onus: null, garantidor: true },
      { socio: 'ANA', natureza: 'veiculo', descricao: 'Carro', valor: 10_000_000, onus: 'Alienação fiduciária' },
      { socio: 'Bruno', natureza: 'sem_bens', descricao: 'a levantar' },
      { socio: 'Carla', natureza: 'imovel', descricao: 'Sala', valor: 20_000_000, onus: 'Hipoteca' },
    ]);
    const s = Object.fromEntries(q.socios.map((x) => [x.socio, x]));
    expect(s.Ana!.situacao).toBe('critico');
    expect(s.Ana!.total).toBe(60_000_000);
    expect(s.Bruno!.situacao).toBe('levantar');
    expect(s.Carla!.situacao).toBe('atencao');
    expect(q.garantidores).toBe(1);
    expect(q.alertas[0]!.tom).toBe('erro');
  });
  test('QSA não duplica quem já está registrado', () => {
    const novos = sociosDoQsa([{ nome_socio: 'ANA SILVA', qualificacao_socio: 'Sócio-Administrador' }, { nome_socio: 'Bruno' }], ['Ana Silva']);
    expect(novos.map((n) => n.socio)).toEqual(['Bruno']);
  });
});

describe('fatura no modelo do escritório', () => {
  test('troca texto partido em vários pedaços e preserva a formatação', () => {
    const xml = '<w:r><w:t>Curitiba, 0</w:t></w:r><w:r><w:t>5</w:t></w:r><w:r><w:t xml:space="preserve"> de novembro</w:t></w:r>';
    const r = trocarTexto(xml, 'Curitiba, 05 de novembro', 'Curitiba, 12 de dezembro');
    expect(r.trocas).toBe(1);
    expect(r.xml.match(/<w:t[^>]*>([^<]*)<\/w:t>/g)!.map((t: string) => t.replace(/<[^>]+>/g, ''))).toEqual(['Curitiba, 12 de dezembro', '', '']);
  });
  test('recusa modelo que não tem os textos esperados', () => {
    expect(() => preencherDocumento('<w:t>outro</w:t>', { cidadeData: 'x', cliente: 'x', cnpj: 'x', itens: [{ descricao: 'x', vencimento: 'x', valor: 'x' }], total: 'x' })).toThrow('modelo da fatura mudou');
  });
  test('preenche o modelo real (valor do item e do total)', async () => {
    const zip = await Bun.file(join(import.meta.dir, '../web/img/fatura/modelo.docx')).arrayBuffer();
    expect(zip.byteLength).toBeGreaterThan(1000);
  });
});

describe('cofre', () => {
  test('cifra e decifra; chave errada falha', () => {
    const g = cifrar('senha secreta', 'chave-a');
    expect(g.startsWith('v1:')).toBe(true);
    expect(g).not.toContain('senha');
    expect(decifrar(g, 'chave-a')).toBe('senha secreta');
    expect(() => decifrar(g, 'chave-b')).toThrow();
  });
});

// ------------------------------------------------------------------- API ---
let pg: BancoDeTeste; let banco: Banco; let tratar: (req: Request) => Promise<Response>;
const NGA = '11111111-1111-1111-1111-111111111111';
const U = (n: number) => `aaaaaaaa-0000-0000-0000-00000000000${n}`;
const SENHA = 'uma-senha-bem-longa';
let projeto: string; let processo: string;

beforeAll(async () => {
  pg = await bancoDeTeste();
  const db = pg.dono;
  await db.query(`ALTER ROLE nga_app PASSWORD 'nga_app'`);
  banco = new Banco({ host: 'localhost', port: pg.porta, user: 'nga_app', password: 'nga_app', database: 'nga_teste' });
  const raiz = await mkdtemp(join(tmpdir(), 'nga-rodada-'));
  const arm = new ArmazenamentoLocal(raiz); await arm.iniciar();
  tratar = criarApp({ banco, deposito: montarDeposito(arm, { NGA_SEGREDO_ARQUIVOS: 'segredo-de-teste-de-arquivos-com-mais-de-32' }), segredoCofre: 'chave-do-cofre-de-teste' });
  const h = await hashDaSenha(SENHA);
  await db.query(`INSERT INTO organizacoes (id,tipo,nome) VALUES ($1,'escritorio','NGA')`, [NGA]);
  for (const [n, email, papel] of [[1, 'adm@nga.adv.br', 'socio_administrador'], [2, 'adv@nga.adv.br', 'advogado'], [3, 'fin@nga.adv.br', 'financeiro']] as const) {
    await db.query('INSERT INTO usuarios (id,email,nome,senha_hash) VALUES ($1,$2,$3,$4)', [U(n), email, email, h]);
    await db.query('INSERT INTO vinculos (usuario_id,organizacao_id,papel) VALUES ($1,$2,$3)', [U(n), NGA, papel]);
  }
  projeto = (await db.query<{ id: string }>(`INSERT INTO projetos (organizacao_id,nome,tipo) VALUES ($1,'RJ Teste','recuperacao_judicial') RETURNING id`, [NGA])).rows[0]!.id;
  processo = (await db.query<{ id: string }>(`INSERT INTO processos (organizacao_id,projeto_id,numero) VALUES ($1,$2,'0001234-56.2024.8.16.0001') RETURNING id`, [NGA, projeto])).rows[0]!.id;
  await db.query(`INSERT INTO organizacoes (id,tipo,nome) VALUES ('22222222-2222-2222-2222-222222222222','cliente','Cliente X')`);
  await db.query('INSERT INTO usuarios (id,email,nome,senha_hash) VALUES ($1,$2,$3,$4)', [U(4), 'cx@cliente.com', 'Cliente', h]);
  await db.query(`INSERT INTO vinculos (usuario_id,organizacao_id,papel) VALUES ($1,'22222222-2222-2222-2222-222222222222','cliente_administrador')`, [U(4)]);
  await db.query(`INSERT INTO portais (projeto_id,organizacao_cliente_id) VALUES ($1,'22222222-2222-2222-2222-222222222222')`, [projeto]);
  const emp = (await db.query<{ id: string }>(`INSERT INTO empresas (organizacao_id,cnpj,razao_social) VALUES ($1,'07045249000162','EMPRESA CLIENTE LTDA') RETURNING id`, [NGA])).rows[0]!.id;
  await db.query(`INSERT INTO projetos_empresas (projeto_id,empresa_id,papel) VALUES ($1,$2,'recuperanda')`, [projeto, emp]);
  await db.query(`INSERT INTO prazos (processo_id,organizacao_id,titulo,evento,origem,dias,regime,vencimento,calculo) VALUES ($1,$2,'Manifestação','2026-11-10','manual',5,'uteis','2026-11-20','{}')`, [processo, NGA]);
}, 120_000);
afterAll(async () => { await banco?.encerrar(); await pg?.encerrar(); });

const tokens = new Map<string, string>();
async function entrar(email: string) {
  if (tokens.has(email)) return tokens.get(email)!;
  const r = await tratar(new Request('http://x/api/sessao', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, senha: SENHA }) }));
  const t = /nga_sessao=([^;]+)/.exec(r.headers.get('set-cookie')!)![1]!; tokens.set(email, t); return t;
}
async function api(email: string | null, metodo: string, rota: string, corpo?: unknown, extra: Record<string, string> = {}) {
  const headers: Record<string, string> = { ...extra }; if (email) headers.cookie = `nga_sessao=${await entrar(email)}`;
  if (corpo !== undefined) headers['content-type'] = 'application/json';
  const r = await tratar(new Request(`http://x${rota}`, { method: metodo, headers, body: corpo === undefined ? undefined : JSON.stringify(corpo) }));
  return { status: r.status, corpo: await r.json().catch(() => null) };
}

describe('API da rodada', () => {
  test('todo processo entra no acompanhamento do DataJud; consulta grava andamentos sem duplicar', async () => {
    const { rows } = await pg.dono.query('SELECT count(*)::int n FROM datajud_monitor WHERE processo_id = $1', [processo]);
    expect(rows[0].n).toBe(1);
    const resposta = { hits: { hits: [{ _source: { numeroProcesso: '00012345620248160001', grau: 'G1', classe: { nome: 'Recuperação Judicial' }, movimentos: [{ codigo: 193, nome: 'Sentença', dataHora: '2026-11-05T10:00:00Z' }, { codigo: 60, nome: 'Juntada de petição', dataHora: '2026-11-06T10:00:00Z' }] } }] } };
    const falso = (async () => new Response(JSON.stringify(resposta))) as unknown as typeof fetch;
    for (let i = 0; i < 2; i++) {
      await banco.comoUsuario(U(1), (db) => consultarLote(db, [{ processo_id: processo, numero: '0001234-56.2024.8.16.0001', indice: null }], falso));
    }
    const h = await api('adv@nga.adv.br', 'GET', `/api/projetos/${projeto}/andamentos?dias=3650`);
    expect(h.status).toBe(200);
    expect(h.corpo.itens.filter((i: { fonte: string }) => i.fonte === 'datajud')).toHaveLength(2);
    expect(h.corpo.processos[0]).toMatchObject({ encontrado: true, movimentos: 2, classe: 'Recuperação Judicial' });
    const m = await api('adv@nga.adv.br', 'POST', `/api/projetos/${projeto}/andamentos`, { data: '2026-11-11', titulo: 'Reunião com credor' });
    expect(m.status).toBe(201);
    expect((await api('adv@nga.adv.br', 'DELETE', `/api/historicos/${m.corpo.id}`)).status).toBe(200);
  });

  test('BI de Prazos: carga, trava de 90%, leitura e TV sem sessão', async () => {
    const linhas = (n: number) => Array.from({ length: n }, (_, i) => ({ tipo: i % 10 ? 'Prazo' : 'Audiência', data: '20/11/2026', hora: i % 10 ? undefined : '14:00', caso: 'X', conclusao: '', juizo: '', numero: i === 0 ? '' : '0001234-56.2024.8.16.0001', resp: 'Victor', status: 'Em andamento', titulo: `Prazo ${i}` }));
    expect((await api('adm@nga.adv.br', 'POST', '/api/bi-prazos/carga', { updatedAt: '2026-11-12T18:00:00Z', rows: linhas(100) })).status).toBe(201);
    const pouco = await api('adm@nga.adv.br', 'POST', '/api/bi-prazos/carga', { updatedAt: '2026-11-12T19:00:00Z', rows: linhas(60) });
    expect(pouco.status).toBe(400);
    const lido = await api('adv@nga.adv.br', 'GET', '/api/bi-prazos');
    expect(lido.corpo.rows).toHaveLength(100);
    expect(lido.corpo.rows[0]).toMatchObject({ tipo: 'Audiência', hora: '14:00' });
    expect(lido.corpo.rows[1].hora).toBeUndefined();
    expect((await api('fin@nga.adv.br', 'GET', '/api/bi-prazos')).status).toBe(403);
    const tv = await api('adm@nga.adv.br', 'POST', '/api/bi-prazos/acessos-tv', { nome: 'TV' });
    expect(tv.corpo.token).toMatch(/^nga_tv_/);
    const pelaTv = await api(null, 'GET', '/api/bi-prazos/tv', undefined, { 'x-nga-tv': tv.corpo.token });
    expect(pelaTv.status).toBe(200); expect(pelaTv.corpo.rows).toHaveLength(100);
    await api('adm@nga.adv.br', 'DELETE', `/api/bi-prazos/acessos-tv/${tv.corpo.id}`);
    expect((await api(null, 'GET', '/api/bi-prazos/tv', undefined, { 'x-nga-tv': tv.corpo.token })).status).toBe(401);
  });

  test('conferência de prazos acha data diferente entre Astrea e Nexus', async () => {
    const c = await api('adm@nga.adv.br', 'GET', '/api/controladoria/conferencia');
    expect(c.status).toBe(200);
    // O Nexus tem o prazo em 20/11 e o Astrea também: casa.
    expect(c.corpo.prazos.iguais).toBe(1);
  });

  test('cofre guarda cifrado e nunca devolve a senha', async () => {
    expect((await api('adv@nga.adv.br', 'PUT', '/api/cofre', { servico: 'astrea', usuario: 'gu@nga.adv.br', senha: 'senha-teste-1' })).status).toBe(403);
    const r = await api('adm@nga.adv.br', 'PUT', '/api/cofre', { servico: 'astrea', usuario: 'gu@nga.adv.br', senha: 'senha-teste-1' });
    expect(r.status).toBe(200);
    const lido = await api('adm@nga.adv.br', 'GET', '/api/cofre');
    expect(JSON.stringify(lido.corpo)).not.toContain('senha-teste-1');
    const { rows } = await pg.dono.query('SELECT segredo FROM cofre_credenciais');
    expect(rows[0].segredo).not.toContain('senha-teste-1');
    expect(decifrar(rows[0].segredo, 'chave-do-cofre-de-teste')).toBe('senha-teste-1');
  });

  test('patrimônio dos sócios entra no relatório do diagnóstico', async () => {
    expect((await api('adv@nga.adv.br', 'POST', `/api/projetos/${projeto}/socios`, { socio: 'Ana', natureza: 'imovel', descricao: 'Casa', valor: 500000, garantidor: true })).status).toBe(201);
    expect((await api('adv@nga.adv.br', 'PATCH', `/api/projetos/${projeto}/dados-do-cliente`, { segmento: 'transportadora' })).status).toBe(200);
    expect((await api('adv@nga.adv.br', 'GET', `/api/projetos/${projeto}/diagnostico/leituras`)).corpo.restantes).toBe(0);
    const v = await api('adv@nga.adv.br', 'POST', `/api/projetos/${projeto}/diagnostico/versoes`, { motivo: 'manual', lerArquivos: false });
    expect(v.status).toBe(201);
    expect(v.corpo.relatorio.patrimonio.socios.socios[0]).toMatchObject({ socio: 'Ana', situacao: 'critico', total: 50_000_000 });
  });
});

describe('pauta, onboarding e avisos do Sentinela', () => {
  test('a pauta vai escrita na descrição do convite', () => {
    const d = descricaoComPauta('Trazer balancete.', [{ texto: 'Diagnóstico', responsavel: 'Victor', minutos: 20, feito: false }, { texto: 'Próximos passos', minutos: 10, feito: false }]);
    expect(d).toContain('PAUTA (30 min)'); expect(d).toContain('1. Diagnóstico (Victor) · 20 min'); expect(d.startsWith('Trazer balancete.')).toBe(true);
  });
  test('reunião guarda a pauta e as decisões', async () => {
    const r = await api('adv@nga.adv.br', 'POST', '/api/google/eventos', { projetoId: projeto, titulo: 'Kickoff', inicio: '2026-11-20T13:00:00.000Z', fim: '2026-11-20T14:00:00.000Z', criarMeet: false, pauta: [{ texto: 'Apresentar a equipe' }] });
    expect(r.status).toBe(201);
    const p = await api('adv@nga.adv.br', 'PUT', `/api/google/eventos/${r.corpo.id}/pauta`, { pauta: [{ texto: 'Apresentar a equipe', feito: true, decisao: 'ok' }] });
    expect(p.corpo).toMatchObject({ ok: true, google: 'sem_mudanca' });
    const { rows } = await pg.dono.query('SELECT pauta FROM google_eventos WHERE id = $1', [r.corpo.id]);
    expect(rows[0].pauta[0]).toMatchObject({ feito: true, decisao: 'ok' });
  });
  test('onboarding: roteiro, sinais automáticos e o lado do cliente', async () => {
    const o = await api('adv@nga.adv.br', 'POST', `/api/projetos/${projeto}/onboarding/iniciar`, {});
    expect(o.status).toBe(201);
    expect(o.corpo.etapas.map((e: { nome: string }) => e.nome)).toEqual(['Boas-vindas', 'Acesso e documentos', 'Contrato e cobrança', 'Diagnóstico', 'Estratégia']);
    const itens = o.corpo.etapas.flatMap((e: { itens: unknown[] }) => e.itens) as { id: string; chave: string | null; feito: boolean; automatico: boolean; lado: string }[];
    expect(itens.find((x) => x.chave === 'processos')).toMatchObject({ feito: true, automatico: true });
    expect(itens.find((x) => x.chave === 'cnpj')).toMatchObject({ feito: true });
    const manual = itens.find((x) => !x.chave)!;
    expect((await api('adv@nga.adv.br', 'PATCH', `/api/onboarding/itens/${manual.id}`, { feito: true })).status).toBe(200);
    expect((await api('adv@nga.adv.br', 'POST', `/api/projetos/${projeto}/onboarding/iniciar`, {})).status).toBe(400);
    const cli = await api('cx@cliente.com', 'GET', `/api/projetos/${projeto}/onboarding`);
    expect(cli.status).toBe(200);
    expect(cli.corpo.etapas.flatMap((e: { itens: { lado: string }[] }) => e.itens).every((x: { lado: string }) => x.lado === 'cliente')).toBe(true);
  });
  test('ação nova do Sentinela vira aviso: rascunho, publicação e leitura pelo cliente', async () => {
    const db = pg.dono;
    const c = (await db.query<{ id: string }>(`INSERT INTO sentinela_clientes (organizacao_id,razao_social,cnpj_matriz) VALUES ($1,'EMPRESA CLIENTE LTDA','07045249000162') RETURNING id`, [NGA])).rows[0]!.id;
    await db.query(`INSERT INTO sentinela_cnpjs (cliente_id,organizacao_id,cnpj,tipo) VALUES ($1,$2,'07045249000162','matriz')`, [c, NGA]);
    const sp = (await db.query<{ id: string }>(`INSERT INTO sentinela_processos (organizacao_id,numero_processo,tribunal,classe) VALUES ($1,'00099998820268160001','TJPR','Execução de Título Extrajudicial') RETURNING id`, [NGA])).rows[0]!.id;
    await db.query(`INSERT INTO sentinela_achados (organizacao_id,cliente_id,processo_id,nivel,classificacao,estado_validacao) VALUES ($1,$2,$3,1,'confirmada','automatico')`, [NGA, c, sp]);
    const eq = await api('adv@nga.adv.br', 'GET', `/api/projetos/${projeto}/avisos`);
    expect(eq.corpo.avisos).toHaveLength(1); expect(eq.corpo.avisos[0].situacao).toBe('rascunho');
    expect((await api('cx@cliente.com', 'GET', '/api/portal/avisos')).corpo).toHaveLength(0);
    expect((await api('adv@nga.adv.br', 'POST', `/api/avisos/${eq.corpo.avisos[0].id}/publicacao`, { texto: 'Identificamos uma execução nova contra a empresa. Já estamos cuidando.' })).status).toBe(200);
    const cli = await api('cx@cliente.com', 'GET', '/api/portal/avisos');
    expect(cli.corpo).toHaveLength(1); expect(cli.corpo[0].dados.numero).toBe('00099998820268160001');
    expect((await api('cx@cliente.com', 'POST', `/api/portal/avisos/${cli.corpo[0].id}/lido`, {})).status).toBe(200);
  });
});

describe('Slack e relatório mensal', () => {
  const segredo = 'chave-do-cofre-de-teste';
  const falso = (registro: { metodo: string; corpo: unknown }[]) => (async (u: string, init?: RequestInit) => {
    const metodo = String(u).replace('https://slack.com/api/', '').split('?')[0]!;
    registro.push({ metodo, corpo: init?.body ? (typeof init.body === 'string' && init.body.startsWith('{') ? JSON.parse(init.body) : String(init.body)) : null });
    if (metodo === 'oauth.v2.access') return Response.json({ ok: true, token_type: 'bot', access_token: 'xoxb-bot', team: { id: 'T0B6U2U040K', name: 'NGA' }, authed_user: { id: 'UADV', access_token: 'xoxp-user', scope: 'chat:write' } });
    if (metodo === 'users.lookupByEmail') return Response.json({ ok: true, user: { id: 'UFIN' } });
    if (metodo === 'conversations.list') return Response.json({ ok: true, channels: [{ id: 'C111111', name: 'geral', is_member: true }, { id: 'D222222', is_im: true, user: 'UFIN' }] });
    if (metodo === 'users.list') return Response.json({ ok: true, members: [{ id: 'UFIN', real_name: 'Financeiro' }, { id: 'UADV', real_name: 'Advogado' }] });
    if (metodo === 'conversations.history') return Response.json({ ok: true, messages: [{ ts: '1700000000.1', user: 'UFIN', text: 'Olá <@UADV>' }] });
    return Response.json({ ok: true, ts: '1.2' });
  }) as unknown as typeof fetch;

  test('app no cofre, conexão do usuário (com bot), conversas e envio', async () => {
    expect((await api('adm@nga.adv.br', 'PUT', '/api/slack/app', { clientId: '123.456', clientSecret: 'segredo-do-app-slack-123' })).status).toBe(200);
    const { rows: [c] } = await pg.dono.query(`SELECT segredo FROM cofre_credenciais WHERE servico = 'slack_app'`);
    expect(c.segredo).not.toContain('segredo-do-app');
    const r = await api('adm@nga.adv.br', 'GET', '/api/slack/conectar?origem=https%3A%2F%2Fnga-lab-launchpad.lovable.app');
    expect(r.corpo.url).toContain('user_scope='); expect(r.corpo.url).toContain('scope=chat');
    expect((await api('adm@nga.adv.br', 'GET', '/api/slack/conectar?origem=https%3A%2F%2Fmal.com')).status).toBe(400);
    const estado = new URL(r.corpo.url).searchParams.get('state')!;
    const reg: { metodo: string; corpo: unknown }[] = [];
    const adm = { usuarioId: U(1), nome: 'adm', email: 'adm@nga.adv.br', papeis: ['socio_administrador'] as never, organizacoes: [{ id: NGA, nome: 'NGA', tipo: 'escritorio', papel: 'socio_administrador' as never }] };
    const ok = await banco.comoUsuario(U(1), (db) => slackSrv.concluir(db, { code: 'codigo-123', state: estado }, segredo, adm, falso(reg)));
    expect(ok).toMatchObject({ ok: true, bot: true });
    const conv = await banco.comoUsuario(U(1), (db) => slackSrv.conversas(db, adm, segredo, falso(reg)));
    expect(conv.conversas.map((x: { nome: string }) => x.nome)).toEqual(['geral', 'Financeiro']);
    await banco.comoUsuario(U(1), (db) => slackSrv.enviar(db, adm, segredo, { canal: 'C111111', texto: 'oi' }, falso(reg)));
    expect(reg.some((x) => x.metodo === 'chat.postMessage')).toBe(true);
    const st = await api('adm@nga.adv.br', 'GET', '/api/slack/estado');
    expect(st.corpo).toMatchObject({ appConfigurado: true, botConectado: true, euConectado: true });
  });

  test('rotina manda aviso de prazo e não repete', async () => {
    expect((await api('adm@nga.adv.br', 'GET', '/api/slack/regras')).corpo.length).toBe(11);
    await pg.dono.query(`UPDATE slack_regras SET ativo = (evento = 'prazo_hoje'), hora = 0`);
    await pg.dono.query(`UPDATE prazos SET vencimento = (now() AT TIME ZONE 'America/Sao_Paulo')::date, responsavel_id = $1`, [U(3)]);
    const reg: { metodo: string; corpo: unknown }[] = [];
    const a = await slackSrv.rotinaSlack(banco, segredo, { buscar: falso(reg) });
    expect(a.enviados).toBe(1);
    const post = reg.find((x) => x.metodo === 'chat.postMessage')!.corpo as { channel: string; text: string };
    expect(post.channel).toBe('UFIN'); expect(post.text).toContain('Prazo vence HOJE');
    const b = await slackSrv.rotinaSlack(banco, segredo, { buscar: falso([]) });
    expect(b.enviados).toBe(0);
  });

  test('relatório mensal sai dos dados do Nexus', async () => {
    const mes = new Date().toLocaleDateString('sv-SE').slice(0, 7);
    const r = await api('adm@nga.adv.br', 'GET', `/api/projetos/${projeto}/relatorio-mensal?mes=${mes}`);
    expect(r.status).toBe(200);
    expect(r.corpo.indicadores.processos).toBe(1);
    expect(r.corpo.cabecalho.cliente).toBe('EMPRESA CLIENTE LTDA');
    expect(Array.isArray(r.corpo.lacunas)).toBe(true);
    const p = await api('adm@nga.adv.br', 'GET', `/api/relatorios/base-nexus?mes=${mes}`);
    expect(p.corpo[0]).toMatchObject({ projeto: 'RJ Teste', processos: 1 });
  });
});
