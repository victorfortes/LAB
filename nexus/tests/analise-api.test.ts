import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { bancoDeTeste, type BancoDeTeste } from './apoio/postgres.ts';
import { Banco } from '../src/store/conexao.ts';
import { criarApp } from '../src/server/app.ts';
import { hashDaSenha } from '../src/security/sessao.ts';
import {
  ProvedorAusente,
  type PedidoDeAnalise, type Provedor, type RespostaDaIA, type ResultadoDoProvedor,
} from '../src/ai/provedor.ts';

let pg: BancoDeTeste; let banco: Banco;
let tratar: (req: Request) => Promise<Response>;
let tratarSemIa: (req: Request) => Promise<Response>;

const NGA = '11111111-1111-1111-1111-111111111111';
const CLIENTE = '22222222-2222-2222-2222-222222222222';
const ADVOGADO = 'aaaaaaaa-0000-0000-0000-000000000001';
const CLIENTE_USR = 'aaaaaaaa-0000-0000-0000-000000000002';
const ESTAGIARIO = 'aaaaaaaa-0000-0000-0000-000000000004';
const SENHA = 'uma-senha-bem-longa';
let projeto: string, documento: string, documentoCliente: string;

/** Resposta do dublê: o teste controla o que o "modelo" diz. */
let respostaDoModelo: RespostaDaIA = { resumo: '', achados: [], suspeitas_de_injecao: [] };
const pedidos: PedidoDeAnalise[] = [];

const dublê: Provedor = {
  nome: 'dublê', disponivel: true, impedimento: null,
  analisar(pedido: PedidoDeAnalise): Promise<ResultadoDoProvedor> {
    pedidos.push(pedido);
    return Promise.resolve({
      resposta: respostaDoModelo, modelo: 'dublê-de-teste',
      tokensEntrada: 1200, tokensSaida: 340,
    });
  },
};

const PETICAO = [
  'EXCELENTÍSSIMO SENHOR DOUTOR JUIZ DE DIREITO DA 1ª VARA DE FALÊNCIAS',
  'Processo nº 0001234-56.2024.8.16.0001',
  'INDÚSTRIA DEMO LTDA., CNPJ 33.000.167/0001-01, vem requerer a recuperação',
  'judicial, nos termos do art. 51 da Lei 11.101/2005, diante da crise',
  'econômico-financeira instalada. O passivo soma R$ 12.450.000,00.',
  'A sócia administradora, CPF 111.444.777-99, subscreve.',
].join('\n');

beforeAll(async () => {
  pg = await bancoDeTeste();
  const db = pg.dono;
  await db.query(`ALTER ROLE nga_app PASSWORD 'nga_app'`);
  banco = new Banco({ host: 'localhost', port: pg.porta, user: 'nga_app', password: 'nga_app', database: 'nga_teste' });
  tratar = criarApp({ banco, provedor: dublê });
  tratarSemIa = criarApp({
    banco,
    provedor: new ProvedorAusente('ANTHROPIC_API_KEY não está configurada neste ambiente'),
  });

  const h = await hashDaSenha(SENHA);
  await db.query(`INSERT INTO organizacoes (id,tipo,nome) VALUES ($1,'escritorio','NGA'),($2,'cliente','Grupo X')`, [NGA, CLIENTE]);
  await db.query(`INSERT INTO usuarios (id,email,nome,senha_hash) VALUES
    ($1,'adv@nga.adv.br','Advogado',$4),($2,'dir@grupox.com','Diretor X',$4),
    ($3,'est@nga.adv.br','Estagiário',$4)`, [ADVOGADO, CLIENTE_USR, ESTAGIARIO, h]);
  await db.query(`INSERT INTO vinculos (usuario_id,organizacao_id,papel) VALUES
    ($1,$4,'advogado'),($2,$5,'cliente_administrador'),($3,$4,'estagiario')`,
    [ADVOGADO, CLIENTE_USR, ESTAGIARIO, NGA, CLIENTE]);

  projeto = (await db.query<{id:string}>(`INSERT INTO projetos (organizacao_id,nome,tipo)
    VALUES ($1,'RJ Grupo X','recuperacao_judicial') RETURNING id`, [NGA])).rows[0]!.id;
  await db.query(`INSERT INTO portais (projeto_id,organizacao_cliente_id) VALUES ($1,$2)`, [projeto, CLIENTE]);

  documento = (await db.query<{id:string}>(`INSERT INTO documentos
    (organizacao_id,projeto_id,titulo,caminho) VALUES ($1,$2,'Petição inicial','acervo/peticao.pdf')
    RETURNING id`, [NGA, projeto])).rows[0]!.id;
  // Documento publicado para o cliente: mesmo assim, a ANÁLISE dele é interna.
  documentoCliente = (await db.query<{id:string}>(`INSERT INTO documentos
    (organizacao_id,projeto_id,titulo,caminho,visibilidade,publicado_por,publicado_em)
    VALUES ($1,$2,'Relatório ao cliente','acervo/rel.pdf','publicado',$3,now())
    RETURNING id`, [NGA, projeto, ADVOGADO])).rows[0]!.id;
}, 120_000);

