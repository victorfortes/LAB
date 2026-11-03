/**
 * Fluxo de caixa da empresa em reestruturação (§6.6).
 *
 * "Não quero apenas gráficos ilustrativos. Quero um módulo efetivo de controle
 * financeiro." Então aqui é aritmética em centavos inteiros, com previsto e
 * realizado separados em todo lugar — misturar os dois é o erro que faz a
 * recuperanda achar que tem caixa que não tem.
 */
import type { Centavos } from '../shared/dinheiro.ts';
import { ErroDeValor, somar } from '../shared/dinheiro.ts';
import type { DataISO } from '../shared/datas.ts';
import { comparar, partes, somarDias, somarMeses } from '../shared/datas.ts';

export type TipoDeLancamento = 'receita' | 'despesa';
export type SituacaoDeLancamento = 'previsto' | 'realizado';

export interface Lancamento {
  readonly id: string;
  readonly data: DataISO;
  readonly tipo: TipoDeLancamento;
  readonly situacao: SituacaoDeLancamento;
  /** Sempre positivo: o sinal vem de `tipo`, não do valor. */
  readonly valor: Centavos;
  readonly categoria: string;
  readonly contraparte?: string;
  /** Obrigação do plano que originou o lançamento, quando houver. */
  readonly obrigacaoId?: string;
}

export type Granularidade = 'diaria' | 'semanal' | 'mensal';

export interface Periodo {
  readonly inicio: DataISO;
  readonly fim: DataISO;
  readonly rotulo: string;
  readonly receitasPrevistas: Centavos;
  readonly receitasRealizadas: Centavos;
  readonly despesasPrevistas: Centavos;
  readonly despesasRealizadas: Centavos;
  readonly saldoInicial: Centavos;
  /** Considera previsto + realizado: é a projeção. */
  readonly saldoProjetado: Centavos;
  /** Só o que de fato entrou e saiu. */
  readonly saldoRealizado: Centavos;
}

export interface FluxoDeCaixa {
  readonly saldoInicial: Centavos;
  readonly periodos: readonly Periodo[];
  readonly totalReceitasPrevistas: Centavos;
  readonly totalReceitasRealizadas: Centavos;
  readonly totalDespesasPrevistas: Centavos;
  readonly totalDespesasRealizadas: Centavos;
  readonly saldoFinalProjetado: Centavos;
  readonly saldoFinalRealizado: Centavos;
  /** Períodos em que a projeção fica negativa — o alerta que importa. */
  readonly periodosNegativos: readonly string[];
  readonly menorSaldoProjetado: Centavos;
}

function inicioDaSemana(data: DataISO): DataISO {
  const { ano, mes, dia } = partes(data);
  // Dia da semana por Zeller, sem `Date` e sem fuso.
  const d = new Date(Date.UTC(ano, mes - 1, dia)).getUTCDay();
  const recuo = d === 0 ? 6 : d - 1; // semana começa na segunda
  return somarDias(data, -recuo);
}

function inicioDoMes(data: DataISO): DataISO {
  const { ano, mes } = partes(data);
  return `${String(ano).padStart(4, '0')}-${String(mes).padStart(2, '0')}-01`;
}

function proximoInicio(inicio: DataISO, granularidade: Granularidade): DataISO {
  switch (granularidade) {
    case 'diaria': return somarDias(inicio, 1);
    case 'semanal': return somarDias(inicio, 7);
    case 'mensal': return somarMeses(inicio, 1);
  }
}

function rotularPeriodo(inicio: DataISO, granularidade: Granularidade): string {
  const { ano, mes, dia } = partes(inicio);
  const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  switch (granularidade) {
    case 'diaria': return `${String(dia).padStart(2, '0')}/${String(mes).padStart(2, '0')}`;
    case 'semanal': return `semana de ${String(dia).padStart(2, '0')}/${String(mes).padStart(2, '0')}`;
    case 'mensal': return `${MESES[mes - 1]}/${ano}`;
  }
}

/**
 * Monta o fluxo de caixa período a período.
 *
 * O saldo projetado acumula previsto E realizado; o realizado acumula só o que
 * aconteceu. Os dois partem do mesmo saldo inicial e divergem conforme o
 * previsto se confirma ou não — que é exatamente a informação que a recuperanda
 * precisa olhar todo dia.
 */
