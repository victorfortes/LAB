/**
 * Texto que cabe num PDF com fonte padrão.
 *
 * As fontes padrão do PDF usam a codificação WinAnsi, que cobre o português
 * inteiro mas não cobre tudo. Nome de credor vindo de OCR traz caractere que
 * não existe ali, e a biblioteca ERRA no meio da geração quando isso acontece.
 *
 * Relatório que falha porque um credor se chama "Mikołaj" é defeito, não
 * detalhe. Então o texto passa por aqui antes de ser desenhado: o que não
 * cabe vira o equivalente sem acento quando existe um, e vira '?' quando não
 * existe — e nunca derruba a geração.
 */

/** Caracteres de 0x80 a 0x9F que o WinAnsi define (o resto da faixa é vazio). */
const ALTOS = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030,
  0x0160, 0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022,
  0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
]);

export function codificavel(ponto: number): boolean {
  if (ponto >= 0x20 && ponto <= 0x7e) return true;   // ASCII imprimível
  if (ponto >= 0xa0 && ponto <= 0xff) return true;   // Latin-1 suplementar
  return ALTOS.has(ponto);
}

/** Substitutos para o que aparece de verdade em documento jurídico. */
const TROCAS: Readonly<Record<string, string>> = Object.freeze({
  '→': '->', '←': '<-', '≤': '<=', '≥': '>=',
  '≠': '!=', ' ': ' ', ' ': ' ', ' ': ' ',
  '‑': '-', '‒': '-', '―': '-',
  'Ł': 'L', 'ł': 'l', 'Đ': 'D', 'đ': 'd',
  '₽': 'RUB', '₹': 'INR',
});

/**
 * Deixa o texto desenhável.
 *
 * Primeiro tenta o próprio caractere; depois a troca conhecida; depois a
 * decomposição sem acento (que resolve a maior parte do que vem de outras
 * línguas latinas); só então desiste e põe '?'.
 */
export function paraWinAnsi(texto: string): string {
  // Espaços exóticos viram espaço comum ANTES de tudo: o não separável é
  // codificável em WinAnsi, mas a quebra de linha deste módulo trata `\s`
  // como separador e partiria nele assim mesmo. Manter o caractere seria
  // prometer um não separável que não se cumpre.
  let saida = '';
  for (const ch of texto.replace(/[\u00a0\u2007\u2009\u202f]/g, ' ')) {
    const ponto = ch.codePointAt(0)!;
    if (codificavel(ponto)) { saida += ch; continue; }
    if (ch === '\n' || ch === '\t') { saida += ch; continue; }

    const trocado = TROCAS[ch];
    if (trocado !== undefined) { saida += trocado; continue; }

    const semAcento = ch.normalize('NFD').replace(/\p{M}/gu, '');
    saida += [...semAcento].every((c) => codificavel(c.codePointAt(0)!)) && semAcento !== ''
      ? semAcento
      : '?';
  }
  return saida;
}

export interface MedidorDeTexto {
  widthOfTextAtSize(texto: string, tamanho: number): number;
}

/**
 * Quebra o texto na largura disponível.
 *
 * Respeita quebra de linha existente, quebra por palavra e, no caso de uma
 * palavra maior que a linha inteira (número de processo colado, URL), parte a
 * palavra — porque deixar estourar a margem é pior do que partir.
 */
export function quebrarLinhas(
  texto: string, fonte: MedidorDeTexto, tamanho: number, largura: number,
): string[] {
  if (largura <= 0) throw new Error('largura disponível precisa ser positiva');
  const linhas: string[] = [];

  for (const paragrafo of paraWinAnsi(texto).split('\n')) {
    if (paragrafo === '') { linhas.push(''); continue; }

    let atual = '';
    for (const palavra of paragrafo.split(/\s+/).filter((p) => p !== '')) {
      const tentativa = atual === '' ? palavra : `${atual} ${palavra}`;
      if (fonte.widthOfTextAtSize(tentativa, tamanho) <= largura) {
        atual = tentativa;
        continue;
      }
      if (atual !== '') { linhas.push(atual); atual = ''; }

      // Palavra sozinha maior que a linha: parte onde couber.
      let resto = palavra;
      while (fonte.widthOfTextAtSize(resto, tamanho) > largura) {
        let corte = resto.length - 1;
        while (corte > 1 && fonte.widthOfTextAtSize(resto.slice(0, corte), tamanho) > largura) {
          corte--;
        }
        linhas.push(resto.slice(0, corte));
        resto = resto.slice(corte);
      }
      atual = resto;
    }
    linhas.push(atual);
  }

  return linhas;
}

/** Corta com reticências quando não couber, para célula de tabela. */
export function encurtar(
  texto: string, fonte: MedidorDeTexto, tamanho: number, largura: number,
): string {
  const limpo = paraWinAnsi(texto);
  if (fonte.widthOfTextAtSize(limpo, tamanho) <= largura) return limpo;
  let corte = limpo.length;
  while (corte > 1 && fonte.widthOfTextAtSize(`${limpo.slice(0, corte)}...`, tamanho) > largura) {
    corte--;
  }
  return `${limpo.slice(0, corte).trimEnd()}...`;
}
