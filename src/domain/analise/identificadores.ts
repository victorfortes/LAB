/**
 * Extração determinística de identificadores de documento brasileiro.
 *
 * O §7.3 e o §9 do briefing mandam usar mecanismo determinístico sempre que
 * possível, em vez de depender de modelo de linguagem. Aqui isso é literal:
 * CNPJ, CPF e número de processo têm DÍGITO VERIFICADOR, então a extração não é
 * palpite — é cálculo. Um CNPJ extraído daqui está certo ou está declarado
 * inválido, e nos dois casos a razão é verificável.
 *
 * Toda ocorrência INVÁLIDA também é devolvida, nunca descartada em silêncio:
 * CNPJ com dígito errado numa petição é achado relevante, não ruído. Quem
 * descarta esconde do advogado exatamente o que ele precisa ver.
 */
import { ErroDeValor, parseReais } from '../shared/dinheiro.ts';
import { diasNoMes, formatar } from '../shared/datas.ts';

export type TipoDeIdentificador =
  | 'cnpj' | 'cpf' | 'processo_cnj' | 'oab' | 'valor' | 'data';

export interface Ocorrencia {
  readonly tipo: TipoDeIdentificador;
  /** Exatamente como está escrito no documento. */
  readonly bruto: string;
  /** Deslocamento em caracteres no texto analisado. */
  readonly posicao: number;
  /**
   * Forma canônica: CNPJ/CPF só dígitos (ou alfanumérico maiúsculo), processo
   * em 20 caracteres, valor em centavos, data em ISO 8601.
   */
  readonly canonico: string;
  /** Para os que têm dígito verificador, é o resultado do cálculo. */
  readonly valido: boolean;
  readonly observacao?: string;
}

// ------------------------------------------------------------------- CNPJ ---

/**
 * O CNPJ alfanumérico (IN RFB nº 2.229/2024) usa o MESMO cálculo de dígito do
 * numérico: o valor de cada caractere é o código ASCII menos 48, de modo que
 * '0'→0 … '9'→9 e 'A'→17 … 'Z'→42. Os dois dígitos verificadores continuam
 * numéricos. Uma implementação serve aos dois formatos, e o CNPJ só de dígitos
 * é caso particular — não há dois caminhos para divergirem.
 */
function valorDoCaractere(c: string): number {
  return c.charCodeAt(0) - 48;
}

const PESOS_CNPJ_1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const PESOS_CNPJ_2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

