// Uso: bun scripts/split-cli.ts <saida> <pdf...>  — divide PDFs em partes ≤ 20 MB e confere a cobertura.
import { basename } from "node:path";
import { splitPdfs, verifyCoverage } from "../src/pdf/split.ts";
const [out, ...files] = process.argv.slice(2);
if (!out || files.length === 0) { console.error("uso: split-cli <saida> <pdf...>"); process.exit(1); }
const t = Date.now();
const r = await splitPdfs(files.map((p, i) => ({ id: i + 1, name: basename(p), path: p })), out, {
  maxPages: Number(process.env.NGA_MAX_PAGES ?? 0) || undefined,
  onProgress: (d, n) => process.stdout.write(`\r${d}/${n} págs.`),
});
const problems = verifyCoverage(r);
console.log(`\n${r.parts.length} partes, ${r.sources.reduce((a, s) => a + s.pages, 0)} págs., maior parte ${(Math.max(...r.parts.map((p) => p.bytes)) / 1e6).toFixed(1)} MB, ${((Date.now() - t) / 1000).toFixed(0)} s`);
console.log(problems.length ? problems : "cobertura OK");
