import { join, resolve } from "node:path";
import { openDb, Store } from "../jobs/store.ts";
import { createApp } from "./app.ts";

const root = resolve(import.meta.dir, "../..");
const dataDir = process.env.NGA_DATA_DIR ?? join(root, "data");

function keychainKey(): string | null {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  const r = Bun.spawnSync(["security", "find-generic-password", "-s", "nga-integra-anthropic", "-w"]);
  return r.exitCode === 0 ? r.stdout.toString().trim() || null : null;
}

const store = new Store(openDb(join(dataDir, "nga-integra.db")));
store.failInterrupted();

const app = createApp({
  store,
  dataDir,
  webDir: join(root, "web"),
  getApiKey: keychainKey,
  pipeline: { maxPages: Number(process.env.NGA_MAX_PAGES ?? 100) },
});

const port = Number(process.env.PORT ?? 8792);
Bun.serve({ hostname: "127.0.0.1", port, maxRequestBodySize: 1024 ** 3, idleTimeout: 120, fetch: app.fetch });
console.log(`NGA Íntegra em http://127.0.0.1:${port}  ·  chave Anthropic: ${keychainKey() ? "configurada" : "ausente (bun run set-key)"}`);
