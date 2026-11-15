/**
 * Gerador de Relatórios dentro do LAB (15/11/2026, item 12): mesmo motor e mesmo PDF do Gerador, dados do LAB,
 * importação do Astrea mantida e agendamento por cliente (mensal, quinzenal, semanal).
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractText, getDocumentProxy } from 'unpdf';
import { bancoDeTeste, type BancoDeTeste } from './apoio/postgres.ts';
import { Banco } from '../src/store/conexao.ts';
import { criarApp } from '../src/server/app.ts';
import { hashDaSenha } from '../src/security/sessao.ts';
import { ArmazenamentoLocal } from '../src/store/arquivos.ts';
import { deposito as montarDeposito, type Deposito } from '../src/server/arquivos.ts';
import { montarMotor } from '../scripts/motor-gerador.ts';
import * as g from '../src/server/gerador_lab.ts';
import { criarMotor } from '../src/relatorio/motor_gerador.gen.js';

// Export sintético do Astrea, o mesmo fixture de tests/e2e/fichas-e-metricas.spec.mjs do Gerador (5 fichas, 3 cabeçalhos).
function exportAstrea(): Uint8Array {
  const { jsPDF } = criarMotor().window.jspdf; const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const reg = (y: number, data: string, desc: string, tipo: string) => [[40, y, data], [140, y, desc], [500, y, tipo]] as [number, number, string][];
  const ficha = (cab: [number, number, string][], extra: [number, number, string][] = []) => [...cab, [40, 290, 'Histórico | 1º Grau -'], [40, 310, 'DATA DESCRIÇÃO TIPO'], ...extra] as [number, number, string][];
  const paginas = [
    ficha([[40, 100, 'Ficha do processo - Nº 0001111-11.2026.8.16.0001 1/5'], [40, 130, 'CLIENTE: Cliente Teste'], [40, 150, 'VALOR DA CAUSA: R$ 100.000,00'], [40, 170, 'STATUS: Ativo 1º Grau'], [40, 190, 'CLIENTE: A EQUIPE: CÍVEL FASE: EM TRÂMITE SJ: PROJUDI']],
      [...reg(330, '05/10/2026', 'Elaborar peça', 'Tarefa realizada'), ...reg(350, '06/10/2026', 'Juntada de petição', 'Andamento')]),
    ficha([[40, 100, 'Ficha do processo - Nº 0001111-11.2026.8.16.0001 2/5'], [40, 130, 'CLIENTE: Cliente Teste'], [40, 150, 'R$ 135.000,00'], [40, 170, 'VALOR DA CAUSA:'], [40, 190, 'STATUS: Ativo 1º Grau'], [40, 210, 'CLIENTE: A EQUIPE: CÍVEL FASE: EM TRÂMITE SJ: PROJUDI']],
      reg(330, '07/10/2026', 'Analisar intimação', 'Tarefa realizada')),
    ficha([[40, 100, 'Ficha do processo - Nº 0002222-22.2026.8.16.0001 3/5'], [40, 130, 'VALOR DA CAUSA: R$ 50.000,00'], [40, 150, 'STATUS: Ativo 1º Grau'], [40, 170, 'CLIENTE: A EQUIPE: CÍVEL FASE: ARQUIVADO SJ: PROJUDI']], reg(330, '08/10/2026', 'Arquivamento', 'Andamento')),
    ficha([[40, 100, 'Ficha do processo 4/5'], [40, 130, 'PASTA: 009999'], [40, 150, 'VALOR DA CAUSA: R$ 11.103,86'], [40, 170, 'STATUS: Ativo 1º Grau']], reg(330, '09/10/2026', 'Contato com cliente', 'Tarefa realizada')),
    ficha([[40, 100, 'Ficha do caso 5/5'], [40, 130, 'CLIENTE: Cliente Teste'], [40, 150, 'TÍTULO: Notificação extrajudicial'], [40, 170, 'ADVOGADO: Maria'], [40, 190, 'VALOR DA CAUSA: R$ 0,00'], [40, 210, 'STATUS: Ativo']], reg(330, '10/10/2026', 'Notificação enviada', 'Histórico manual')),
  ];
  paginas.forEach((pg, k) => { if (k) doc.addPage(); doc.setFontSize(10); pg.forEach(([x, y, t]) => doc.text(t, x, y)); });
  return new Uint8Array(doc.output('arraybuffer'));
}

const HTML = join(import.meta.dir, '..', '..', 'relatorios', 'public', 'gerador', 'app', 'gerador.html');
const textoDoPdf = async (bytes: Uint8Array) => (await extractText(await getDocumentProxy(bytes.slice()), { mergePages: true })).text as string;
// jsPDF grava data de criação e ID do arquivo: fora isso, dois PDFs do mesmo conteúdo são idênticos.
const normalizar = (b: Uint8Array) => new TextDecoder('latin1').decode(b).replace(/\/CreationDate \(D:[^)]*\)/g, '').replace(/\/ID \[[^\]]*\]/g, '');

describe('períodos e agenda', () => {
  test('normaliza mês, quinzena e semana', () => {
    expect(g.periodo('mensal', '2026-10-17')).toMatchObject({ inicio: '2026-10-01', fim: '2026-10-31', rotulo: null, descricao: 'Outubro de 2026' });
    expect(g.periodo('quinzenal', '2026-02-20')).toMatchObject({ inicio: '2026-02-16', fim: '2026-02-28', rotulo: '2ª quinzena de fevereiro de 2026' });
    expect(g.periodo('quinzenal', '2026-11-03')).toMatchObject({ inicio: '2026-11-01', fim: '2026-11-15' });
    expect(g.periodo('semanal', '2026-11-12')).toMatchObject({ inicio: '2026-11-09', fim: '2026-11-15', rotulo: 'Semana de 09/11 a 15/11/2026' });
  });
  test('a rotina gera o último período fechado', () => {
    expect(g.periodoFechado('mensal', '2026-11-05')).toMatchObject({ inicio: '2026-10-01', fim: '2026-10-31' });
    expect(g.periodoFechado('quinzenal', '2026-11-16')).toMatchObject({ inicio: '2026-11-01', fim: '2026-11-15' });
    expect(g.periodoFechado('quinzenal', '2026-11-01')).toMatchObject({ inicio: '2026-10-16', fim: '2026-10-31' });
    expect(g.periodoFechado('semanal', '2026-11-16')).toMatchObject({ inicio: '2026-11-09', fim: '2026-11-15' });
  });
  test('próxima geração', () => {
    expect(g.proximaGeracao('mensal', 5, '2026-11-05')).toBe('2026-12-05');
    expect(g.proximaGeracao('mensal', 5, '2026-11-04')).toBe('2026-11-05');
    expect(g.proximaGeracao('quinzenal', 1, '2026-11-01')).toBe('2026-11-16');
    expect(g.proximaGeracao('semanal', 1, '2026-11-15')).toBe('2026-11-16'); // domingo → segunda
  });
});

describe('motor do Gerador', () => {
  test('o módulo do LAB corresponde ao gerador.html atual (P1–P53) e aos patches L1–L2', async () => {
    const patches = JSON.parse(await readFile(join(import.meta.dir, '..', 'scripts', 'motor-gerador.patches.json'), 'utf8'));
    const esperado = montarMotor(await readFile(HTML, 'utf8'), patches);
    expect(await readFile(join(import.meta.dir, '..', 'src', 'relatorio', 'motor_gerador.gen.js'), 'utf8')).toBe(esperado);
  });

  const n = '0001234-56.2024.8.16.0001';
  const extraido = (): g.Extraido => ({
    processos: [{ numero_processo: n, cliente: 'ACME', envolvidos: null, titulo: 'RJ', juizo: '1ª Vara', acao: 'Recuperação Judicial', advogado: 'Ana', distribuicao: null, criado_em: null, pasta: null, valor_causa: 'R$ 1.000.000,00', valor_condenacao: null, status: 'Ativo', equipe: 'Empresarial', fase: 'Inicial', sistema_judicial: null }],
    atividades: [
      { numero_processo: n, data: '03/10/2026', data_narrada: null, tipo: 'Prazo realizado', descricao: 'Manifestação - Apresentar impugnação de crédito - Realizado: protocolada impugnação' },
      { numero_processo: n, data: '05/10/2026', data_narrada: null, tipo: 'Andamento', descricao: 'Juntada de Petição' },
      { numero_processo: n, data: '08/10/2026', data_narrada: null, tipo: 'Tarefa realizada', descricao: 'Analisar plano de recuperação judicial apresentado' },
      { numero_processo: n, data: '20/10/2026', data_narrada: null, tipo: 'Evento realizado', descricao: 'Reunião realizada: Assembleia geral de credores' },
    ],
    tarefasFuturas: [], casosAdministrativos: [], atividadesAdministrativas: [], naoClassificados: [],
  });

  test('mesmo PDF do Gerador original (sem os ganchos do LAB, byte a byte fora data e ID)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nga-motor-'));
    await writeFile(join(dir, 'original.js'), montarMotor(await readFile(HTML, 'utf8'), []));
    const original = (await import(join(dir, 'original.js'))).criarMotor();
    const per = g.periodo('mensal', '2026-10-01');
    const calc = await g.calcular(extraido(), per, 'astrea');
    const ref = original.calcularIndicadores(extraido().processos, extraido().atividades, new Date(Date.UTC(2026, 9, 1)), new Date(Date.UTC(2026, 9, 31)), Object.assign([], { destaquesComite: false }), [], []);
    expect(calc.indicadores.quantidade_total_atividades_periodo).toBe(4);
    expect(calc.indicadores).toEqual(ref.indicadores);
    const doLab = g.desenharPdf('ACME Indústria S.A.', calc, 'astrea');
    const doGerador = new Uint8Array(new original.GeradorRelatorioPDF().gerar('ACME Indústria S.A.', ref.indicadores, ref.atividadesClassificadas).output('arraybuffer'));
    expect(normalizar(doLab)).toBe(normalizar(doGerador));
  });

  test('base LAB e período curto trocam só os rótulos fixos', async () => {
    const mensal = await textoDoPdf(g.desenharPdf('ACME', await g.calcular(extraido(), g.periodo('mensal', '2026-10-01'), 'lab'), 'lab'));
    expect(mensal).toContain('REGISTROS NO LAB');
    expect(mensal).not.toContain('Astrea');
    expect(mensal).toContain('Outubro de 2026');
    expect(mensal).toContain('Registros por tipo no LAB');
    const quinzena = await textoDoPdf(g.desenharPdf('ACME', await g.calcular(extraido(), g.periodo('quinzenal', '2026-10-01'), 'lab'), 'lab'));
    expect(quinzena).toContain('RELATÓRIO QUINZENAL DE ATUAÇÃO JURÍDICA');
    expect(quinzena).toContain('1ª quinzena de outubro de 2026');
    expect(quinzena).toContain('A quinzena em números');
  });

  test('P53: mês sem registro repete o último mês com dados e avisa', async () => {
    const calc = await g.calcular(extraido(), g.periodo('mensal', '2026-11-01'), 'lab');
    expect(calc.periodo.inicio).toBe('2026-10-01');
    expect(calc.indicadores.aviso_periodo).toContain('Não houve atualização no LAB em novembro de 2026');
    const semana = await g.calcular(extraido(), g.periodo('semanal', '2026-11-09'), 'lab');
    expect(semana.indicadores.quantidade_total_atividades_periodo).toBe(0);
    expect(semana.avisos.join(' ')).toContain('Nenhum registro no período');
  });
});

// ------------------------------------------------------------------- API ---
let pg: BancoDeTeste; let banco: Banco; let tratar: (req: Request) => Promise<Response>; let dep: Deposito;
const NGA = '11111111-1111-1111-1111-111111111111';
const U = (n: number) => `aaaaaaaa-0000-0000-0000-00000000000${n}`;
const SENHA = 'uma-senha-bem-longa';
let projeto: string; let processo: string;

beforeAll(async () => {
  pg = await bancoDeTeste();
  const db = pg.dono;
  await db.query(`ALTER ROLE nga_app PASSWORD 'nga_app'`);
  banco = new Banco({ host: 'localhost', port: pg.porta, user: 'nga_app', password: 'nga_app', database: 'nga_teste' });
  const arm = new ArmazenamentoLocal(await mkdtemp(join(tmpdir(), 'nga-gerador-lab-'))); await arm.iniciar();
  dep = montarDeposito(arm, { NGA_SEGREDO_ARQUIVOS: 'segredo-de-teste-de-arquivos-com-mais-de-32' });
  tratar = criarApp({ banco, deposito: dep, segredoCofre: 'chave-do-cofre-de-teste' });
  const h = await hashDaSenha(SENHA);
  await db.query(`INSERT INTO organizacoes (id,tipo,nome) VALUES ($1,'escritorio','NGA')`, [NGA]);
  for (const [n, email, papel] of [[1, 'adm@nga.adv.br', 'socio_administrador'], [2, 'adv@nga.adv.br', 'advogado']] as const) {
    await db.query('INSERT INTO usuarios (id,email,nome,senha_hash) VALUES ($1,$2,$3,$4)', [U(n), email, email, h]);
    await db.query('INSERT INTO vinculos (usuario_id,organizacao_id,papel) VALUES ($1,$2,$3)', [U(n), NGA, papel]);
  }
  projeto = (await db.query<{ id: string }>(`INSERT INTO projetos (organizacao_id,nome,tipo,responsavel_id) VALUES ($1,'RJ Acme','recuperacao_judicial',$2) RETURNING id`, [NGA, U(1)])).rows[0]!.id;
  const emp = (await db.query<{ id: string }>(`INSERT INTO empresas (organizacao_id,cnpj,razao_social) VALUES ($1,'07045249000162','ACME INDÚSTRIA LTDA') RETURNING id`, [NGA])).rows[0]!.id;
  await db.query(`INSERT INTO projetos_empresas (projeto_id,empresa_id,papel) VALUES ($1,$2,'recuperanda')`, [projeto, emp]);
  processo = (await db.query<{ id: string }>(`INSERT INTO processos (organizacao_id,projeto_id,numero,classe,valor_causa) VALUES ($1,$2,'0001234-56.2024.8.16.0001','Recuperação Judicial',150000000) RETURNING id`, [NGA, projeto])).rows[0]!.id;
  await db.query(`INSERT INTO movimentacoes (processo_id,organizacao_id,data,titulo,fonte,externo_id) VALUES ($1,$2,'2026-10-05','Juntada de Petição','datajud','m1'),($1,$2,'2026-10-12','Decisão','datajud','m2')`, [processo, NGA]);
  await db.query(`INSERT INTO prazos (processo_id,organizacao_id,titulo,evento,origem,dias,regime,vencimento,calculo,situacao,cumprido_em,observacao)
    VALUES ($1,$2,'Apresentar impugnação de crédito','2026-10-01','manual',15,'uteis','2026-10-22','{}','cumprido','2026-10-20 15:00-03','protocolada impugnação')`, [processo, NGA]);
  await db.query(`INSERT INTO tarefas (organizacao_id,projeto_id,titulo,status,concluida_em) VALUES ($1,$2,'Analisar plano de recuperação','concluida','2026-10-08 10:00-03')`, [NGA, projeto]);
  await db.query(`INSERT INTO atas (organizacao_id,projeto_id,titulo,realizada_em,decisoes) VALUES ($1,$2,'Reunião com a recuperanda','2026-10-21','Aprovar o cronograma')`, [NGA, projeto]);
  await db.query(`INSERT INTO organizacoes (id,tipo,nome) VALUES ('22222222-2222-2222-2222-222222222222','cliente','Cliente X')`);
  await db.query('INSERT INTO usuarios (id,email,nome,senha_hash) VALUES ($1,$2,$3,$4)', [U(4), 'cx@cliente.com', 'Cliente', h]);
  await db.query(`INSERT INTO vinculos (usuario_id,organizacao_id,papel) VALUES ($1,'22222222-2222-2222-2222-222222222222','cliente_administrador')`, [U(4)]);
}, 120_000);
afterAll(async () => { await banco?.encerrar(); await pg?.encerrar(); });

const tokens = new Map<string, string>();
async function entrar(email: string) {
  if (tokens.has(email)) return tokens.get(email)!;
  const r = await tratar(new Request('http://x/api/sessao', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, senha: SENHA }) }));
  const t = /nga_sessao=([^;]+)/.exec(r.headers.get('set-cookie')!)![1]!; tokens.set(email, t); return t;
}
async function chamar(email: string, metodo: string, rota: string, corpo?: unknown) {
  const headers: Record<string, string> = { cookie: `nga_sessao=${await entrar(email)}` };
  if (corpo !== undefined) headers['content-type'] = 'application/json';
  return tratar(new Request(`http://x${rota}`, { method: metodo, headers, body: corpo === undefined ? undefined : JSON.stringify(corpo) }));
}

describe('API do Gerador no LAB', () => {
  test('extrai do LAB no formato do leitor do Astrea', async () => {
    const { cliente, extraido } = await banco.comoUsuario(U(1), (db) => g.extrairDoLab(db, projeto, '2026-10-01', '2026-10-31'));
    expect(cliente).toBe('ACME INDÚSTRIA LTDA');
    expect(extraido.processos[0]).toMatchObject({ numero_processo: '0001234-56.2024.8.16.0001', valor_causa: 'R$ 1.500.000,00', status: 'Ativo', equipe: 'Empresarial', advogado: 'adm@nga.adv.br' });
    const tipos = extraido.atividades.map((a) => a.tipo).sort();
    expect(tipos).toEqual(['Andamento', 'Andamento', 'Evento realizado', 'Prazo realizado', 'Tarefa realizada']);
    expect(extraido.atividades.find((a) => a.tipo === 'Prazo realizado')!.descricao).toBe('Apresentar impugnação de crédito - Realizado: protocolada impugnação');
  });

  test('prévia devolve o PDF de 4 páginas e os números', async () => {
    const r = await chamar('adm@nga.adv.br', 'POST', `/api/projetos/${projeto}/gerador-lab/previa`, { periodicidade: 'mensal', inicio: '2026-10-01' });
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('application/pdf');
    const resumo = JSON.parse(decodeURIComponent(r.headers.get('x-nga-resumo')!));
    expect(resumo).toMatchObject({ registros: 5, movimentados: 1, ativos: 1, valorCausas: 1500000, pecas: 1, porTipo: { tarefas: 1, prazos: 1, andamentos: 2, historicos: 0, eventos: 1 } });
    const pdf = new Uint8Array(await r.arrayBuffer());
    const doc = await getDocumentProxy(pdf.slice()); expect(doc.numPages).toBe(4);
    expect(await textoDoPdf(pdf)).toContain('ACME INDÚSTRIA LTDA');
  });

  test('emite, guarda no acervo do projeto e lista', async () => {
    const r = await chamar('adm@nga.adv.br', 'POST', `/api/projetos/${projeto}/gerador-lab/emissoes`, { periodicidade: 'quinzenal', inicio: '2026-10-16' });
    expect(r.status).toBe(201);
    const e = await r.json() as { documentoId: string; resumo: { registros: number } };
    expect(e.resumo.registros).toBe(2);
    const { rows } = await pg.dono.query('SELECT categoria FROM documentos WHERE id = $1', [e.documentoId]);
    expect(rows[0].categoria).toBe('relatorio_gerador');
    const lista = await (await chamar('adm@nga.adv.br', 'GET', `/api/projetos/${projeto}/gerador-lab/emissoes`)).json() as { descricao: string; automatico: boolean }[];
    expect(lista[0]).toMatchObject({ descricao: '2ª quinzena de outubro de 2026', automatico: false });
  });

  test('importar do Astrea: leitor original, auditoria e os mesmos números do teste do Gerador', async () => {
    const f = new FormData();
    f.set('fonte', 'astrea'); f.set('periodicidade', 'mensal'); f.set('inicio', '2026-10-01');
    f.set('arquivo', new File([exportAstrea() as unknown as BlobPart], 'astrea.pdf', { type: 'application/pdf' }));
    const r = await tratar(new Request(`http://x/api/projetos/${projeto}/gerador-lab/previa`, { method: 'POST', headers: { cookie: `nga_sessao=${await entrar('adm@nga.adv.br')}` }, body: f }));
    expect(r.status).toBe(200);
    const resumo = JSON.parse(decodeURIComponent(r.headers.get('x-nga-resumo')!));
    expect(resumo).toMatchObject({ registros: 6, movimentados: 4, ativos: 2, valorCausas: 135000 + 50000 + 11103.86 });
    expect(resumo.avisos).toEqual([]);
    const texto = await textoDoPdf(new Uint8Array(await r.arrayBuffer()));
    expect(texto).toContain('REGISTROS NO ASTREA');   // fonte Astrea: rótulos originais
  });

  test('cliente do portal não acessa', async () => {
    expect((await chamar('cx@cliente.com', 'POST', `/api/projetos/${projeto}/gerador-lab/previa`, { inicio: '2026-10-01' })).status).toBe(403);
  });

  test('agendamento por cliente e rotina sem gerar duas vezes', async () => {
    expect((await chamar('adm@nga.adv.br', 'PUT', `/api/projetos/${projeto}/gerador-lab/agendamento`, { frequencia: 'semanal', dia: 9 })).status).toBe(400);
    const a = await (await chamar('adm@nga.adv.br', 'PUT', `/api/projetos/${projeto}/gerador-lab/agendamento`, { frequencia: 'mensal', dia: 5 })).json() as { proximaEm: string };
    expect(a.proximaEm).toMatch(/^\d{4}-\d{2}-05$/);
    const lista = await (await chamar('adm@nga.adv.br', 'GET', '/api/relatorios/agendamentos')).json() as { projetoId: string; frequencia: string }[];
    expect(lista.find((x) => x.projetoId === projeto)).toMatchObject({ frequencia: 'mensal' });

    await pg.dono.query(`UPDATE relatorio_agendamentos SET proxima_em = '2026-11-05'`);
    const agora = new Date('2026-11-05T12:00:00-03:00');
    const r1 = await g.rotinaRelatorios(banco, dep, { agora });
    expect(r1).toEqual({ gerados: 1, erros: [] });
    const r2 = await g.rotinaRelatorios(banco, dep, { agora });
    expect(r2.gerados).toBe(0);
    const { rows: [ag] } = await pg.dono.query(`SELECT proxima_em::text AS p, ultimo_erro FROM relatorio_agendamentos WHERE projeto_id = $1`, [projeto]);
    expect(ag).toEqual({ p: '2026-12-05', ultimo_erro: null });
    const { rows: [em] } = await pg.dono.query(`SELECT periodo_inicio::text AS i, agendamento_id IS NOT NULL AS auto, (resumo->>'registros')::int AS n FROM relatorio_emissoes WHERE projeto_id = $1 ORDER BY gerado_em DESC LIMIT 1`, [projeto]);
    expect(em).toEqual({ i: '2026-10-01', auto: true, n: 5 });
    expect((await chamar('adm@nga.adv.br', 'DELETE', `/api/projetos/${projeto}/gerador-lab/agendamento`)).status).toBe(200);
  });
});
