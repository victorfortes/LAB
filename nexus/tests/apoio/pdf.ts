/**
 * Leitor de PDF para os testes.
 *
 * Existe porque asserção sobre `bytes.length > 0` não prova nada: um PDF
 * válido e vazio passa. O que precisa ser verificado é que o número foi
 * PARA DENTRO do arquivo — e para isso é preciso abrir o arquivo, inflar os
 * fluxos de conteúdo e ler os operadores de texto.
 *
 * Não é um parser de PDF; é o suficiente para conferir o que este projeto
 * desenha: texto por `Tj`, em fontes padrão com codificação WinAnsi.
 */
import { inflateSync } from 'node:zlib';

const CP1252 = new TextDecoder('windows-1252');

/** Desfaz os escapes de string literal do PDF e decodifica como WinAnsi. */
function decodificarLiteral(bruto: string): string {
  const bytes: number[] = [];
  for (let i = 0; i < bruto.length; i++) {
    const ch = bruto[i]!;
    if (ch !== '\\') { bytes.push(ch.charCodeAt(0) & 0xff); continue; }

    const proximo = bruto[++i];
    if (proximo === undefined) break;
    if (proximo >= '0' && proximo <= '7') {
      let octal = proximo;
      while (octal.length < 3 && bruto[i + 1] !== undefined
        && bruto[i + 1]! >= '0' && bruto[i + 1]! <= '7') {
        octal += bruto[++i]!;
      }
      bytes.push(parseInt(octal, 8) & 0xff);
      continue;
    }
    const especiais: Record<string, number> = {
      n: 0x0a, r: 0x0d, t: 0x09, b: 0x08, f: 0x0c,
    };
    bytes.push(especiais[proximo] ?? (proximo.charCodeAt(0) & 0xff));
  }
  return CP1252.decode(new Uint8Array(bytes));
}

/** `<4E4741>` → bytes → texto WinAnsi. É a forma que a pdf-lib emite. */
function decodificarHexadecimal(bruto: string): string {
  const limpo = bruto.replace(/\s+/g, '');
  const par = limpo.length % 2 === 0 ? limpo : `${limpo}0`;
  const bytes = new Uint8Array(par.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(par.slice(i * 2, i * 2 + 2), 16);
  }
  return CP1252.decode(bytes);
}

/** Infla todos os fluxos do arquivo; devolve o conteúdo legível de cada um. */
function fluxos(pdf: Uint8Array): string[] {
  const bruto = Buffer.from(pdf);
  const saida: string[] = [];
  let posicao = 0;
  for (;;) {
    const inicio = bruto.indexOf('stream', posicao);
    if (inicio === -1) break;
    const fim = bruto.indexOf('endstream', inicio);
    if (fim === -1) break;

    let corpo = bruto.subarray(inicio + 'stream'.length, fim);
    if (corpo[0] === 0x0d) corpo = corpo.subarray(1);
    if (corpo[0] === 0x0a) corpo = corpo.subarray(1);

    try {
      saida.push(inflateSync(corpo).toString('latin1'));
    } catch {
      saida.push(corpo.toString('latin1'));
    }
    posicao = fim + 'endstream'.length;
  }
  return saida;
}

/** Todo o texto desenhado no PDF, uma string por operador `Tj`. */
export function trechosDoPdf(pdf: Uint8Array): string[] {
  const trechos: string[] = [];

  for (const conteudo of fluxos(pdf)) {
    // Duas formas de string no PDF, e a pdf-lib usa a hexadecimal — descobri
    // isso depois de o leitor voltar vazio contra um arquivo que claramente
    // tinha texto. As duas ficam suportadas.
    const re = /(?:\(((?:\\.|[^\\()])*)\)|<([0-9A-Fa-f\s]*)>)\s*Tj/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(conteudo)) !== null) {
      trechos.push(m[1] !== undefined
        ? decodificarLiteral(m[1])
        : decodificarHexadecimal(m[2] ?? ''));
    }
  }
  return trechos;
}

/** Todo o texto do PDF numa string só, com espaços entre os trechos. */
export function textoDoPdf(pdf: Uint8Array): string {
  return trechosDoPdf(pdf).join(' ');
}

/**
 * Quantas páginas o PDF tem.
 *
 * O catálogo costuma viver dentro de um fluxo de objetos comprimido, então a
 * busca é feita sobre os fluxos inflados, não sobre o arquivo cru.
 */
export function paginasDoPdf(pdf: Uint8Array): number {
  const todo = [Buffer.from(pdf).toString('latin1'), ...fluxos(pdf)].join('\n');
  const m = /\/Type\s*\/Pages\b[\s\S]{0,200}?\/Count\s+(\d+)/.exec(todo)
    ?? /\/Count\s+(\d+)[\s\S]{0,200}?\/Type\s*\/Pages\b/.exec(todo);
  if (m) return Number(m[1]);
  return (todo.match(/\/Type\s*\/Page(?![s])/g) ?? []).length;
}

export function ehPdf(bytes: Uint8Array): boolean {
  return Buffer.from(bytes.subarray(0, 5)).toString('latin1') === '%PDF-';
}
