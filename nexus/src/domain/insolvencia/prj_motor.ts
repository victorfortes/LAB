/**
 * Motor do PRJ Studio.
 *
 * Determinístico e em centavos (BigInt). O modelo de linguagem nunca calcula
 * nada aqui. Alterar um parâmetro recalcula o cenário sem tocar em dado oficial:
 * a função é pura, recebe tudo e devolve tudo.
 *
 * Regras explícitas, repetidas na memória de cálculo:
 * - primeiro vencimento = marco + carência + uma periodicidade;
 * - a última parcela absorve o resíduo de arredondamento;
 * - correção monetária e juros compõem: (1+j)×(1+c)−1;
 * - índice (TR, IPCA) é premissa informada pelo usuário, nunca presumida.
 */
import type { Centavos } from '../shared/dinheiro.ts';
import { aplicarTaxa } from '../shared/dinheiro.ts';
import { somarMeses, type DataISO } from '../shared/datas.ts';
import { MESES_POR_PERIODO, gerarCronograma, type Periodicidade, type SistemaDeAmortizacao } from './plano.ts';

export type Modalidade = 'parcelas' | 'bullet' | 'escalonado';

export interface CondicaoPrj {
  readonly desagio: number;
  readonly carenciaMeses: number;
  readonly parcelas: number;
  readonly periodicidade: Periodicidade;
  readonly jurosAoAno: number;
  readonly correcaoAoAno: number;
  readonly sistema: SistemaDeAmortizacao;
  readonly capitalizarNaCarencia?: boolean;
  readonly modalidade: Modalidade;
  /** Bullet: fração do valor novado paga na última parcela. */
  readonly bulletPercentual?: number;
  /** Escalonado: fração do valor novado em cada parcela; soma 1. */
  readonly percentuais?: readonly number[];
}

export interface ClassePrj { readonly id: string; readonly rotulo: string; readonly credito: Centavos; readonly condicao: CondicaoPrj }

export interface ParcelaPrj { readonly vencimento: DataISO; readonly juros: Centavos; readonly amortizacao: Centavos; readonly valor: Centavos; readonly saldoFinal: Centavos }

export interface CronogramaClasse {
  readonly id: string; readonly rotulo: string; readonly original: Centavos; readonly novado: Centavos; readonly desagio: Centavos;
  readonly juros: Centavos; readonly total: Centavos; readonly parcelas: readonly ParcelaPrj[];
}

export class ParametroInvalido extends Error { override readonly name = 'ParametroInvalido'; }

export const taxaComposta = (juros: number, correcao: number): number => (1 + juros) * (1 + correcao) - 1;

function porPercentuais(c: ClassePrj, marco: DataISO, percentuais: readonly number[]): CronogramaClasse {
  const k = c.condicao; const meses = MESES_POR_PERIODO[k.periodicidade];
  const soma = percentuais.reduce((a, b) => a + b, 0);
  if (Math.abs(soma - 1) > 1e-6) throw new ParametroInvalido(`os percentuais de ${c.rotulo} somam ${(soma * 100).toFixed(2)}%, e precisam somar 100%`);
  const desagio = aplicarTaxa(c.credito, k.desagio); const novado = c.credito - desagio;
  const anual = taxaComposta(k.jurosAoAno, k.correcaoAoAno); const taxa = anual * (meses / 12);
  let saldo = novado;
  if (k.capitalizarNaCarencia && k.carenciaMeses > 0) saldo += aplicarTaxa(novado, anual * (k.carenciaMeses / 12));
  const base = saldo; const parcelas: ParcelaPrj[] = []; let jurosTotal = 0n; let total = 0n;
  percentuais.forEach((p, i) => {
    const ultima = i === percentuais.length - 1;
    const amortizacao = ultima ? saldo : aplicarTaxa(base, p);
    const juros = aplicarTaxa(saldo, taxa);
    saldo -= amortizacao; jurosTotal += juros; total += amortizacao + juros;
    parcelas.push({ vencimento: somarMeses(marco, k.carenciaMeses + meses * (i + 1)), juros, amortizacao, valor: amortizacao + juros, saldoFinal: saldo });
  });
  return { id: c.id, rotulo: c.rotulo, original: c.credito, novado, desagio, juros: jurosTotal, total, parcelas };
}

