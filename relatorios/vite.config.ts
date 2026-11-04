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
        // TanStack intercepts HTML requests before Vite's public middleware.
         // Generated shell assets also bypass SSR, matching production static hosting.
        server.middlewares.use(async (req, res, next) => {
          const pathname = (req.url || "").split("?")[0] || "";
          const documents: Record<string, string> = {
            "/gerador/": "gerador/index.html",
            "/gerador/index.html": "gerador/index.html",
            "/gerador/app/gerador.html": "gerador/app/gerador.html",
          };
          const document = documents[pathname];
           const assetTypes: Record<string, string> = {
             ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
             ".json": "application/json", ".png": "image/png", ".woff2": "font/woff2",
           };
           const assetType = assetTypes[path.extname(pathname)];
           const asset = pathname.startsWith("/gerador/") && assetType ? pathname.slice(1) : undefined;
           const relative = document || asset;
           if (!relative || !["GET", "HEAD"].includes(req.method || "")) return next();
           const base = path.resolve(server.config.publicDir, "gerador");
           const file = path.resolve(server.config.publicDir, relative);
           if (!file.startsWith(base + path.sep)) return next();
          try {
             const html = await readFile(file);
            res.statusCode = 200;
             res.setHeader("Content-Type", document ? "text/html; charset=utf-8" : assetType || "application/octet-stream");
            res.end(req.method === "HEAD" ? undefined : html);
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
