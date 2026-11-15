/**
 * Gerador de Relatórios DENTRO do LAB (pedido de 15/11/2026, item 12).
 *
 * Não é uma imitação do Gerador: é o MESMO motor (leitor, núcleo de classificação/indicadores e desenho do PDF em
 * jsPDF), recortado do `gerador.html` por `scripts/motor-gerador.ts`. O que muda é a entrada. O Gerador lê o PDF de
 * fichas exportado do Astrea; aqui a mesma estrutura que o leitor do Astrea entrega (fichas de processo + registros
 * do histórico) é montada a partir das tabelas do LAB:
 *
 *   Ficha do processo (cabeçalho)   ← processos (+ astrea_registros, quando o processo veio da carteira do Astrea)
 *   "Andamento"                     ← movimentacoes do DataJud / DJEN
 *   "Histórico manual"              ← movimentacoes manuais ou importadas do Astrea; projeto_historicos (como caso)
 *   "Prazo realizado"               ← prazos cumpridos ("<prazo> - Realizado: <observação>", formato do Astrea)
 *   "Tarefa realizada"              ← tarefas concluídas
 *   "Evento realizado"              ← reuniões passadas da agenda (google_eventos) e atas
 *   "Audiência realizada"           ← eventos da agenda marcados como audiência
 *   Tarefas futuras                 ← prazos em aberto e tarefas não concluídas
 *
 * Publicações não entram como registro: no Astrea elas também não aparecem no histórico da ficha; o que a equipe
 * fez com elas aparece como prazo cumprido. A opção de importar do Astrea continua: o PDF de fichas é lido pelo
 * leitor original (com a auditoria P51/P52) e segue pelo mesmo caminho.
 */
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { getDocumentProxy } from 'unpdf';
import type { Banco } from '../store/conexao.ts';
import { auditar } from '../store/conexao.ts';
import type { Identidade } from '../security/sessao.ts';
import { NaoEncontrado, PedidoInvalido } from './erros.ts';
import { receber, type Deposito } from './arquivos.ts';
import { criarMotor, ORIGEM_SHA256 } from '../relatorio/motor_gerador.gen.js';

// ------------------------------------------------------------------ períodos ---
export type Periodicidade = 'mensal' | 'quinzenal' | 'semanal';
export interface Periodo { periodicidade: Periodicidade; inicio: string; fim: string; rotulo: string | null; descricao: string }

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const iso = (d: Date) => d.toISOString().slice(0, 10);
const dia = (s: string) => new Date(`${s}T00:00:00Z`);
const mais = (s: string, n: number) => { const d = dia(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const ultimoDia = (a: number, m: number) => new Date(Date.UTC(a, m, 0)).getUTCDate();
const br = (s: string) => s.split('-').reverse().join('/');
const brCurto = (s: string) => br(s).slice(0, 5);
/** Hoje em São Paulo, AAAA-MM-DD. */
export const hojeSP = (agora = new Date()) => agora.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });

/** O período que começa em `inicio` (normalizado: mês inteiro, quinzena 1–15/16–fim, semana de segunda a domingo). */
export function periodo(periodicidade: Periodicidade, inicio: string): Periodo {
  const [a, m, d] = inicio.split('-').map(Number) as [number, number, number];
  const mesTxt = `${MESES[m - 1]} de ${a}`;
  if (periodicidade === 'mensal') {
    const i = `${a}-${String(m).padStart(2, '0')}-01`;
    return { periodicidade, inicio: i, fim: `${i.slice(0, 8)}${ultimoDia(a, m)}`, rotulo: null, descricao: mesTxt[0]!.toUpperCase() + mesTxt.slice(1) };
  }
  if (periodicidade === 'quinzenal') {
    const primeira = d <= 15; const base = `${a}-${String(m).padStart(2, '0')}-`;
    const rotulo = `${primeira ? '1ª' : '2ª'} quinzena de ${mesTxt}`;
    return { periodicidade, inicio: base + (primeira ? '01' : '16'), fim: base + (primeira ? '15' : String(ultimoDia(a, m))), rotulo, descricao: rotulo[0]!.toUpperCase() + rotulo.slice(1) };
  }
  const semana = dia(inicio).getUTCDay(); const seg = mais(inicio, -((semana + 6) % 7)); const dom = mais(seg, 6);
  const rotulo = `Semana de ${brCurto(seg)} a ${br(dom)}`;
  return { periodicidade, inicio: seg, fim: dom, rotulo, descricao: rotulo };
}