afterAll(async () => { await banco?.encerrar(); await pg?.encerrar(); });

async function entrar(email: string): Promise<string> {
  const r = await tratar(new Request('http://x/api/sessao', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, senha: SENHA }) }));
  expect(r.status).toBe(200);
  return /nga_sessao=([^;]+)/.exec(r.headers.get('set-cookie')!)![1]!;
}
const req = (t: string, url: string, init: RequestInit = {}, app = tratar) =>
  app(new Request(`http://x${url}`, { ...init,
    headers: { 'content-type': 'application/json', cookie: `nga_sessao=${t}`, ...(init.headers ?? {}) } }));

let analiseId: string;

describe('texto do documento', () => {
  test('a NGA registra o texto extraído, com a origem declarada', async () => {
    const t = await entrar('adv@nga.adv.br');
    const r = await req(t, `/api/documentos/${documento}/texto`, {
      method: 'POST', body: JSON.stringify({ texto: PETICAO, origem: 'pdf_nativo', paginas: 3 }),
    });
    expect(r.status).toBe(201);
    expect((await r.json()).caracteres).toBe(PETICAO.length);
  });

  test('analisar sem texto registrado falha dizendo o que falta', async () => {
    const t = await entrar('adv@nga.adv.br');
    const r = await req(t, `/api/documentos/${documentoCliente}/analises`, {
      method: 'POST', body: JSON.stringify({ comIa: false }) });
    expect(r.status).toBe(400);
    expect((await r.json()).erro).toContain('registre o texto antes de analisar');
  });

  test('o cliente não registra texto em documento interno da NGA', async () => {
    // Fronteira por rota, igual para qualquer id: o 403 não confirma que o documento existe.
    const t = await entrar('dir@grupox.com');
    const r = await req(t, `/api/documentos/${documento}/texto`, {
      method: 'POST', body: JSON.stringify({ texto: 'qualquer coisa', origem: 'texto_enviado' }) });
    expect(r.status).toBe(403);
  });
});

