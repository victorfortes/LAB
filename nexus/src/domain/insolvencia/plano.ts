/**
 * Cronograma de pagamento do plano de recuperação judicial.
 *
 * Determinístico. Os números que saem daqui vão para o calendário de
 * obrigações, para a conferência de descumprimento e para a peça — não podem
 * vir de modelo de linguagem, e não vêm.
 *
 * Garantia central: a soma das amortizações fecha EXATAMENTE com o valor
 * novado, e o saldo da última parcela é zero. A última parcela absorve o
 * resíduo de arredondamento, que é como o mercado calcula e como o
 * administrador judicial confere.
 */
import type { Centavos } from '../shared/dinheiro.ts';
import { ErroDeValor, aplicarTaxa, repartir, somar } from '../shared/dinheiro.ts';
import type { DataISO } from '../shared/datas.ts';
import { somarDias, somarMeses } from '../shared/datas.ts';

export type Periodicidade = 'mensal' | 'bimestral' | 'trimestral' | 'semestral' | 'anual';

export const MESES_POR_PERIODO: Readonly<Record<Periodicidade, number>> = Object.freeze({
  mensal: 1, bimestral: 2, trimestral: 3, semestral: 6, anual: 12,
});

/** Como os juros anunciados no plano viram taxa do período. */
export type RegimeDeJuros =
  /** Nominal: taxa anual dividida proporcionalmente (o mais comum em PRJ). */
  | 'nominal'
  /** Efetiva: capitalização composta equivalente. */
  | 'efetiva';

export type SistemaDeAmortizacao =
  /** Parcelas de valor constante (tabela Price). */
  | 'price'
  /** Amortização constante, parcela decrescente (SAC). */
  | 'sac'
  /** Sem juros: o valor novado dividido em parcelas iguais. */
  | 'sem_juros';

/** Condições pactuadas para uma classe (ou subgrupo) de credores. */
export interface CondicaoDePagamento {
  /** Deságio, como decimal: 0.6 = 60 % de desconto sobre o crédito original. */
  readonly desagio: number;
  /** Carência em meses, contada da data-base. */
  readonly carenciaMeses: number;
  /** Número de parcelas. */
  readonly parcelas: number;
  readonly periodicidade: Periodicidade;
  /** Juros ao ano, como decimal: 0.06 = 6 % a.a. Zero quando não houver. */
  readonly jurosAoAno: number;
  readonly regimeDeJuros?: RegimeDeJuros;
  readonly sistema: SistemaDeAmortizacao;
  /**
   * Durante a carência, os juros se acumulam ao saldo (capitalizam) ou são
   * simplesmente dispensados. O plano precisa dizer; o padrão aqui é não
   * capitalizar, que é a leitura mais favorável ao devedor e a mais comum.
   */
  readonly capitalizarNaCarencia?: boolean;
}

export interface Parcela {
  readonly numero: number;
  readonly vencimento: DataISO;
  readonly saldoInicial: Centavos;
  readonly juros: Centavos;
  readonly amortizacao: Centavos;
  /** O que o credor recebe: amortização + juros. */
  readonly valor: Centavos;
  readonly saldoFinal: Centavos;
}

export interface Cronograma {
  readonly creditoOriginal: Centavos;
  readonly desagioAplicado: Centavos;
  /** Valor efetivamente devido após o deságio — a base do cronograma. */
  readonly valorNovado: Centavos;
  readonly dataBase: DataISO;
  readonly primeiroVencimento: DataISO;
  readonly ultimoVencimento: DataISO;
  readonly parcelas: readonly Parcela[];
  readonly totalJuros: Centavos;
  readonly totalPago: Centavos;
  readonly condicao: CondicaoDePagamento;
}

/** Converte a taxa anual na taxa do período de pagamento. */
export function taxaDoPeriodo(condicao: CondicaoDePagamento): number {
  const meses = MESES_POR_PERIODO[condicao.periodicidade];
  if (condicao.jurosAoAno === 0) return 0;
  return (condicao.regimeDeJuros ?? 'nominal') === 'efetiva'
    ? (1 + condicao.jurosAoAno) ** (meses / 12) - 1
    : condicao.jurosAoAno * (meses / 12);
}

function validar(condicao: CondicaoDePagamento): void {
  if (!Number.isInteger(condicao.parcelas) || condicao.parcelas <= 0) {
    throw new ErroDeValor(`número de parcelas inválido: ${condicao.parcelas}`);
  }
  if (!Number.isInteger(condicao.carenciaMeses) || condicao.carenciaMeses < 0) {
    throw new ErroDeValor(`carência inválida: ${condicao.carenciaMeses}`);
  }
  if (!(condicao.desagio >= 0 && condicao.desagio < 1)) {
    throw new ErroDeValor(`deságio deve estar em [0, 1): ${condicao.desagio}`);
  }
  if (!Number.isFinite(condicao.jurosAoAno) || condicao.jurosAoAno < 0) {
    throw new ErroDeValor(`juros ao ano inválidos: ${condicao.jurosAoAno}`);
  }
}

