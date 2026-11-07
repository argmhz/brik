// Builds the game player (the runtime that exported games run on) into
// minified ES modules. The editor embeds them when exporting a game.
// Output: packages/editor/src/generated/brik.js, plus brik-physics.js with
// Rapier, which games load only when they use physics.
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
      output: {
        format: "es",
        entryFileNames: "brik.js",
        chunkFileNames: "brik-[name].js",
        // Rapier is imported dynamically; give its chunk a fixed name
        manualChunks: (id) => (id.includes("rapier2d") ? "physics" : undefined),
      },
      preserveEntrySignatures: false,
    },
  },
});
const { statSync } = await import("node:fs");
const kb = (f) => (statSync(resolve(root, "packages/editor/src/generated", f)).size / 1024).toFixed(0);
console.log(`brik player: ${kb("brik.js")} KB, physics: ${kb("brik-physics.js")} KB`);
