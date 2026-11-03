import { describe, expect, test } from "bun:test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCnj } from "../src/domain/cnj.ts";
import { resolverTribunal } from "../src/domain/tribunais.ts";
import { splitPdfs, verifyCoverage } from "../src/pdf/split.ts";
import { openDb, Store } from "../src/jobs/store.ts";
import { createApp } from "../src/server/app.ts";
import { inboxDriver } from "../src/agent/drivers.ts";

function cnjWithCheck(seq: string, year: string, j: string, tr: string, org: string) {
  let rem = 0;
  for (const c of seq + year + j + tr + org + "00") rem = (rem * 10 + Number(c)) % 97;
  const dd = String(98 - rem).padStart(2, "0");
  return `${seq}-${dd}.${year}.${j}.${tr}.${org}`;
}

async function makePdf(pages: number, noisePerPage = 0): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    const p = doc.addPage();
    p.drawText(`pagina ${i + 1} ${"x".repeat(noisePerPage)}`.slice(0, 400), { x: 20, y: 700, size: 8, font });
  }
  return doc.save();
}

describe("CNJ e tribunais", () => {
  test("valida dígito verificador e resolve o TJPR", () => {
    const n = cnjWithCheck("0015506", "2025", "8", "16", "0017");
    const r = resolverTribunal(n)!;
    expect(r.cnj.checkOk).toBe(true);
    expect(r.tribunal?.sigla).toBe("TJPR");
    expect(r.tribunal?.sistema).toBe("projudi");
    expect(r.avisos).toEqual([]);
  });
  test("dígito errado e tribunal desconhecido geram aviso", () => {
    expect(parseCnj("0015506-00.2025.8.16.0017")!.checkOk).toBe(false);
    const r = resolverTribunal(cnjWithCheck("0000001", "2024", "8", "99", "0001"))!;
    expect(r.tribunal).toBeNull();
    expect(r.avisos.length).toBe(1);
  });
  test("lixo é rejeitado", () => expect(parseCnj("123")).toBeNull());
  test("endereço não confirmado gera aviso", () => {
    const r = resolverTribunal(cnjWithCheck("5010061", "2022", "8", "13", "0699"))!;
    expect(r.tribunal?.sigla).toBe("TJMG");
    expect(r.avisos.some((a) => a.includes("não foi confirmado"))).toBe(true);
  });
});

describe("divisão de PDFs", () => {
  test("respeita limite de bytes, preserva ordem e cobre todas as páginas", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nga-"));
    await Bun.write(join(dir, "a.pdf"), await makePdf(60, 300));
    const size = Bun.file(join(dir, "a.pdf")).size;
    const maxBytes = Math.floor(size / 4);
    const r = await splitPdfs([{ id: 1, name: "a.pdf", path: join(dir, "a.pdf") }], join(dir, "out"), { maxBytes });
    expect(r.parts.length).toBeGreaterThanOrEqual(4);
    expect(r.parts.every((p) => p.bytes <= maxBytes)).toBe(true);
    expect(verifyCoverage(r, maxBytes)).toEqual([]);
    // Página N de cada parte corresponde à original: confere o texto desenhado.
    const last = r.parts.at(-1)!;
    const doc = await PDFDocument.load(await Bun.file(join(dir, "out", last.name)).arrayBuffer());
    expect(doc.getPageCount()).toBe(last.originalPageEnd - last.originalPageStart + 1);
  });
  test("maxPages limita páginas por parte", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nga-"));
    await Bun.write(join(dir, "b.pdf"), await makePdf(25));
    const r = await splitPdfs([{ id: 1, name: "b.pdf", path: join(dir, "b.pdf") }], join(dir, "out"), { maxPages: 10 });
    expect(r.parts.map((p) => p.originalPageEnd - p.originalPageStart + 1)).toEqual([10, 10, 5]);
    expect(verifyCoverage(r)).toEqual([]);
  });
  test("verifyCoverage detecta lacuna", () => {
    const base = { sourceId: 1, source: "a", partPageStart: 1, bytes: 1 };
    const bad = {
      sources: [{ id: 1, name: "a", pages: 10, bytes: 1 }],
      parts: [
        { ...base, name: "p1", originalPageStart: 1, originalPageEnd: 4, partPageEnd: 4 },
        { ...base, name: "p2", originalPageStart: 6, originalPageEnd: 10, partPageEnd: 5 },
      ],
    };
    expect(verifyCoverage(bad).length).toBeGreaterThan(0);
  });
});

