/**
 * Honorários: o que foi contratado e o que a lei deixa cobrar.
 *
 * Duas coisas distintas convivem aqui, e confundi-las é erro caro:
 *
 *   HONORÁRIO CONTRATUAL é o que o escritório combinou com o cliente — fixo,
 *   mensal, de êxito ou a mistura dos três. É aritmética de contrato.
 *
 *   REMUNERAÇÃO DO ADMINISTRADOR JUDICIAL é fixada pelo juiz e tem TETO LEGAL
 *   (art. 24 da Lei 11.101/2005). Propor acima do teto é pedir redução na
 *   decisão, e a conta do teto depende de a devedora ser ou não ME/EPP.
 *
 * Como em todo cálculo financeiro desta plataforma (§7.3), nada passa por
 * ponto flutuante: centavos em `bigint`, percentual aplicado por inteiro
 * escalonado. A diferença entre 5,00% e 4,99% de um passivo de R$ 50 milhões
 * é R$ 5 mil, e aparece em petição.
 */
import {
  type Centavos, ErroDeValor, aplicarTaxa, dividirArredondando, repartir,
} from '../shared/dinheiro.ts';
import { type DataISO, somarMeses } from '../shared/datas.ts';

export type ModeloDeHonorario = 'fixo' | 'mensal' | 'exito' | 'misto';

/** Sobre o que incide o percentual de êxito. Muda o resultado, e muito. */
export type BaseDoExito =
  /** Vantagem econômica obtida pelo cliente, apurada caso a caso. */
  | 'beneficio_economico'
  /** Valor efetivamente recebido pelo credor. */
  | 'valor_recuperado'
  /** Redução obtida no passivo da devedora (deságio). */
  | 'desagio_obtido';

export interface Contrato {
  readonly modelo: ModeloDeHonorario;
  readonly valorFixo?: Centavos;
  readonly valorMensal?: Centavos;
  readonly meses?: number;
  /** Fração, não porcentagem: 10% é 0.1. */
  readonly percentualExito?: number;
  readonly baseDoExito?: BaseDoExito;
}

export interface ParcelaDeHonorario {
  readonly numero: number;
  readonly vencimento: DataISO;
  readonly valor: Centavos;
  readonly origem: 'fixo' | 'mensal';
}

export interface ResultadoDeHonorario {
  readonly fixo: Centavos;
  readonly mensalTotal: Centavos;
  readonly exito: Centavos;
  readonly total: Centavos;
  /** Verdadeiro quando o êxito não pôde ser calculado por falta de base. */
  readonly exitoPendente: boolean;
  readonly ressalvas: readonly string[];
}

export class ErroDeHonorario extends Error {
  override readonly name = 'ErroDeHonorario';
}

const PERCENTUAL_MAXIMO = 0.5;

function conferirContrato(c: Contrato): void {
  const precisaFixo = c.modelo === 'fixo' || c.modelo === 'misto';
  const precisaMensal = c.modelo === 'mensal' || c.modelo === 'misto';
  const precisaExito = c.modelo === 'exito' || c.modelo === 'misto';

  if (precisaFixo && (c.valorFixo === undefined || c.valorFixo < 0n)) {
    throw new ErroDeHonorario('contrato com parcela fixa precisa de valor fixo não negativo');
  }
  if (precisaMensal) {
    if (c.valorMensal === undefined || c.valorMensal < 0n) {
      throw new ErroDeHonorario('contrato mensal precisa de valor mensal não negativo');
    }
    if (!Number.isInteger(c.meses) || (c.meses ?? 0) < 1) {
      throw new ErroDeHonorario('contrato mensal precisa de um número inteiro de meses');
    }
  }
  if (precisaExito) {
    const p = c.percentualExito;
    if (p === undefined || !Number.isFinite(p) || p <= 0) {
      throw new ErroDeHonorario('contrato de êxito precisa de percentual positivo');
    }
    if (p > PERCENTUAL_MAXIMO) {
      // 50% já é extremo; acima disso é quase certamente ponto decimal errado
      // — alguém digitou 20 querendo 0,20.
      throw new ErroDeHonorario(
        `percentual de êxito de ${(p * 100).toFixed(2)}% está fora de qualquer prática; ` +
        'o campo é fração (10% = 0.1)');
    }
    if (c.baseDoExito === undefined) {
      throw new ErroDeHonorario(
        'contrato de êxito precisa declarar a base: benefício econômico, valor ' +
        'recuperado ou deságio obtido mudam o resultado');
    }
  }
}

const ROTULO_DA_BASE: Readonly<Record<BaseDoExito, string>> = Object.freeze({
  beneficio_economico: 'benefício econômico obtido pelo cliente',
  valor_recuperado: 'valor efetivamente recebido',
  desagio_obtido: 'redução obtida no passivo',
});

