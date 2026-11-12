/**
 * Saúde financeira a partir do fechamento mensal que o cliente informa.
 *
 * O cliente preenche poucos números por mês (o que qualquer empresa tem à mão:
 * faturamento, custos, folha, caixa, contas a pagar e a receber, dívidas). A
 * partir deles saem indicadores simples e alertas. Regras:
 *   - campo não informado é "não informado", nunca zero;
 *   - indicador que depende de campo ausente sai nulo, sem estimativa;
 *   - todo alerta diz qual número o disparou.
 * Valores em centavos (bigint); percentuais em pontos (12.5 = 12,5%).
 */

export const CAMPOS_DO_FECHAMENTO = [
  ['faturamento', 'Faturamento bruto do mês', 'Tudo o que foi vendido ou faturado no mês, antes de impostos.'],
  ['deducoes', 'Impostos sobre vendas e devoluções', 'ICMS, PIS, COFINS, ISS, Simples e devoluções do mês.'],
  ['custos', 'Custo dos produtos ou serviços', 'Matéria-prima, mercadoria revendida, terceiros ligados à produção.'],
  ['folha', 'Folha de pagamento e encargos', 'Salários, pró-labore, férias, 13º, INSS e FGTS do mês.'],
  ['despesas', 'Demais despesas operacionais', 'Aluguel, energia, fretes, sistemas, contador, comerciais.'],
  ['financeiras', 'Despesas financeiras', 'Juros, IOF, tarifas bancárias e deságio de antecipação.'],
  ['caixa', 'Saldo em caixa e bancos no último dia', 'Soma de todas as contas e aplicações de resgate imediato.'],
  ['receber', 'Contas a receber em aberto', 'Duplicatas e boletos de clientes ainda não recebidos.'],
  ['pagar', 'Contas a pagar a fornecedores em aberto', 'Inclui o que já venceu e não foi pago.'],
  ['dividaBancaria', 'Dívida com bancos e fundos', 'Saldo devedor de empréstimos, financiamentos, antecipações e fomento.'],
  ['tributosAtraso', 'Tributos em atraso', 'Impostos e contribuições vencidos e não pagos, inclusive parcelamentos atrasados.'],
] as const;

export type CampoDoFechamento = (typeof CAMPOS_DO_FECHAMENTO)[number][0];
export type Fechamento = { readonly competencia: string; readonly empregados?: number | null } & { readonly [K in CampoDoFechamento]?: bigint | null };

export interface Indicadores {
  readonly competencia: string;
  readonly receitaLiquida: bigint | null;
  readonly margemBruta: number | null;
  /** Lucro operacional antes de juros (aproximação de EBITDA, sem depreciação). */
  readonly resultadoOperacional: bigint | null;
  readonly margemOperacional: number | null;
  readonly resultado: bigint | null;
  readonly margemLiquida: number | null;
  /** Peso das despesas financeiras sobre o faturamento. */
  readonly pesoFinanceiro: number | null;
  /** Quantos meses o caixa cobre as saídas do mês (custos + folha + despesas + financeiras). */
  readonly mesesDeCaixa: number | null;
  /** (caixa + a receber) / a pagar. */
  readonly liquidezCorrente: number | null;
  /** Dívida bancária em meses de faturamento. */
  readonly dividaEmMesesDeFaturamento: number | null;
  readonly variacaoFaturamento: number | null;
}

export interface Alerta { readonly nivel: 'critico' | 'atencao'; readonly competencia: string; readonly texto: string }

const pct = (a: bigint, b: bigint) => (b === 0n ? null : Math.round(Number((a * 10000n) / b)) / 100);
const razao = (a: bigint, b: bigint) => (b === 0n ? null : Math.round(Number((a * 100n) / b)) / 100);
const tem = (...v: (bigint | null | undefined)[]): boolean => v.every((x) => x !== null && x !== undefined);
const n = (v: bigint | null | undefined) => v as bigint;

