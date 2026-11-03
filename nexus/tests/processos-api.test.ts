import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { bancoDeTeste, type BancoDeTeste } from './apoio/postgres.ts';
import { Banco } from '../src/store/conexao.ts';
import { criarApp } from '../src/server/app.ts';
import { hashDaSenha } from '../src/security/sessao.ts';

let pg: BancoDeTeste; let banco: Banco;
let tratar: (req: Request) => Promise<Response>;

const NGA = '11111111-1111-1111-1111-111111111111';
const CLIENTE = '22222222-2222-2222-2222-222222222222';
const OUTRO = '33333333-3333-3333-3333-333333333333';
const ADVOGADO = 'aaaaaaaa-0000-0000-0000-000000000001';
const CLIENTE_USR = 'aaaaaaaa-0000-0000-0000-000000000002';
const OUTRO_USR = 'aaaaaaaa-0000-0000-0000-000000000003';
const ESTAGIARIO = 'aaaaaaaa-0000-0000-0000-000000000004';
const SENHA = 'uma-senha-bem-longa';

const NUMERO = '0001234-56.2024.8.16.0001';
const NUMERO_SECRETO = '5001234-63.2023.8.16.0014';
let projeto: string, portalId: string;
let processo: string, processoSecreto: string, movimentacao: string, prazo: string;

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
    ($1,$5,'advogado'),($2,$6,'cliente_administrador'),($3,$7,'cliente_administrador'),
    ($4,$5,'estagiario')`,
    [ADVOGADO, CLIENTE_USR, OUTRO_USR, ESTAGIARIO, NGA, CLIENTE, OUTRO]);

  projeto = (await db.query<{id:string}>(`INSERT INTO projetos (organizacao_id,nome,tipo)
    VALUES ($1,'RJ Grupo X','recuperacao_judicial') RETURNING id`, [NGA])).rows[0]!.id;
  portalId = (await db.query<{id:string}>(`INSERT INTO portais (projeto_id,organizacao_cliente_id)
    VALUES ($1,$2) RETURNING id`, [projeto, CLIENTE])).rows[0]!.id;
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

describe('cadastro de processo', () => {
  test('o número é conferido pelo dígito verificador, não só pela forma', async () => {
    const t = await entrar('adv@nga.adv.br');
    const r = await req(t, '/api/processos', {
      method: 'POST', body: JSON.stringify({ numero: '0001234-99.2024.8.16.0001' }) });
    expect(r.status).toBe(400);
    expect((await r.json()).erro).toContain('dígito verificador');
  });

  test('número fora do padrão do CNJ é recusado', async () => {
    const t = await entrar('adv@nga.adv.br');
    const r = await req(t, '/api/processos', {
      method: 'POST', body: JSON.stringify({ numero: '12345' }) });
    expect(r.status).toBe(400);
  });

  test('número válido entra normalizado e com o segmento identificado', async () => {
    const t = await entrar('adv@nga.adv.br');
    const r = await req(t, '/api/processos', {
      method: 'POST',
      body: JSON.stringify({
        numero: '00012345620248160001', projetoId: projeto,
        classe: 'Recuperação Judicial', comarca: 'Curitiba', uf: 'pr',
        valorCausa: '1245000000', distribuidoEm: '2024-03-15',
      }),
    });
    expect(r.status).toBe(201);
    const corpo = await r.json();
    processo = corpo.id;
    // Entrou sem pontuação e saiu na forma canônica.
    expect(corpo.numero).toBe(NUMERO);
    expect(corpo.segmento).toBe('Justiça Estadual');
  });

  test('o mesmo processo não entra duas vezes', async () => {
    const t = await entrar('adv@nga.adv.br');
    const r = await req(t, '/api/processos', {
      method: 'POST', body: JSON.stringify({ numero: NUMERO }) });
    expect(r.status).toBe(400);
  });

  test('suspender exige motivo', async () => {
    const t = await entrar('adv@nga.adv.br');
    const sem = await req(t, `/api/processos/${processo}/situacao`, {
      method: 'POST', body: JSON.stringify({ situacao: 'suspenso' }) });
    expect(sem.status).toBe(400);
    expect((await sem.json()).erro).toContain('precisa de motivo');

    const com = await req(t, `/api/processos/${processo}/situacao`, {
      method: 'POST',
      body: JSON.stringify({
        situacao: 'suspenso', motivo: 'stay period do art. 6º, § 4º, da LREF',
        suspensoAte: '2026-09-08',
      }) });
    expect(com.status).toBe(200);
  });
});

describe('prazos', () => {
  test('o catálogo preenche dias e regime a partir do tipo', async () => {
    const t = await entrar('adv@nga.adv.br');
    const r = await req(t, `/api/processos/${processo}/prazos`, {
      method: 'POST',
      body: JSON.stringify({ tipo: 'embargos', evento: '2026-11-06' }),
    });
    expect(r.status).toBe(201);
    const corpo = await r.json();
    prazo = corpo.id;

    expect(corpo.dias).toBe(5);
    expect(corpo.regime).toBe('uteis');
    // DJe sexta 06/11 → publicação segunda 09/11 → 1º dia terça 10/11 → 5 úteis.
    expect(corpo.publicacao).toBe('2026-11-09');
    expect(corpo.vencimento).toBe('2026-11-16');
    expect(corpo.fundamentoLegal).toBe('art. 1.023 do CPC');
    expect(corpo.exigeConferencia).toBe(true);
  });

  test('o cálculo inteiro fica gravado, com os dias pulados e o porquê', async () => {
    const t = await entrar('adv@nga.adv.br');
    const d = await (await req(t, `/api/processos/${processo}`)).json();
    const guardado = d.prazos.find((z: { id: string }) => z.id === prazo);
    expect(guardado.calculo.fundamentos.join(' ')).toContain('Art. 224, § 2º');
    expect(guardado.calculo.naoCorreram.map((x: { data: string }) => x.data))
      .toEqual(['2026-11-14', '2026-11-15']);
    expect(guardado.calculo.ressalvas.join(' ')).toContain('Feriados estaduais');
  });

  test('o calendário local informado muda a conta', async () => {
    const t = await entrar('adv@nga.adv.br');
    const r = await req(t, `/api/processos/${processo}/prazos`, {
      method: 'POST',
      body: JSON.stringify({
        tipo: 'embargos', evento: '2026-11-06',
        feriadosLocais: ['2026-11-13'],
      }),
    });
    expect((await r.json()).vencimento).toBe('2026-11-17');
  });

  test('tipo desconhecido é recusado em vez de virar prazo inventado', async () => {
    const t = await entrar('adv@nga.adv.br');
    const r = await req(t, `/api/processos/${processo}/prazos`, {
      method: 'POST', body: JSON.stringify({ tipo: 'nao-existe', evento: '2026-11-06' }) });
    expect(r.status).toBe(400);
    expect((await r.json()).erro).toContain('tipo de prazo desconhecido');
  });

  test('a agenda marca o vencido e traz a ressalva do calendário', async () => {
    const t = await entrar('adv@nga.adv.br');
    const a = await (await req(t, '/api/agenda?ate=2027-12-31')).json();
    expect(a.itens.length).toBeGreaterThanOrEqual(2);
    expect(a.itens[0].numero).toBe(NUMERO);
    expect(typeof a.itens[0].diasUteisRestantes).toBe('number');
    expect(a.ressalva).toContain('feriado estadual');
  });

  test('o estagiário lê prazo, mas não cria nem fecha', async () => {
    const t = await entrar('est@nga.adv.br');
    expect((await req(t, '/api/agenda')).status).toBe(200);
    const criar = await req(t, `/api/processos/${processo}/prazos`, {
      method: 'POST', body: JSON.stringify({ tipo: 'embargos', evento: '2026-11-06' }) });
    expect(criar.status).toBe(403);
    const fechar = await req(t, `/api/prazos/${prazo}/fechamento`, {
      method: 'POST', body: JSON.stringify({ situacao: 'cumprido' }) });
    expect(fechar.status).toBe(403);
  });

  test('fechar duas vezes é recusado', async () => {
    const t = await entrar('adv@nga.adv.br');
    const um = await req(t, `/api/prazos/${prazo}/fechamento`, {
      method: 'POST', body: JSON.stringify({ situacao: 'cumprido', observacao: 'protocolado' }) });
    expect(um.status).toBe(200);
    const dois = await req(t, `/api/prazos/${prazo}/fechamento`, {
      method: 'POST', body: JSON.stringify({ situacao: 'cumprido' }) });
    expect(dois.status).toBe(400);
    expect((await dois.json()).erro).toContain('já está');
  });
});

describe('§6.3 — o que o cliente vê do andamento', () => {
  test('a NGA registra a movimentação e ela nasce invisível', async () => {
    const t = await entrar('adv@nga.adv.br');
    const r = await req(t, `/api/processos/${processo}/movimentacoes`, {
      method: 'POST',
      body: JSON.stringify({
        data: '2026-11-01',
        titulo: 'Juntada de petição de impugnação ao crédito nº 42',
        conteudo: 'Petição protocolada pelo credor Banco Fictício S.A.',
      }),
    });
    expect(r.status).toBe(201);
    const corpo = await r.json();
    movimentacao = corpo.id;
    expect(corpo.visivelAoCliente).toBe(false);
  });

  test('o cliente não vê movimentação não publicada', async () => {
    const t = await entrar('dir@grupox.com');
    const d = await (await req(t, `/api/processos/${processo}`)).json();
    expect(d.movimentacoes).toHaveLength(0);
    // Mas enxerga o processo em si, porque o portal expõe processos.
    expect(d.numero).toBe(NUMERO);
  });

  test('publicar sem resumo é recusado: despejar o andamento cru não é traduzir', async () => {
    const t = await entrar('adv@nga.adv.br');
    const r = await req(t, `/api/movimentacoes/${movimentacao}/publicacao`, {
      method: 'POST', body: JSON.stringify({ resumo: 'ok' }) });
    expect(r.status).toBe(400);
    expect((await r.json()).erro).toContain('ao menos 10 caracteres');
  });

  test('com resumo, o cliente passa a ver — e só o resumo importa na tela dele', async () => {
    const nga = await entrar('adv@nga.adv.br');
    const pub = await req(nga, `/api/movimentacoes/${movimentacao}/publicacao`, {
      method: 'POST',
      body: JSON.stringify({
        resumo: 'Um credor discordou do valor do seu crédito na lista. Vamos responder no prazo.',
      }) });
    expect(pub.status).toBe(200);

    const cliente = await entrar('dir@grupox.com');
    const d = await (await req(cliente, `/api/processos/${processo}`)).json();
    expect(d.movimentacoes).toHaveLength(1);
    expect(d.movimentacoes[0].resumo_ao_cliente).toContain('Um credor discordou');
    expect(d.movimentacoes[0].publicado_em).not.toBeNull();

    // O nome de quem publicou chega VAZIO ao cliente, e isso não é defeito: o
    // RLS de `usuarios` não deixa o cliente ler a equipe da NGA, e a junção
    // simplesmente não encontra a linha. Internamente o nome está lá.
    expect(d.movimentacoes[0].publicado_por_nome).toBeNull();
    const interno = await (await req(nga, `/api/processos/${processo}`)).json();
    expect(interno.movimentacoes[0].publicado_por_nome).toBe('Advogado');
  });

  test('despublicar tira do portal na hora', async () => {
    const nga = await entrar('adv@nga.adv.br');
    await req(nga, `/api/movimentacoes/${movimentacao}/publicacao`, { method: 'DELETE' });
    const cliente = await entrar('dir@grupox.com');
    const d = await (await req(cliente, `/api/processos/${processo}`)).json();
    expect(d.movimentacoes).toHaveLength(0);
  });

  test('o estagiário não publica movimentação', async () => {
    const t = await entrar('est@nga.adv.br');
    const r = await req(t, `/api/movimentacoes/${movimentacao}/publicacao`, {
      method: 'POST', body: JSON.stringify({ resumo: 'um resumo qualquer bem longo' }) });
    expect(r.status).toBe(403);
  });
});

describe('§13 — o que o cliente nunca alcança', () => {
  test('prazo nenhum, nem na listagem nem no detalhe', async () => {
    // Prazo é controle interno. Um prazo perdido aparecendo numa listagem
    // para o cliente é a pior forma possível de ele descobrir.
    const t = await entrar('dir@grupox.com');
    const d = await (await req(t, `/api/processos/${processo}`)).json();
    expect(d.prazos).toHaveLength(0);
    expect((await req(t, '/api/agenda')).status).toBe(403);
  });

  test('processo em segredo de justiça fica fora do portal', async () => {
    const nga = await entrar('adv@nga.adv.br');
    const r = await req(nga, '/api/processos', {
      method: 'POST',
      body: JSON.stringify({ numero: NUMERO_SECRETO, projetoId: projeto, segredoJustica: true }) });
    expect(r.status).toBe(201);
    processoSecreto = (await r.json()).id;

    const cliente = await entrar('dir@grupox.com');
    expect((await req(cliente, `/api/processos/${processoSecreto}`)).status).toBe(404);
    const lista = await (await req(cliente, '/api/processos')).json();
    expect(lista.map((p: { numero: string }) => p.numero)).not.toContain(NUMERO_SECRETO);
  });

  test('cliente de outro grupo não vê processo algum deste', async () => {
    const t = await entrar('dir@grupoy.com');
    expect(await (await req(t, '/api/processos')).json()).toEqual([]);
    expect((await req(t, `/api/processos/${processo}`)).status).toBe(404);
  });

  test('o cliente não cadastra processo nem movimentação', async () => {
    const t = await entrar('dir@grupox.com');
    expect((await req(t, '/api/processos', {
      method: 'POST', body: JSON.stringify({ numero: NUMERO_SECRETO }) })).status).toBe(403);
    expect((await req(t, `/api/processos/${processo}/movimentacoes`, {
      method: 'POST', body: JSON.stringify({ data: '2026-11-01', titulo: 'forjada' }) })).status)
      .toBe(403);
  });

  test('desligar a exibição de processos no portal tira tudo de uma vez', async () => {
    await pg.dono.query('UPDATE portais SET mostra_processos = FALSE WHERE id = $1', [portalId]);
    const t = await entrar('dir@grupox.com');
    expect(await (await req(t, '/api/processos')).json()).toEqual([]);
    await pg.dono.query('UPDATE portais SET mostra_processos = TRUE WHERE id = $1', [portalId]);
    expect((await (await req(t, '/api/processos')).json()).length).toBe(1);
  });
});

describe('partes', () => {
  test('a NGA cadastra e o cliente lê as partes do processo dele', async () => {
    const nga = await entrar('adv@nga.adv.br');
    const r = await req(nga, `/api/processos/${processo}/partes`, {
      method: 'POST',
      body: JSON.stringify({
        nome: 'INDÚSTRIA DEMO LTDA.', documento: '33000167000101', tipoDocumento: 'cnpj',
        polo: 'ativo', papel: 'recuperanda', ehCliente: true,
      }) });
    expect(r.status).toBe(201);

    const cliente = await entrar('dir@grupox.com');
    const d = await (await req(cliente, `/api/processos/${processo}`)).json();
    expect(d.partes).toHaveLength(1);
    expect(d.partes[0].papel).toBe('recuperanda');
  });
});
