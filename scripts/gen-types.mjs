// Generates type declarations for the engine API that scripts use ("brik").
// The editor feeds them to Monaco and writes them into projects for VS Code.
// Output: packages/editor/src/generated/brik-types.json  ({ "<path>": "<d.ts source>" })
import { mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packages = ["core", "assets", "input", "render", "physics", "audio", "runtime"];

const list = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? list(p) : p.endsWith(".ts") && !p.endsWith(".d.ts") ? [p] : [];
  });

const files = packages.flatMap((p) => list(join(root, "packages", p, "src")));
const options = {
  declaration: true,
  emitDeclarationOnly: true,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  lib: ["lib.es2022.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
  strict: true,
  skipLibCheck: true,
  types: [],
  rootDir: join(root, "packages"),
  outDir: join(root, ".types-out"),
};

const host = ts.createCompilerHost(options);
const out = {};
host.writeFile = (fileName, text) => {
  // .types-out/core/src/x.d.ts -> @brik/core/src/x.d.ts
  const rel = relative(options.outDir, fileName).split("\\").join("/");
  out[`@brik/${rel}`] = text;
};
const program = ts.createProgram(files, options, host);
const result = program.emit(undefined, undefined, undefined, true);
const errors = [...ts.getPreEmitDiagnostics(program), ...result.diagnostics].filter(
  (d) => d.category === ts.DiagnosticCategory.Error,
);
if (errors.length) {
  console.error(ts.formatDiagnostics(errors, { getCanonicalFileName: (f) => f, getCurrentDirectory: () => root, getNewLine: () => "\n" }));
  process.exit(1);
}
for (const p of packages) out[`@brik/${p}/index.d.ts`] = `export * from "./src/index";\n`;
out["brik/index.d.ts"] = `export * from "@brik/runtime";\n`;

const target = join(root, "packages/editor/src/generated/brik-types.json");
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, JSON.stringify(out));
console.log(`brik types: ${Object.keys(out).length} files, ${(JSON.stringify(out).length / 1024).toFixed(0)} KB`);
