/**
 * Datas em ISO `YYYY-MM-DD`, sem fuso e sem `Date` na aritmética.
 *
 * `new Date('2026-01-31')` + 1 mês é uma fonte clássica de erro de vencimento.
 * Aqui a soma de meses satura no último dia do mês de destino: 31/01 + 1 mês
 * = 28/02 (ou 29/02 em bissexto), que é como vence boleto e parcela de plano.
 */
export type DataISO = string;

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface PartesDaData { readonly ano: number; readonly mes: number; readonly dia: number }

export function partes(data: DataISO): PartesDaData {
  const m = ISO.exec(data);
  if (!m) throw new ErroDeData(`data fora do formato YYYY-MM-DD: ${data}`);
  const ano = Number(m[1]), mes = Number(m[2]), dia = Number(m[3]);
  if (mes < 1 || mes > 12) throw new ErroDeData(`mês inválido: ${data}`);
  if (dia < 1 || dia > diasNoMes(ano, mes)) throw new ErroDeData(`dia inválido: ${data}`);
  return { ano, mes, dia };
}

export function ehBissexto(ano: number): boolean {
  return (ano % 4 === 0 && ano % 100 !== 0) || ano % 400 === 0;
}

export function diasNoMes(ano: number, mes: number): number {
  const base = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mes - 1];
  if (base === undefined) throw new ErroDeData(`mês inválido: ${mes}`);
  return mes === 2 && ehBissexto(ano) ? 29 : base;
}

export function formatar(ano: number, mes: number, dia: number): DataISO {
  return `${String(ano).padStart(4, '0')}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

/** Soma meses, saturando no último dia do mês de destino. */
export function somarMeses(data: DataISO, meses: number): DataISO {
  if (!Number.isInteger(meses)) throw new ErroDeData(`número de meses inválido: ${meses}`);
  const { ano, mes, dia } = partes(data);
  const total = (ano * 12 + (mes - 1)) + meses;
  const novoAno = Math.floor(total / 12);
  const novoMes = (total % 12 + 12) % 12 + 1;
  const limite = diasNoMes(novoAno, novoMes);
  return formatar(novoAno, novoMes, Math.min(dia, limite));
}

/** Soma dias corridos. */
export function somarDias(data: DataISO, dias: number): DataISO {
  if (!Number.isInteger(dias)) throw new ErroDeData(`número de dias inválido: ${dias}`);
  let { ano, mes, dia } = partes(data);
  dia += dias;
  while (dia > diasNoMes(ano, mes)) {
    dia -= diasNoMes(ano, mes);
    if (++mes > 12) { mes = 1; ano++; }
  }
  while (dia < 1) {
    if (--mes < 1) { mes = 12; ano--; }
    dia += diasNoMes(ano, mes);
  }
  return formatar(ano, mes, dia);
}

/**
 * Dia da semana: 0 = domingo … 6 = sábado.
 *
 * Algoritmo de Sakamoto, aritmética inteira pura. Usar `new Date(iso).getDay()`
 * aqui seria erro: a string ISO é interpretada em UTC e o `getDay()` devolve o
 * dia no fuso local, de modo que no Brasil toda data vira o dia anterior.
 */
export function diaDaSemana(data: DataISO): number {
  const { ano, mes, dia } = partes(data);
  const t = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
  const a = mes < 3 ? ano - 1 : ano;
  return (a + Math.floor(a / 4) - Math.floor(a / 100) + Math.floor(a / 400)
    + t[mes - 1]! + dia) % 7;
}

/** Sábado ou domingo. */
export function ehFimDeSemana(data: DataISO): boolean {
  const d = diaDaSemana(data);
  return d === 0 || d === 6;
}

/** Comparação lexicográfica, que no formato ISO é também cronológica. */
export function comparar(a: DataISO, b: DataISO): number {
  partes(a); partes(b);
  return a < b ? -1 : a > b ? 1 : 0;
}

export class ErroDeData extends Error {
  override readonly name = 'ErroDeData';
}
