import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { type Plugin, defineConfig } from "vite";
import solid from "vite-plugin-solid";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

/**
 * Serves the docs site (public/docs, built by scripts/docs/build.mjs) straight from disk in dev.
 * Vite only knows the public files that existed when it started, and every docs build empties and
 * recreates the folder, so without this the Help button lands on the editor's start page instead.
 */
function serveDocs(): Plugin {
  const root = resolve(fileURLToPath(new URL("./public/docs", import.meta.url)));
  return {
    name: "brik:serve-docs",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? "").split("?")[0];
        if (!url.startsWith("/docs/")) return next();
        let path = decodeURIComponent(url.slice("/docs/".length));
        if (path === "" || path.endsWith("/")) path += "index.html";
        const file = resolve(root, path);
        if (!file.startsWith(root + sep) || !existsSync(file) || !statSync(file).isFile()) return next();
        res.setHeader("Content-Type", TYPES[extname(file).toLowerCase()] ?? "application/octet-stream");
        res.setHeader("Cache-Control", "no-cache");
        createReadStream(file).pipe(res);
      });
    },
  };
}

export default defineConfig({
  plugins: [solid(), serveDocs()],
  server: { port: 5180 },
  // these are loaded lazily; pre-bundling them up front avoids a full page
  // reload the first time the code editor or the script compiler is used
  // (nested syntax, since pnpm doesn't hoist them to this package)
  optimizeDeps: {
    include: [
      "@brik/editor > monaco-editor",
      "@brik/editor > esbuild-wasm",
      "@brik/editor > @brik/runtime > @brik/physics > @dimforge/rapier2d-compat",
    ],
  },
  worker: { format: "es" },
});