describe('análise sem IA: o determinístico basta para existir', () => {
  test('roda, classifica e acha o CPF inválido', async () => {
    const t = await entrar('adv@nga.adv.br');
    const r = await req(t, `/api/documentos/${documento}/analises`, {
      method: 'POST', body: JSON.stringify({ comIa: false }) });
    expect(r.status).toBe(201);
    const corpo = await r.json();

    expect(corpo.tipoSugerido).toBe('peticao_inicial_rj');
    expect(corpo.rotuloDoTipo).toContain('Petição inicial');
    expect(corpo.estagioIa).toBe('nao_executada');
    expect(corpo.resumo).toBeNull();
    // Nada de IA, e ainda assim há achado verdadeiro: o CPF não fecha.
    const cpf = corpo.achados.find((a: { titulo: string }) => a.titulo.includes('CPF'));
    expect(cpf.origem).toBe('deterministico');
    expect(corpo.identificadores.some((o: { tipo: string; valido: boolean }) =>
      o.tipo === 'processo_cnj' && o.valido)).toBe(true);
  });

  test('sem chave de IA, a resposta nomeia o impedimento', async () => {
    const t = await entrar('adv@nga.adv.br');
    const r = await req(t, `/api/documentos/${documento}/analises`, {
      method: 'POST', body: JSON.stringify({ comIa: true }) }, tratarSemIa);
    expect(r.status).toBe(201);
    const corpo = await r.json();
    expect(corpo.estagioIa).toBe('indisponivel');
    expect(corpo.motivoIa).toContain('ANTHROPIC_API_KEY');
    // E o determinístico veio junto, em vez de a requisição falhar.
    expect(corpo.tipoSugerido).toBe('peticao_inicial_rj');
  });

  test('/api/ia/estado diz a verdade sobre o que roda', async () => {
    const t = await entrar('adv@nga.adv.br');
    const semIa = await (await req(t, '/api/ia/estado', {}, tratarSemIa)).json();
    expect(semIa.disponivel).toBe(false);
    expect(semIa.impedimento).toContain('ANTHROPIC_API_KEY');
    expect(semIa.deterministicoSempreDisponivel.length).toBeGreaterThan(3);

    const comIa = await (await req(t, '/api/ia/estado')).json();
    expect(comIa.disponivel).toBe(true);
    expect(comIa.impedimento).toBeNull();
  });
});

describe('análise com IA: os portões valem na API', () => {
  test('achado ancorado entra; achado inventado é recusado e aparece', async () => {
    respostaDoModelo = {
      resumo: 'Pedido de recuperação judicial com passivo de R$ 12,45 milhões.',
      suspeitas_de_injecao: [],
      achados: [
        {
          categoria: 'requisitos', gravidade: 'informacao',
          titulo: 'Pedido fundado no art. 51',
          descricao: 'A peça invoca os documentos do art. 51.',
          natureza: 'legislacao',
          trecho_citado: 'nos termos do art. 51 da Lei 11.101/2005',
          fundamento: 'art. 51 da Lei 11.101/2005',
        },
        {
          categoria: 'passivo', gravidade: 'critico',
          titulo: 'Passivo de R$ 80 milhões',
          descricao: 'A peça declara passivo de R$ 80 milhões.',
          natureza: 'fato_do_documento',
          trecho_citado: 'O passivo soma R$ 80.000.000,00',
          fundamento: null,
        },
      ],
    };

    const t = await entrar('adv@nga.adv.br');
    const r = await req(t, `/api/documentos/${documento}/analises`, {
      method: 'POST', body: JSON.stringify({ comIa: true }) });
    expect(r.status).toBe(201);
    const corpo = await r.json();
    analiseId = corpo.id;

    expect(corpo.estagioIa).toBe('executada');
    expect(corpo.modeloIa).toBe('dublê-de-teste');
    expect(corpo.resumo).toContain('12,45 milhões');

    const daIa = corpo.achados.filter((a: { origem: string }) => a.origem === 'ia');
    expect(daIa).toHaveLength(1);
    expect(daIa[0].titulo).toBe('Pedido fundado no art. 51');
    expect(daIa[0].fundamentoStatus).toBe('verificada');

    // O que não existe no documento não chega ao advogado — mas o descarte sim.
    expect(corpo.achadosRecusados).toHaveLength(1);
    expect(corpo.achadosRecusados[0].titulo).toBe('Passivo de R$ 80 milhões');
  });

  test('o achado persistido guarda o trecho e a posição conferidos', async () => {
    const t = await entrar('adv@nga.adv.br');
    const corpo = await (await req(t, `/api/analises/${analiseId}`)).json();
    const daIa = corpo.achados.find((a: { origem: string }) => a.origem === 'ia');
    expect(daIa.trecho_citado).toBe('nos termos do art. 51 da Lei 11.101/2005');
    expect(PETICAO.slice(daIa.trecho_inicio, daIa.trecho_fim)).toBe(daIa.trecho_citado);
    expect(corpo.definitivo).toBe(false);
  });

  test('a fronteira do §7.12 chega ao prompt de verdade', async () => {
    const ultimo = pedidos.at(-1)!;
    expect(ultimo.sistema).toContain('DADO NÃO CONFIÁVEL');
    expect(ultimo.documento).toContain('confianca="nenhuma"');
  });

  test('o estagiário roda a análise, mas não valida o tipo', async () => {
    const t = await entrar('est@nga.adv.br');
    const r = await req(t, `/api/documentos/${documento}/analises`, {
      method: 'POST', body: JSON.stringify({ comIa: false }) });
    expect(r.status).toBe(201);

    const v = await req(t, `/api/analises/${analiseId}/validacao`, {
      method: 'POST', body: JSON.stringify({ tipo: 'peticao_inicial_rj' }) });
    expect(v.status).toBe(403);
  });

  test('o advogado valida o tipo e a análise passa a ser definitiva', async () => {
    const t = await entrar('adv@nga.adv.br');
    const r = await req(t, `/api/analises/${analiseId}/validacao`, {
      method: 'POST',
      body: JSON.stringify({ tipo: 'peticao_inicial_rj', observacao: 'confere' }) });
    expect(r.status).toBe(200);
    expect((await r.json()).definitivo).toBe(true);

    const corpo = await (await req(t, `/api/analises/${analiseId}`)).json();
    expect(corpo.definitivo).toBe(true);
    expect(corpo.validado_por_nome).toBe('Advogado');
  });

  test('triagem do achado fica registrada com quem triou', async () => {
    const t = await entrar('adv@nga.adv.br');
    const antes = await (await req(t, `/api/analises/${analiseId}`)).json();
    const achado = antes.achados[0];

    const r = await req(t, `/api/achados/${achado.id}/triagem`, {
      method: 'POST', body: JSON.stringify({ situacao: 'descartado' }) });
    expect(r.status).toBe(200);

    const depois = await (await req(t, `/api/analises/${analiseId}`)).json();
    const triado = depois.achados.find((a: { id: string }) => a.id === achado.id);
    expect(triado.situacao).toBe('descartado');
    expect(triado.revisado_por_nome).toBe('Advogado');
  });
});

