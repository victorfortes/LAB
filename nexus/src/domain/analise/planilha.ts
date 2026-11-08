/**
 * Leitor mínimo de .xlsx: só extrai valores, nunca executa nada do arquivo.
 * Sem dependência nova; o tamanho de cada parte é limitado contra bomba de descompressão.
 */
import { inflateRawSync } from 'node:zlib';

const LIMITE_DA_PARTE = 80 * 1024 * 1024;

function partesDoZip(d: Uint8Array): Map<string, Uint8Array> {
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength); const saida = new Map<string, Uint8Array>();
  let fim = -1; for (let i = d.length - 22; i >= Math.max(0, d.length - 66_000); i--) if (v.getUint32(i, true) === 0x06054b50) { fim = i; break; }
  if (fim < 0) throw new Error('planilha corrompida');
  let p = v.getUint32(fim + 16, true); const total = v.getUint16(fim + 10, true);
  for (let n = 0; n < total; n++) {
    const metodo = v.getUint16(p + 10, true), comprimido = v.getUint32(p + 20, true), tamanho = v.getUint32(p + 24, true);
    const tn = v.getUint16(p + 28, true), te = v.getUint16(p + 30, true), tc = v.getUint16(p + 32, true), local = v.getUint32(p + 42, true);
    const nome = new TextDecoder().decode(d.subarray(p + 46, p + 46 + tn)); p += 46 + tn + te + tc;
    if (!/^xl\/(sharedStrings|workbook|worksheets\/sheet\d+)\.xml$/.test(nome)) continue;
    if (tamanho > LIMITE_DA_PARTE) throw new Error('planilha grande demais');
    const ini = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true); const bruto = d.subarray(ini, ini + comprimido);
    saida.set(nome, metodo === 0 ? bruto : new Uint8Array(inflateRawSync(bruto, { maxOutputLength: LIMITE_DA_PARTE })));
  }
  return saida;
}

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const texto = (x: string) => x.replace(/&(amp|lt|gt|quot|apos);|&#(\d+);/g, (_m, e: string, n: string) => (e ? ENT[e]! : String.fromCharCode(Number(n))));
const coluna = (ref: string) => { let n = 0; for (const c of /^[A-Z]+/.exec(ref)?.[0] ?? 'A') n = n * 26 + c.charCodeAt(0) - 64; return n - 1; };

export interface Aba { readonly nome: string; readonly linhas: string[][] }

export function lerXlsx(dados: Uint8Array): Aba[] {
  const p = partesDoZip(dados); const dec = (n: string) => new TextDecoder().decode(p.get(n) ?? new Uint8Array());
  const compartilhadas = [...dec('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => texto([...m[1]!.matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((x) => x[1]).join('')));
  const nomes = [...dec('xl/workbook.xml').matchAll(/<sheet [^>]*name="([^"]+)"/g)].map((m) => texto(m[1]!));
  return [...p.keys()].filter((k) => k.includes('worksheets/')).sort((a, b) => Number(/(\d+)\.xml/.exec(a)![1]) - Number(/(\d+)\.xml/.exec(b)![1])).map((k, i) => {
    const linhas: string[][] = [];
    for (const l of dec(k).matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const atual: string[] = [];
      for (const c of l[1]!.matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = /r="([A-Z]+\d+)"/.exec(c[1]!)?.[1] ?? 'A1'; const t = /t="(\w+)"/.exec(c[1]!)?.[1];
        const v = /<v>([^<]*)<\/v>/.exec(c[2] ?? '')?.[1] ?? /<t[^>]*>([^<]*)<\/t>/.exec(c[2] ?? '')?.[1] ?? '';
        atual[coluna(ref)] = t === 's' ? compartilhadas[Number(v)] ?? '' : texto(v);
      }
      linhas.push(Array.from(atual, (x) => x ?? ''));
    }
    return { nome: nomes[i] ?? `Planilha ${i + 1}`, linhas };
  });
}

/** Planilha em texto tabulado: é o que a análise documental lê. */
export const xlsxParaTexto = (dados: Uint8Array): string =>
  lerXlsx(dados).map((a) => `## ${a.nome}\n${a.linhas.map((l) => l.join('\t')).join('\n')}`).join('\n\n');