export function montarFluxo(
  saldoInicial: Centavos,
  lancamentos: readonly Lancamento[],
  de: DataISO,
  ate: DataISO,
  granularidade: Granularidade = 'mensal',
): FluxoDeCaixa {
  if (comparar(de, ate) > 0) {
    throw new ErroDeValor(`intervalo inválido: ${de} é posterior a ${ate}`);
  }
  for (const l of lancamentos) {
    if (l.valor < 0n) {
      throw new ErroDeValor(
        `lançamento ${l.id} com valor negativo: o sinal vem do tipo (receita/despesa), não do valor`);
    }
  }

  const noIntervalo = lancamentos.filter(
    (l) => comparar(l.data, de) >= 0 && comparar(l.data, ate) <= 0);

  let cursor = granularidade === 'mensal' ? inicioDoMes(de)
    : granularidade === 'semanal' ? inicioDaSemana(de) : de;

  const periodos: Periodo[] = [];
  let saldoProjetado = saldoInicial;
  let saldoRealizado = saldoInicial;
  let menorSaldoProjetado = saldoInicial;
  const negativos: string[] = [];

  // Trava de segurança: granularidade diária em intervalo longo geraria
  // milhares de períodos e travaria a interface.
  const LIMITE = 2000;

  while (comparar(cursor, ate) <= 0 && periodos.length < LIMITE) {
    const proximo = proximoInicio(cursor, granularidade);
    const fim = somarDias(proximo, -1);
    const doPeriodo = noIntervalo.filter(
      (l) => comparar(l.data, cursor) >= 0 && comparar(l.data, fim) <= 0);

    const receitasPrevistas = somar(doPeriodo.filter((l) => l.tipo === 'receita' && l.situacao === 'previsto').map((l) => l.valor));
    const receitasRealizadas = somar(doPeriodo.filter((l) => l.tipo === 'receita' && l.situacao === 'realizado').map((l) => l.valor));
    const despesasPrevistas = somar(doPeriodo.filter((l) => l.tipo === 'despesa' && l.situacao === 'previsto').map((l) => l.valor));
    const despesasRealizadas = somar(doPeriodo.filter((l) => l.tipo === 'despesa' && l.situacao === 'realizado').map((l) => l.valor));

    const saldoInicialDoPeriodo = saldoProjetado;
    saldoProjetado += receitasPrevistas + receitasRealizadas - despesasPrevistas - despesasRealizadas;
    saldoRealizado += receitasRealizadas - despesasRealizadas;

    const rotulo = rotularPeriodo(cursor, granularidade);
    if (saldoProjetado < 0n) negativos.push(rotulo);
    if (saldoProjetado < menorSaldoProjetado) menorSaldoProjetado = saldoProjetado;

    periodos.push({
      inicio: cursor, fim, rotulo,
      receitasPrevistas, receitasRealizadas, despesasPrevistas, despesasRealizadas,
      saldoInicial: saldoInicialDoPeriodo,
      saldoProjetado, saldoRealizado,
    });

    cursor = proximo;
  }

  const total = (tipo: TipoDeLancamento, situacao: SituacaoDeLancamento) =>
    somar(noIntervalo.filter((l) => l.tipo === tipo && l.situacao === situacao).map((l) => l.valor));

  return {
    saldoInicial,
    periodos,
    totalReceitasPrevistas: total('receita', 'previsto'),
    totalReceitasRealizadas: total('receita', 'realizado'),
    totalDespesasPrevistas: total('despesa', 'previsto'),
    totalDespesasRealizadas: total('despesa', 'realizado'),
    saldoFinalProjetado: saldoProjetado,
    saldoFinalRealizado: saldoRealizado,
    periodosNegativos: negativos,
    menorSaldoProjetado,
  };
}

export interface Indicadores {
  readonly saldoAtual: Centavos;
  /** Média de despesa realizada por mês no intervalo. */
  readonly queimaMensal: Centavos;
  /**
   * Meses de caixa restantes na queima atual. `null` quando não há queima
   * (não é "infinito": é indefinido, e a interface precisa saber a diferença).
   */
  readonly mesesDeCaixa: number | null;
  readonly contasVencidas: Centavos;
  readonly aVencerEm30Dias: Centavos;
}

/** Indicadores de acompanhamento (§6.6). */
export function calcularIndicadores(
  saldoAtual: Centavos,
  lancamentos: readonly Lancamento[],
  hoje: DataISO,
  mesesDoIntervalo: number,
): Indicadores {
  if (mesesDoIntervalo <= 0) throw new ErroDeValor('intervalo em meses deve ser positivo');

  const despesasRealizadas = somar(
    lancamentos.filter((l) => l.tipo === 'despesa' && l.situacao === 'realizado').map((l) => l.valor));
  const queimaMensal = despesasRealizadas / BigInt(mesesDoIntervalo);

  const em30 = somarDias(hoje, 30);
  const contasVencidas = somar(lancamentos
    .filter((l) => l.tipo === 'despesa' && l.situacao === 'previsto' && comparar(l.data, hoje) < 0)
    .map((l) => l.valor));
  const aVencerEm30Dias = somar(lancamentos
    .filter((l) => l.tipo === 'despesa' && l.situacao === 'previsto'
      && comparar(l.data, hoje) >= 0 && comparar(l.data, em30) <= 0)
    .map((l) => l.valor));

  return {
    saldoAtual,
    queimaMensal,
    mesesDeCaixa: queimaMensal <= 0n ? null : Number(saldoAtual / queimaMensal),
    contasVencidas,
    aVencerEm30Dias,
  };
}