/**
 * Gera o cronograma de um crédito sob uma condição de pagamento.
 *
 * `dataBase` costuma ser a data da homologação do plano; a carência corre a
 * partir dela e a primeira parcela vence em `carência + 1 período`.
 */
export function gerarCronograma(
  creditoOriginal: Centavos,
  condicao: CondicaoDePagamento,
  dataBase: DataISO,
): Cronograma {
  validar(condicao);
  if (creditoOriginal < 0n) throw new ErroDeValor('crédito original negativo');

  const desagioAplicado = aplicarTaxa(creditoOriginal, condicao.desagio);
  let saldo = creditoOriginal - desagioAplicado;
  const valorNovado = saldo;

  const i = taxaDoPeriodo(condicao);
  const mesesPorPeriodo = MESES_POR_PERIODO[condicao.periodicidade];
  const n = condicao.parcelas;

  // Carência: se o plano capitaliza, o saldo cresce antes da 1ª parcela.
  if (condicao.carenciaMeses > 0 && condicao.capitalizarNaCarencia && condicao.jurosAoAno > 0) {
    const taxaMensal =
      (condicao.regimeDeJuros ?? 'nominal') === 'efetiva'
        ? (1 + condicao.jurosAoAno) ** (1 / 12) - 1
        : condicao.jurosAoAno / 12;
    for (let m = 0; m < condicao.carenciaMeses; m++) {
      saldo += aplicarTaxa(saldo, taxaMensal);
    }
  }

  const parcelas: Parcela[] = [];

  // SAC e "sem juros" repartem o principal de forma exata de antemão.
  const amortizacoes =
    condicao.sistema === 'price' && i > 0 ? null : repartir(saldo, n);

  // Price: PMT = PV · i / (1 − (1+i)^−n). Calculada uma vez; o resíduo de
  // arredondamento é absorvido pela última parcela.
  let pmt = 0n;
  if (amortizacoes === null) {
    const fator = i / (1 - (1 + i) ** -n);
    pmt = aplicarTaxa(saldo, fator);
  }

  for (let k = 1; k <= n; k++) {
    const saldoInicial = saldo;
    const juros = i > 0 ? aplicarTaxa(saldoInicial, i) : 0n;
    const ultima = k === n;

    let amortizacao: Centavos;
    if (ultima) {
      // Fecha o saldo em zero, sempre.
      amortizacao = saldoInicial;
    } else if (amortizacoes !== null) {
      amortizacao = amortizacoes[k - 1]!;
    } else {
      amortizacao = pmt - juros;
      // Na Price, PMT > juros sempre que n é finito, então amortização negativa
      // não ocorre. Amortização ZERO ocorre — com saldo ínfimo ou juros
      // absurdos, a parcela arredondada só paga juros e o saldo nunca desce.
      // O cronograma não converge: a última parcela despejaria o saldo inteiro.
      // Melhor falhar alto do que devolver um plano que não paga nada.
      if (amortizacao <= 0n) {
        throw new ErroDeValor(
          `parcela Price não amortiza o saldo na parcela ${k}: a prestação arredondada ` +
            'apenas cobre os juros do período. Reveja prazo, juros ou sistema de amortização.',
        );
      }
      if (amortizacao > saldoInicial) amortizacao = saldoInicial;
    }

    saldo = saldoInicial - amortizacao;
    parcelas.push({
      numero: k,
      vencimento: somarMeses(dataBase, condicao.carenciaMeses + k * mesesPorPeriodo),
      saldoInicial,
      juros,
      amortizacao,
      valor: amortizacao + juros,
      saldoFinal: saldo,
    });
  }

  const primeira = parcelas[0]!;
  const ultima = parcelas[parcelas.length - 1]!;
  return {
    creditoOriginal,
    desagioAplicado,
    valorNovado,
    dataBase,
    primeiroVencimento: primeira.vencimento,
    ultimoVencimento: ultima.vencimento,
    parcelas,
    totalJuros: somar(parcelas.map((p) => p.juros)),
    totalPago: somar(parcelas.map((p) => p.valor)),
    condicao,
  };
}

/** Parcelas vencidas e não quitadas até uma data — base para alerta de descumprimento. */
export function parcelasVencidas(
  cronograma: Cronograma,
  pagas: ReadonlySet<number>,
  hoje: DataISO,
): Parcela[] {
  return cronograma.parcelas.filter((p) => p.vencimento <= hoje && !pagas.has(p.numero));
}

/** Parcelas a vencer dentro de `dias` — base para o alerta de obrigação próxima. */
export function parcelasAVencer(
  cronograma: Cronograma,
  pagas: ReadonlySet<number>,
  hoje: DataISO,
  dias: number,
): Parcela[] {
  const fim = somarDias(hoje, dias);
  return cronograma.parcelas.filter(
    (p) => p.vencimento > hoje && p.vencimento <= fim && !pagas.has(p.numero),
  );
}