export function cronogramaDaClasse(c: ClassePrj, marco: DataISO): CronogramaClasse {
  const k = c.condicao;
  if (k.modalidade === 'escalonado') {
    if (!k.percentuais?.length) throw new ParametroInvalido(`informe os percentuais de ${c.rotulo}`);
    return porPercentuais(c, marco, k.percentuais);
  }
  if (k.modalidade === 'bullet') {
    const b = k.bulletPercentual ?? 1;
    if (!(b > 0 && b <= 1)) throw new ParametroInvalido('o pagamento final deve ficar entre 0% e 100%');
    if (k.parcelas === 1) return porPercentuais(c, marco, [1]);
    if (b === 1) return porPercentuais(c, marco, [...Array(k.parcelas - 1).fill(0), 1]);
    return porPercentuais(c, marco, [...Array(k.parcelas - 1).fill((1 - b) / (k.parcelas - 1)), b]);
  }
  const anual = taxaComposta(k.jurosAoAno, k.correcaoAoAno);
  const sistema: SistemaDeAmortizacao = anual === 0 ? 'sem_juros' : k.sistema === 'sem_juros' ? 'sac' : k.sistema;
  const g = gerarCronograma(c.credito, { desagio: k.desagio, carenciaMeses: k.carenciaMeses, parcelas: k.parcelas, periodicidade: k.periodicidade,
    jurosAoAno: anual, sistema, capitalizarNaCarencia: k.capitalizarNaCarencia ?? false }, marco);
  return { id: c.id, rotulo: c.rotulo, original: g.creditoOriginal, novado: g.valorNovado, desagio: g.desagioAplicado, juros: g.totalJuros, total: g.totalPago,
    parcelas: g.parcelas.map((p) => ({ vencimento: p.vencimento, juros: p.juros, amortizacao: p.amortizacao, valor: p.valor, saldoFinal: p.saldoFinal })) };
}

export interface CaixaBase {
  readonly saldoInicial: Centavos; readonly inicio: DataISO;
  readonly receitaMensal: Centavos; readonly outrasEntradasMensal: Centavos; readonly despesaMensal: Centavos;
  readonly tributosMensal: Centavos; readonly extraconcursalMensal: Centavos; readonly investimentoMensal: Centavos;
  readonly crescimentoReceitaAoMes: number;
}

export interface Estresse {
  readonly receita?: number; readonly despesa?: number; readonly inadimplencia?: number; readonly atrasoDias?: number;
  readonly perdaClienteMensal?: Centavos; readonly perdaClienteMes?: number;
  readonly custoFinanceiroMensal?: Centavos; readonly investimentoExtra?: Centavos; readonly investimentoExtraMes?: number;
}

export interface MesProjetado {
  readonly mes: string; readonly entradas: Centavos; readonly saidas: Centavos; readonly prj: Centavos;
  readonly porClasse: Readonly<Record<string, Centavos>>; readonly saldo: Centavos; readonly geracao: Centavos;
}

const mesDe = (d: DataISO) => d.slice(0, 7);

export function projetar(caixa: CaixaBase, cronogramas: readonly CronogramaClasse[], horizonte: number, e: Estresse = {}): MesProjetado[] {
  const porMes = new Map<string, Record<string, Centavos>>();
  for (const c of cronogramas) for (const p of c.parcelas) {
    const m = mesDe(p.vencimento); const r = porMes.get(m) ?? {}; r[c.id] = (r[c.id] ?? 0n) + p.valor; porMes.set(m, r);
  }
  const atraso = Math.max(0, e.atrasoDias ?? 0); const mesesZerados = Math.floor(atraso / 30); const fracao = (atraso % 30) / 30;
  let saldo = caixa.saldoInicial; const serie: MesProjetado[] = [];
  for (let m = 0; m < horizonte; m++) {
    const fator = (1 + caixa.crescimentoReceitaAoMes) ** m * (1 + (e.receita ?? 0)) * (1 - (e.inadimplencia ?? 0));
    let receita = aplicarTaxa(caixa.receitaMensal, fator);
    if (e.perdaClienteMensal && m >= (e.perdaClienteMes ?? 0)) receita -= e.perdaClienteMensal;
    if (receita < 0n) receita = 0n;
    // Atraso desloca todos os recebimentos: um buraco único no início, não uma queda permanente.
    if (m < mesesZerados) receita = 0n; else if (m === mesesZerados && fracao > 0) receita -= aplicarTaxa(receita, fracao);
    const entradas = receita + caixa.outrasEntradasMensal;
    const despesa = aplicarTaxa(caixa.despesaMensal, 1 + (e.despesa ?? 0));
    let saidas = despesa + caixa.tributosMensal + caixa.extraconcursalMensal + caixa.investimentoMensal + (e.custoFinanceiroMensal ?? 0n);
    if (e.investimentoExtra && m === (e.investimentoExtraMes ?? 0)) saidas += e.investimentoExtra;
    const mes = mesDe(somarMeses(caixa.inicio, m));
    const porClasse = porMes.get(mes) ?? {};
    const prj = Object.values(porClasse).reduce((a, b) => a + b, 0n);
    saldo += entradas - saidas - prj;
    serie.push({ mes, entradas, saidas, prj, porClasse, saldo, geracao: entradas - saidas });
  }
  return serie;
}

