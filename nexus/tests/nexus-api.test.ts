/**
 * NGA Nexus: matriz de acessos, grupo de WhatsApp, faturas com comprovante, financeiro por projeto,
 * ajustes editáveis e vínculo das publicações da Controladoria.
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
import { pdfDeTeste } from './apoio/zip.ts';

let pg: BancoDeTeste; let banco: Banco;
let tratar: (req: Request) => Promise<Response>;
const NGA = '11111111-1111-1111-1111-111111111111';
const CX = '22222222-2222-2222-2222-222222222222';
const CY = '33333333-3333-3333-3333-333333333333';
const U = (n: number) => `aaaaaaaa-0000-0000-0000-00000000000${n}`;
const SENHA = 'uma-senha-bem-longa';
let pX: string, pY: string;

beforeAll(async () => {
  pg = await bancoDeTeste();
  const db = pg.dono;
  await db.query(`ALTER ROLE nga_app PASSWORD 'nga_app'`);
  banco = new Banco({ host: 'localhost', port: pg.porta, user: 'nga_app', password: 'nga_app', database: 'nga_teste' });
  const raiz = await mkdtemp(join(tmpdir(), 'nga-nexus-'));
  const arm = new ArmazenamentoLocal(raiz); await arm.iniciar();
  tratar = criarApp({ banco, deposito: montarDeposito(arm, { NGA_SEGREDO_ARQUIVOS: 'segredo-de-teste-de-arquivos-com-mais-de-32' }) });

  const h = await hashDaSenha(SENHA);
  await db.query(`INSERT INTO organizacoes (id,tipo,nome) VALUES ($1,'escritorio','NGA'),($2,'cliente','Grupo X'),($3,'cliente','Grupo Y')`, [NGA, CX, CY]);
  const pessoas: Array<[number, string, string, string, string]> = [
    [1, 'adm@nga.adv.br', 'Administrador', 'socio_administrador', NGA], [2, 'coord@nga.adv.br', 'Coordenação', 'coordenacao', NGA],
    [3, 'adv@nga.adv.br', 'Advogado', 'advogado', NGA], [4, 'ctrl@nga.adv.br', 'Controladoria', 'controladoria', NGA],
    [5, 'fin@nga.adv.br', 'Financeiro', 'financeiro', NGA], [6, 'cx@grupox.com', 'Cliente X', 'cliente_administrador', CX],
    [7, 'cy@grupoy.com', 'Cliente Y', 'cliente_administrador', CY], [8, 'soc@nga.adv.br', 'Sócio', 'socio', NGA],
  ];
  for (const [n, email, nome, papel, org] of pessoas) {
    await db.query('INSERT INTO usuarios (id,email,nome,senha_hash) VALUES ($1,$2,$3,$4)', [U(n), email, nome, h]);
    await db.query('INSERT INTO vinculos (usuario_id,organizacao_id,papel) VALUES ($1,$2,$3)', [U(n), org, papel]);
  }
  pX = (await db.query<{ id: string }>(`INSERT INTO projetos (organizacao_id,nome,tipo) VALUES ($1,'RJ Grupo X','recuperacao_judicial') RETURNING id`, [NGA])).rows[0]!.id;
  pY = (await db.query<{ id: string }>(`INSERT INTO projetos (organizacao_id,nome,tipo) VALUES ($1,'RJ Grupo Y','recuperacao_judicial') RETURNING id`, [NGA])).rows[0]!.id;
  await db.query('INSERT INTO portais (projeto_id,organizacao_cliente_id) VALUES ($1,$2),($3,$4)', [pX, CX, pY, CY]);
  // O financeiro só está na equipe do projeto X.
  await db.query(`INSERT INTO projeto_equipe (projeto_id,organizacao_id,usuario_id,papel) VALUES ($1,$2,$3,'apoio')`, [pX, NGA, U(5)]);
}, 120_000);
afterAll(async () => { await banco?.encerrar(); await pg?.encerrar(); });

const tokens = new Map<string, string>();
async function entrar(email: string) {
  if (tokens.has(email)) return tokens.get(email)!;
  const r = await tratar(new Request('http://x/api/sessao', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, senha: SENHA }) }));
  expect(r.status).toBe(200);
  const t = /nga_sessao=([^;]+)/.exec(r.headers.get('set-cookie')!)![1]!; tokens.set(email, t); return t;
}
const req = async (email: string, url: string, init: RequestInit = {}) => {
  const t = await entrar(email);
  return tratar(new Request(`http://x${url}`, { ...init, headers: { ...(init.body instanceof FormData ? {} : { 'content-type': 'application/json' }), cookie: `nga_sessao=${t}`, ...(init.headers ?? {}) } }));
};
const post = (e: string, u: string, b: unknown) => req(e, u, { method: 'POST', body: JSON.stringify(b) });
const patch = (e: string, u: string, b: unknown) => req(e, u, { method: 'PATCH', body: JSON.stringify(b) });
const arquivo = (nome = 'comprovante.pdf') => { const f = new FormData(); f.append('arquivo', new File([pdfDeTeste() as unknown as BlobPart], nome, { type: 'application/pdf' })); return f; };

describe('matriz de acessos', () => {
  test('Clientes: só controladoria, coordenação, sócio e administração', async () => {
    for (const e of ['adm@nga.adv.br', 'coord@nga.adv.br', 'ctrl@nga.adv.br', 'soc@nga.adv.br']) expect((await req(e, '/api/clientes')).status, e).toBe(200);
    for (const e of ['adv@nga.adv.br', 'fin@nga.adv.br']) expect((await req(e, '/api/clientes')).status, e).toBe(403);
  });
  test('Controladoria, Sentinela e BI: controladoria, sócio e administração; coordenação e advogado não', async () => {
    for (const e of ['adm@nga.adv.br', 'ctrl@nga.adv.br', 'soc@nga.adv.br']) { expect((await req(e, '/api/controladoria/oabs')).status, e).toBe(200); expect((await req(e, '/api/sentinela')).status, e).toBe(200); }
    for (const e of ['coord@nga.adv.br', 'adv@nga.adv.br', 'fin@nga.adv.br']) { expect((await req(e, '/api/controladoria/oabs')).status, e).toBe(403); expect((await req(e, '/api/sentinela')).status, e).toBe(403); }
  });
  test('Entregas NEXUS: só sócio e administração', async () => {
    for (const e of ['adm@nga.adv.br', 'soc@nga.adv.br']) expect((await req(e, '/api/lab/entregas')).status, e).toBe(200);
    for (const e of ['coord@nga.adv.br', 'adv@nga.adv.br', 'ctrl@nga.adv.br']) expect((await req(e, '/api/lab/entregas')).status, e).toBe(404);
  });
  test('Relatórios: advogado não emite; coordenação e controladoria sim', async () => {
    expect((await req('adv@nga.adv.br', '/api/relatorios/tipos')).status).toBe(403);
    for (const e of ['coord@nga.adv.br', 'ctrl@nga.adv.br']) expect((await req(e, '/api/relatorios/tipos')).status, e).toBe(200);
  });
  test('Painel: o financeiro não o abre', async () => {
    expect((await req('fin@nga.adv.br', '/api/painel')).status).toBe(403);
    expect((await req('adv@nga.adv.br', '/api/painel')).status).toBe(200);
  });
  test('o chat interno não existe mais', async () => {
    expect((await req('adm@nga.adv.br', '/api/conversas')).status).toBe(404);
  });
  test('/api/eu entrega as permissões que a navegação lê', async () => {
    const adv = await (await req('adv@nga.adv.br', '/api/eu')).json();
    expect(adv.permissoes).not.toContain('modulo.clientes'); expect(adv.permissoes).not.toContain('portal.acessos'); expect(adv.podeVerEntregas).toBe(false);
    const coord = await (await req('coord@nga.adv.br', '/api/eu')).json();
    expect(coord.permissoes).toContain('modulo.clientes'); expect(coord.permissoes).not.toContain('controladoria.ler');
  });
  test('a matriz de Ajustes bate com as permissões', async () => {
    const { matriz } = await (await req('adv@nga.adv.br', '/api/escritorio/acessos')).json() as { matriz: Array<{ papel: string; menu: Array<{ id: string; acesso: boolean }> }> };
    const acesso = (p: string, m: string) => matriz.find((x) => x.papel === p)!.menu.find((x) => x.id === m)!.acesso;
    expect(acesso('advogado', 'clientes')).toBe(false); expect(acesso('advogado', 'controladoria')).toBe(false); expect(acesso('advogado', 'projetos')).toBe(true);
    expect(acesso('coordenacao', 'controladoria')).toBe(false); expect(acesso('coordenacao', 'entregas')).toBe(false); expect(acesso('coordenacao', 'equipe')).toBe(true);
    expect(acesso('controladoria', 'bi-prazos')).toBe(true); expect(acesso('controladoria', 'entregas')).toBe(false);
    expect(acesso('socio', 'entregas')).toBe(true); expect(acesso('socio_administrador', 'ajustes')).toBe(true);
    expect(acesso('financeiro', 'financeiro')).toBe(true); expect(acesso('financeiro', 'clientes')).toBe(false);
  });
});

describe('acesso do cliente ao portal', () => {
  test('advogado e controladoria não criam usuário do portal; coordenação, sócio e administração criam', async () => {
    const corpo = (n: string) => ({ nome: 'Fulano', email: `${n}@grupox.com`, organizacao: 'Grupo X' });
    expect((await post('adv@nga.adv.br', `/api/projetos/${pX}/portal/convites`, corpo('a'))).status).toBe(403);
    expect((await post('ctrl@nga.adv.br', `/api/projetos/${pX}/portal/convites`, corpo('b'))).status).toBe(403);
    expect((await post('coord@nga.adv.br', `/api/projetos/${pX}/portal/convites`, corpo('c'))).status).toBe(201);
    expect((await post('adm@nga.adv.br', `/api/projetos/${pX}/portal/convites`, corpo('d'))).status).toBe(201);
  });
  test('o banco também recusa: função de convite chamada por advogado falha', async () => {
    const r = await banco.comoUsuario(U(3), (db) => db.query(`SELECT convidar_cliente($1,'Grupo X','z@grupox.com','Z','$argon2id$x')`, [pX]).then(() => 'ok').catch((e: Error) => e.message));
    expect(String(r)).toContain('sem permissão');
  });
});

describe('grupo de WhatsApp do cliente', () => {
  test('o advogado cadastra o link; o cliente o recebe no portal; link estranho é recusado', async () => {
    expect((await patch('adv@nga.adv.br', `/api/projetos/${pX}/dados-do-cliente`, { whatsappGrupoUrl: 'https://evil.example.com/x' })).status).toBe(400);
    expect((await patch('adv@nga.adv.br', `/api/projetos/${pX}/dados-do-cliente`, { whatsappGrupoUrl: 'https://chat.whatsapp.com/AbCdEf123' })).status).toBe(200);
    const portal = await (await req('cx@grupox.com', '/api/portal/projetos')).json();
    expect(portal[0].whatsapp_grupo_url).toBe('https://chat.whatsapp.com/AbCdEf123');
    expect((await patch('cx@grupox.com', `/api/projetos/${pX}/dados-do-cliente`, { whatsappGrupoUrl: 'https://chat.whatsapp.com/outro' })).status).toBe(403);
    expect((await patch('adv@nga.adv.br', `/api/projetos/${pX}/dados-do-cliente`, { whatsappGrupoUrl: '' })).status).toBe(200);
  });
});

let faturaX: string; let guiaX: string; let faturaY: string;
describe('faturas, comprovante e financeiro por projeto', () => {
  const nova = (projetoId: string, extra: Record<string, unknown> = {}) => ({ projetoId, descricao: 'Honorários de novembro', valor: '5.000,00', vencimento: '2027-01-10', ...extra });

  test('só quem gere fatura emite; advogado lê mas não emite', async () => {
    expect((await post('adv@nga.adv.br', '/api/faturas', nova(pX))).status).toBe(403);
    expect((await post('cx@grupox.com', '/api/faturas', nova(pX))).status).toBe(403);
    const r = await post('coord@nga.adv.br', '/api/faturas', nova(pX)); expect(r.status).toBe(201);
    const f = await r.json(); faturaX = f.id; expect(f.valorCentavos).toBe(500000); expect(f.status).toBe('a_vencer'); expect(f.numero).toMatch(/^FAT-\d{4}-\d{5}$/);
    faturaY = (await (await post('coord@nga.adv.br', '/api/faturas', nova(pY, { descricao: 'Honorários Y' }))).json()).id;
    const g = await (await post('coord@nga.adv.br', '/api/faturas', nova(pX, { tipo: 'guia_custas', descricao: 'Custas iniciais', valor: '320,50' }))).json();
    guiaX = g.id; expect(g.pagador).toBe('escritorio'); expect(g.visivelCliente).toBe(false);
    expect((await req('adv@nga.adv.br', '/api/faturas')).status).toBe(200);
  });

  test('o cliente vê só a própria fatura visível: nem a guia do escritório, nem a de outro cliente', async () => {
    const x = await (await req('cx@grupox.com', '/api/faturas')).json();
    expect(x.faturas.map((f: { id: string }) => f.id)).toEqual([faturaX]);
    expect(x.resumo.proxima.id).toBe(faturaX); expect(x.resumo.totalAbertoFormatado).toBe('5.000,00');
    const y = await (await req('cy@grupoy.com', '/api/faturas')).json();
    expect(y.faturas.map((f: { id: string }) => f.id)).toEqual([faturaY]);
  });

  test('o financeiro só alcança os projetos em que está na equipe', async () => {
    const lista = await (await req('fin@nga.adv.br', '/api/faturas')).json();
    expect(lista.faturas.map((f: { id: string }) => f.id).sort()).toEqual([faturaX, guiaX].sort());
    const projetos = await (await req('fin@nga.adv.br', '/api/projetos')).json();
    expect(projetos.map((p: { id: string }) => p.id)).toEqual([pX]);
    expect((await post('fin@nga.adv.br', '/api/faturas', nova(pY))).status).toBeGreaterThanOrEqual(400);
  });

  test('o cliente não consegue marcar como paga sem comprovante; com comprovante, aparece paga em conferência', async () => {
    const semArquivo = await req('cx@grupox.com', `/api/faturas/${faturaX}/comprovante`, { method: 'POST', body: new FormData() });
    expect(semArquivo.status).toBe(400);
    expect((await req('cy@grupoy.com', `/api/faturas/${faturaX}/comprovante`, { method: 'POST', body: arquivo() })).status).toBeGreaterThanOrEqual(400);
    const r = await req('cx@grupox.com', `/api/faturas/${faturaX}/comprovante`, { method: 'POST', body: arquivo() });
    expect(r.status).toBe(201);
    const f = await r.json(); expect(f.status).toBe('paga_em_conferencia'); expect(f.comprovanteId).toBeTruthy();
    const resumo = (await (await req('cx@grupox.com', '/api/faturas')).json()).resumo; expect(resumo.emAberto).toBe(0); expect(resumo.pagas).toBe(1);
  });

  test('o banco não aceita fatura paga sem comprovante, nem por SQL direto', async () => {
    await expect(pg.dono.query(`UPDATE faturas SET situacao='paga', pago_em=CURRENT_DATE WHERE id=$1`, [faturaY])).rejects.toThrow(/paga_com_comprovante/);
  });

  test('o comprovante vai para os documentos do financeiro e o cliente baixa o próprio', async () => {
    const docs = await (await req('fin@nga.adv.br', '/api/financeiro/documentos')).json();
    const comp = docs.find((d: { papel: string; fatura_id: string }) => d.papel === 'comprovante' && d.fatura_id === faturaX);
    expect(comp).toBeTruthy();
    expect((await post('fin@nga.adv.br', `/api/documentos/${comp.documento_id}/link`, {})).status).toBe(200);
    expect((await post('cx@grupox.com', `/api/documentos/${comp.documento_id}/link`, {})).status).toBe(200);
    expect((await post('cy@grupoy.com', `/api/documentos/${comp.documento_id}/link`, {})).status).toBeGreaterThanOrEqual(400);
  });

  test('o financeiro confere; ou recusa e a fatura volta a ficar em aberto', async () => {
    const ok = await post('fin@nga.adv.br', `/api/faturas/${faturaX}/conferencia`, { acao: 'conferir' }); expect(ok.status).toBe(200);
    expect((await ok.json()).status).toBe('paga');
    // O cliente do projeto Y paga e o financeiro (que não está nesse projeto) não consegue conferir.
    await req('cy@grupoy.com', `/api/faturas/${faturaY}/comprovante`, { method: 'POST', body: arquivo() });
    expect((await post('fin@nga.adv.br', `/api/faturas/${faturaY}/conferencia`, { acao: 'conferir' })).status).toBe(404);
    const rec = await post('coord@nga.adv.br', `/api/faturas/${faturaY}/conferencia`, { acao: 'recusar', motivo: 'Valor diferente do boleto' });
    const f = await rec.json(); expect(f.situacao).toBe('aberta'); expect(f.comprovanteId).toBeNull(); expect(f.observacao).toContain('Valor diferente');
  });

  test('guia de custas: o financeiro registra o pagamento com o comprovante', async () => {
    const r = await req('fin@nga.adv.br', `/api/faturas/${guiaX}/comprovante`, { method: 'POST', body: (() => { const f = arquivo('guia-paga.pdf'); f.append('pagoEm', '2027-01-05'); return f; })() });
    expect(r.status).toBe(201); const g = await r.json(); expect(g.status).toBe('paga'); expect(g.pagoEm).toBe('2027-01-05');
  });
});

describe('ajustes editáveis: fluxograma, linha do tempo e automações', () => {
  test('fluxograma com ligação para etapa inexistente é recusado; válido é salvo e editado', async () => {
    const ruim = { tipo: 'fluxograma', nome: 'Fluxo', definicao: { nos: [{ id: 'a', tipo: 'inicio', rotulo: 'Início', x: 0, y: 0 }], arestas: [{ id: 'e', de: 'a', para: 'zzz' }] } };
    expect((await post('coord@nga.adv.br', '/api/config/modelos', ruim)).status).toBe(400);
    const bom = { tipo: 'fluxograma', nome: 'Triagem de publicação', definicao: { nos: [{ id: 'a', tipo: 'inicio', rotulo: 'Publicação', x: 0, y: 0 }, { id: 'b', tipo: 'etapa', rotulo: 'Calcular prazo', x: 200, y: 0 }], arestas: [{ id: 'e', de: 'a', para: 'b' }] } };
    const c = await post('coord@nga.adv.br', '/api/config/modelos', bom); expect(c.status).toBe(201);
    const { id } = await c.json();
    expect((await patch('coord@nga.adv.br', `/api/config/modelos/${id}`, { nome: 'Triagem v2' })).status).toBe(200);
    expect((await post('adv@nga.adv.br', '/api/config/modelos', bom)).status).toBe(403);
    expect((await req('adv@nga.adv.br', '/api/config/modelos')).status).toBe(200);
  });

  test('linha do tempo aplicada vira marco real do projeto, visível ao cliente só se marcado', async () => {
    const lt = { tipo: 'linha_do_tempo', nome: 'RJ padrão', definicao: { etapas: [{ id: '1', titulo: 'Pedido distribuído', diasApos: 0, visivelCliente: true }, { id: '2', titulo: 'Reunião interna', diasApos: 10, visivelCliente: false }] } };
    const { id } = await (await post('coord@nga.adv.br', '/api/config/modelos', lt)).json();
    const ap = await post('coord@nga.adv.br', `/api/config/modelos/${id}/aplicacao`, { projetoId: pX, inicio: '2027-03-01' });
    expect(ap.status).toBe(201); expect((await ap.json()).marcos).toBe(2);
    const { rows } = await pg.dono.query('SELECT titulo, data_prevista::text AS d, visivel_cliente FROM projeto_marcos WHERE projeto_id=$1 ORDER BY data_prevista', [pX]);
    expect(rows.map((r) => [r.titulo, r.d, r.visivel_cliente])).toEqual([['Pedido distribuído', '2027-03-01', true], ['Reunião interna', '2027-03-11', false]]);
  });

  test('automação "fatura paga" gera a tarefa; "fase iniciada" respeita a fase', async () => {
    const a = await post('coord@nga.adv.br', '/api/config/automacoes', { nome: 'Dar baixa', gatilho: 'fatura_paga', tituloTarefa: 'Conferir recebimento no banco', diasUteis: 2 });
    expect(a.status).toBe(201);
    const b = await post('coord@nga.adv.br', '/api/config/automacoes', { nome: 'Ao distribuir', gatilho: 'fase_iniciada', fase: 'processamento', tituloTarefa: 'Acompanhar despacho inicial', diasUteis: 1 });
    expect(b.status).toBe(201);
    expect((await post('coord@nga.adv.br', '/api/config/automacoes', { nome: 'x', gatilho: 'projeto_criado', fase: 'x', tituloTarefa: 'x' })).status).toBe(400);
    // Nova fatura de X, paga pelo financeiro: dispara.
    const f = await (await post('coord@nga.adv.br', '/api/faturas', { projetoId: pX, descricao: 'Êxito', valor: '1.000,00', vencimento: '2027-02-01' })).json();
    await req('fin@nga.adv.br', `/api/faturas/${f.id}/comprovante`, { method: 'POST', body: arquivo() });
    const { rows } = await pg.dono.query(`SELECT titulo FROM tarefas WHERE projeto_id=$1 AND origem='automacao'`, [pX]);
    expect(rows.map((r) => r.titulo)).toContain('Conferir recebimento no banco');
    const lista = await (await req('adv@nga.adv.br', '/api/config/automacoes')).json();
    expect(lista.automacoes.find((x: { nome: string }) => x.nome === 'Dar baixa').execucoes).toBeGreaterThanOrEqual(1);
  });
});

describe('Controladoria: publicações ligadas ao processo e ao projeto', () => {
  const numero = '5001234-63.2023.8.16.0014'; const digitos = numero.replace(/\D/g, '');
  test('processo cadastrado depois puxa a publicação que o esperava; o confronto conta o que sobra', async () => {
    await pg.dono.query(`INSERT INTO publicacoes (organizacao_id,comunicacao_id,oabs,data_disponibilizacao,numero_processo,texto) VALUES ($1,9001,'{Fulano}','2027-01-02',$2,'Intimação'),($1,9002,'{Fulano}','2027-01-02','00000000000000000000','Outra')`, [NGA, digitos]);
    const antes = await pg.dono.query('SELECT processo_id FROM publicacoes WHERE comunicacao_id = 9001'); expect(antes.rows[0].processo_id).toBeNull();
    await pg.dono.query(`INSERT INTO processos (organizacao_id,projeto_id,numero) VALUES ($1,$2,$3)`, [NGA, pX, numero]);
    const depois = await pg.dono.query('SELECT processo_id FROM publicacoes WHERE comunicacao_id = 9001'); expect(depois.rows[0].processo_id).not.toBeNull();
    const r = await post('ctrl@nga.adv.br', '/api/controladoria/confronto', {});
    expect(r.status).toBe(200); const c = await r.json(); expect(c.semProcesso).toBe(1); expect(c.semProjeto).toBe(0);
    expect((await post('adv@nga.adv.br', '/api/controladoria/confronto', {})).status).toBe(403);
    expect((await post('coord@nga.adv.br', '/api/controladoria/confronto', {})).status).toBe(403);
  });
});
