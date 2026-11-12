import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { analisarBalanco, analisarExtrato, classificarContraparte, coberturaDoChecklist, compararFaturamento, curvaAbc, faixaDePassivo, mesesRepetidos, semTravessao } from '../src/domain/diagnostico/analises.ts';
import { montarRelatorio, compararVersoes } from '../src/domain/diagnostico/relatorio.ts';
import { renderizarDiagnostico } from '../src/server/diagnostico_html.ts';
import { lerPlanilha } from '../src/domain/diagnostico/planilhas.ts';
import { bancoDeTeste, type BancoDeTeste } from './apoio/postgres.ts';
import { Banco } from '../src/store/conexao.ts';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ArmazenamentoLocal } from '../src/store/arquivos.ts';
import { deposito as montarDeposito } from '../src/server/arquivos.ts';
import { criarApp } from '../src/server/app.ts';
import { hashDaSenha } from '../src/security/sessao.ts';

const ref = { arquivo: 'balanco-2025.pdf', local: 'p. 2' };

describe('análises (números do caso de referência EJE)', () => {
  test('checklist de 43 itens: 86% pendente, 7% parcial, 7% sem resposta, 0% entregue', () => {
    const itens = [
      ...Array.from({ length: 34 }, (_, i) => ({ numero: i + 1, titulo: `p${i}`, area: 'A', artigo: null, situacao: 'pendente', temArquivo: false })),
      ...Array.from({ length: 3 }, (_, i) => ({ numero: 35 + i, titulo: `s${i}`, area: 'A', artigo: null, situacao: 'enviado', temArquivo: false })),
      ...Array.from({ length: 3 }, (_, i) => ({ numero: 38 + i, titulo: `c${i}`, area: 'A', artigo: null, situacao: 'complementacao', temArquivo: true })),
      ...Array.from({ length: 3 }, (_, i) => ({ numero: 41 + i, titulo: `r${i}`, area: 'A', artigo: null, situacao: 'sem_resposta', temArquivo: false })),
    ];
    const c = coberturaDoChecklist(itens);
    expect(c.total).toBe(43); expect(c.pendentesTotal).toBe(37); expect(c.contagem.marcado_sem_arquivo).toBe(3);
    expect(Math.round(c.percentuais.pendente)).toBe(86); expect(Math.round(c.percentuais.parcial)).toBe(7); expect(Math.round(c.percentuais.semResposta)).toBe(7); expect(c.percentuais.entregue).toBe(0);
  });
  test('balanço: ativo = exigível + PL; divergência é mostrada, não corrigida', () => {
    const ok = analisarBalanco({ exercicio: 2025, ref, ativoCirculante: 10_000_000, ativoNaoCirculante: 18_000_000, passivoCirculante: 40_000_000, passivoNaoCirculante: 12_900_000, patrimonioLiquido: -24_900_000 });
    expect(ok.fecha).toBe(true); expect(ok.liquidezCorrente).toBe(0.25);
    const ruim = analisarBalanco({ exercicio: 2024, ref, ativoCirculante: 10, ativoNaoCirculante: 10, passivoCirculante: 5, passivoNaoCirculante: 5, patrimonioLiquido: 5 });
    expect(ruim.fecha).toBe(false); expect(ruim.diferenca).toBe(5);
  });
  test('convenção D/C: passivo credor negativo é normalizado antes de somar', () => {
    const b = analisarBalanco({ exercicio: 2023, ref, convencao: 'dc', ativoCirculante: 50, ativoNaoCirculante: 50, passivoCirculante: -60, passivoNaoCirculante: -30, patrimonioLiquido: 10 });
    expect(b.exigivel).toBe(90); expect(b.fecha).toBe(true);
  });
  test('faturamento gerencial acima do fiscal acumula a diferença', () => {
    const f = compararFaturamento([{ ano: 2023, ref, fiscal: 10, gerencial: 20 }, { ano: 2024, ref, fiscal: 10, gerencial: 22 }]);
    expect(f.diferencaAcumulada).toBe(22); expect(f.percentualSobreFiscal).toBe(110);
  });
  test('contrapartes: fomento, tributos, cartório e parte relacionada pela razão social', () => {
    expect(classificarContraparte('PIX Alfa Securitizadora S/A')).toBe('fomento');
    expect(classificarContraparte('DARF Receita Federal')).toBe('tributos');
    expect(classificarContraparte('Cartório de Protestos')).toBe('cartorio');
    expect(classificarContraparte('TED L G Esbrissé Bicicletas', ['L G Esbrissé'])).toBe('parte_relacionada');
    expect(classificarContraparte('Fornecedor X')).toBe('outros');
  });
  test('extrato: entradas, saídas, fomento e queda de atividade', () => {
    const linhas = [];
    for (let m = 1; m <= 10; m++) { linhas.push({ data: `2026-${String(m).padStart(2, '0')}-05`, valor: m <= 5 ? 200 : 70, historico: m <= 5 ? 'Factoring Beta' : 'Cliente Z' }); linhas.push({ data: `2026-${String(m).padStart(2, '0')}-10`, valor: m <= 5 ? -190 : -69, historico: 'Fornecedor' }); }
    const x = analisarExtrato({ banco: 'Itaú', ref, linhas });
    expect(x.meses).toHaveLength(10); expect(x.queda!.variacaoPercentual).toBe(-65); expect(x.percentualFomentoNasEntradas).toBe(74.07);
  });
  test('curva ABC, faixa de passivo e meses repetidos', () => {
    expect(curvaAbc([{ nome: 'a', valor: 50 }, { nome: 'b', valor: 30 }, { nome: 'c', valor: 20 }]).top1).toBe(50);
    expect(faixaDePassivo([{ fonte: 'balanço', ref, total: 11, fiscal: 11 }, { fonte: 'balancete', ref, total: 5.2, fiscal: 5.2 }])!.fiscal).toEqual({ minimo: 5.2, maximo: 11 });
    expect(mesesRepetidos([{ mes: '01', valor: 5 }, { mes: '02', valor: 5 }, { mes: '03', valor: 6 }])).toEqual(['01 e 02']);
  });
  test('nenhum travessão longo sai do relatório', () => {
    expect(semTravessao('a — b – c')).toBe('a, b, c');
    const r = montarRelatorio({ projeto: { nome: 'P — X', razaoSocial: 'EJE', posicao: 'devedor' }, dataBase: '2026-11-10', geradoPor: 'T', versao: 1, documentos: [], checklist: [], portal: { obrigatorios: 0, enviados: 0, aprovados: 0 }, balancos: [], dres: [], faturamento: [], extratos: [], passivo: [], clientesAbc: [], relacionadas: [] });
    expect(JSON.stringify(r)).not.toMatch(/[—–]/); expect(renderizarDiagnostico(r)).not.toMatch(/[—–]/);
  });
  test('sem dados, as 13 páginas continuam (11 da estrutura + endividamento e enquadramento jurídico) e dizem o que pedir', () => {
    const r = montarRelatorio({ projeto: { nome: 'P', razaoSocial: null, posicao: 'credor' }, dataBase: '2026-11-10', geradoPor: 'T', versao: 1, documentos: [], checklist: [], portal: { obrigatorios: 0, enviados: 0, aprovados: 0 }, balancos: [], dres: [], faturamento: [], extratos: [], passivo: [], clientesAbc: [], relacionadas: [] });
    const h = renderizarDiagnostico(r); expect((h.match(/class="pg"/g) ?? []).length).toBe(13); expect(h).toContain('Sem documentos para esta análise');
    expect(r.resumo.conclusao).toContain('devedor');
  });
  test('comparar versões mostra o que mudou', () => {
    const base = { projeto: { nome: 'P', razaoSocial: 'E', posicao: 'devedor' as const }, dataBase: '2026-11-10', geradoPor: 'T', documentos: [], portal: { obrigatorios: 0, enviados: 0, aprovados: 0 }, balancos: [], dres: [], faturamento: [], extratos: [], passivo: [], clientesAbc: [], relacionadas: [] };
    const it = (s: string) => ({ numero: 1, titulo: 't', area: 'A', artigo: null, situacao: s, temArquivo: s === 'aprovado' });
    const a = montarRelatorio({ ...base, versao: 1, checklist: [it('pendente'), it('pendente')] }); const b = montarRelatorio({ ...base, versao: 2, checklist: [it('aprovado'), it('pendente')] });
    expect(compararVersoes(a, b).mudancas.find((m) => m.campo === 'pendentes')).toMatchObject({ antes: 2, depois: 1, variacao: -1 });
  });
});