function digitoModulo11(valores: readonly number[], pesos: readonly number[]): number {
  let soma = 0;
  for (let i = 0; i < pesos.length; i++) soma += valores[i]! * pesos[i]!;
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

/** Remove pontuação de máscara, preservando letras do CNPJ alfanumérico. */
export function limparCnpj(bruto: string): string {
  return bruto.toUpperCase().replace(/[^0-9A-Z]/g, '');
}

export function validarCnpj(bruto: string): boolean {
  const c = limparCnpj(bruto);
  if (c.length !== 14) return false;
  if (!/^[0-9A-Z]{12}\d{2}$/.test(c)) return false;
  // Sequência de caractere repetido passa pelo módulo 11 e não existe na
  // realidade: 00.000.000/0000-00 é o exemplo clássico.
  if (/^(.)\1{13}$/.test(c)) return false;

  const valores = [...c].map(valorDoCaractere);
  const d1 = digitoModulo11(valores, PESOS_CNPJ_1);
  if (d1 !== valores[12]) return false;
  const d2 = digitoModulo11(valores, PESOS_CNPJ_2);
  return d2 === valores[13];
}

export function formatarCnpj(bruto: string): string {
  const c = limparCnpj(bruto);
  if (c.length !== 14) return bruto;
  return `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`;
}

// -------------------------------------------------------------------- CPF ---

export function limparCpf(bruto: string): string {
  return bruto.replace(/\D/g, '');
}

export function validarCpf(bruto: string): boolean {
  const c = limparCpf(bruto);
  if (c.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(c)) return false;

  const d = [...c].map(Number);
  for (const [tamanho, posicao] of [[9, 9], [10, 10]] as const) {
    let soma = 0;
    for (let i = 0; i < tamanho; i++) soma += d[i]! * (tamanho + 1 - i);
    const resto = soma % 11;
    const esperado = resto < 2 ? 0 : 11 - resto;
    if (esperado !== d[posicao]) return false;
  }
  return true;
}

export function formatarCpf(bruto: string): string {
  const c = limparCpf(bruto);
  if (c.length !== 11) return bruto;
  return `${c.slice(0, 3)}.${c.slice(3, 6)}.${c.slice(6, 9)}-${c.slice(9)}`;
}

// -------------------------------------------------- processo (CNJ 65/2008) ---

export interface PartesDoProcesso {
  readonly sequencial: string;
  readonly digito: string;
  readonly ano: string;
  readonly segmento: string;
  readonly tribunal: string;
  readonly origem: string;
}

/**
 * Dígito verificador do número único: D = 98 − ((N × 100) mod 97), onde N é a
 * concatenação sequencial+ano+segmento+tribunal+origem (18 dígitos).
 * BigInt porque 20 dígitos não cabem em Number sem perder precisão.
 */
export function digitoDoProcesso(p: Omit<PartesDoProcesso, 'digito'>): string {
  const base = BigInt(`${p.sequencial}${p.ano}${p.segmento}${p.tribunal}${p.origem}00`);
  return (98n - (base % 97n)).toString().padStart(2, '0');
}

const RE_PROCESSO = /(?<!\d)(\d{7})-?(\d{2})\.?(\d{4})\.?(\d)\.?(\d{2})\.?(\d{4})(?!\d)/g;

export function partesDoProcesso(bruto: string): PartesDoProcesso | null {
  const m = new RegExp(RE_PROCESSO.source).exec(bruto);
  if (!m) return null;
  return {
    sequencial: m[1]!, digito: m[2]!, ano: m[3]!,
    segmento: m[4]!, tribunal: m[5]!, origem: m[6]!,
  };
}

export function validarProcessoCnj(bruto: string): boolean {
  const p = partesDoProcesso(bruto);
  if (!p) return false;
  return digitoDoProcesso(p) === p.digito;
}

export function formatarProcesso(bruto: string): string {
  const p = partesDoProcesso(bruto);
  if (!p) return bruto;
  return `${p.sequencial}-${p.digito}.${p.ano}.${p.segmento}.${p.tribunal}.${p.origem}`;
}

/** Segmento do Judiciário pelo 1º dígito após o ano (Res. CNJ 65/2008, art. 1º). */
export const SEGMENTOS: Readonly<Record<string, string>> = Object.freeze({
  '1': 'Supremo Tribunal Federal',
  '2': 'Conselho Nacional de Justiça',
  '3': 'Superior Tribunal de Justiça',
  '4': 'Justiça Federal',
  '5': 'Justiça do Trabalho',
  '6': 'Justiça Eleitoral',
  '7': 'Justiça Militar da União',
  '8': 'Justiça Estadual',
  '9': 'Justiça Militar estadual',
});

// -------------------------------------------------------------- varredura ---

const RE_CNPJ_MASCARADO = /(?<![0-9A-Za-z])[0-9A-Z]{2}\.[0-9A-Z]{3}\.[0-9A-Z]{3}\/[0-9A-Z]{4}-\d{2}(?![0-9A-Za-z])/g;
const RE_CNPJ_NU = /(?<!\d)\d{14}(?!\d)/g;
const RE_CPF_MASCARADO = /(?<!\d)\d{3}\.\d{3}\.\d{3}-\d{2}(?!\d)/g;
const RE_CPF_NU = /(?<![\d.])\d{11}(?!\d)/g;
const RE_OAB = /\bOAB\s*[\/\-]?\s*([A-Z]{2})\s*(?:n[º°.]?\s*)?([\d.]{3,8})/gi;

/**
 * Valor monetário. Exige "R$" OU agrupamento de milhar completo: sem essa
 * exigência, "juros de 1,50% ao mês" entraria como R$ 1,50 — e um valor errado
 * num quadro de credores é pior do que um valor ausente.
 */
const RE_VALOR = /(?:R\$\s*(\d{1,3}(?:\.\d{3})*(?:,\d{2})?|\d+(?:,\d{2})?)|(?<![\d.,])(\d{1,3}(?:\.\d{3})+,\d{2})(?![\d%]))/g;

const RE_DATA_NUMERICA = /(?<!\d)(\d{1,2})\/(\d{1,2})\/(\d{4})(?!\d)/g;
const RE_DATA_ISO = /(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/g;
const RE_DATA_EXTENSO =
  /(?<!\d)(\d{1,2})\s+de\s+(janeiro|fevereiro|marco|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s+de\s+(\d{4})/gi;

const MESES: Readonly<Record<string, number>> = Object.freeze({
  janeiro: 1, fevereiro: 2, marco: 3, março: 3, abril: 4, maio: 5, junho: 6,
  julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
});

function dataValida(ano: number, mes: number, dia: number): boolean {
  if (mes < 1 || mes > 12 || dia < 1) return false;
  return dia <= diasNoMes(ano, mes);
}

/**
 * Varre o texto e devolve tudo o que reconheceu, em ordem de posição.
 *
 * Deduplica por tipo + canônico + posição, porque as máscaras se sobrepõem:
 * um CNPJ formatado também contém um trecho com cara de outra coisa.
 */
export function extrairIdentificadores(texto: string): Ocorrencia[] {
  const achados: Ocorrencia[] = [];
  const ocupado: Array<[number, number]> = [];

  function livre(inicio: number, fim: number): boolean {
    return !ocupado.some(([a, b]) => inicio < b && a < fim);
  }
  function reservar(inicio: number, fim: number): void {
    ocupado.push([inicio, fim]);
  }

  function varrer(
    re: RegExp,
    montar: (m: RegExpExecArray) => Omit<Ocorrencia, 'posicao' | 'bruto'> | null,
  ): void {
    const r = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
    let m: RegExpExecArray | null;
    while ((m = r.exec(texto)) !== null) {
      if (m[0].length === 0) { r.lastIndex++; continue; }
      const fim = m.index + m[0].length;
      if (!livre(m.index, fim)) continue;
      const base = montar(m);
      if (!base) continue;
      reservar(m.index, fim);
      achados.push({ ...base, bruto: m[0], posicao: m.index });
    }
  }

  // Ordem importa: o mais específico (com máscara) reserva o trecho primeiro,
  // senão o CNPJ "12.345.678/0001-95" seria lido em pedaços.
  varrer(RE_PROCESSO, (m) => {
    const p: PartesDoProcesso = {
      sequencial: m[1]!, digito: m[2]!, ano: m[3]!,
      segmento: m[4]!, tribunal: m[5]!, origem: m[6]!,
    };
    const valido = digitoDoProcesso(p) === p.digito;
    return {
      tipo: 'processo_cnj',
      canonico: `${p.sequencial}-${p.digito}.${p.ano}.${p.segmento}.${p.tribunal}.${p.origem}`,
      valido,
      observacao: valido
        ? SEGMENTOS[p.segmento]
        : `dígito verificador não confere (esperado ${digitoDoProcesso(p)})`,
    };
  });

  varrer(RE_CNPJ_MASCARADO, (m) => ({
    tipo: 'cnpj',
    canonico: limparCnpj(m[0]),
    valido: validarCnpj(m[0]),
    observacao: validarCnpj(m[0]) ? undefined : 'dígito verificador não confere',
  }));

  varrer(RE_CPF_MASCARADO, (m) => ({
    tipo: 'cpf',
    canonico: limparCpf(m[0]),
    valido: validarCpf(m[0]),
    observacao: validarCpf(m[0]) ? undefined : 'dígito verificador não confere',
  }));

  // Sem máscara, só aceita se o dígito fechar: 14 dígitos seguidos também são
  // um código de barras, um protocolo ou um telefone com DDI colado.
  varrer(RE_CNPJ_NU, (m) =>
    validarCnpj(m[0]) ? { tipo: 'cnpj', canonico: limparCnpj(m[0]), valido: true } : null);
  varrer(RE_CPF_NU, (m) =>
    validarCpf(m[0]) ? { tipo: 'cpf', canonico: limparCpf(m[0]), valido: true } : null);

  varrer(RE_OAB, (m) => ({
    tipo: 'oab',
    canonico: `${m[1]!.toUpperCase()} ${m[2]!.replace(/\./g, '')}`,
    // Inscrição na OAB não tem dígito verificador público: a conferência é na
    // consulta ao Cadastro Nacional dos Advogados, que não está integrada.
    valido: true,
    observacao: 'inscrição não conferida no CNA (integração não construída)',
  }));

  varrer(RE_VALOR, (m) => {
    const texto = m[1] ?? m[2];
    if (texto === undefined) return null;
    try {
      return { tipo: 'valor', canonico: parseReais(texto).toString(), valido: true };
    } catch (e) {
      if (e instanceof ErroDeValor) return null;
      throw e;
    }
  });

  varrer(RE_DATA_NUMERICA, (m) => {
    const [dia, mes, ano] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const valido = dataValida(ano, mes, dia);
    return {
      tipo: 'data',
      canonico: valido ? formatar(ano, mes, dia) : m[0],
      valido,
      observacao: valido ? undefined : 'data inexistente no calendário',
    };
  });

  varrer(RE_DATA_ISO, (m) => {
    const [ano, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const valido = dataValida(ano, mes, dia);
    return {
      tipo: 'data',
      canonico: valido ? formatar(ano, mes, dia) : m[0],
      valido,
      observacao: valido ? undefined : 'data inexistente no calendário',
    };
  });

  varrer(RE_DATA_EXTENSO, (m) => {
    const mes = MESES[m[2]!.toLowerCase()];
    if (mes === undefined) return null;
    const [dia, ano] = [Number(m[1]), Number(m[3])];
    const valido = dataValida(ano, mes, dia);
    return {
      tipo: 'data',
      canonico: valido ? formatar(ano, mes, dia) : m[0],
      valido,
      observacao: valido ? undefined : 'data inexistente no calendário',
    };
  });

  achados.sort((a, b) => a.posicao - b.posicao);
  return achados;
}

/** Agrupa por tipo, preservando a ordem de aparição. */
export function agruparPorTipo(
  ocorrencias: readonly Ocorrencia[],
): Partial<Record<TipoDeIdentificador, Ocorrencia[]>> {
  const mapa: Partial<Record<TipoDeIdentificador, Ocorrencia[]>> = {};
  for (const o of ocorrencias) (mapa[o.tipo] ??= []).push(o);
  return mapa;
}