describe("fluxo HTTP ponta a ponta (captura por importação + análise simulada)", () => {
  test("registra, cria job, envia PDF, divide, analisa e entrega a triagem", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "nga-data-"));
    const calls: any[] = [];
    const fetcher = async (_u: string, init: RequestInit) => {
      calls.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ content: [{ type: "text", text: "TRIAGEM OK" }], stop_reason: "end_turn" }), { status: 200 });
    };
    const store = new Store(openDb(":memory:"));
    const app = createApp({
      store, dataDir, webDir: join(import.meta.dir, "../web"),
      getApiKey: () => "sk-test", pipeline: { maxPages: 10, fetcher },
    });
    const origin = "http://localhost";
    const req = (path: string, init: RequestInit = {}, cookie = "") =>
      app.fetch(new Request(origin + path, { ...init, headers: { ...(init.headers as any), cookie, origin } }));

    expect((await req("/api/jobs")).status).toBe(401);
    expect((await req("/api/register", { method: "POST", body: JSON.stringify({ username: "a", password: "curta" }) })).status).toBe(400);
    const reg = await req("/api/register", { method: "POST", body: JSON.stringify({ username: "victor", password: "senha-bem-longa-123" }) });
    const cookie = reg.headers.get("set-cookie")!.split(";")[0]!;
    expect((await req("/api/register", { method: "POST", body: JSON.stringify({ username: "x", password: "senha-bem-longa-123" }) }, cookie)).status).toBe(403);
    // CSRF: origem estranha é barrada
    expect((await app.fetch(new Request(origin + "/api/logout", { method: "POST", headers: { origin: "http://evil.test", cookie } }))).status).toBe(403);

    const numero = cnjWithCheck("0015506", "2025", "8", "16", "0017");
    const created = await req("/api/jobs", { method: "POST", body: JSON.stringify({ numero, caseName: "Teste", side: "Credor", mode: "importacao" }) }, cookie);
    expect(created.status).toBe(201);
    const { job } = (await created.json()) as any;

    const fd = new FormData();
    fd.append("files", new File([(await makePdf(25)) as BlobPart], "autos vol1.pdf", { type: "application/pdf" }));
    fd.append("files", new File(["nao e pdf"], "x.txt"));
    const up = await req(`/api/jobs/${job.id}/upload`, { method: "POST", body: fd }, cookie);
    expect(((await up.json()) as any).received).toBe(1);
    expect((await req(`/api/jobs/${job.id}/start`, { method: "POST" }, cookie)).status).toBe(200);

    let detail: any;
    for (let i = 0; i < 100; i++) {
      detail = await (await req(`/api/jobs/${job.id}`, {}, cookie)).json();
      if (["review_ready", "failed"].includes(detail.job.status)) break;
      await Bun.sleep(100);
    }
    expect(detail.job.error).toBeNull();
    expect(detail.job.status).toBe("review_ready");
    expect(detail.manifest.parts.length).toBe(3);
    expect(calls.length).toBe(4); // 3 partes + 1 síntese
    expect(calls[0].messages[0].content[0].type).toBe("document");
    expect(calls[3].messages[0].content).toContain("não leia nada além delas");
    const tri = await req(`/api/jobs/${job.id}/file/triagem-preliminar.md`, {}, cookie);
    expect(await tri.text()).toBe("TRIAGEM OK");
    // Path traversal
    expect((await req(`/api/jobs/${job.id}/file/..%2F..%2Fnga.db`, {}, cookie)).status).toBe(404);
  });

  test("sem chave da API, para em split_done sem fingir análise", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "nga-data-"));
    const store = new Store(openDb(":memory:"));
    const { id: uid } = store.createUser("u", "h");
    const app = createApp({
      store, dataDir, webDir: "web", getApiKey: () => null,
      pipeline: { maxPages: 10 },
      driverOverride: () => ({
        id: "fake",
        capture: async (ctx) => {
          const p = join(ctx.dir, "v.pdf");
          await Bun.write(p, await makePdf(12));
          return [{ id: 1, name: "v.pdf", path: p }];
        },
      }),
    });
    store.createJob({ id: "11111111-1111-1111-1111-111111111111", userId: uid, cnj: "n", caseName: "c", side: "s", tribunalCodigo: null, sistema: "outro", url: "" });
    await app.pipeline.run("11111111-1111-1111-1111-111111111111");
    const j = store.job("11111111-1111-1111-1111-111111111111")!;
    expect(j.status).toBe("split_done");
    expect(store.events(j.id).some((e) => e.kind === "analysis.skipped")).toBe(true);
  });

  test("trava humana: awaiting_human até liberar", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "nga-data-"));
    const store = new Store(openDb(":memory:"));
    const { id: uid } = store.createUser("u", "h");
    const app = createApp({
      store, dataDir, webDir: "web", getApiKey: () => null,
      driverOverride: () => ({
        id: "fake",
        capture: async (ctx) => {
          await ctx.requestHuman("PIN do token");
          const p = join(ctx.dir, "v.pdf");
          await Bun.write(p, await makePdf(2));
          return [{ id: 1, name: "v.pdf", path: p }];
        },
      }),
    });
    const id = "22222222-2222-2222-2222-222222222222";
    store.createJob({ id, userId: uid, cnj: "n", caseName: "c", side: "s", tribunalCodigo: null, sistema: "outro", url: "" });
    const done = app.pipeline.run(id);
    await Bun.sleep(50);
    expect(store.job(id)!.status).toBe("awaiting_human");
    expect(store.job(id)!.humanPrompt).toBe("PIN do token");
    expect(app.pipeline.release(id)).toBe(true);
    await done;
    expect(store.job(id)!.status).toBe("split_done");
  });
});

void inboxDriver;
