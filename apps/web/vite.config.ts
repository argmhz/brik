import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

export default defineConfig({
  plugins: [solid()],
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