export interface Entrada { readonly marco: DataISO; readonly classes: readonly ClassePrj[]; readonly caixa: CaixaBase; readonly horizonte: number; readonly reservaMinima: Centavos; readonly taxaDesconto: number; readonly estresse?: Estresse }

const valorPresente = (crons: readonly CronogramaClasse[], marco: DataISO, taxaAno: number): Centavos => {
  let vp = 0n; const [ay, am] = marco.split('-').map(Number) as [number, number];
  for (const c of crons) for (const p of c.parcelas) {
    const [y, m] = p.vencimento.split('-').map(Number) as [number, number];
    vp += aplicarTaxa(p.valor, (1 + taxaAno) ** (-((y - ay) * 12 + (m - am)) / 12));
  }
  return vp;
};

function menor(serie: readonly MesProjetado[]) {
  return serie.reduce((a, b) => (b.saldo < a.saldo ? b : a), serie[0]!);
}

export function simular(e: Entrada) {
  if (e.horizonte < 1 || e.horizonte > 360) throw new ParametroInvalido('o horizonte deve ficar entre 1 e 360 meses');
  const cronogramas = e.classes.map((c) => cronogramaDaClasse(c, e.marco));
  const serie = projetar(e.caixa, cronogramas, e.horizonte, e.estresse);
  const soma = (f: (c: CronogramaClasse) => Centavos) => cronogramas.reduce((a, c) => a + f(c), 0n);
  const piso = menor(serie);
  const deficit = serie.filter((m) => m.saldo < 0n).map((m) => m.mes);
  const abaixoDaReserva = serie.filter((m) => m.saldo < e.reservaMinima).map((m) => m.mes);
  const geracaoTotal = serie.reduce((a, m) => a + (m.geracao > 0n ? m.geracao : 0n), 0n);
  const prjNoHorizonte = serie.reduce((a, m) => a + m.prj, 0n);
  let picoComprometimento: number | null = null; let mesDoPico: string | null = null;
  for (const m of serie) {
    if (m.prj === 0n) continue;
    const r = m.geracao > 0n ? Number((m.prj * 10000n) / m.geracao) / 100 : Infinity;
    if (picoComprometimento === null || r > picoComprometimento) { picoComprometimento = r; mesDoPico = m.mes; }
  }
  const porAno = new Map<string, Centavos>();
  for (const m of serie) porAno.set(m.mes.slice(0, 4), (porAno.get(m.mes.slice(0, 4)) ?? 0n) + m.prj);
  const ultimoVencimento = cronogramas.flatMap((c) => c.parcelas.map((p) => p.vencimento)).sort().at(-1) ?? null;
  const parcelasForaDoHorizonte = ultimoVencimento !== null && serie.length > 0 && mesDe(ultimoVencimento) > serie.at(-1)!.mes;
  return {
    cronogramas,
    serie,
    indicadores: {
      original: soma((c) => c.original), novado: soma((c) => c.novado), desagio: soma((c) => c.desagio), juros: soma((c) => c.juros), total: soma((c) => c.total),
      valorPresente: valorPresente(cronogramas, e.marco, e.taxaDesconto), menorSaldo: piso?.saldo ?? 0n, mesMenorSaldo: piso?.mes ?? null,
      saldoFinal: serie.at(-1)?.saldo ?? 0n, mesesDeficit: deficit, mesesAbaixoDaReserva: abaixoDaReserva,
      necessidadeFinanciamento: piso && piso.saldo < e.reservaMinima ? e.reservaMinima - piso.saldo : 0n,
      picoComprometimento: picoComprometimento === Infinity ? null : picoComprometimento, picoSemGeracao: picoComprometimento === Infinity, mesDoPico,
      coberturaObrigacoes: prjNoHorizonte > 0n ? Number((geracaoTotal * 100n) / prjNoHorizonte) / 100 : null,
      ultimoVencimento, parcelasForaDoHorizonte,
      desembolsoPorAno: [...porAno].map(([ano, valor]) => ({ ano, valor })),
    },
    memoria: [
      `Marco inicial: ${e.marco}. Primeiro vencimento = marco + carência + uma periodicidade.`,
      'Valores em centavos, arredondamento meio para cima; a última parcela absorve a diferença.',
      'Juros e correção compõem: (1+j)×(1+c)−1. Índices são premissas informadas, não projeções oficiais.',
      `Valor presente descontado a ${(e.taxaDesconto * 100).toFixed(2)}% a.a., por mês cheio.`,
      'Simulação financeira: não presume aprovação dos credores, validade jurídica nem homologação.',
    ],
  };
}

