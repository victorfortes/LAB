import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import type { Store, Job } from "./store.ts";
import type { CaptureDriver } from "../agent/drivers.ts";
import { DEFAULT_MAX_BYTES, splitPdfs, verifyCoverage } from "../pdf/split.ts";
import { buildManifest, type Manifest } from "../pdf/manifest.ts";
import { analyze, roteiro, type Fetcher } from "../analysis/claude.ts";

export interface PipelineDeps {
  store: Store;
  dataDir: string;
  driverFor: (job: Job) => CaptureDriver;
  getApiKey: () => string | null;
  maxBytes?: number;
  /** Teto de páginas por parte (limite de páginas por PDF da API do Claude). */
  maxPages?: number;
  fetcher?: Fetcher;
}

export const jobDir = (dataDir: string, id: string) => join(dataDir, "jobs", id);

export class Pipeline {
  private gates = new Map<string, () => void>();
  constructor(private d: PipelineDeps) {}

  /** Libera a trava humana de um job. */
  release(jobId: string): boolean {
    const g = this.gates.get(jobId);
    if (!g) return false;
    this.gates.delete(jobId);
    g();
    return true;
  }

  start(jobId: string): void {
    void this.run(jobId).catch((e) => {
      this.d.store.setStatus(jobId, "failed", { error: e instanceof Error ? e.message : String(e) });
    });
  }

  async run(jobId: string): Promise<void> {
    const { store, dataDir } = this.d;
    const job = store.job(jobId)!;
    const dir = jobDir(dataDir, jobId);
    await mkdir(dir, { recursive: true });
    const maxBytes = this.d.maxBytes ?? DEFAULT_MAX_BYTES;

    store.setStatus(jobId, "capturing");
    const sources = await this.d.driverFor(job).capture({
      job,
      dir,
      log: (m) => store.event(jobId, "agent.log", m),
      requestHuman: (prompt) =>
        new Promise<void>((resolve) => {
          store.setStatus(jobId, "awaiting_human", { humanPrompt: prompt });
          this.gates.set(jobId, () => {
            store.setStatus(jobId, "capturing");
            resolve();
          });
        }),
    });

    store.setStatus(jobId, "splitting");
    const partsDir = join(dir, "partes");
    const split = await splitPdfs(sources, partsDir, {
      maxBytes,
      maxPages: this.d.maxPages,
      onProgress: (done, total, label) => store.event(jobId, "split.progress", `${label}: ${done}/${total} págs.`),
    });
    const problems = verifyCoverage(split, maxBytes);
    if (problems.length) throw new Error(`Falha na conferência da divisão: ${problems.join("; ")}`);

    const manifest = buildManifest({
      caseName: job.caseName, cnj: job.cnj, side: job.side, maxBytes,
      capture: this.d.driverFor(job).id, split,
    });
    await Bun.write(join(partsDir, "manifesto.json"), JSON.stringify(manifest, null, 2));
    await Bun.write(join(partsDir, "roteiro-triagem.md"), roteiro(manifest));
    store.setStatus(jobId, "split_done");
    store.event(jobId, "split.done", `${split.parts.length} partes, ${split.sources.reduce((a, s) => a + s.pages, 0)} páginas conferidas`);

    const key = this.d.getApiKey();
    if (!key) {
      store.event(jobId, "analysis.skipped", "Sem chave da API Anthropic: a triagem automática não foi executada. Use o pacote e o roteiro.");
      return;
    }
    store.setStatus(jobId, "analyzing");
    const text = await analyze(manifest, {
      apiKey: key,
      fetcher: this.d.fetcher,
      readPart: async (name) => new Uint8Array(await Bun.file(join(partsDir, name)).arrayBuffer()),
      onProgress: (m) => store.event(jobId, "analysis.progress", m),
    });
    await Bun.write(join(dir, "triagem-preliminar.md"), text);
    store.setStatus(jobId, "review_ready");
  }

  manifest(jobId: string): Promise<Manifest | null> {
    const f = Bun.file(join(jobDir(this.d.dataDir, jobId), "partes", "manifesto.json"));
    return f.exists().then((ok) => (ok ? (f.json() as Promise<Manifest>) : null));
  }
}