/** O último período FECHADO em `hoje` (o que a rotina gera). */
export function periodoFechado(periodicidade: Periodicidade, hoje: string): Periodo {
  if (periodicidade === 'mensal') return periodo('mensal', mais(`${hoje.slice(0, 8)}01`, -1));
  if (periodicidade === 'quinzenal') return Number(hoje.slice(8)) >= 16 ? periodo('quinzenal', `${hoje.slice(0, 8)}01`) : periodo('quinzenal', mais(`${hoje.slice(0, 8)}01`, -1));
  return periodo('semanal', mais(hoje, -7));
}

/** Próxima data de geração estritamente depois de `depoisDe`. */
export function proximaGeracao(frequencia: Periodicidade, diaRegra: number, depoisDe: string): string {
  let d = mais(depoisDe, 1);
  for (let i = 0; i < 40; i++, d = mais(d, 1)) {
    const n = Number(d.slice(8)); const semana = ((dia(d).getUTCDay() + 6) % 7) + 1;
    if (frequencia === 'mensal' && n === diaRegra) return d;
    if (frequencia === 'quinzenal' && (n === 1 || n === 16)) return d;
    if (frequencia === 'semanal' && semana === diaRegra) return d;
  }
  throw new Error('regra de agendamento sem próxima data');
}

/** Rótulos FIXOS do PDF trocados pelo gancho L1 (o texto dos registros nunca muda). */
export function rotulosDoLab(periodicidade: Periodicidade, fonte: 'lab' | 'astrea') {
  const t: Record<string, string> = {};
  if (fonte === 'lab') {
    t['Este panorama resume os registros do Astrea (lançamentos do período, inclusive movimentações do tribunal) e o alcance da atuação sobre a carteira do cliente.'] =
      'Este panorama resume os registros do LAB (andamentos do DataJud, prazos, tarefas, reuniões e históricos do período) e o alcance da atuação sobre a carteira do cliente.';
    t['registros no Astrea'] = 'registros no LAB';
    t['Registros por tipo no Astrea'] = 'Registros por tipo no LAB';
    t['Atividades do escritório por dia (a soma das barras é o total de atividades). Vale a data do fato quando o registro a narra; nos demais casos, a de lançamento no Astrea.'] =
      'Atividades do escritório por dia (a soma das barras é o total de atividades). Vale a data do fato quando o registro a narra; nos demais casos, a de lançamento no LAB.';
  }
  const curto = periodicidade === 'quinzenal' ? { na: 'NA QUINZENA', a: 'A quinzena', no: 'na quinzena', deste: 'desta quinzena', tit: 'QUINZENAL' }
    : periodicidade === 'semanal' ? { na: 'NA SEMANA', a: 'A semana', no: 'na semana', deste: 'desta semana', tit: 'SEMANAL' } : null;
  if (curto) {
    t['RELATÓRIO MENSAL DE ATUAÇÃO JURÍDICA'] = `RELATÓRIO ${curto.tit} DE ATUAÇÃO JURÍDICA`;
    t['ATIVIDADES DO ESCRITÓRIO NO MÊS'] = `ATIVIDADES DO ESCRITÓRIO ${curto.na}`;
    t['O mês em números'] = `${curto.a} em números`;
    t['Ritmo de atuação no mês'] = `Ritmo de atuação ${curto.no}`;
    t['Nenhum ato do escritório deste mês foi classificado em uma frente específica; todos ficaram em Outros.'] = `Nenhum ato do escritório ${curto.deste} foi classificado em uma frente específica; todos ficaram em Outros.`;
  }
  for (const [de, para] of Object.entries(t)) t[de.toUpperCase()] = para.toUpperCase();   // cartões escrevem o rótulo em caixa-alta
  return (texto: string) => t[texto] ?? (curto && texto.startsWith('Peças protocoladas no mês:') ? texto.replace('no mês', curto.no) : texto);
}

// -------------------------------------------------------- extração do LAB ---
export interface FichaProcesso {
  numero_processo: string; cliente: string | null; cliente_carteira?: string | null; envolvidos: string | null; titulo: string | null; juizo: string | null; acao: string | null;
  advogado: string | null; distribuicao: string | null; criado_em: string | null; pasta: string | null; valor_causa: string | null; valor_condenacao: string | null;
  status: string | null; equipe: string | null; fase: string | null; sistema_judicial: string | null;
}
export interface Registro { numero_processo: string | null; data: string; data_narrada: string | null; descricao: string; tipo: string; ficha?: number; caso?: string; caso_idx?: number; administrativo?: boolean }
export interface Extraido {
  processos: FichaProcesso[]; atividades: Registro[]; tarefasFuturas: { numero_processo: string | null; data: string | null; descricao: string; tipo: string; responsavel: string | null }[];
  casosAdministrativos: { titulo: string; valor_causa: string | null; status: string | null; fase: string | null; _idx: number }[]; atividadesAdministrativas: Registro[];
  naoClassificados: unknown[]; baseCasos?: boolean; avisos?: string[];
}

