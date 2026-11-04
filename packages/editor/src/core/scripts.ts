import * as runtime from "@brik/runtime";
import type { ProjectFS } from "./fs";
import { dirname, joinPath, walk } from "./fs";

/** The parts of the esbuild API the compiler uses (works with esbuild and esbuild-wasm). */
export interface EsbuildLike {
  build(options: Record<string, unknown>): Promise<{ outputFiles?: { text: string }[] }>;
}

export interface CompileError {
  file: string;
  line: number;
  column: number;
  message: string;
  lineText?: string;
}

export interface CompileResult {
  code: string | null;
  errors: CompileError[];
}

/** Script files in a project: every .ts file except type declarations. */
export function isScriptFile(path: string): boolean {
  return path.endsWith(".ts") && !path.endsWith(".d.ts");
}

const RUNTIME_GLOBAL = "__brik";

/** Makes the engine available to compiled scripts as `import ... from "brik"`. */
export function exposeRuntime(): void {
  (globalThis as Record<string, unknown>)[RUNTIME_GLOBAL] = runtime;
}

/**
 * Bundles all project scripts into one ES module that exports
 * `modules: { "<path>": exports }`. Imports of "brik" resolve to the running
 * engine; relative imports resolve between project files.
 */
export async function compileScripts(esbuild: EsbuildLike, files: Record<string, string>): Promise<CompileResult> {
  const paths = Object.keys(files).sort();
  if (paths.length === 0) return { code: "export const modules = {};", errors: [] };

  const entry = [
    ...paths.map((p, i) => `import * as m${i} from ${JSON.stringify(`./${p}`)};`),
    `export const modules = { ${paths.map((p, i) => `${JSON.stringify(p)}: m${i}`).join(", ")} };`,
  ].join("\n");

  const resolveProject = (spec: string, importer: string): string | null => {
    const base = joinPath(dirname(importer), spec);
    for (const candidate of [base, `${base}.ts`, `${base}/index.ts`]) if (candidate in files) return candidate;
    return null;
  };

  const plugin = {
    name: "brik-project",
    setup(build: {
      onResolve: (o: { filter: RegExp; namespace?: string }, cb: (a: { path: string; importer: string; namespace: string }) => unknown) => void;
      onLoad: (o: { filter: RegExp; namespace: string }, cb: (a: { path: string }) => unknown) => void;
    }) {
      build.onResolve({ filter: /^brik:entry$/ }, () => ({ path: "entry", namespace: "brik-entry" }));
      build.onResolve({ filter: /^brik$/ }, () => ({ path: "brik", namespace: "brik-runtime" }));
      build.onResolve({ filter: /.*/ }, (args) => {
        if (!args.path.startsWith(".")) {
          return {
            errors: [{ text: `Kan ikke importere "${args.path}". Brug "brik" eller en relativ sti til et andet script.` }],
          };
        }
        const importer = args.namespace === "brik-entry" ? "" : args.importer;
        const resolved = resolveProject(args.path, importer || "_");
        if (!resolved) return { errors: [{ text: `Filen "${args.path}" findes ikke` }] };
        return { path: resolved, namespace: "project" };
      });
      build.onLoad({ filter: /.*/, namespace: "brik-entry" }, () => ({ contents: entry, loader: "js" }));
      build.onLoad({ filter: /.*/, namespace: "brik-runtime" }, () => ({
        contents: `module.exports = globalThis.${RUNTIME_GLOBAL};`,
        loader: "js",
      }));
      build.onLoad({ filter: /.*/, namespace: "project" }, (args) => ({ contents: files[args.path], loader: "ts" }));
    },
  };

  try {
    const result = await esbuild.build({
      entryPoints: ["brik:entry"],
      bundle: true,
      write: false,
      format: "esm",
      target: "es2022",
      sourcemap: "inline",
      logLevel: "silent",
      plugins: [plugin],
      tsconfigRaw: { compilerOptions: { experimentalDecorators: true, useDefineForClassFields: false } },
    });
    return { code: result.outputFiles?.[0]?.text ?? "", errors: [] };
  } catch (err) {
    const failure = err as { errors?: { text: string; location?: { file: string; line: number; column: number; lineText: string } | null }[] };
    if (!failure.errors) throw err;
    return {
      code: null,
      errors: failure.errors.map((e) => ({
        file: e.location?.file.replace(/^project:/, "") ?? "",
        line: e.location?.line ?? 0,
        column: e.location?.column ?? 0,
        message: e.text,
        lineText: e.location?.lineText,
      })),
    };
  }
}

/** Reads every script file in the project. */
export async function readScripts(fs: ProjectFS): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  for (const path of await walk(fs)) if (isScriptFile(path)) files[path] = await fs.readText(path);
  return files;
}

/** A signature of all script files that changes when any of them is edited, added or removed. */
export async function scriptSignature(fs: ProjectFS): Promise<string> {
  const parts: string[] = [];
  for (const path of await walk(fs)) {
    if (!isScriptFile(path)) continue;
    const s = await fs.stat(path).catch(() => ({ mtime: 0, size: 0 }));
    parts.push(`${path}:${s.mtime}:${s.size}`);
  }
  return parts.join("|");
}

/** Loads compiled code as a module. In the browser this uses a blob URL. */
export async function importCode(code: string): Promise<Record<string, unknown>> {
  const url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
  try {
    return await import(/* @vite-ignore */ url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function scriptTemplate(className: string): string {
  return `import { Behaviour, expose } from "brik";

/**
 * Sæt scriptet på en entity i inspectoren ("Tilføj komponent" → Scripts).
 * Felter markeret med @expose kan ændres i inspectoren.
 */
export class ${className} extends Behaviour {
  @expose speed = 90; // grader pr. sekund

  onStart() {
    this.log("startet på", this.entity);
  }

  onUpdate(dt: number) {
    this.transform.rotation += (this.speed * Math.PI / 180) * dt;
  }
}
`;
}

/** Turns "my player" into "MyPlayer". */
export function toClassName(name: string): string {
  const cls = name
    .replace(/\.ts$/, "")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join("");
  return /^[A-Za-z]/.test(cls) ? cls : `Script${cls}`;
}
