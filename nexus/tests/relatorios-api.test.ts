import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bancoDeTeste, type BancoDeTeste } from './apoio/postgres.ts';
import { Banco } from '../src/store/conexao.ts';
import { criarApp } from '../src/server/app.ts';
import { hashDaSenha } from '../src/security/sessao.ts';
import { ArmazenamentoLocal } from '../src/store/arquivos.ts';
import { deposito as montarDeposito } from '../src/server/arquivos.ts';
import { ehPdf, textoDoPdf } from './apoio/pdf.ts';
import { periodoPadrao } from '../src/server/relatorios.ts';

let pg: BancoDeTeste; let banco: Banco; let raiz: string;
let tratar: (req: Request) => Promise<Response>;

const NGA = '11111111-1111-1111-1111-111111111111';
const CLIENTE = '22222222-2222-2222-2222-222222222222';
const ADVOGADO = 'aaaaaaaa-0000-0000-0000-000000000001';
const CLIENTE_USR = 'aaaaaaaa-0000-0000-0000-000000000002';
const SENHA = 'uma-senha-bem-longa';
const SEGREDO = 'segredo-de-teste-de-relatorios-com-32-ou-mais';

let projeto: string, projetoVazio: string;
const PERIODO = { de: '2026-10-01', ate: '2026-10-31' };

