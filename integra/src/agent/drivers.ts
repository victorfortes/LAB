import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { readdirSync } from "node:fs";
import type { SourcePdf } from "../pdf/split.ts";
import type { Job } from "../jobs/store.ts";

export interface CaptureContext {
  job: Job;
  /** Pasta do job para gravar a íntegra capturada. */
  dir: string;
  log: (msg: string) => void;
  /** Trava a UI e espera a pessoa liberar (token/PIN, login, exportação assistida). */
  requestHuman: (prompt: string) => Promise<void>;
}

export interface CaptureDriver {
  id: string;
  capture(ctx: CaptureContext): Promise<SourcePdf[]>;
}

export const listPdfs = (dir: string): SourcePdf[] => {
  try {
    return readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith(".pdf"))
      .sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true }))
      .map((name, i) => ({ id: i + 1, name, path: join(dir, name) }));
  } catch {
    return [];
  }
};

/** Importação: a pessoa envia os PDFs já baixados (upload na UI) e libera. Funciona em qualquer tribunal. */
export const inboxDriver: CaptureDriver = {
  id: "importacao",
  async capture(ctx) {
    const dir = join(ctx.dir, "integra");
    await mkdir(dir, { recursive: true });
    if (listPdfs(dir).length === 0) {
      await ctx.requestHuman("Envie os PDFs da íntegra do processo e confirme.");
    }
    const pdfs = listPdfs(dir);
    if (pdfs.length === 0) throw new Error("Nenhum PDF recebido.");
    return pdfs;
  },
};

/**
 * Captura ASSISTIDA no tribunal: abre navegador visível com perfil persistente, trava a UI até a pessoa
 * autenticar com o token (o PIN é digitado só no navegador/sistema do token — o NGA nunca o vê) e
 * grava os downloads que o tribunal entregar ("Exportar Processo → Tudo" no Projudi).
 *
 * Os cliques de busca/exportação NÃO estão automatizados: nenhum seletor foi mapeado em sessão real
 * (ver docs/LIMITATIONS.md). Quando forem, entram aqui sem mudar o resto do fluxo.
 */
export function assistedDriver(profileDir: string): CaptureDriver {
  return {
    id: "assistida",
    async capture(ctx) {
      const { chromium } = await import("playwright");
      const dir = join(ctx.dir, "integra");
      await mkdir(dir, { recursive: true });
      const browser = await chromium.launchPersistentContext(profileDir, { headless: false, acceptDownloads: true });
      try {
        const page = browser.pages()[0] ?? (await browser.newPage());
        const saved: Promise<void>[] = [];
        page.context().on("page", (p) => p.on("download", onDownload));
        page.on("download", onDownload);
        function onDownload(d: import("playwright").Download) {
          saved.push(
            (async () => {
              const name = d.suggestedFilename();
              await d.saveAs(join(dir, name));
              ctx.log(`Download recebido: ${name}`);
            })(),
          );
        }
        await page.goto(ctx.job.url, { waitUntil: "domcontentloaded" });
        await ctx.requestHuman(
          "Selecione o token e digite o PIN na janela do tribunal. Quando estiver autenticado, confirme aqui.",
        );
        await ctx.requestHuman(
          `Abra o processo ${ctx.job.cnj} e exporte a íntegra completa (todos os volumes). ` +
            `Quando os downloads terminarem, confirme aqui.`,
        );
        await Promise.all(saved);
        const pdfs = listPdfs(dir);
        if (pdfs.length === 0) throw new Error("Nenhum PDF foi baixado durante a captura.");
        return pdfs;
      } finally {
        await browser.close();
      }
    },
  };
}
