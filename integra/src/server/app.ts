import { join, resolve, sep } from "node:path";
import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { Store } from "../jobs/store.ts";
import { Pipeline, jobDir, type PipelineDeps } from "../jobs/pipeline.ts";
import { resolverTribunal } from "../domain/tribunais.ts";
import { assistedDriver, inboxDriver, listPdfs, type CaptureDriver } from "../agent/drivers.ts";

const SESSION_MS = 8 * 3600_000;
const json = (data: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...headers } });

export interface AppDeps {
  store: Store;
  dataDir: string;
  webDir: string;
  getApiKey: () => string | null;
  profileDir?: string;
  pipeline?: Partial<Pick<PipelineDeps, "maxBytes" | "maxPages" | "fetcher">>;
  /** Substitui o driver de captura (testes). */
  driverOverride?: (mode: string) => CaptureDriver;
}

export function createApp(d: AppDeps) {
  const { store } = d;
  const modes = new Map<string, string>();
  const pipeline = new Pipeline({
    store,
    dataDir: d.dataDir,
    getApiKey: d.getApiKey,
    ...d.pipeline,
    driverFor: (job) => {
      const mode = modes.get(job.id) ?? "importacao";
      if (d.driverOverride) return d.driverOverride(mode);
      return mode === "assistida" ? assistedDriver(d.profileDir ?? join(d.dataDir, "browser-profile")) : inboxDriver;
    },
  });

  const cookieOf = (req: Request) => /(?:^|;\s*)nga_session=([^;]+)/.exec(req.headers.get("cookie") ?? "")?.[1] ?? null;
  const userOf = (req: Request) => {
    const t = cookieOf(req);
    return t ? store.sessionUser(t) : null;
  };
  const openSession = (userId: number) => {
    const token = randomUUID() + randomUUID();
    store.createSession(token, userId, SESSION_MS);
    return `nga_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}`;
  };

  async function api(req: Request, url: URL): Promise<Response> {
    const path = url.pathname;
    const method = req.method;

    if (method !== "GET") {
      const origin = req.headers.get("origin");
      if (origin && new URL(origin).host !== url.host) return json({ error: "origem não permitida" }, 403);
    }

    if (path === "/api/state" && method === "GET") {
      return json({ needsSetup: store.userCount() === 0, user: userOf(req)?.username ?? null, hasApiKey: !!d.getApiKey() });
    }
    if (path === "/api/register" && method === "POST") {
      if (store.userCount() > 0) return json({ error: "cadastro já realizado" }, 403);
      const b = (await req.json()) as { username?: string; password?: string };
      if (!b.username?.trim() || (b.password ?? "").length < 12) return json({ error: "Informe usuário e senha com ao menos 12 caracteres." }, 400);
      const { id } = store.createUser(b.username.trim(), await Bun.password.hash(b.password!));
      return json({ ok: true }, 200, { "set-cookie": openSession(id) });
    }
    if (path === "/api/login" && method === "POST") {
      const b = (await req.json()) as { username?: string; password?: string };
      const u = store.userByName(b.username ?? "");
      if (!u || !(await Bun.password.verify(b.password ?? "", u.hash))) return json({ error: "Usuário ou senha inválidos." }, 401);
      return json({ ok: true }, 200, { "set-cookie": openSession(u.id) });
    }
    if (path === "/api/logout" && method === "POST") {
      const t = cookieOf(req);
      if (t) store.deleteSession(t);
      return json({ ok: true }, 200, { "set-cookie": "nga_session=; Path=/; Max-Age=0" });
    }

    const user = userOf(req);
    if (!user) return json({ error: "não autenticado" }, 401);

    if (path === "/api/resolve" && method === "GET") {
      const r = resolverTribunal(url.searchParams.get("numero") ?? "");
      return r ? json(r) : json({ error: "Número CNJ inválido (esperado NNNNNNN-DD.AAAA.J.TR.OOOO)." }, 400);
    }

    if (path === "/api/jobs" && method === "GET") return json(store.jobs(user.id));
    if (path === "/api/jobs" && method === "POST") {
      const b = (await req.json()) as { numero?: string; caseName?: string; side?: string; mode?: string; sistema?: string; url?: string };
      const r = resolverTribunal(b.numero ?? "");
      if (!r) return json({ error: "Número CNJ inválido." }, 400);
      const sistema = b.sistema || r.tribunal?.sistema;
      const target = b.url || r.tribunal?.url;
      const mode = b.mode === "assistida" ? "assistida" : "importacao";
      if (mode === "assistida" && (!sistema || !target)) return json({ error: "Informe o sistema e o endereço do tribunal." }, 400);
      if (mode === "assistida" && !/^https:\/\//.test(target!)) return json({ error: "O endereço do tribunal deve ser https." }, 400);
      const id = randomUUID();
      const job = store.createJob({
        id, userId: user.id, cnj: r.cnj.formatted,
        caseName: (b.caseName ?? "").trim() || r.cnj.formatted,
        side: (b.side ?? "").trim() || "Não informado",
        tribunalCodigo: r.tribunal?.codigo ?? null, sistema: sistema ?? "outro", url: target ?? "",
      });
      modes.set(id, mode);
      await mkdir(join(jobDir(d.dataDir, id), "integra"), { recursive: true });
      if (mode === "assistida") pipeline.start(id);
      return json({ job, avisos: r.avisos }, 201);
    }

    const m = /^\/api\/jobs\/([0-9a-f-]{36})(?:\/([a-z]+)(?:\/(.+))?)?$/.exec(path);
    if (m) {
      const [, id, action, arg] = m;
      const job = store.job(id!);
      if (!job || job.userId !== user.id) return json({ error: "não encontrado" }, 404);
      const dir = jobDir(d.dataDir, id!);

      if (!action && method === "GET") {
        return json({ job, events: store.events(id!), manifest: await pipeline.manifest(id!), hasTriage: await Bun.file(join(dir, "triagem-preliminar.md")).exists() });
      }
      if (action === "upload" && method === "POST") {
        if (job.status !== "queued" && job.status !== "awaiting_human") return json({ error: "Job não aceita envio neste estado." }, 409);
        const form = await req.formData();
        let n = 0;
        for (const f of form.getAll("files")) {
          if (!(f instanceof File) || !/\.pdf$/i.test(f.name)) continue;
          const safe = f.name.replace(/[^\w.\- ()]/g, "_");
          await Bun.write(join(dir, "integra", safe), f);
          n++;
        }
        store.event(id!, "upload", `${n} PDF(s) recebido(s)`);
        return json({ received: n, files: listPdfs(join(dir, "integra")).map((p) => p.name) });
      }
      if (action === "start" && method === "POST") {
        if (job.status !== "queued") return json({ error: "Job já iniciado." }, 409);
        if (listPdfs(join(dir, "integra")).length === 0) return json({ error: "Envie ao menos um PDF." }, 400);
        pipeline.start(id!);
        return json({ ok: true });
      }
      if (action === "release" && method === "POST") {
        if (job.status !== "awaiting_human") return json({ error: "Nada aguardando confirmação." }, 409);
        return json({ ok: pipeline.release(id!) });
      }
      if (action === "file" && method === "GET") {
        const allowed = ["triagem-preliminar.md"];
        const rel = decodeURIComponent(arg ?? "");
        const full = resolve(rel.startsWith("partes/") || allowed.includes(rel) ? join(dir, rel) : "/nope");
        if (!full.startsWith(dir + sep) || !(await Bun.file(full).exists())) return json({ error: "arquivo inexistente" }, 404);
        return new Response(Bun.file(full), { headers: { "content-disposition": `attachment; filename="${full.split(sep).pop()}"` } });
      }
    }
    return json({ error: "rota inexistente" }, 404);
  }

  const webRoot = resolve(d.webDir);
  async function fetchHandler(req: Request): Promise<Response> {
    const url = new URL(req.url);
    try {
      if (url.pathname.startsWith("/api/")) return await api(req, url);
      const rel = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
      const full = resolve(webRoot, rel);
      if (!full.startsWith(webRoot + sep) || !(await Bun.file(full).exists())) return new Response("não encontrado", { status: 404 });
      return new Response(Bun.file(full), { headers: { "x-content-type-options": "nosniff" } });
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : "erro interno" }, 500);
    }
  }

  return { fetch: fetchHandler, pipeline };
}