/**
 * Soma o que o contrato prevê.
 *
 * `baseDoExito` é o valor apurado sobre o qual o percentual incide. Sem ele,
 * o êxito volta como PENDENTE em vez de zero: zero seria afirmar que não há
 * honorário de êxito, e o que há é ausência de apuração.
 */
export function totalContratado(
  contrato: Contrato, baseApurada?: Centavos,
): ResultadoDeHonorario {
  conferirContrato(contrato);
  const ressalvas: string[] = [];

  const fixo = contrato.modelo === 'fixo' || contrato.modelo === 'misto'
    ? contrato.valorFixo! : 0n;

  const mensalTotal = contrato.modelo === 'mensal' || contrato.modelo === 'misto'
    ? contrato.valorMensal! * BigInt(contrato.meses!) : 0n;

  let exito = 0n;
  let exitoPendente = false;
  if (contrato.modelo === 'exito' || contrato.modelo === 'misto') {
    if (baseApurada === undefined) {
      exitoPendente = true;
      ressalvas.push(
        `O honorário de êxito (${(contrato.percentualExito! * 100).toFixed(2)}% sobre o ` +
        `${ROTULO_DA_BASE[contrato.baseDoExito!]}) não entra no total: a base ainda ` +
        'não foi apurada.');
    } else {
      if (baseApurada < 0n) throw new ErroDeHonorario('a base de êxito não pode ser negativa');
      exito = aplicarTaxa(baseApurada, contrato.percentualExito!);
      ressalvas.push(
        `Êxito calculado sobre o ${ROTULO_DA_BASE[contrato.baseDoExito!]}, que é ` +
        'apuração de quem acompanha o caso, não um número do sistema.');
    }
  }

  return { fixo, mensalTotal, exito, total: fixo + mensalTotal + exito, exitoPendente, ressalvas };
}

/**
 * Parcelas a faturar.
 *
 * A fixa pode ser dividida em `parcelasDaFixa` prestações; o resto de centavo
 * cai nas primeiras, de modo que a soma fecha exatamente com o contratado —
 * nunca um centavo a mais nem a menos no total.
 */
export function cronogramaDeHonorarios(
  contrato: Contrato, primeiroVencimento: DataISO, parcelasDaFixa = 1,
): ParcelaDeHonorario[] {
  conferirContrato(contrato);
  if (!Number.isInteger(parcelasDaFixa) || parcelasDaFixa < 1) {
    throw new ErroDeHonorario('o número de parcelas da fixa precisa ser inteiro positivo');
  }

  const parcelas: ParcelaDeHonorario[] = [];
  let numero = 1;

  if ((contrato.modelo === 'fixo' || contrato.modelo === 'misto') && contrato.valorFixo! > 0n) {
    for (const [i, valor] of repartir(contrato.valorFixo!, parcelasDaFixa).entries()) {
      parcelas.push({
        numero: numero++, vencimento: somarMeses(primeiroVencimento, i), valor, origem: 'fixo',
      });
    }
  }

  if (contrato.modelo === 'mensal' || contrato.modelo === 'misto') {
    for (let i = 0; i < contrato.meses!; i++) {
      parcelas.push({
        numero: numero++, vencimento: somarMeses(primeiroVencimento, i),
        valor: contrato.valorMensal!, origem: 'mensal',
      });
    }
  }

  // O êxito não entra no cronograma: ele vence quando o êxito ocorre, e
  // agendá-lo seria inventar uma data.
  parcelas.sort((a, b) => (a.vencimento < b.vencimento ? -1 : a.vencimento > b.vencimento ? 1 : 0));
  return parcelas.map((p, i) => ({ ...p, numero: i + 1 }));
}

// ------------------------------------- remuneração do administrador judicial ---

export const TETO_GERAL = 0.05;
export const TETO_ME_EPP = 0.02;
/** Art. 24, § 2º: parcela reservada para depois da prestação de contas. */
export const RESERVA = 0.4;

export interface PedidoDeTeto {
  /**
   * Base do art. 24, § 1º: valor devido aos credores submetidos à recuperação
   * judicial, ou valor de venda dos bens na falência.
   */
  readonly base: Centavos;
  /** ME ou EPP reduz o teto a 2% (art. 24, § 5º). */
  readonly microempresaOuEpp: boolean;
  /** Remuneração que se pretende propor ao juízo, para conferir contra o teto. */
  readonly propostoMensal?: Centavos;
  readonly meses?: number;
}

