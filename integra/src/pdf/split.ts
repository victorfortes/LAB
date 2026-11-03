import { PDFDocument } from "pdf-lib";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

export const DEFAULT_MAX_BYTES = 20_000_000;

export interface SourcePdf {
  id: number;
  name: string;
  path: string;
}

export interface Part {
  name: string;
  sourceId: number;
  source: string;
  originalPageStart: number;
  originalPageEnd: number;
  partPageStart: number;
  partPageEnd: number;
  bytes: number;
}

export interface SplitResult {
  sources: { id: number; name: string; pages: number; bytes: number }[];
  parts: Part[];
}

export interface SplitOptions {
  maxBytes?: number;
  /** Teto opcional de páginas por parte (ex.: limite de páginas por PDF da API do Claude). */
  maxPages?: number;
  onProgress?: (done: number, total: number, label: string) => void;
}

async function savePages(src: PDFDocument, from: number, count: number): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  const idx = Array.from({ length: count }, (_, i) => from + i);
  for (const p of await out.copyPages(src, idx)) out.addPage(p);
  return out.save({ useObjectStreams: true });
}

/**
 * Divide cada PDF em partes consecutivas, na ordem original, com no máximo `maxBytes` por parte.
 * A divisão regrava os PDFs (assinaturas digitais do original não são preservadas).
 */
export async function splitPdfs(sources: SourcePdf[], outDir: string, opts: SplitOptions = {}): Promise<SplitResult> {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  await mkdir(outDir, { recursive: true });
  const result: SplitResult = { sources: [], parts: [] };
  let seq = 0;

  for (const s of sources) {
    const file = Bun.file(s.path);
    const total = file.size;
    const src = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
    const pages = src.getPageCount();
    result.sources.push({ id: s.id, name: s.name, pages, bytes: total });

    const avg = Math.max(1, total / Math.max(1, pages));
    let start = 0;
    while (start < pages) {
      const cap = Math.min(pages - start, opts.maxPages ?? Infinity);
      let count = Math.max(1, Math.min(cap, Math.floor((maxBytes * 0.9) / avg)));
      let bytes = await savePages(src, start, count);
      while (bytes.byteLength > maxBytes && count > 1) {
        count = Math.max(1, Math.floor(count * (maxBytes / bytes.byteLength) * 0.95));
        bytes = await savePages(src, start, count);
      }
      if (bytes.byteLength > maxBytes) {
        throw new Error(
          `A página ${start + 1} de "${s.name}" sozinha tem ${bytes.byteLength} bytes, acima do limite de ${maxBytes}. Reduza a imagem na origem.`,
        );
      }
      seq += 1;
      const name = `${String(s.id).padStart(2, "0")}_parte-${String(seq).padStart(3, "0")}.pdf`;
      await Bun.write(join(outDir, name), bytes);
      result.parts.push({
        name,
        sourceId: s.id,
        source: s.name,
        originalPageStart: start + 1,
        originalPageEnd: start + count,
        partPageStart: 1,
        partPageEnd: count,
        bytes: bytes.byteLength,
      });
      start += count;
      opts.onProgress?.(start, pages, s.name);
    }
  }
  return result;
}

/** Confere que as partes cobrem todas as páginas de cada origem, em ordem, sem lacunas nem sobreposição. */
export function verifyCoverage(r: SplitResult, maxBytes = DEFAULT_MAX_BYTES): string[] {
  const problems: string[] = [];
  for (const s of r.sources) {
    const ps = r.parts.filter((p) => p.sourceId === s.id);
    let expect = 1;
    for (const p of ps) {
      if (p.originalPageStart !== expect) problems.push(`${p.name}: começa na página ${p.originalPageStart}, esperado ${expect}`);
      expect = p.originalPageEnd + 1;
    }
    if (expect - 1 !== s.pages) problems.push(`${s.name}: cobertura termina em ${expect - 1} de ${s.pages} páginas`);
  }
  for (const p of r.parts) if (p.bytes > maxBytes) problems.push(`${p.name}: ${p.bytes} bytes acima do limite`);
  return problems;
}
