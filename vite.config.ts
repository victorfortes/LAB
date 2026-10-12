// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { readFile } from "node:fs/promises";
import path from "node:path";

export default defineConfig({
  vite: {
    plugins: [{
      name: "nga-static-html-preview",
      apply: "serve",
      configureServer(server) {
        // TanStack intercepta requisições antes do middleware público do Vite.
        // A prévia local espelha a hospedagem estática: serve tudo que existe em public/gerador.
        const MIME: Record<string, string> = {
          ".html": "text/html; charset=utf-8",
          ".css": "text/css; charset=utf-8",
          ".js": "text/javascript; charset=utf-8",
          ".json": "application/json; charset=utf-8",
          ".png": "image/png",
          ".jpg": "image/jpeg",
          ".jpeg": "image/jpeg",
          ".svg": "image/svg+xml",
          ".woff": "font/woff",
          ".woff2": "font/woff2",
          ".ttf": "font/ttf",
          ".otf": "font/otf",
          ".ico": "image/x-icon",
          ".map": "application/json; charset=utf-8",
        };
        server.middlewares.use(async (req, res, next) => {
          const pathname = (req.url || "").split("?")[0] || "";
          if (!pathname.startsWith("/gerador") || !["GET", "HEAD"].includes(req.method || "")) return next();
          const rel = decodeURIComponent(pathname)
            .replace(/^\/gerador\/?/, "")
            .replace(/^$/, "index.html")
            .replace(/\/$/, "/index.html");
          try {
            const file = path.resolve(server.config.publicDir, "gerador", rel);
            if (!file.startsWith(path.resolve(server.config.publicDir, "gerador") + path.sep)) return next();
            const data = await readFile(file);
            res.statusCode = 200;
            res.setHeader("Content-Type", MIME[path.extname(file).toLowerCase()] || "application/octet-stream");
            res.end(req.method === "HEAD" ? undefined : data);
          } catch { next(); }
        });
      },
    }],
  },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
