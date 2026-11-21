/**
 * Rodada de 21/11/2026: DataJud honesto (429 e shards recusados), conciliação da agenda do Astrea, limpeza
 * de tarefas, pauta por equipe, QGC (valor sujeito, lastro, link do AJ), pedido de documento, parceiro externo.
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
import { consultar } from '../src/server/datajud.ts';
import { consultarLote } from '../src/server/andamentos.ts';
import { direcionarAgenda } from '../src/server/controladoria_auto.ts';
import { palavrasDoCredor, sugestaoDeSujeito } from '../src/server/qgc_lastros.ts';
import { proximoDia } from '../src/server/pautas_equipe.ts';
import { poderDeVoto, cabecasPorClasse } from '../src/server/pre_agc.ts';

const resposta = (corpo: unknown, status = 200) => (async () => new Response(JSON.stringify(corpo), { status })) as unknown as typeof fetch;

describe('DataJud: cliente honesto', () => {
  test('HTTP 429 é instabilidade (não "não encontrado")', async () => {
    const r = await consultar('tjsp', ['10526860620248260100'], { campos: ['numeroProcesso'], buscar: resposta({ error: 'es_rejected_execution_exception' }, 429), tentativas: 1, pausaEntreTentativas: 0 });
    expect(r.tipo).toBe('instavel');
  });
  test('shards recusados: o que veio vale, o resto fica incompleto', async () => {
    const r = await consultar('tjsp', ['10526860620248260100', '00367448220238260100'], { campos: ['numeroProcesso'], tentativas: 0,
      buscar: resposta({ _shards: { total: 20, failed: 17 }, hits: { hits: [{ _source: { numeroProcesso: '10526860620248260100' } }] } }) });
    expect(r.tipo).toBe('ok');
    if (r.tipo === 'ok') { expect(r.incompleto).toBe(true); expect(r.porNumero.has('10526860620248260100')).toBe(true); expect(r.porNumero.has('00367448220238260100')).toBe(false); }
  });
  test('todos os shards falharam e nada veio: instável', async () => {
    const r = await consultar('tjsp', ['10526860620248260100'], { campos: ['numeroProcesso'], tentativas: 0, buscar: resposta({ _shards: { total: 20, failed: 20 }, hits: { hits: [] } }) });
    expect(r.tipo).toBe('instavel');
  });
});

describe('QGC, pauta e AGC: regras puras', () => {
  test('palavras que identificam o credor (sem "banco", "ltda")', () => {
    expect(palavrasDoCredor('Banco Bradesco S/A')).toEqual(['BRADESCO']);
    expect(palavrasDoCredor('Pé Vermelho Pavimentação e Obras Ltda')).toEqual(['VERMELHO', 'PAVIMENTACAO', 'OBRAS']);
  });
  test('garantia fiduciária parcial: o saldo descoberto é o valor sujeito sugerido', () => {
    const s = sugestaoDeSujeito({ natureza: 'proprietario_fiduciario', valor: '100000000', valor_bem_gravado: '60000000', valor_sujeito: null });
    expect(s?.valorSujeito).toBe('40000000');
    expect(sugestaoDeSujeito({ natureza: 'proprietario_fiduciario', valor: '100000000', valor_bem_gravado: '60000000', valor_sujeito: '40000000' })).toBeNull();
    expect(sugestaoDeSujeito({ natureza: 'quirografario', valor: '100', valor_bem_gravado: null, valor_sujeito: null })).toBeNull();
  });
  test('próxima reunião semanal cai no dia certo', () => {
    expect(proximoDia('2026-11-21', 2)).toBe('2026-11-24'); // sábado → terça
    expect(proximoDia('2026-11-24', 2)).toBe('2026-11-24');
  });
  test('poder de voto: menor grupo que decide a classe pelo valor', () => {
    const c = (id: string, credor: string, valor: string, classe: 'II' | 'III') => ({ id, credor_id: credor, credor, valor, valor_bem_gravado: null, classe, sujeito: true });
    const p = poderDeVoto(cabecasPorClasse([c('1', 'A', '600', 'III'), c('2', 'B', '300', 'III'), c('3', 'C', '100', 'III')]));
    expect(p[0]!.classe).toBe('III');
    expect(p[0]!.minimoParaValor).toBe(1); // A sozinho tem 60%
    expect(p[0]!.minimoParaCabecas).toBe(2);
    expect(p[0]!.lista[0]!.decisivo).toBe(true);
    expect(p[0]!.lista[1]!.decisivo).toBe(false);
  });
});

// ------------------------------------------------------------------- banco ---
let pg: BancoDeTeste; let banco: Banco; let tratar: (req: Request) => Promise<Response>;
const NGA = '11111111-1111-1111-1111-111111111111';
const U = (n: number) => `bbbbbbbb-0000-0000-0000-00000000000${n}`;
const SENHA = 'uma-senha-bem-longa';
let projeto: string; let processo: string;

beforeAll(async () => {
  pg = await bancoDeTeste();
  const db = pg.dono;
  await db.query(`ALTER ROLE nga_app PASSWORD 'nga_app'`);
  banco = new Banco({ host: 'localhost', port: pg.porta, user: 'nga_app', password: 'nga_app', database: 'nga_teste' });
  const raiz = await mkdtemp(join(tmpdir(), 'nga-r21-'));
  const arm = new ArmazenamentoLocal(raiz); await arm.iniciar();
  tratar = criarApp({ banco, deposito: montarDeposito(arm, { NGA_SEGREDO_ARQUIVOS: 'segredo-de-teste-de-arquivos-com-mais-de-32' }), segredoCofre: 'chave-do-cofre-de-teste' });
  const h = await hashDaSenha(SENHA);
  await db.query(`INSERT INTO organizacoes (id,tipo,nome) VALUES ($1,'escritorio','NGA')`, [NGA]);
  for (const [n, email, papel, nome] of [[1, 'adm@nga.adv.br', 'socio_administrador', 'Adm'], [2, 'adv@nga.adv.br', 'advogado', 'Ana Advogada']] as const) {
    await db.query('INSERT INTO usuarios (id,email,nome,senha_hash) VALUES ($1,$2,$3,$4)', [U(n), email, nome, h]);
    await db.query('INSERT INTO vinculos (usuario_id,organizacao_id,papel) VALUES ($1,$2,$3)', [U(n), NGA, papel]);
  }
  projeto = (await db.query<{ id: string }>(`INSERT INTO projetos (organizacao_id,nome,tipo) VALUES ($1,'RJ Teste','recuperacao_judicial') RETURNING id`, [NGA])).rows[0]!.id;
  processo = (await db.query<{ id: string }>(`INSERT INTO processos (organizacao_id,projeto_id,numero) VALUES ($1,$2,'0001234-56.2024.8.16.0001') RETURNING id`, [NGA, projeto])).rows[0]!.id;
  await db.query(`INSERT INTO projeto_equipe (projeto_id, organizacao_id, usuario_id, papel) VALUES ($1,$2,$3,'lider')`, [projeto, NGA, U(2)]);
}, 120_000);
afterAll(async () => { await banco?.encerrar(); await pg?.encerrar(); });

const tokens = new Map<string, string>();
async function entrar(email: string, senha = SENHA) {
  if (tokens.has(email)) return tokens.get(email)!;
  const r = await tratar(new Request('http://x/api/sessao', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, senha }) }));
  const t = /nga_sessao=([^;]+)/.exec(r.headers.get('set-cookie') ?? '')?.[1]; if (!t) throw new Error(`login falhou: ${r.status}`);
  tokens.set(email, t); return t;
}
async function api(email: string | null, metodo: string, rota: string, corpo?: unknown, extra: Record<string, string> = {}) {
  const headers: Record<string, string> = { ...extra }; if (email) headers.cookie = `nga_sessao=${await entrar(email)}`;
  if (corpo !== undefined) headers['content-type'] = 'application/json';
  const r = await tratar(new Request(`http://x${rota}`, { method: metodo, headers, body: corpo === undefined ? undefined : JSON.stringify(corpo) }));
  return { status: r.status, corpo: await r.json().catch(() => null) };
}

describe('DataJud: fila', () => {
  test('resposta incompleta não marca "não encontrado": reagenda sem castigar o processo', async () => {
    const falso = resposta({ _shards: { total: 20, failed: 17 }, hits: { hits: [] } });
    // Shards todos falhos e nada veio = instável; com parte dos shards ok e nada do número = incompleto → adiado.
    const parcial = resposta({ _shards: { total: 20, failed: 5 }, hits: { hits: [] } });
    const r1 = await banco.comoUsuario(U(1), (db) => consultarLote(db, [{ processo_id: processo, numero: '0001234-56.2024.8.16.0001', indice: null }], parcial, 75_000, { pausaEntreTentativas: 0 }));
    expect(r1.adiados).toBe(1);
    const { rows: [m] } = await pg.dono.query('SELECT encontrado, falhas, adiamentos, ultimo_erro FROM datajud_monitor WHERE processo_id = $1', [processo]);
    expect(m.encontrado).toBeNull(); expect(m.falhas).toBe(0); expect(m.adiamentos).toBe(1); expect(m.ultimo_erro).toContain('DataJud instável');
    void falso;
  });
});

describe('Astrea: a agenda mantém as tarefas em dia', () => {
  const linha = (t: string, data: string, status = 'Em andamento', tipo = 'Prazo') => ({ tipo, data, hora: tipo === 'Prazo' ? undefined : '14:00', caso: 'X x Y', conclusao: '', juizo: '1ª Vara', numero: '0001234-56.2024.8.16.0001', resp: 'Ana Advogada', status, titulo: t });
  const carregar = (rows: unknown[]) => api('adm@nga.adv.br', 'POST', '/api/bi-prazos/carga', { updatedAt: new Date().toISOString(), rows, forcar: true });
  const abertas = async () => (await pg.dono.query(`SELECT titulo, tipo, status, arquivada_motivo, processo_id FROM tarefas WHERE chave_playbook LIKE 'astrea:%' ORDER BY titulo`)).rows;

  test('cria com o tipo certo, arquiva o que saiu, fecha o concluído e não traz o podre', async () => {
    const hoje = new Date(Date.now() - 3 * 3600_000);
    const br = (dias: number) => { const d = new Date(hoje.getTime() + dias * 86_400_000); return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`; };
    const base = Array.from({ length: 20 }, (_, i) => linha(`Prazo ${i}`, br(5 + i)));
    const r1 = await carregar([...base, linha('Audiência de conciliação', br(10), 'Em andamento', 'Audiência'), linha('Prazo velho', br(-60))]);
    expect(r1.status).toBe(201);
    expect(r1.corpo.direcionamento.criadas).toBe(21);
    expect(r1.corpo.direcionamento.ignoradasPodres).toBe(1);
    const t1 = await abertas();
    expect(t1.find((t) => t.titulo === 'Audiência de conciliação')).toMatchObject({ tipo: 'audiencia', processo_id: processo });
    expect(t1.some((t) => t.titulo === 'Prazo velho')).toBe(false);
    // Carga seguinte: "Prazo 0" foi concluído no Astrea e "Prazo 1" sumiu da agenda (remarcado/baixado).
    const r2 = await carregar([linha('Prazo 0', br(5), 'Concluído'), ...base.slice(2), linha('Audiência de conciliação', br(10), 'Em andamento', 'Audiência')]);
    expect(r2.corpo.direcionamento.concluidas).toBe(1);
    expect(r2.corpo.direcionamento.arquivadasSumidas).toBe(1);
    const t2 = await abertas();
    expect(t2.find((t) => t.titulo === 'Prazo 1')).toMatchObject({ status: 'concluida' });
    expect(t2.find((t) => t.titulo === 'Prazo 1')!.arquivada_motivo).toContain('Saiu da agenda');
    // Arquivada não aparece na lista; aparece no filtro de arquivadas.
    const lista = await api('adm@nga.adv.br', 'GET', '/api/tarefas');
    expect(lista.corpo.tarefas.some((t: { titulo: string }) => t.titulo === 'Prazo 1')).toBe(false);
    const arq = await api('adm@nga.adv.br', 'GET', '/api/tarefas?arquivadas=1');
    expect(arq.corpo.tarefas.map((t: { titulo: string }) => t.titulo)).toContain('Prazo 1');
  });

  test('limpeza com prévia, arquivamento e desfazer', async () => {
    await pg.dono.query(`INSERT INTO tarefas (organizacao_id, projeto_id, titulo, prazo, chave_playbook, origem) VALUES ($1,$2,'Velha do Astrea', current_date - 90, 'astrea:velha', 'automacao')`, [NGA, projeto]);
    const previa = await api('adm@nga.adv.br', 'POST', '/api/tarefas/limpeza', { dias: 30, grupos: ['astrea'], previa: true });
    expect(previa.corpo.contagem.astrea).toBe(1);
    const feita = await api('adm@nga.adv.br', 'POST', '/api/tarefas/limpeza', { dias: 30, grupos: ['astrea'], previa: false });
    expect(feita.corpo.arquivadas).toBe(1);
    const desfeita = await api('adm@nga.adv.br', 'POST', '/api/tarefas/desarquivar', { ids: feita.corpo.ids });
    expect(desfeita.corpo.reabertas).toBe(1);
  });

  test('conclusão direta pelo banco ainda funciona via serviço (sem sessão)', async () => {
    const r = await banco.comoUsuario(U(1), (db) => direcionarAgenda(db, NGA, U(1)));
    expect(r.linhas).toBeGreaterThan(0);
  });
});

describe('Pauta por equipe, QGC e portal', () => {
  test('reunião semanal da equipe: item → encaminhamento (evento) → ata por cliente → próxima reunião marcada', async () => {
    expect((await api('adm@nga.adv.br', 'PUT', `/api/projetos/${projeto}/equipes`, { equipes: ['Empresarial'] })).status).toBe(200);
    const cad = await api('adm@nga.adv.br', 'PUT', '/api/pautas/equipes/Empresarial/cadencia', { diaSemana: 2, hora: '09:00', duracaoMin: 60, ativo: true });
    expect(cad.corpo.agendada).toBeTruthy();
    const item = await api('adm@nga.adv.br', 'POST', `/api/pautas/projetos/${projeto}/itens`, { titulo: 'Contraproposta do Banco', categoria: 'negociacao', prioridade: 'alta', equipe: 'Empresarial' });
    const mesa = await api('adm@nga.adv.br', 'GET', '/api/pautas/equipes/Empresarial');
    expect(mesa.corpo.itens.find((i: { id: string }) => i.id === item.corpo.id).reuniaoId).toBe(mesa.corpo.reuniaoAtual.id);
    const t = await api('adm@nga.adv.br', 'POST', `/api/pautas/itens/${item.corpo.id}/tarefa`, { titulo: 'Reunião com o banco', tipo: 'evento', prazo: '2026-12-01', hora: '10:00' });
    expect(t.status).toBe(201);
    const { rows: [tar] } = await pg.dono.query('SELECT tipo, hora, origem FROM tarefas WHERE id = $1', [t.corpo.tarefaId]);
    expect(tar).toMatchObject({ tipo: 'evento', hora: '10:00', origem: 'pauta' });
    const fim = await api('adm@nga.adv.br', 'POST', `/api/pautas/reunioes/${mesa.corpo.reuniaoAtual.id}/encerrar`, { publicarAta: false });
    expect(fim.corpo).toMatchObject({ atas: 1, encaminhados: 1 });
    expect(fim.corpo.proxima).toBeTruthy();
  });

  test('valor sujeito, lastro e link do administrador judicial', async () => {
    const c = await api('adm@nga.adv.br', 'POST', `/api/projetos/${projeto}/qgc/credito`, { credor: 'Banco Fiduciário S/A', documento: '60746948000112', natureza: 'proprietario_fiduciario', valor: '100000000', valorBemGravado: '60000000' });
    expect(c.status).toBe(201);
    const painel = await api('adm@nga.adv.br', 'GET', `/api/projetos/${projeto}/qgc/lastros`);
    expect(painel.corpo.sugestoesSujeito[0]).toMatchObject({ creditoId: c.corpo.id, valorSujeito: '40000000' });
    expect((await api('adm@nga.adv.br', 'PUT', `/api/creditos/${c.corpo.id}/sujeito`, { valorSujeito: '40000000', garantiaDescricao: 'Alienação fiduciária' })).status).toBe(200);
    const agc = await api('adm@nga.adv.br', 'GET', `/api/projetos/${projeto}/agc/simulador`);
    expect(agc.corpo.cabecas.find((x: { credor: string }) => x.credor === 'Banco Fiduciário S/A')).toMatchObject({ classe: 'III', valorCentavos: '40000000' });
    const aj = await api('adm@nga.adv.br', 'POST', `/api/projetos/${projeto}/qgc/acessos`, { nome: 'Dr. Administrador', dias: 5, soValidado: false });
    expect(aj.corpo.token).toMatch(/^nga_aj_/);
    const lido = await api(null, 'GET', '/api/aj/qgc', undefined, { 'x-nga-aj': aj.corpo.token });
    expect(lido.status).toBe(200);
    expect(lido.corpo.creditos[0]).toMatchObject({ credor: 'Banco Fiduciário S/A', valorSujeito: '40000000' });
    expect((await api(null, 'GET', '/api/aj/qgc', undefined, { 'x-nga-aj': 'nga_aj_' + 'x'.repeat(43) })).status).toBe(401);
    expect((await api('adm@nga.adv.br', 'DELETE', `/api/qgc/acessos/${aj.corpo.id}`)).status).toBe(200);
    expect((await api(null, 'GET', '/api/aj/qgc', undefined, { 'x-nga-aj': aj.corpo.token })).status).toBe(401);
  });

  test('pedido avulso de documento vira pendência e e-mail na fila', async () => {
    const r = await api('adm@nga.adv.br', 'POST', `/api/projetos/${projeto}/checklist/pedido`, { titulo: 'Comprovante de residência do sócio', prazo: '2026-12-05' });
    expect(r.status).toBe(201);
    const ck = await api('adm@nga.adv.br', 'GET', `/api/projetos/${projeto}/checklist`);
    expect(ck.corpo.itens[0]).toMatchObject({ titulo: 'Comprovante de residência do sócio', origem: 'pedido', situacao: 'pendente' });
  });

  test('parceiro externo vê só o projeto dele e não alcança o QGC', async () => {
    const conv = await api('adm@nga.adv.br', 'POST', `/api/projetos/${projeto}/parceiros`, { nome: 'Dra. Trab', email: 'dra@trabalhistas.com.br', area: 'trabalhista', escritorio: 'Trab & Cia' });
    expect(conv.status).toBe(201);
    const outro = (await pg.dono.query<{ id: string }>(`INSERT INTO projetos (organizacao_id,nome,tipo) VALUES ($1,'Outro cliente','consultivo') RETURNING id`, [NGA])).rows[0]!.id;
    const email = 'dra@trabalhistas.com.br';
    tokens.delete(email); await entrar(email, conv.corpo.senhaTemporaria);
    const projs = await api(email, 'GET', '/api/projetos');
    expect(projs.corpo.map((p: { id: string }) => p.id)).toEqual([projeto]);
    expect((await api(email, 'GET', `/api/projetos/${projeto}/creditos`)).status).toBe(403);
    expect((await api(email, 'GET', `/api/projetos/${outro}/tarefas`)).status).not.toBe(200);
  });
});