export interface TetoDoAdministrador {
  readonly percentual: number;
  readonly teto: Centavos;
  /** 40% do total, reservado para depois da prestação de contas. */
  readonly reserva: Centavos;
  readonly liberavelDuranteOProcesso: Centavos;
  readonly propostoTotal: Centavos | null;
  readonly excedeOTeto: boolean;
  readonly excedente: Centavos;
  readonly fundamentos: readonly string[];
  readonly ressalvas: readonly string[];
  /** Sempre: o valor é fixado pelo juiz, não pela planilha. */
  readonly exigeDecisaoJudicial: true;
}

/**
 * Teto da remuneração do administrador judicial (art. 24 da LREF).
 *
 * O que esta função faz é conferir um número contra um limite legal. O que
 * ela NÃO faz é dizer quanto o administrador vai receber: isso o juiz fixa
 * olhando complexidade, praxe do mercado e capacidade de pagamento da
 * devedora (art. 24, caput), e nada disso é calculável aqui.
 */
export function tetoDoAdministradorJudicial(pedido: PedidoDeTeto): TetoDoAdministrador {
  if (pedido.base < 0n) throw new ErroDeHonorario('a base do teto não pode ser negativa');

  const percentual = pedido.microempresaOuEpp ? TETO_ME_EPP : TETO_GERAL;
  const teto = aplicarTaxa(pedido.base, percentual);
  const reserva = aplicarTaxa(teto, RESERVA);

  const fundamentos = [
    'Art. 24, caput, da Lei 11.101/2005: o juiz fixa o valor e a forma de pagamento, ' +
    'observados a complexidade do trabalho, os valores de mercado e a capacidade de ' +
    'pagamento do devedor.',
    pedido.microempresaOuEpp
      ? 'Art. 24, § 5º, da Lei 11.101/2005: tratando-se de microempresa ou empresa de ' +
        'pequeno porte, a remuneração fica reduzida ao limite de 2%.'
      : 'Art. 24, § 1º, da Lei 11.101/2005: o total pago não excederá 5% do valor devido ' +
        'aos credores submetidos à recuperação judicial ou do valor de venda dos bens na falência.',
    'Art. 24, § 2º, da Lei 11.101/2005: reserva-se 40% do montante devido para pagamento ' +
    'após a prestação de contas.',
  ];

  const ressalvas = [
    'A base do teto depende do que se considera "valor devido aos credores submetidos": ' +
    'o quadro de credores precisa estar consolidado, e crédito ainda não validado altera o cálculo.',
    'O teto é limite, não arbitramento. O valor concreto é fixado em decisão judicial.',
  ];

  let propostoTotal: Centavos | null = null;
  if (pedido.propostoMensal !== undefined) {
    if (pedido.propostoMensal < 0n) {
      throw new ErroDeHonorario('a remuneração proposta não pode ser negativa');
    }
    if (!Number.isInteger(pedido.meses) || (pedido.meses ?? 0) < 1) {
      throw new ErroDeHonorario('informe em quantos meses a remuneração proposta será paga');
    }
    propostoTotal = pedido.propostoMensal * BigInt(pedido.meses!);
  }

  const excedente = propostoTotal !== null && propostoTotal > teto ? propostoTotal - teto : 0n;

  return {
    percentual,
    teto,
    reserva,
    liberavelDuranteOProcesso: teto - reserva,
    propostoTotal,
    excedeOTeto: excedente > 0n,
    excedente,
    fundamentos,
    ressalvas,
    exigeDecisaoJudicial: true,
  };
}

/** Rateio de um valor entre projetos, proporcional a uma medida (horas, por exemplo). */
export function ratear(
  valor: Centavos, pesos: readonly { readonly chave: string; readonly peso: number }[],
): Array<{ chave: string; valor: Centavos }> {
  if (pesos.length === 0) throw new ErroDeValor('não há como ratear sem destino');
  const total = pesos.reduce((t, p) => t + p.peso, 0);
  if (total <= 0) throw new ErroDeValor('a soma dos pesos precisa ser positiva');

  // Reparte por inteiro e devolve o resto ao primeiro: a soma tem de fechar
  // com o valor rateado, sem centavo sobrando nem faltando.
  const escala = 1_000_000n;
  const partes = pesos.map((p) => ({
    chave: p.chave,
    valor: dividirArredondando(valor * BigInt(Math.round(p.peso * Number(escala))),
      BigInt(Math.round(total * Number(escala)))),
  }));
  const soma = partes.reduce((t, p) => t + p.valor, 0n);
  const diferenca = valor - soma;
  if (diferenca !== 0n && partes[0]) {
    partes[0] = { ...partes[0], valor: partes[0].valor + diferenca };
  }
  return partes;
}