export function indicadores(f: Fechamento, anterior?: Fechamento): Indicadores {
  const { faturamento: fat, deducoes: ded, custos, folha, despesas, financeiras: fin, caixa, receber, pagar, dividaBancaria: divida } = f;
  const receitaLiquida = tem(fat) ? n(fat) - (ded ?? 0n) : null;
  const lucroBruto = receitaLiquida !== null && tem(custos) ? receitaLiquida - n(custos) : null;
  const resultadoOperacional = lucroBruto !== null && tem(folha, despesas) ? lucroBruto - n(folha) - n(despesas) : null;
  const resultado = resultadoOperacional !== null && tem(fin) ? resultadoOperacional - n(fin) : null;
  const saidas = tem(custos, folha, despesas) ? n(custos) + n(folha) + n(despesas) + (fin ?? 0n) : null;
  return {
    competencia: f.competencia, receitaLiquida,
    margemBruta: lucroBruto !== null && receitaLiquida ? pct(lucroBruto, receitaLiquida) : null,
    resultadoOperacional, margemOperacional: resultadoOperacional !== null && receitaLiquida ? pct(resultadoOperacional, receitaLiquida) : null,
    resultado, margemLiquida: resultado !== null && receitaLiquida ? pct(resultado, receitaLiquida) : null,
    pesoFinanceiro: tem(fin, fat) ? pct(n(fin), n(fat)) : null,
    mesesDeCaixa: tem(caixa) && saidas ? razao(n(caixa), saidas) : null,
    liquidezCorrente: tem(caixa, receber, pagar) ? razao(n(caixa) + n(receber), n(pagar)) : null,
    dividaEmMesesDeFaturamento: tem(divida, fat) ? razao(n(divida), n(fat)) : null,
    variacaoFaturamento: tem(fat) && anterior && tem(anterior.faturamento) && n(anterior.faturamento) > 0n ? pct(n(fat) - n(anterior.faturamento), n(anterior.faturamento)) : null,
  };
}

/** Série completa, do mês mais antigo ao mais recente, com os alertas do período. */
export function saude(fechamentos: readonly Fechamento[]) {
  const ord = [...fechamentos].sort((a, b) => a.competencia.localeCompare(b.competencia));
  const serie = ord.map((f, i) => indicadores(f, ord[i - 1]));
  const alertas: Alerta[] = [];
  const reais = (c: bigint) => `R$ ${(Number(c) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  serie.forEach((x, i) => {
    const f = ord[i]!; const c = x.competencia;
    if (x.mesesDeCaixa !== null && x.mesesDeCaixa < 0.5) alertas.push({ nivel: 'critico', competencia: c, texto: `Caixa cobre ${x.mesesDeCaixa.toLocaleString('pt-BR')} mês das saídas (menos de 15 dias).` });
    else if (x.mesesDeCaixa !== null && x.mesesDeCaixa < 1) alertas.push({ nivel: 'atencao', competencia: c, texto: `Caixa cobre ${x.mesesDeCaixa.toLocaleString('pt-BR')} mês das saídas.` });
    if (x.variacaoFaturamento !== null && x.variacaoFaturamento <= -20) alertas.push({ nivel: x.variacaoFaturamento <= -35 ? 'critico' : 'atencao', competencia: c, texto: `Faturamento caiu ${Math.abs(x.variacaoFaturamento).toLocaleString('pt-BR')}% sobre o mês anterior.` });
    if (x.pesoFinanceiro !== null && x.pesoFinanceiro >= 8) alertas.push({ nivel: x.pesoFinanceiro >= 15 ? 'critico' : 'atencao', competencia: c, texto: `Juros e tarifas consomem ${x.pesoFinanceiro.toLocaleString('pt-BR')}% do faturamento.` });
    if (x.liquidezCorrente !== null && x.liquidezCorrente < 1) alertas.push({ nivel: 'atencao', competencia: c, texto: `Caixa mais recebíveis cobrem ${x.liquidezCorrente.toLocaleString('pt-BR')} vez as contas a pagar.` });
    const ant = ord[i - 1];
    if (tem(f.tributosAtraso) && n(f.tributosAtraso) > 0n && ant && tem(ant.tributosAtraso) && n(f.tributosAtraso) > n(ant.tributosAtraso)) alertas.push({ nivel: 'atencao', competencia: c, texto: `Tributos em atraso subiram para ${reais(n(f.tributosAtraso))}.` });
  });
  // Três meses seguidos no vermelho é tendência, não oscilação.
  for (let i = 2; i < serie.length; i++) {
    const tres = serie.slice(i - 2, i + 1);
    if (tres.every((x) => x.resultado !== null && x.resultado < 0n)) alertas.push({ nivel: 'critico', competencia: serie[i]!.competencia, texto: 'Resultado negativo há três meses seguidos.' });
  }
  const ultimo = serie.at(-1) ?? null;
  const doUltimo = ultimo ? alertas.filter((a) => a.competencia === ultimo.competencia) : [];
  const situacao = !ultimo ? 'sem_dados' : doUltimo.some((a) => a.nivel === 'critico') ? 'critica' : doUltimo.length ? 'atencao' : 'estavel';
  const faltando = ultimo ? CAMPOS_DO_FECHAMENTO.filter(([k]) => ord.at(-1)![k] === null || ord.at(-1)![k] === undefined).map(([, r]) => r) : [];
  return { serie, alertas: alertas.reverse(), situacao, ultimo, faltando };
}