describe('leitura de planilhas', () => {
  const bytes = (t: string) => new TextEncoder().encode(t);
  test('extrato em CSV, com crédito e débito, vira linhas com data e valor', () => {
    const r = lerPlanilha('extrato-itau.csv', bytes('Extrato Itaú\nData;Histórico;Crédito;Débito\n05/01/2026;Factoring Beta;2.000,00;\n10/01/2026;Fornecedor;;1.500,00\nSaldo;;;\n'));
    const x = r.extracoes[0]!; expect(x.tipo).toBe('extrato'); expect(x.referencia).toBe('extrato-itau.csv | csv');
    expect((x.dados as { banco: string }).banco).toBe('Itaú'); expect((x.dados as { linhas: unknown[] }).linhas).toEqual([{ data: '2026-01-05', valor: 2000, historico: 'Factoring Beta' }, { data: '2026-01-10', valor: -1500, historico: 'Fornecedor' }]);
  });
  test('faturamento por ano, curva ABC e demonstração por exercício', () => {
    const f = lerPlanilha('faturamento.csv', bytes('Ano;Fiscal;Gerencial\n2023;10.000,00;20.000,00\n2024;12.000,00;25.000,00\n'));
    expect(f.extracoes.map((e) => e.dados)).toEqual([{ ano: 2023, fiscal: 10000, gerencial: 20000 }, { ano: 2024, fiscal: 12000, gerencial: 25000 }]);
    const a = lerPlanilha('abc.csv', bytes('Cliente;Valor\nA;500,00\nB;300,00\nTotal;800,00\n'));
    expect(a.extracoes[0]!.tipo).toBe('clientes_abc'); expect((a.extracoes[0]!.dados as { clientes: unknown[] }).clientes).toHaveLength(2);
    const b = lerPlanilha('balanco.csv', bytes('Conta;2024;2025\nAtivo Circulante;100,00;90,00\nAtivo Não Circulante;50,00;40,00\nPassivo Circulante;120,00;130,00\nPassivo Não Circulante;30,00;40,00\nPatrimônio Líquido;0,00;-40,00\n'));
    expect(b.extracoes.map((e) => [e.tipo, (e.dados as { exercicio: number }).exercicio])).toEqual([['balanco', 2024], ['balanco', 2025]]);
    const d = lerPlanilha('dre-gerencial.csv', bytes('Conta;2025\nReceita Bruta;1.000,00\nResultado do Exercício;100,00\n'));
    expect(d.extracoes[0]!.tipo).toBe('dre_gerencial');
  });
  test('layout desconhecido e formato não suportado viram aviso, nunca palpite', () => {
    expect(lerPlanilha('x.csv', bytes('Foo;Bar\n1;2\n')).extracoes).toHaveLength(0);
    expect(lerPlanilha('x.csv', bytes('Foo;Bar\n1;2\n')).avisos[0]).toContain('x.csv');
    expect(lerPlanilha('x.doc', bytes('abc')).avisos[0]).toContain('não lido automaticamente');
  });
});