beforeAll(async () => {
  pg = await bancoDeTeste();
  const db = pg.dono;
  await db.query(`ALTER ROLE nga_app PASSWORD 'nga_app'`);
  banco = new Banco({ host: 'localhost', port: pg.porta, user: 'nga_app', password: 'nga_app', database: 'nga_teste' });
  raiz = await mkdtemp(join(tmpdir(), 'nga-rel-'));
  const armazenamento = new ArmazenamentoLocal(raiz);
  await armazenamento.iniciar();
  tratar = criarApp({
    banco,
    deposito: montarDeposito(armazenamento, { NGA_SEGREDO_ARQUIVOS: SEGREDO }),
  });

  const h = await hashDaSenha(SENHA);
  await db.query(`INSERT INTO organizacoes (id,tipo,nome) VALUES ($1,'escritorio','NGA'),($2,'cliente','Grupo Demonstração')`, [NGA, CLIENTE]);
  await db.query(`INSERT INTO usuarios (id,email,nome,senha_hash) VALUES
    ($1,'adv@nga.adv.br','Advogado Responsável',$3),($2,'dir@grupox.com','Diretor X',$3)`,
    [ADVOGADO, CLIENTE_USR, h]);
  await db.query(`INSERT INTO vinculos (usuario_id,organizacao_id,papel) VALUES
    ($1,$3,'advogado'),($2,$4,'cliente_administrador')`, [ADVOGADO, CLIENTE_USR, NGA, CLIENTE]);

  projeto = (await db.query<{id:string}>(`INSERT INTO projetos (organizacao_id,nome,tipo)
    VALUES ($1,'RJ Grupo Demonstração','recuperacao_judicial') RETURNING id`, [NGA])).rows[0]!.id;
  projetoVazio = (await db.query<{id:string}>(`INSERT INTO projetos (organizacao_id,nome,tipo)
    VALUES ($1,'Projeto sem dado algum','investigacao_patrimonial') RETURNING id`, [NGA])).rows[0]!.id;
  await db.query(`INSERT INTO portais (projeto_id,organizacao_cliente_id) VALUES ($1,$2)`, [projeto, CLIENTE]);
  const empresa = (await db.query<{id:string}>(`INSERT INTO empresas
    (organizacao_id,cnpj,razao_social) VALUES ($1,'11222333000180','INDÚSTRIA DEMONSTRAÇÃO LTDA.')
    RETURNING id`, [NGA])).rows[0]!.id;
  await db.query(`INSERT INTO projetos_empresas (projeto_id,empresa_id,papel)
    VALUES ($1,$2,'recuperanda')`, [projeto, empresa]);

  // --- dados reais para o relatório medir ---
  const processo = (await db.query<{id:string}>(`INSERT INTO processos
    (organizacao_id,projeto_id,numero,classe,comarca,uf,situacao,suspenso_motivo,criado_por)
    VALUES ($1,$2,'0001234-56.2024.8.16.0001','Recuperação Judicial','Curitiba','PR',
      'suspenso','Stay period do art. 6º, § 4º, da LREF',$3) RETURNING id`,
    [NGA, projeto, ADVOGADO])).rows[0]!.id;
  await db.query(`INSERT INTO movimentacoes
    (processo_id,organizacao_id,data,titulo,visivel_ao_cliente,resumo_ao_cliente,publicado_por,publicado_em,criado_por)
    VALUES ($1,$2,'2026-10-14','Juntada de petição',TRUE,
      'Protocolamos a resposta à impugnação do credor dentro do prazo.',$3,now(),$3),
           ($1,$2,'2026-10-20','Despacho interno sigiloso',FALSE,NULL,NULL,NULL,$3)`,
    [processo, NGA, ADVOGADO]);

  await db.query(`INSERT INTO requisitos (organizacao_id,projeto_id,categoria,titulo,situacao,
      analisado_por,analisado_em,documento_id)
    VALUES ($1,$2,'Societário','Contrato social','aprovado',$3,now(),NULL)`, [NGA, projeto, ADVOGADO])
    .catch(async () => {
      // `envio_tem_documento` exige documento para "aprovado": cria um antes.
      const doc = (await db.query<{id:string}>(`INSERT INTO documentos
        (organizacao_id,projeto_id,titulo,caminho) VALUES ($1,$2,'Contrato social','ref')
        RETURNING id`, [NGA, projeto])).rows[0]!.id;
      await db.query(`INSERT INTO requisitos (organizacao_id,projeto_id,categoria,titulo,
        situacao,analisado_por,analisado_em,documento_id)
        VALUES ($1,$2,'Societário','Contrato social','aprovado',$3,now(),$4)`,
        [NGA, projeto, ADVOGADO, doc]);
    });
  await db.query(`INSERT INTO requisitos (organizacao_id,projeto_id,categoria,titulo,situacao)
    VALUES ($1,$2,'Contábil','Balanço patrimonial','pendente'),
           ($1,$2,'Contábil','Balancete','pendente')`, [NGA, projeto]);

  const credor = (await db.query<{id:string}>(`INSERT INTO credores
    (organizacao_id,projeto_id,nome,documento)
    VALUES ($1,$2,'Banco Fictício S.A.','33000167000101') RETURNING id`,
    [NGA, projeto])).rows[0]!.id;
  const credor2 = (await db.query<{id:string}>(`INSERT INTO credores
    (organizacao_id,projeto_id,nome) VALUES ($1,$2,'Metalúrgica Pendente Ltda.')
    RETURNING id`, [NGA, projeto])).rows[0]!.id;
  await db.query(`INSERT INTO creditos (organizacao_id,projeto_id,credor_id,valor,natureza,
      classe_validada,sujeito_validado,validado_por,validado_em)
    VALUES ($1,$2,$3,320000000,'quirografario','III',TRUE,$4,now())`,
    [NGA, projeto, credor, ADVOGADO]);
  await db.query(`INSERT INTO creditos (organizacao_id,projeto_id,credor_id,valor,natureza)
    VALUES ($1,$2,$3,98050035,'trabalhista')`, [NGA, projeto, credor2]);

  const conta = (await db.query<{id:string}>(`INSERT INTO contas_financeiras
    (organizacao_id,projeto_id,nome,saldo_inicial,data_inicial)
    VALUES ($1,$2,'Operacional',0,'2026-01-01') RETURNING id`, [CLIENTE, projeto])).rows[0]!.id;
  await db.query(`INSERT INTO lancamentos (organizacao_id,projeto_id,conta_id,data,tipo,situacao,valor,categoria)
    VALUES ($1,$2,$3,'2026-10-15','receita','realizado',41000000,'Vendas'),
           ($1,$2,$3,'2026-10-20','despesa','realizado',21500000,'Folha de pagamento'),
           ($1,$2,$3,'2026-11-15','receita','previsto',40000000,'Vendas')`,
    [CLIENTE, projeto, conta]);
}, 120_000);

afterAll(async () => {
  await banco?.encerrar(); await pg?.encerrar();
  await rm(raiz, { recursive: true, force: true });
});

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

/** Gera, pega o link e baixa o PDF — o caminho inteiro, como no uso real. */
async function baixarRelatorio(token: string, projetoId: string, corpo: unknown) {
  const r = await req(token, `/api/projetos/${projetoId}/relatorios`, {
    method: 'POST', body: JSON.stringify(corpo) });
  expect(r.status).toBe(201);
  const gerado = await r.json();
  const link = await (await req(token, `/api/documentos/${gerado.documentoId}/link`,
    { method: 'POST' })).json();
  const baixado = await tratar(new Request(`http://x${link.url}`));
  expect(baixado.status).toBe(200);
  return { gerado, pdf: new Uint8Array(await baixado.arrayBuffer()) };
}

