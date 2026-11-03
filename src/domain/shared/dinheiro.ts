/**
 * Valores monetários em centavos inteiros (bigint).
 *
 * Nunca usar ponto flutuante: estes números vão para habilitação de crédito,
 * quadro-geral de credores e cronograma do plano. `0.1 + 0.2 !== 0.3` é
 * aceitável num gráfico e inaceitável numa petição.
 */
export type Centavos = bigint;

const SEPARADOR = /[.,]/;

/** Converte "1.234.567,89", "1234567.89" ou "1234567" em centavos. */
export function parseReais(texto: string): Centavos {
  const limpo = texto.trim().replace(/^R\$\s*/i, '').replace(/\s/g, '');
  if (limpo === '') throw new ErroDeValor('valor vazio');

  const negativo = limpo.startsWith('-');
  const corpo = negativo ? limpo.slice(1) : limpo;
  if (!/^[\d.,]+$/.test(corpo)) throw new ErroDeValor(`valor inválido: ${texto}`);

  // O último separador é o decimal, desde que sobrem 1 ou 2 dígitos depois dele.
  const ultimo = Math.max(corpo.lastIndexOf('.'), corpo.lastIndexOf(','));
  let inteiros: string;
  let decimais: string;
  if (ultimo === -1) {
    inteiros = corpo;
    decimais = '';
  } else {
    const cauda = corpo.slice(ultimo + 1);
    if (cauda.length === 1 || cauda.length === 2) {
      inteiros = corpo.slice(0, ultimo);
      decimais = cauda;
    } else {
      // Separador de milhar (ex.: "1.234" ou "1.234.567").
      inteiros = corpo;
      decimais = '';
    }
  }

  inteiros = inteiros.replace(new RegExp(SEPARADOR.source, 'g'), '');
  if (inteiros === '') inteiros = '0';
  if (SEPARADOR.test(decimais)) throw new ErroDeValor(`valor inválido: ${texto}`);

  const centavos = BigInt(inteiros) * 100n + BigInt(decimais.padEnd(2, '0') || '0');
  return negativo ? -centavos : centavos;
}

/** Formata centavos como "1.234.567,89" (sem o prefixo R$). */
export function formatarReais(valor: Centavos): string {
  const negativo = valor < 0n;
  const abs = negativo ? -valor : valor;
  const inteiros = (abs / 100n).toString();
  const decimais = (abs % 100n).toString().padStart(2, '0');
  const comMilhar = inteiros.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${negativo ? '-' : ''}${comMilhar},${decimais}`;
}

/** Formata com o prefixo da moeda. */
export function formatarBRL(valor: Centavos): string {
  return `R$ ${formatarReais(valor)}`;
}

/**
 * Multiplica por uma taxa decimal (ex.: deságio de 60 % = 0.6), arredondando
 * para o centavo mais próximo (half-up em valores absolutos, simétrico no sinal).
 *
 * `taxa` é um número de ponto flutuante por conveniência de entrada, mas a
 * multiplicação acontece em inteiros escalonados — o float nunca toca o resultado.
 */
export function aplicarTaxa(valor: Centavos, taxa: number, escala = 10n ** 9n): Centavos {
  if (!Number.isFinite(taxa)) throw new ErroDeValor(`taxa inválida: ${taxa}`);
  const taxaEscalada = BigInt(Math.round(taxa * Number(escala)));
  return dividirArredondando(valor * taxaEscalada, escala);
}

/** Divisão com arredondamento half-up simétrico (0,5 afasta-se do zero). */
export function dividirArredondando(numerador: bigint, denominador: bigint): bigint {
  if (denominador === 0n) throw new ErroDeValor('divisão por zero');
  const negativo = numerador < 0n !== denominador < 0n;
  const n = numerador < 0n ? -numerador : numerador;
  const d = denominador < 0n ? -denominador : denominador;
  const quociente = (n * 2n + d) / (d * 2n);
  return negativo ? -quociente : quociente;
}

/**
 * Reparte um valor em `partes` parcelas que somam exatamente o original.
 * Os centavos de resto vão para as primeiras parcelas — assim a soma fecha
 * sempre, que é o que a conferência do administrador judicial vai checar.
 */
export function repartir(valor: Centavos, partes: number): Centavos[] {
  if (!Number.isInteger(partes) || partes <= 0) {
    throw new ErroDeValor(`número de parcelas inválido: ${partes}`);
  }
  const n = BigInt(partes);
  const base = valor / n;
  const resto = valor - base * n;
  const sinal = resto < 0n ? -1n : 1n;
  const sobra = resto < 0n ? -resto : resto;
  return Array.from({ length: partes }, (_, i) =>
    base + (BigInt(i) < sobra ? sinal : 0n),
  );
}

/** Soma uma lista de valores. */
export function somar(valores: readonly Centavos[]): Centavos {
  return valores.reduce((a, b) => a + b, 0n);
}

export class ErroDeValor extends Error {
  override readonly name = 'ErroDeValor';
}
