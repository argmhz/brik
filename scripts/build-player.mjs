// Builds the game player (the runtime that exported games run on) into one
// minified ES module. The editor embeds it when exporting a game.
// Output: packages/editor/src/generated/brik.js
// (Not "player.js": ad blockers block files with that name.)
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

await build({
  root,
  logLevel: "warn",
  configFile: false,
  build: {
    outDir: resolve(root, "packages/editor/src/generated"),
    emptyOutDir: false,
    minify: true,
    // Rapier embeds its WASM, so the bundle is big by nature
    chunkSizeWarningLimit: 4096,
    target: "es2022",
    // a normal (not library) build, so the ES module is fully minified
    rollupOptions: {
      input: resolve(root, "packages/player/src/main.ts"),
      output: { format: "es", entryFileNames: "brik.js", inlineDynamicImports: true },
      preserveEntrySignatures: false,
    },
  },
});
const { statSync } = await import("node:fs");
const size = statSync(resolve(root, "packages/editor/src/generated/brik.js")).size;
console.log(`brik player: ${(size / 1024).toFixed(0)} KB`);