describe('relatório de acompanhamento', () => {
  test('o PDF sai do acervo com os números do banco', async () => {
    const t = await entrar('adv@nga.adv.br');
    const { gerado, pdf } = await baixarRelatorio(t, projeto, { tipo: 'acompanhamento', ...PERIODO });

    expect(gerado.tipo).toBe('application/pdf');
    expect(ehPdf(pdf)).toBe(true);
    const texto = textoDoPdf(pdf);

    expect(texto).toContain('Relatório mensal de acompanhamento');
    // "Cliente" é a organização do CLIENTE, não a dona do projeto: o projeto
    // pertence à NGA, e imprimir isso faria todo relatório dizer "Cliente: NGA".
    expect(texto).toContain('Cliente INDÚSTRIA DEMONSTRAÇÃO LTDA.');
    expect(texto).toContain('Escritório NGA');
    // O identificador da coluna é `recuperacao_judicial`; o que vai ao
    // cliente tem de estar escrito em português.
    expect(texto).toContain('Recuperação judicial');
    expect(texto).not.toContain('recuperacao judicial');
    expect(texto).toContain('0001234-56.2024.8.16.0001');
    expect(texto).toContain('Stay period');
    // Caixa realizado de outubro: 410.000,00 de receita e 215.000,00 de despesa.
    expect(texto).toContain('410.000,00');
    expect(texto).toContain('215.000,00');
    expect(texto).toContain('195.000,00');          // resultado do período
  });

  test('só o andamento PUBLICADO entra no relatório', async () => {
    const t = await entrar('adv@nga.adv.br');
    const { pdf } = await baixarRelatorio(t, projeto, { tipo: 'acompanhamento', ...PERIODO });
    const texto = textoDoPdf(pdf);
    expect(texto).toContain('Protocolamos a resposta à impugnação');
    // O despacho não publicado não vaza para o PDF que vai ao cliente.
    expect(texto).not.toContain('sigiloso');
  });

  test('lançamento previsto não entra como realizado', async () => {
    const t = await entrar('adv@nga.adv.br');
    const { pdf } = await baixarRelatorio(t, projeto, { tipo: 'acompanhamento', ...PERIODO });
    const texto = textoDoPdf(pdf);
    expect(texto).toContain('somente situação realizada');
    expect(texto).not.toContain('400.000,00');
  });

  test('o progresso distingue aprovado de enviado', async () => {
    const t = await entrar('adv@nga.adv.br');
    const { pdf } = await baixarRelatorio(t, projeto, { tipo: 'acompanhamento', ...PERIODO });
    const texto = textoDoPdf(pdf);
    expect(texto).toContain('1 de 3');
    expect(texto).toContain('Enviar um documento não o aprova');
  });
});

describe('§15 — projeto sem dado nenhum', () => {
  test('o relatório existe e diz, seção por seção, o que não tem', async () => {
    // O teste que importa: nenhum zero inventado, nenhuma tabela vazia com
    // cara de medição.
    const t = await entrar('adv@nga.adv.br');
    const { gerado, pdf } = await baixarRelatorio(t, projetoVazio, { tipo: 'acompanhamento', ...PERIODO });
    const texto = textoDoPdf(pdf);

    expect(texto).toContain('Nenhum processo vinculado a este projeto');
    expect(texto).toContain('Nenhuma movimentação foi publicada');
    expect(texto).toContain('Nenhum checklist documental foi aberto');
    expect(texto).toContain('Nenhuma parcela do plano vence neste período');
    expect(texto).toContain('Nenhum lançamento realizado foi registrado');
    expect(texto).toContain('O QUE ESTE RELATÓRIO NÃO AFIRMA');
    expect(gerado.lacunas.length).toBeGreaterThanOrEqual(5);
  });

  test('a resposta devolve as lacunas ANTES de alguém publicar', async () => {
    const t = await entrar('adv@nga.adv.br');
    const r = await req(t, `/api/projetos/${projetoVazio}/relatorios`, {
      method: 'POST', body: JSON.stringify({ tipo: 'acompanhamento', ...PERIODO }) });
    const gerado = await r.json();
    expect(gerado.lacunas.join(' ')).toContain('Nenhum processo vinculado');
  });
});