export const CENARIOS_DE_ESTRESSE: Readonly<Record<string, Estresse>> = Object.freeze({
  base: {}, otimista: { receita: 0.1, despesa: -0.03 }, conservador: { receita: -0.1, despesa: 0.05, inadimplencia: 0.03 },
  severo: { receita: -0.3, despesa: 0.1, inadimplencia: 0.08, atrasoDias: 45 },
});

export function sensibilidade(e: Entrada) {
  return [-0.3, -0.2, -0.1, 0, 0.1].map((v) => {
    const r = simular({ ...e, estresse: { ...e.estresse, receita: (e.estresse?.receita ?? 0) + v } }).indicadores;
    return { variacao: v, menorSaldo: r.menorSaldo, mesesDeficit: r.mesesDeficit.length };
  });
}

export interface Otimizacao {
  readonly classeId: string; readonly desagio: readonly [number, number]; readonly passoDesagio: number;
  readonly carencia: readonly [number, number]; readonly passoCarencia: number;
  readonly parcelas: readonly [number, number]; readonly passoParcelas: number;
  readonly reservaMinima: Centavos; readonly limiteAnual?: Centavos; readonly pagamentoMinimo?: Centavos;
}

const faixa = (a: number, b: number, p: number) => { const r: number[] = []; for (let v = a; v <= b + 1e-9; v += p) r.push(Number(v.toFixed(6))); return r; };
const LIMITE_DE_COMBINACOES = 5000;

/** Busca combinações viáveis dentro de limites autorizados. Viável financeiramente não é aprovado nem válido. */
export function otimizar(e: Entrada, o: Otimizacao) {
  const desagios = faixa(o.desagio[0], o.desagio[1], o.passoDesagio); const carencias = faixa(o.carencia[0], o.carencia[1], o.passoCarencia); const parcelas = faixa(o.parcelas[0], o.parcelas[1], o.passoParcelas);
  const combinacoes = desagios.length * carencias.length * parcelas.length;
  if (combinacoes > LIMITE_DE_COMBINACOES) throw new ParametroInvalido(`são ${combinacoes} combinações. Aumente os passos para ficar em até ${LIMITE_DE_COMBINACOES}`);
  if (!e.classes.some((c) => c.id === o.classeId)) throw new ParametroInvalido('classe a otimizar não encontrada');
  const fixas = e.classes.filter((c) => c.id !== o.classeId).map((c) => cronogramaDaClasse(c, e.marco));
  const alvo = e.classes.find((c) => c.id === o.classeId)!;
  const avaliadas = [];
  for (const d of desagios) for (const ca of carencias) for (const pa of parcelas) {
    const c = cronogramaDaClasse({ ...alvo, condicao: { ...alvo.condicao, desagio: d, carenciaMeses: ca, parcelas: pa } }, e.marco);
    const serie = projetar(e.caixa, [...fixas, c], e.horizonte, e.estresse);
    const piso = menor(serie);
    const porAno = new Map<string, Centavos>();
    for (const m of serie) porAno.set(m.mes.slice(0, 4), (porAno.get(m.mes.slice(0, 4)) ?? 0n) + m.prj);
    const maiorAno = [...porAno.values()].reduce((a, b) => (b > a ? b : a), 0n);
    const violacoes: string[] = [];
    if (piso.saldo < o.reservaMinima) violacoes.push('reserva mínima de caixa');
    if (o.limiteAnual !== undefined && maiorAno > o.limiteAnual) violacoes.push('limite de desembolso anual');
    if (o.pagamentoMinimo !== undefined && c.total < o.pagamentoMinimo) violacoes.push('pagamento mínimo da classe');
    avaliadas.push({ desagio: d, carenciaMeses: ca, parcelas: pa, total: c.total, menorSaldo: piso.saldo, mesMenorSaldo: piso.mes, maiorDesembolsoAnual: maiorAno, violacoes });
  }
  // Primeiro o que mais paga ao credor: é a proposta com mais chance de ser aceita, entre as que o caixa suporta.
  const viaveis = avaliadas.filter((a) => a.violacoes.length === 0).sort((a, b) => (a.total === b.total ? a.parcelas - b.parcelas : a.total > b.total ? -1 : 1));
  const proximas = viaveis.length ? [] : [...avaliadas].sort((a, b) => a.violacoes.length - b.violacoes.length || (a.menorSaldo > b.menorSaldo ? -1 : 1)).slice(0, 5);
  return { combinacoes, viaveis: viaveis.length, alternativas: viaveis.slice(0, 10), maisProximas: proximas,
    aviso: 'Otimização financeira. Não presume aprovação dos credores, validade jurídica nem homologação judicial.' };
}