const dataAstrea = (s: string) => br(s.slice(0, 10));
const reais = (centavos: string | number | null) => {
  if (centavos === null || centavos === undefined || centavos === '') return null;
  return `R$ ${(Number(centavos) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const narrada = (t: string) => /^No dia\s+(\d{2}\/\d{2}\/\d{4})\b/i.exec(t.trim())?.[1] ?? null;
const juntar = (...partes: (string | null | undefined)[]) => partes.map((p) => (p ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean).join(' - ');
const EMPRESARIAL = new Set(['recuperacao_judicial', 'recuperacao_extrajudicial', 'falencia', 'reestruturacao', 'negociacao_credores']);

/** Dados do projeto no formato que o leitor do Astrea entrega ao motor. Lê 13 meses antes do período (P53 e confronto de peças). */
export async function extrairDoLab(db: PoolClient, projetoId: string, inicio: string, fim: string): Promise<{ cliente: string; extraido: Extraido }> {
  const { rows: [p] } = await db.query<{ nome: string; tipo: string; fase: string | null; situacao: string; responsavel: string | null; cliente: string | null; resumo: string | null }>(
    `SELECT p.nome, p.tipo, p.fase, p.situacao, p.resumo, (SELECT u.nome FROM usuarios u WHERE u.id = p.responsavel_id) AS responsavel,
            (SELECT coalesce(e.razao_social, e.nome_fantasia) FROM projetos_empresas pe JOIN empresas e ON e.id = pe.empresa_id WHERE pe.projeto_id = p.id ORDER BY pe.papel LIMIT 1) AS cliente
       FROM projetos p WHERE p.id = $1`, [projetoId]);
  if (!p) throw new NaoEncontrado('projeto não encontrado');
  const desde = mais(`${inicio.slice(0, 8)}01`, -396);
  const cliente = p.cliente ?? p.nome;
  const equipePadrao = EMPRESARIAL.has(p.tipo) ? 'Empresarial' : 'Cível';

  const { rows: procs } = await db.query<{ id: string; numero: string; classe: string | null; assunto: string | null; juizo: string | null; orgao: string | null; tribunal: string | null; valor: string | null; distribuido: string | null; situacao: string; criado: string;
    a_responsavel: string | null; a_equipe: string | null; a_fase: string | null; a_pasta: string | null; a_titulo: string | null; a_envolvidos: string | null; a_acao: string | null; a_valor: string | null }>(
    `SELECT pr.id, pr.numero, pr.classe, pr.assunto, pr.juizo, pr.orgao_julgador AS orgao, pr.tribunal, pr.valor_causa::text AS valor, pr.distribuido_em::text AS distribuido, pr.situacao, pr.criado_em::date::text AS criado,
            a.responsavel AS a_responsavel, a.equipe AS a_equipe, a.fase AS a_fase, a.pasta AS a_pasta, a.titulo AS a_titulo, a.outros_envolvidos AS a_envolvidos, a.acao AS a_acao, a.valor_causa::text AS a_valor
       FROM processos pr LEFT JOIN LATERAL (SELECT * FROM astrea_registros r WHERE r.processo_id = pr.id ORDER BY r.importado_em DESC LIMIT 1) a ON TRUE
      WHERE pr.projeto_id = $1 ORDER BY pr.distribuido_em NULLS LAST, pr.numero`, [projetoId]);
  const arquivado = (s: string) => ['arquivado', 'baixado', 'extinto'].includes(s);
  const processos: FichaProcesso[] = procs.map((x) => ({
    numero_processo: x.numero, cliente, cliente_carteira: cliente, envolvidos: x.a_envolvidos, titulo: x.a_titulo ?? x.assunto ?? x.classe,
    juizo: x.juizo ?? x.orgao ?? x.tribunal, acao: x.a_acao ?? x.classe, advogado: x.a_responsavel ?? p.responsavel, distribuicao: x.distribuido ? dataAstrea(x.distribuido) : null,
    criado_em: dataAstrea(x.criado), pasta: x.a_pasta, valor_causa: reais(x.valor ?? x.a_valor), valor_condenacao: null,
    status: arquivado(x.situacao) ? 'Inativo' : 'Ativo', equipe: x.a_equipe ?? equipePadrao, fase: arquivado(x.situacao) ? 'ARQUIVADO' : (x.a_fase ?? p.fase), sistema_judicial: x.tribunal,
  }));
  const numeroDe = new Map(procs.map((x) => [x.id, x.numero]));
  // Cada processo é uma "ficha" (o motor conta fichas movimentadas pelo índice, como no leitor do Astrea, P44c).
  const fichaDe = new Map(procs.map((x, i) => [x.numero, i]));

  const atividades: Registro[] = [];
  const reg = (numero: string | null, data: string, tipo: string, descricao: string) => {
    const d = descricao.replace(/\s+/g, ' ').trim(); if (!d) return;
    atividades.push({ numero_processo: numero, data: dataAstrea(data), data_narrada: narrada(d), descricao: d, tipo, ...(numero !== null && fichaDe.has(numero) ? { ficha: fichaDe.get(numero)! } : {}) });
  };
  const { rows: movs } = await db.query<{ processo_id: string; data: string; titulo: string; conteudo: string | null; fonte: string }>(
    `SELECT m.processo_id, m.data::text, m.titulo, m.conteudo, m.fonte FROM movimentacoes m JOIN processos pr ON pr.id = m.processo_id
      WHERE pr.projeto_id = $1 AND m.data BETWEEN $2 AND $3 ORDER BY m.data, m.criado_em`, [projetoId, desde, fim]);
  for (const m of movs) reg(numeroDe.get(m.processo_id) ?? null, m.data, m.fonte === 'datajud' || m.fonte === 'djen' ? 'Andamento' : 'Histórico manual', juntar(m.titulo, m.conteudo));

  const { rows: prazos } = await db.query<{ processo_id: string; titulo: string; tipo: string | null; cumprido: string; observacao: string | null }>(
    `SELECT z.processo_id, z.titulo, z.tipo, (z.cumprido_em AT TIME ZONE 'America/Sao_Paulo')::date::text AS cumprido, z.observacao FROM prazos z JOIN processos pr ON pr.id = z.processo_id
      WHERE pr.projeto_id = $1 AND z.situacao = 'cumprido' AND (z.cumprido_em AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN $2 AND $3 ORDER BY z.cumprido_em`, [projetoId, desde, fim]);
  // Formato do Astrea: "<tipo do prazo> - <prazo> - Realizado: <o que foi feito>". Sem observação, o núcleo deixa o
  // desfecho "a confirmar" (não vira peça protocolada), exatamente como no Astrea.
  for (const z of prazos) reg(numeroDe.get(z.processo_id) ?? null, z.cumprido, 'Prazo realizado', `${juntar(z.tipo, z.titulo)} - Realizado: ${(z.observacao ?? '').trim()}`);

  // Registros sem processo (tarefas, reuniões, atas, históricos do projeto): com um único processo, ficam nele; sem
  // processo ou com vários, o projeto vira um "caso" (o mesmo tratamento da Ficha do caso do Astrea, P40).
  const casosAdministrativos: Extraido['casosAdministrativos'] = [];
  const atividadesAdministrativas: Registro[] = [];
  const unico = procs.length === 1 ? procs[0]!.numero : null;
  const regProjeto = (data: string, tipo: string, descricao: string) => {
    if (unico) return reg(unico, data, tipo, descricao);
    if (!casosAdministrativos.length) casosAdministrativos.push({ titulo: p.nome, valor_causa: null, status: p.situacao === 'encerrado' ? 'Inativo' : 'Ativo', fase: p.fase, _idx: 0 });
    const d = descricao.replace(/\s+/g, ' ').trim(); if (!d) return;
    atividadesAdministrativas.push({ numero_processo: null, caso: p.nome, caso_idx: 0, ficha: procs.length, administrativo: true, data: dataAstrea(data), data_narrada: narrada(d), descricao: d, tipo });
  };
  const { rows: tarefas } = await db.query<{ titulo: string; descricao: string | null; concluida: string }>(
    `SELECT titulo, descricao, (concluida_em AT TIME ZONE 'America/Sao_Paulo')::date::text AS concluida FROM tarefas
      WHERE projeto_id = $1 AND status = 'concluida' AND (concluida_em AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN $2 AND $3 ORDER BY concluida_em`, [projetoId, desde, fim]);
  for (const t of tarefas) regProjeto(t.concluida, 'Tarefa realizada', juntar(t.titulo, t.descricao));
  const { rows: hist } = await db.query<{ data: string; titulo: string; texto: string | null }>(
    'SELECT data::text, titulo, texto FROM projeto_historicos WHERE projeto_id = $1 AND data BETWEEN $2 AND $3 ORDER BY data, criado_em', [projetoId, desde, fim]);
  for (const h of hist) regProjeto(h.data, 'Histórico manual', juntar(h.titulo, h.texto));
  const { rows: atas } = await db.query<{ titulo: string; realizada: string; decisoes: string }>(
    'SELECT titulo, realizada_em::text AS realizada, decisoes FROM atas WHERE projeto_id = $1 AND realizada_em BETWEEN $2 AND $3 ORDER BY realizada_em', [projetoId, desde, fim]);
  const { rows: eventos } = await db.query<{ titulo: string; dia: string; marcador: string; descricao: string }>(
    `SELECT titulo, (inicio AT TIME ZONE 'America/Sao_Paulo')::date::text AS dia, marcador, descricao FROM google_eventos
      WHERE projeto_id = $1 AND marcador IN ('reuniao', 'cliente', 'interno', 'audiencia') AND fim <= now() AND (inicio AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN $2 AND $3 ORDER BY inicio`, [projetoId, desde, fim]);
  const chave = (t: string, d: string) => `${d}|${t.trim().toLowerCase()}`;
  const comAta = new Set(atas.map((a) => chave(a.titulo, a.realizada)));
  for (const a of atas) regProjeto(a.realizada, 'Evento realizado', juntar(`Reunião realizada: ${a.titulo}`, a.decisoes ? `Decisões: ${a.decisoes}` : null));
  for (const e of eventos) if (!comAta.has(chave(e.titulo, e.dia))) regProjeto(e.dia, e.marcador === 'audiencia' ? 'Audiência realizada' : 'Evento realizado', e.marcador === 'audiencia' ? e.titulo : `Reunião realizada: ${e.titulo}`);

  const { rows: futuras } = await db.query<{ numero: string | null; data: string | null; descricao: string; tipo: string; responsavel: string | null }>(
    `SELECT pr.numero, z.vencimento::text AS data, z.titulo AS descricao, 'Prazo' AS tipo, u.nome AS responsavel FROM prazos z JOIN processos pr ON pr.id = z.processo_id LEFT JOIN usuarios u ON u.id = z.responsavel_id
      WHERE pr.projeto_id = $1 AND z.situacao = 'aberto'
     UNION ALL
     SELECT NULL, t.prazo::text, t.titulo, 'Tarefa', u.nome FROM tarefas t LEFT JOIN usuarios u ON u.id = t.responsavel_id WHERE t.projeto_id = $1 AND t.status <> 'concluida'
     ORDER BY 2 NULLS LAST LIMIT 200`, [projetoId]);
  const tarefasFuturas = futuras.map((f) => ({ numero_processo: f.numero, data: f.data ? dataAstrea(f.data) : null, descricao: f.descricao, tipo: f.tipo, responsavel: f.responsavel }));

  return { cliente, extraido: { processos, atividades, tarefasFuturas, casosAdministrativos, atividadesAdministrativas, naoClassificados: [], baseCasos: !processos.length && casosAdministrativos.length > 0 } };
}

// ---------------------------------------------------------------- motor ---
type Motor = ReturnType<typeof criarMotor>;
let motorUnico: Motor | null = null;
const motor = () => (motorUnico ??= criarMotor());
const dataUTC = (s: string) => new Date(`${s}T00:00:00Z`);

export interface Calculo { indicadores: Record<string, any>; atividadesClassificadas: unknown[]; periodo: Periodo; avisos: string[] }

/** Indicadores pelo núcleo do Gerador, com o P53 (mês sem registro repete o último mês com dados, avisando). */
export async function calcular(extraido: Extraido, per: Periodo, fonte: 'lab' | 'astrea', pdfAstrea?: unknown): Promise<Calculo> {
  const m = motor();
  m.window.NGA_BASE_CASOS = !!extraido.baseCasos;
  const regras: unknown[] & { destaquesComite?: boolean } = []; regras.destaquesComite = false;
  const rodar = (i: string, f: string) => m.calcularIndicadores(extraido.processos, extraido.atividades, dataUTC(i), dataUTC(f), regras, extraido.atividadesAdministrativas, extraido.casosAdministrativos);
  const auditar = async (c: any, i: string, f: string) => (pdfAstrea ? m.auditarGeracao(pdfAstrea, extraido, c, dataUTC(i), dataUTC(f), () => rodar(i, f)) : c);
  let periodoUsado = per;
  let c = await auditar(rodar(per.inicio, per.fim), per.inicio, per.fim);
  const avisos: string[] = [...(extraido.avisos ?? [])];
  if (!c?.indicadores?.quantidade_total_atividades_periodo && per.periodicidade === 'mensal') {
    let ultima = '';
    for (const a of [...extraido.atividades, ...extraido.atividadesAdministrativas]) {
      const d = a.data.split('/').reverse().join('-'); if (d < per.inicio && d > ultima) ultima = d;
    }
    if (ultima) {
      const p2 = periodo('mensal', ultima);
      const c2 = await auditar(rodar(p2.inicio, p2.fim), p2.inicio, p2.fim);
      if (c2?.indicadores?.quantidade_total_atividades_periodo) {
        const aviso = `Não houve atualização no ${fonte === 'lab' ? 'LAB' : 'Astrea'} em ${per.descricao.toLowerCase()} (último registro em ${br(ultima)}). Os números deste relatório repetem ${p2.descricao.toLowerCase()}, o último mês com registros.`;
        c = c2; periodoUsado = p2;
        c.indicadores.aviso_periodo = aviso;
        c.indicadores.avisos_metricas = [aviso, ...(c.indicadores.avisos_metricas ?? [])];
      }
    }
  }
  if (!c?.indicadores?.quantidade_total_atividades_periodo) avisos.push(`Nenhum registro no período (${periodoUsado.descricao.toLowerCase()}).`);
  if (periodoUsado.rotulo) c.indicadores.periodo = { ...c.indicadores.periodo, rotulo: periodoUsado.rotulo };
  return { indicadores: c.indicadores, atividadesClassificadas: c.atividadesClassificadas, periodo: periodoUsado, avisos: [...avisos, ...(c.indicadores.avisos_metricas ?? [])] };
}

/** O PDF do modelo Quantitativo do Gerador (4 páginas), byte a byte o mesmo desenho. */
export function desenharPdf(cliente: string, calc: Calculo, fonte: 'lab' | 'astrea'): Uint8Array {
  const m = motor();
  m.window.NGA_ROTULOS_LAB = rotulosDoLab(calc.periodo.periodicidade, fonte);
  try {
    const doc = new m.GeradorRelatorioPDF().gerar(cliente, calc.indicadores, calc.atividadesClassificadas);
    return new Uint8Array(doc.output('arraybuffer'));
  } finally { m.window.NGA_ROTULOS_LAB = undefined; }
}

/** Export de fichas do Astrea, lido pelo leitor original do Gerador. */
export async function extrairDoAstrea(bytes: Uint8Array): Promise<{ extraido: Extraido; pdf: unknown; cliente: string | null }> {
  if (new TextDecoder('latin1').decode(bytes.subarray(0, 5)) !== '%PDF-') throw new PedidoInvalido('o arquivo não é um PDF');
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const extraido = await motor().parseAstreaPDF(pdf) as Extraido & { processos: (FichaProcesso & { cliente_carteira?: string })[] };
  if (!extraido.processos.length && !extraido.casosAdministrativos.length) throw new PedidoInvalido('nenhuma ficha do processo ou do caso encontrada: carregue o PDF de fichas exportado do Astrea');
  const freq = new Map<string, number>();
  for (const p of extraido.processos) { const c = (p.cliente_carteira ?? '').replace(/\s+/g, ' ').trim(); if (c) freq.set(c, (freq.get(c) ?? 0) + 1); }
  const cliente = [...freq].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return { extraido, pdf, cliente };
}

// ------------------------------------------------------- emissão e guarda ---
export const EsquemaPedido = z.object({
  periodicidade: z.enum(['mensal', 'quinzenal', 'semanal']).default('mensal'),
  inicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'informe o início como AAAA-MM-DD'),
  fonte: z.enum(['lab', 'astrea']).default('lab'),
});
export type Pedido = z.infer<typeof EsquemaPedido>;

const resumoDe = (i: Record<string, any>) => ({
  registros: i.quantidade_total_atividades_periodo ?? 0, movimentados: i.quantidade_processos_movimentados ?? 0, ativos: i.processos_ativos ?? null,
  atuacao: i.quantidade_atuacao_escritorio ?? null, valorCausas: i.valor_total_causa ?? 0, pecas: i.quantidade_pecas_protocoladas ?? null,
  porTipo: { tarefas: i.quantidade_tarefas_realizadas ?? 0, prazos: i.quantidade_prazos_realizados ?? 0, andamentos: i.quantidade_andamentos ?? 0, historicos: i.quantidade_historicos_manuais ?? 0, eventos: i.quantidade_eventos_realizados ?? 0 },
});
const nomeArquivo = (cliente: string, per: Periodo) => `Relatorio ${per.periodicidade} ${cliente.replace(/[^\p{L}\p{N} ]+/gu, '').trim().slice(0, 60)} ${per.inicio}.pdf`.replace(/\s+/g, '-');

/** Monta o relatório (sem guardar): usado pela prévia e pela emissão. */
export async function montar(db: PoolClient, projetoId: string, pedido: Pedido, astrea?: Uint8Array) {
  const per = periodo(pedido.periodicidade, pedido.inicio);
  let cliente: string; let extraido: Extraido; let pdfAstrea: unknown;
  const { cliente: doLab, extraido: lab } = await extrairDoLab(db, projetoId, per.inicio, per.fim);
  if (pedido.fonte === 'astrea') {
    if (!astrea) throw new PedidoInvalido('envie o PDF de fichas exportado do Astrea');
    const lido = await extrairDoAstrea(astrea); extraido = lido.extraido; pdfAstrea = lido.pdf; cliente = doLab;
  } else { extraido = lab; cliente = doLab; }
  const calc = await calcular(extraido, per, pedido.fonte, pdfAstrea);
  const pdf = desenharPdf(cliente, calc, pedido.fonte);
  return { cliente, calc, pdf, nome: nomeArquivo(cliente, calc.periodo), resumo: resumoDe(calc.indicadores) };
}

export async function emitir(db: PoolClient, projetoId: string, pedido: Pedido, identidade: Identidade, dep: Deposito, opcoes: { agendamentoId?: string; astrea?: Uint8Array } = {}) {
  const { rows: [pj] } = await db.query<{ organizacao_id: string; nome: string }>('SELECT organizacao_id, nome FROM projetos WHERE id = $1', [projetoId]);
  if (!pj) throw new NaoEncontrado('projeto não encontrado');
  const r = await montar(db, projetoId, pedido, opcoes.astrea);
  const titulo = `Relatório de atuação jurídica · ${r.calc.periodo.descricao}${pedido.fonte === 'astrea' ? ' · Astrea' : ''}`;
  const guardado = await receber(db, projetoId, new File([r.pdf as unknown as BlobPart], r.nome, { type: 'application/pdf' }), { titulo, categoria: 'relatorio_gerador' }, identidade, dep, 'interno');
  const { rows: [em] } = await db.query<{ id: string }>(
    `INSERT INTO relatorio_emissoes (organizacao_id, projeto_id, agendamento_id, modelo, fonte, periodicidade, periodo_inicio, periodo_fim, documento_id, resumo, avisos, motor_sha256, gerado_por)
     VALUES ($1,$2,$3,'quantitativo',$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
    [pj.organizacao_id, projetoId, opcoes.agendamentoId ?? null, pedido.fonte, r.calc.periodo.periodicidade, r.calc.periodo.inicio, r.calc.periodo.fim, guardado.documentoId, JSON.stringify(r.resumo), r.calc.avisos, ORIGEM_SHA256, identidade.usuarioId]);
  await auditar(db, { organizacaoId: pj.organizacao_id, usuarioId: identidade.usuarioId, acao: opcoes.agendamentoId ? 'relatorio.gerado_pela_rotina' : 'relatorio.gerado_no_lab', entidade: 'documento', entidadeId: guardado.documentoId,
    depois: { emissao: em!.id, projeto: pj.nome, periodo: [r.calc.periodo.inicio, r.calc.periodo.fim], fonte: pedido.fonte, registros: r.resumo.registros } });
  return { emissaoId: em!.id, documentoId: guardado.documentoId, titulo, periodo: r.calc.periodo, resumo: r.resumo, avisos: r.calc.avisos };
}

export async function emissoes(db: PoolClient, projetoId: string) {
  const { rows } = await db.query(`SELECT e.id, e.fonte, e.periodicidade, e.periodo_inicio::text AS inicio, e.periodo_fim::text AS fim, e.documento_id AS "documentoId", e.resumo, e.avisos,
      e.agendamento_id IS NOT NULL AS automatico, e.gerado_em AS "geradoEm", u.nome AS por FROM relatorio_emissoes e LEFT JOIN usuarios u ON u.id = e.gerado_por
     WHERE e.projeto_id = $1 ORDER BY e.gerado_em DESC LIMIT 60`, [projetoId]);
  return rows.map((r) => ({ ...r, descricao: periodo(r.periodicidade, r.inicio).descricao }));
}

// ---------------------------------------------------------- agendamento ---
export const EsquemaAgendamento = z.object({
  frequencia: z.enum(['mensal', 'quinzenal', 'semanal']),
  dia: z.number().int().min(1).max(28).default(1),
  ativo: z.boolean().default(true),
}).refine((a) => a.frequencia !== 'semanal' || a.dia <= 7, { message: 'na frequência semanal, o dia vai de 1 (segunda) a 7 (domingo)', path: ['dia'] });

export async function agendamentos(db: PoolClient) {
  const { rows } = await db.query(`SELECT p.id AS "projetoId", p.nome AS projeto, a.id, a.frequencia, a.dia, a.ativo, a.proxima_em::text AS "proximaEm", a.ultima_em AS "ultimaEm", a.ultimo_erro AS "ultimoErro",
      (SELECT max(e.gerado_em) FROM relatorio_emissoes e WHERE e.projeto_id = p.id) AS "ultimaEmissao"
     FROM projetos p LEFT JOIN relatorio_agendamentos a ON a.projeto_id = p.id WHERE p.situacao <> 'encerrado' ORDER BY a.id IS NULL, p.nome`);
  return rows;
}

export async function salvarAgendamento(db: PoolClient, projetoId: string, dados: z.infer<typeof EsquemaAgendamento>, identidade: Identidade, hoje = hojeSP()) {
  const { rows: [pj] } = await db.query<{ organizacao_id: string; nome: string }>('SELECT organizacao_id, nome FROM projetos WHERE id = $1', [projetoId]);
  if (!pj) throw new NaoEncontrado('projeto não encontrado');
  const proxima = proximaGeracao(dados.frequencia, dados.dia, mais(hoje, -1));
  const { rows: [a] } = await db.query(
    `INSERT INTO relatorio_agendamentos (organizacao_id, projeto_id, frequencia, dia, ativo, proxima_em, criado_por) VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (projeto_id) DO UPDATE SET frequencia = EXCLUDED.frequencia, dia = EXCLUDED.dia, ativo = EXCLUDED.ativo, proxima_em = EXCLUDED.proxima_em,
       criado_por = EXCLUDED.criado_por, ultimo_erro = NULL, atualizado_em = now()
     RETURNING id, frequencia, dia, ativo, proxima_em::text AS "proximaEm"`,
    [pj.organizacao_id, projetoId, dados.frequencia, dados.dia, dados.ativo, proxima, identidade.usuarioId]);
  await auditar(db, { organizacaoId: pj.organizacao_id, usuarioId: identidade.usuarioId, acao: 'relatorio.agendamento_salvo', entidade: 'projeto', entidadeId: projetoId, depois: { ...dados, proxima } });
  return a;
}

export async function removerAgendamento(db: PoolClient, projetoId: string, identidade: Identidade) {
  const { rows: [a] } = await db.query<{ organizacao_id: string }>('DELETE FROM relatorio_agendamentos WHERE projeto_id = $1 RETURNING organizacao_id', [projetoId]);
  if (!a) throw new NaoEncontrado('este projeto não tem agendamento');
  await auditar(db, { organizacaoId: a.organizacao_id, usuarioId: identidade.usuarioId, acao: 'relatorio.agendamento_removido', entidade: 'projeto', entidadeId: projetoId });
  return { ok: true };
}

/** Rotina agendada (sem sessão): gera o que venceu, agindo como quem agendou (RLS valendo). */
export async function rotinaRelatorios(banco: Banco, dep: Deposito, opcoes: { agora?: Date; limite?: number } = {}) {
  const hoje = hojeSP(opcoes.agora);
  const reservados = await banco.semContexto(async (db) => (await db.query<{ id: string; projeto_id: string; usuario_id: string }>('SELECT * FROM relatorio_agendamentos_reservar($1)', [opcoes.limite ?? 10])).rows);
  const feitos: string[] = []; const erros: string[] = [];
  for (const r of reservados) {
    try {
      await banco.comoUsuario(r.usuario_id, async (db) => {
        const { rows: [u] } = await db.query<{ nome: string; email: string }>('SELECT nome, email FROM usuarios WHERE id = $1', [r.usuario_id]);
        const { rows: [a] } = await db.query<{ frequencia: Periodicidade; dia: number }>('SELECT frequencia, dia FROM relatorio_agendamentos WHERE id = $1', [r.id]);
        if (!a) throw new NaoEncontrado('agendamento fora do alcance de quem agendou');
        const per = periodoFechado(a.frequencia, hoje);
        const identidade: Identidade = { usuarioId: r.usuario_id, nome: u?.nome ?? 'Rotina', email: u?.email ?? '', papeis: [], organizacoes: [] };
        await emitir(db, r.projeto_id, { periodicidade: a.frequencia, inicio: per.inicio, fonte: 'lab' }, identidade, dep, { agendamentoId: r.id });
        await db.query('UPDATE relatorio_agendamentos SET proxima_em = $2, ultimo_erro = NULL, atualizado_em = now() WHERE id = $1', [r.id, proximaGeracao(a.frequencia, a.dia, hoje)]);
      });
      feitos.push(r.projeto_id);
    } catch (e) {
      const msg = (e as Error).message; erros.push(msg);
      await banco.semContexto((db) => db.query('SELECT relatorio_agendamento_falhou($1,$2)', [r.id, msg]));
    }
  }
  return { gerados: feitos.length, erros };
}