describe('quadro de credores', () => {
  test('consolida só o que tem classe validada por pessoa', async () => {
    const t = await entrar('adv@nga.adv.br');
    const { pdf } = await baixarRelatorio(t, projeto, { tipo: 'credores' });
    const texto = textoDoPdf(pdf);

    expect(texto).toContain('Quadro de credores');
    expect(texto).toContain('Banco Fictício S.A.');
    expect(texto).toContain('3.200.000,00');
    expect(texto).toContain('Quirografário, privilégio e subordinado');
  });

  test('o crédito sem validação fica fora do total e é contado à parte', async () => {
    // §7.7 no papel timbrado: sugestão de máquina não vira quadro de credores.
    const t = await entrar('adv@nga.adv.br');
    const { gerado, pdf } = await baixarRelatorio(t, projeto, { tipo: 'credores' });
    const texto = textoDoPdf(pdf);

    expect(texto).toContain('980.500,35');
    expect(texto).toContain('ainda não validada');
    expect(texto).not.toContain('Metalúrgica Pendente');   // não entra na relação
    expect(gerado.lacunas.join(' ')).toContain('sem validação humana');
    expect(texto).toContain('não é decisão');
  });

  test('projeto sem empresa vinculada diz "não informado", nunca o nome do escritório', async () => {
    const t = await entrar('adv@nga.adv.br');
    const { pdf } = await baixarRelatorio(t, projetoVazio, { tipo: 'credores' });
    const texto = textoDoPdf(pdf);
    expect(texto).toContain('Cliente não informado');
    expect(texto).not.toContain('Cliente NGA');
  });

  test('projeto sem crédito validado não inventa consolidado', async () => {
    const t = await entrar('adv@nga.adv.br');
    const { pdf } = await baixarRelatorio(t, projetoVazio, { tipo: 'credores' });
    expect(textoDoPdf(pdf)).toContain('Nenhum crédito com classe validada por pessoa');
  });
});

describe('o relatório entra no acervo como qualquer documento', () => {
  test('nasce interno e o cliente não o alcança antes da publicação', async () => {
    const nga = await entrar('adv@nga.adv.br');
    const r = await req(nga, `/api/projetos/${projeto}/relatorios`, {
      method: 'POST', body: JSON.stringify({ tipo: 'acompanhamento', ...PERIODO }) });
    const doc = (await r.json()).documentoId;

    const cliente = await entrar('dir@grupox.com');
    expect((await req(cliente, `/api/documentos/${doc}/link`, { method: 'POST' })).status).toBe(404);

    await req(nga, `/api/documentos/${doc}/publicacao`, { method: 'POST' });
    const link = await (await req(cliente, `/api/documentos/${doc}/link`, { method: 'POST' })).json();
    const baixado = await tratar(new Request(`http://x${link.url}`));
    expect(baixado.status).toBe(200);
    expect(baixado.headers.get('content-type')).toBe('application/pdf');
    expect(ehPdf(new Uint8Array(await baixado.arrayBuffer()))).toBe(true);
  });

  test('cada emissão é um documento próprio, ainda que o conteúdo se repita', async () => {
    // Relatório é retrato de um momento, e a data da geração vai impressa.
    const t = await entrar('adv@nga.adv.br');
    const corpo = JSON.stringify({ tipo: 'credores' });
    const a = await (await req(t, `/api/projetos/${projeto}/relatorios`, { method: 'POST', body: corpo })).json();
    const b = await (await req(t, `/api/projetos/${projeto}/relatorios`, { method: 'POST', body: corpo })).json();
    expect(b.documentoId).not.toBe(a.documentoId);
    // E o conteúdo é guardado uma vez só quando coincide. A data impressa tem
    // precisão de minuto, então duas emissões seguidas costumam dar o mesmo
    // arquivo — mas cada emissão continua sendo um documento próprio, com sua
    // própria publicação e sua própria auditoria.
    expect(b.deduplicado).toBe(b.hash === a.hash);
  });
});

describe('quem pode emitir', () => {
  test('o cliente não emite relatório, mesmo podendo enviar documento', async () => {
    const t = await entrar('dir@grupox.com');
    const r = await req(t, `/api/projetos/${projeto}/relatorios`, {
      method: 'POST', body: JSON.stringify({ tipo: 'acompanhamento' }) });
    expect(r.status).toBe(403);
    expect((await req(t, '/api/relatorios/tipos')).status).toBe(403);
  });

  test('período invertido é recusado', async () => {
    const t = await entrar('adv@nga.adv.br');
    const r = await req(t, `/api/projetos/${projeto}/relatorios`, {
      method: 'POST', body: JSON.stringify({ tipo: 'acompanhamento', de: '2026-10-31', ate: '2026-10-01' }) });
    expect(r.status).toBe(400);
  });

  test('o período padrão é o mês fechado anterior', () => {
    const p = periodoPadrao(new Date('2026-11-02T00:00:00Z'));
    expect(p).toEqual({ de: '2026-10-01', ate: '2026-10-31' });
    const fevereiro = periodoPadrao(new Date('2024-03-10T00:00:00Z'));
    expect(fevereiro).toEqual({ de: '2024-02-01', ate: '2024-02-29' });
  });
});
