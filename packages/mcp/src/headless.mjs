// Headless mode: the MCP server opens a Brik project itself, in Node, when the
// editor isn't running. The editor's own code does the work (the same handlers
// the live editor answers with), bundled from TypeScript with esbuild the first
// time it is needed. Changes are written to the project folder on save_scene,
// like in the editor.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ENTRY = resolve(here, "../../editor/src/headless/index.ts");

let loading = null;

/** Bundles and imports packages/editor/src/headless (once per process). */
export function loadHeadless() {
  loading ??= (async () => {
    const { build } = await import("esbuild");
    const result = await build({
      entryPoints: [ENTRY],
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      write: false,
      logLevel: "silent",
      // same TypeScript settings as the rest of the repo (class fields, module syntax)
      tsconfig: resolve(here, "../../../tsconfig.base.json"),
    });
    const dir = await mkdtemp(join(tmpdir(), "brik-mcp-"));
    const file = join(dir, "headless.mjs");
    await writeFile(file, result.outputFiles[0].contents);
    try {
      return await import(pathToFileURL(file).href);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  })();
  loading.catch(() => (loading = null));
  return loading;
}

/** esbuild-wasm for compiling the project's scripts, like the browser editor uses. */
let esbuildWasm = null;
const getEsbuild = async () => (esbuildWasm ??= await import("esbuild-wasm"));

/** One project opened headless. */
export class HeadlessSession {
  constructor(project, folder) {
    this.project = project;
    this.folder = folder;
  }

  static async open(folder) {
    const mod = await loadHeadless();
    const project = await mod.openHeadless(folder, { esbuild: getEsbuild });
    return new HeadlessSession(project, project.fs.root);
  }

  get dirty() {
    return this.project.editor.dirty;
  }

  async call(method, params = {}) {
    if (method === "screenshot") {
      throw new Error(
        "Screenshots need the Brik editor; this project is open headless (no renderer). " +
          "Check the game with inspect_entity, find_entities and get_console instead, or ask the user to open the editor.",
      );
    }
    const handler = this.project.handlers[method];
    if (!handler) throw new Error(`Unknown method ${method}`);
    const result = await handler(params);
    if (method === "project_info") return { ...result, headless: true, folder: this.folder };
    return result;
  }

  close() {
    this.project.close();
  }
}
