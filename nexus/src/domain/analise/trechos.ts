/**
 * Ancoragem de achado no documento e divisão em partes.
 *
 * ESTE É O MECANISMO QUE TORNA A ANÁLISE CONFERÍVEL.
 *
 * O §7.7 exige que toda referência seja verificável, e o §18 proíbe "dados
 * falsos apresentados como reais". A regra que decorre disso é simples e dura:
 * todo achado precisa citar LITERALMENTE um trecho que exista no documento, e
 * a plataforma confere — não acredita. Achado cuja citação não ancora é
 * recusado antes de chegar ao advogado.
 *
 * Isso não depende de o modelo cooperar. Um resumo bonito que ninguém pode
 * localizar no documento vale zero; um achado ancorado pode ser aberto no
 * original, no trecho exato, e conferido em dois segundos.
 *
 * A comparação é tolerante ao que o OCR estraga (acento, caixa, quebra de
 * linha, espaço duplo) e intolerante ao que importa (as palavras). O trecho
 * devolvido é sempre o do DOCUMENTO, nunca o que o modelo escreveu — se o
 * modelo trocou uma palavra, o advogado lê a versão verdadeira.
 */
import { normalizarComMapa } from './texto.ts';

export interface Ancora {
  /** Trecho como está no documento, não como a análise o escreveu. */
  readonly trechoReal: string;
  readonly inicio: number;
  readonly fim: number;
  /** Houve diferença entre o que foi citado e o que está escrito. */
  readonly divergeDoCitado: boolean;
}

/** Citação curta demais ancora em qualquer lugar e não prova nada. */
export const MINIMO_ANCORAVEL = 12;

/**
 * Localiza a citação no documento.
 *
 * Devolve `null` quando não encontra — e `null` significa REJEITAR o achado,
 * não "tentar de outro jeito".
 */
export function ancorar(documento: string, citacao: string): Ancora | null {
  const alvoCitacao = normalizarComMapa(citacao).alvo.trim();
  if (alvoCitacao.length < MINIMO_ANCORAVEL) return null;

  const { alvo, origem } = normalizarComMapa(documento);
  const i = alvo.indexOf(alvoCitacao);
  if (i === -1) return null;

  const inicio = origem[i] ?? 0;
  // +1 porque `origem` guarda o índice do primeiro caractere original que gerou
  // aquele caractere normalizado; o fim precisa incluí-lo.
  const fim = (origem[i + alvoCitacao.length - 1] ?? inicio) + 1;
  const trechoReal = documento.slice(inicio, fim);

  return {
    trechoReal,
    inicio,
    fim,
    divergeDoCitado: trechoReal !== citacao,
  };
}

/** Quantas das citações ancoram de fato. Base do portão de qualidade. */
export function conferirCitacoes(
  documento: string,
  citacoes: readonly string[],
): { ancoradas: Ancora[]; recusadas: string[] } {
  const ancoradas: Ancora[] = [];
  const recusadas: string[] = [];
  for (const c of citacoes) {
    const a = ancorar(documento, c);
    if (a) ancoradas.push(a);
    else recusadas.push(c);
  }
  return { ancoradas, recusadas };
}

// --------------------------------------------------------------- divisão ---

export interface Parte {
  readonly ordem: number;
  readonly texto: string;
  readonly inicio: number;
  readonly fim: number;
  /** Página onde a parte começa, quando o documento traz marcação. */
  readonly pagina?: number;
}

export interface OpcoesDeDivisao {
  /** Máximo de caracteres por parte. */
  readonly maximo?: number;
  /**
   * Sobreposição entre partes consecutivas, para que um fato escrito em cima
   * do corte não desapareça.
   */
  readonly sobreposicao?: number;
  /**
   * Marcação de página do extrator, com um grupo de captura para o número.
   * O NGA Íntegra produz "--- página N ---" ao dividir os autos.
   */
  readonly marcadorDePagina?: RegExp;
}

const MAXIMO = 12_000;
const SOBREPOSICAO = 300;

/** Corta o mais perto possível de `limite`, preferindo fronteira natural. */
function pontoDeCorte(texto: string, de: number, limite: number): number {
  const ate = Math.min(de + limite, texto.length);
  if (ate >= texto.length) return texto.length;

  const janela = texto.slice(de, ate);
  // Fim de parágrafo, fim de frase, fim de linha — nessa ordem de preferência.
  for (const re of [/\n\s*\n(?![\s\S]*\n\s*\n)/, /[.;:!?]\s(?![\s\S]*[.;:!?]\s)/, /\n(?![\s\S]*\n)/]) {
    const m = re.exec(janela);
    // Só vale se o corte não encurtar demais a parte: metade do limite.
    if (m && m.index > limite / 2) return de + m.index + m[0].length;
  }
  return ate;
}

/**
 * Divide o documento em partes do tamanho que cabe numa chamada de modelo,
 * preservando o deslocamento de cada parte no texto original.
 *
 * O deslocamento é o que permite ancorar: um achado da parte 7 aponta para a
 * posição no documento inteiro, não para a posição dentro do pedaço.
 */
export function dividir(texto: string, opcoes: OpcoesDeDivisao = {}): Parte[] {
  const maximo = opcoes.maximo ?? MAXIMO;
  const sobreposicao = Math.min(opcoes.sobreposicao ?? SOBREPOSICAO, Math.floor(maximo / 2));
  if (maximo < 100) throw new Error('parte menor que 100 caracteres não serve para análise');

  const paginas = mapearPaginas(texto, opcoes.marcadorDePagina);
  const partes: Parte[] = [];
  let de = 0;
  let ordem = 1;

  while (de < texto.length) {
    const ate = pontoDeCorte(texto, de, maximo);
    const pagina = paginaEm(paginas, de);
    partes.push({
      ordem: ordem++,
      texto: texto.slice(de, ate),
      inicio: de,
      fim: ate,
      ...(pagina === null ? {} : { pagina }),
    });
    if (ate >= texto.length) break;
    // Avança descontando a sobreposição, sem nunca andar para trás.
    de = Math.max(de + 1, ate - sobreposicao);
  }

  return partes;
}

function mapearPaginas(texto: string, marcador?: RegExp): Array<[number, number]> {
  if (!marcador) return [];
  const re = new RegExp(marcador.source, marcador.flags.includes('g') ? marcador.flags : `${marcador.flags}g`);
  const mapa: Array<[number, number]> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(texto)) !== null) {
    const numero = Number(m[1]);
    if (Number.isInteger(numero)) mapa.push([m.index, numero]);
    if (m[0].length === 0) re.lastIndex++;
  }
  return mapa;
}

function paginaEm(mapa: ReadonlyArray<[number, number]>, posicao: number): number | null {
  let atual: number | null = null;
  for (const [indice, numero] of mapa) {
    if (indice > posicao) break;
    atual = numero;
  }
  return atual;
}

/** Em que parte caiu uma posição do documento. */
export function parteDa(partes: readonly Parte[], posicao: number): Parte | undefined {
  return partes.find((p) => posicao >= p.inicio && posicao < p.fim);
}