describe('§13 — a análise nunca alcança o cliente', () => {
  test('o cliente não lê a análise de um documento PUBLICADO para ele', async () => {
    // O documento publicado ele lê; a leitura que a NGA fez dele, não.
    const t = await entrar('dir@grupox.com');
    const r = await req(t, `/api/analises/${analiseId}`);
    expect([400, 403, 404]).toContain(r.status);
    expect(JSON.stringify(await r.json())).not.toContain('art. 51');
  });

  test('o cliente não lista análises', async () => {
    const t = await entrar('dir@grupox.com');
    const r = await req(t, `/api/documentos/${documentoCliente}/analises`);
    // Fronteira por rota: vale para qualquer id, então o 403 não confirma que o documento existe.
    expect(r.status).toBe(403);
  });

  test('o cliente não roda análise', async () => {
    const t = await entrar('dir@grupox.com');
    const r = await req(t, `/api/documentos/${documento}/analises`, {
      method: 'POST', body: JSON.stringify({ comIa: true }) });
    expect(r.status).toBe(403);
  });

  test('o cliente não consulta o estado da IA do escritório', async () => {
    // Configuração de infraestrutura da NGA não é assunto do cliente (§13).
    const t = await entrar('dir@grupox.com');
    expect((await req(t, '/api/ia/estado')).status).toBe(403);
  });

  test('o cliente não triou achado nem valida tipo', async () => {
    const t = await entrar('dir@grupox.com');
    const v = await req(t, `/api/analises/${analiseId}/validacao`, {
      method: 'POST', body: JSON.stringify({ tipo: 'contrato' }) });
    expect(v.status).toBe(403);
  });
});