describe('API do diagnóstico versionado', () => {
  let pg: BancoDeTeste; let banco: Banco; let tratar: (r: Request) => Promise<Response>; let proj: string;
  const NGA = '11111111-1111-1111-1111-111111111111'; const CL = '22222222-2222-2222-2222-222222222222'; const S = 'aaaaaaaa-0000-0000-0000-000000000001';
  beforeAll(async () => {
    pg = await bancoDeTeste(); await pg.dono.query(`ALTER ROLE nga_app PASSWORD 'nga_app'`);
    const arm = new ArmazenamentoLocal(await mkdtemp(join(tmpdir(), 'nga-diag-'))); await arm.iniciar();
    banco = new Banco({ host: 'localhost', port: pg.porta, user: 'nga_app', password: 'nga_app', database: 'nga_teste' }); tratar = criarApp({ banco, deposito: montarDeposito(arm, { NGA_SEGREDO_ARQUIVOS: 'segredo-de-teste-de-arquivos-com-mais-de-32' }) });
    const h = await hashDaSenha('uma-senha-bem-longa');
    await pg.dono.query(`INSERT INTO organizacoes (id,tipo,nome) VALUES ($1,'escritorio','NGA'),($2,'cliente','C')`, [NGA, CL]);
    await pg.dono.query(`INSERT INTO usuarios (id,email,nome,senha_hash) VALUES ($1,'adv@nga.adv.br','Adv',$2),('aaaaaaaa-0000-0000-0000-000000000002','c@c.com','Cli',$2)`, [S, h]);
    await pg.dono.query(`INSERT INTO vinculos (usuario_id,organizacao_id,papel) VALUES ($1,$2,'advogado'),('aaaaaaaa-0000-0000-0000-000000000002',$3,'cliente_administrador')`, [S, NGA, CL]);
    proj = (await pg.dono.query<{ id: string }>(`INSERT INTO projetos (organizacao_id,nome,tipo) VALUES ($1,'RJ X','recuperacao_judicial') RETURNING id`, [NGA])).rows[0]!.id;
    await pg.dono.query(`INSERT INTO portais (projeto_id,organizacao_cliente_id) VALUES ($1,$2)`, [proj, CL]);
    await pg.dono.query(`INSERT INTO requisitos (organizacao_id,projeto_id,categoria,titulo,obrigatorio,ordem) VALUES ($1,$2,'Contábil','Balanço 2025',true,1),($1,$2,'Fiscal','Passivo fiscal',true,2)`, [NGA, proj]);
  }, 120_000);
  afterAll(async () => { await banco?.encerrar(); await pg?.encerrar(); });
  const tok = new Map<string, string>();
  const req = async (e: string, u: string, init: RequestInit = {}) => {
    if (!tok.has(e)) { const r = await tratar(new Request('http://x/api/sessao', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: e, senha: 'uma-senha-bem-longa' }) })); tok.set(e, /nga_sessao=([^;]+)/.exec(r.headers.get('set-cookie')!)![1]!); }
    return tratar(new Request(`http://x${u}`, { ...init, headers: { 'content-type': 'application/json', cookie: `nga_sessao=${tok.get(e)}` } }));
  };
  test('gera versões numeradas, com extração referenciada, HTML de 13 páginas e comparação', async () => {
    const a = await req('adv@nga.adv.br', `/api/projetos/${proj}/diagnostico/versoes`, { method: 'POST', body: '{}' }); expect(a.status).toBe(201);
    expect((await a.json()).numero).toBe(1);
    const e = await req('adv@nga.adv.br', `/api/projetos/${proj}/diagnostico/extracoes`, { method: 'POST', body: JSON.stringify({ tipo: 'balanco', referencia: 'balanco-2025.pdf | p. 2', dados: { exercicio: 2025, ativoCirculante: 10, ativoNaoCirculante: 18, passivoCirculante: 40, passivoNaoCirculante: 12.9, patrimonioLiquido: -24.9 } }) });
    expect(e.status).toBe(201);
    const b = await (await req('adv@nga.adv.br', `/api/projetos/${proj}/diagnostico/versoes`, { method: 'POST', body: '{}' })).json(); expect(b.numero).toBe(2);
    expect(b.relatorio.contabilII.balancos[0].ref.arquivo).toBe('balanco-2025.pdf');
    expect((await (await req('adv@nga.adv.br', `/api/projetos/${proj}/diagnostico/versoes`)).json()).map((v: { numero: number }) => v.numero)).toEqual([2, 1]);
    const h = await req('adv@nga.adv.br', `/api/projetos/${proj}/diagnostico/versoes/2/html`); expect(h.headers.get('content-type')).toContain('text/html'); expect(((await h.text()).match(/class="pg"/g) ?? []).length).toBe(13);
    const c = await (await req('adv@nga.adv.br', `/api/projetos/${proj}/diagnostico/comparacao?de=1&para=2`)).json(); expect(c.mudancas.length).toBeGreaterThan(3);
  });
  test('gerar lê a planilha que o cliente enviou, grava as extrações e não lê de novo', async () => {
    const cl = async (path: string, f: FormData) => { const t = await (async () => { const r = await tratar(new Request('http://x/api/sessao', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'c@c.com', senha: 'uma-senha-bem-longa' }) })); return /nga_sessao=([^;]+)/.exec(r.headers.get('set-cookie')!)![1]!; })(); return tratar(new Request(`http://x${path}`, { method: 'POST', body: f, headers: { cookie: `nga_sessao=${t}` } })); };
    const f = new FormData(); f.append('arquivo', new File(['Ano;Fiscal;Gerencial\n2024;1.000,00;2.500,00\n'], 'faturamento-2024.csv', { type: 'text/csv' })); f.append('titulo', 'Faturamento'); f.append('categoria', 'Contábil');
    expect((await cl(`/api/projetos/${proj}/documentos`, f)).status).toBe(201);
    const g = await (await req('adv@nga.adv.br', `/api/projetos/${proj}/diagnostico/versoes`, { method: 'POST', body: '{}' })).json();
    expect(g.leitura.planilhasLidas).toBe(1); expect(g.leitura.extracoes).toBe(1);
    expect(g.relatorio.contabilI.faturamento.diferencaAcumulada).toBe(1500);
    const g2 = await (await req('adv@nga.adv.br', `/api/projetos/${proj}/diagnostico/versoes`, { method: 'POST', body: '{}' })).json(); expect(g2.leitura.planilhasLidas).toBe(0);
    const ex = await (await req('adv@nga.adv.br', `/api/projetos/${proj}/diagnostico/extracoes`)).json(); expect(ex.filter((x: { origem: string }) => x.origem === 'planilha')).toHaveLength(1);
  });
  test('o cliente não alcança o diagnóstico e a posição do cliente é gravada', async () => {
    expect((await req('c@c.com', `/api/projetos/${proj}/diagnostico/versoes`)).status).toBe(403);
    expect((await req('adv@nga.adv.br', `/api/projetos/${proj}/dados-do-cliente`, { method: 'PATCH', body: JSON.stringify({ posicaoCliente: 'credor' }) })).status).toBe(200);
    const v = await (await req('adv@nga.adv.br', `/api/projetos/${proj}/diagnostico/versoes`, { method: 'POST', body: '{}' })).json(); expect(v.relatorio.capa.posicao).toBe('credor');
  });
});
