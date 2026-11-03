/**
 * Normalização de texto para busca.
 *
 * Documento jurídico brasileiro vem com acentuação inconsistente, OCR trocando
 * "ç" por "c" e quebra de linha no meio da frase. Buscar no texto cru erra por
 * motivo que não tem nada a ver com o conteúdo.
 */

/**
 * Marcas tipográficas do português jurídico que atrapalham a busca sem
 * carregar significado: ordinal ("art. 7º"), grau e o sinal de parágrafo.
 * Sem retirá-las, procurar "art. 7, 2" nunca acha "art. 7º, § 2º".
 */
const TIPOGRAFIA = /[ºª°§]/g;

/** Minúsculas, sem acento nem ordinal, espaço em branco colapsado. */
export function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(TIPOGRAFIA, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normaliza preservando quebra de linha: necessário quando o padrão buscado
 * depende de começo de linha (cabeçalho, título, assinatura).
 */
export function normalizarComLinhas(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(TIPOGRAFIA, '')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n[ \n]*/g, '\n')
    .trim();
}

export interface TextoComMapa {
  readonly alvo: string;
  /** origem[i] = índice, no texto original, do caractere alvo[i]. */
  readonly origem: readonly number[];
}

/**
 * Normaliza mantendo o mapa de volta ao texto original.
 *
 * Sem o mapa, qualquer achado aponta para uma posição no texto normalizado —
 * que não existe em lugar nenhum. O advogado precisa do trecho como está no
 * documento, com acento, maiúscula e quebra de linha originais.
 */
export function normalizarComMapa(texto: string): TextoComMapa {
  const alvo: string[] = [];
  const origem: number[] = [];
  let emEspaco = false;

  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i]!;
    if (/\s/.test(ch)) {
      if (!emEspaco) {
        alvo.push(' ');
        origem.push(i);
        emEspaco = true;
      }
      continue;
    }
    emEspaco = false;
    const sem = ch.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[ºª°§]/g, '');
    for (const c of sem) {
      alvo.push(c);
      origem.push(i);
    }
  }

  return { alvo: alvo.join(''), origem };
}
