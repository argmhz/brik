import { ScriptRegistry, rehydrateMissing } from "@brik/runtime";
import type { Editor } from "./editor";
import {
  type CompileError,
  type EsbuildLike,
  compileScripts,
  exposeRuntime,
  importCode,
  readScripts,
  scriptSignature,
} from "./scripts";
import { SourceMapper } from "./source-map";

export type ScriptStatus = "none" | "building" | "ok" | "error";

/**
 * Compiles the project's scripts and loads them into the ScriptRegistry.
 * `poll()` rebuilds when files change, also when they are edited outside the
 * editor (e.g. in VS Code on a folder project).
 */
export class ScriptHost {
  readonly registry: ScriptRegistry;
  status: ScriptStatus = "none";
  errors: CompileError[] = [];
  /** Maps positions in the loaded bundle back to script files (for runtime errors). */
  sourceMap: SourceMapper | null = null;
  fileCount = 0;
  private signature = "";
  private pending: Promise<boolean> | null = null;
  private again = false;
  /** The last code that loaded, and whether it has been used by a play session yet. */
  private lastCode: string | null = null;
  private used = false;

  constructor(
    private readonly editor: Editor,
    private readonly getEsbuild?: () => Promise<EsbuildLike>,
    private readonly load: (code: string) => Promise<Record<string, unknown>> = importCode,
  ) {
    this.registry = editor.world.hasResource(ScriptRegistry)
      ? editor.world.resource(ScriptRegistry)
      : editor.world.insertResource(new ScriptRegistry());
  }

  /** The compiler, for other builds (e.g. exporting the game). */
  compiler(): Promise<EsbuildLike> {
    if (!this.getEsbuild) return Promise.reject(new Error("Scripts er ikke slået til i denne editor"));
    return this.getEsbuild();
  }

  get enabled(): boolean {
    return !!this.getEsbuild;
  }

  /** Builds now. Concurrent calls share one build, plus one more if files changed meanwhile. */
  rebuild(): Promise<boolean> {
    if (!this.getEsbuild) return Promise.resolve(true);
    if (this.pending) {
      this.again = true;
      return this.pending;
    }
    this.pending = (async () => {
      let ok = false;
      do {
        this.again = false;
        ok = await this.build();
      } while (this.again);
      return ok;
    })().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  /** Rebuilds if any script changed since the last build. Returns false if the scripts have errors. */
  async poll(): Promise<boolean> {
    if (!this.getEsbuild) return true;
    if (this.pending) return this.pending;
    const sig = await scriptSignature(this.editor.fs);
    if (sig !== this.signature) return this.rebuild();
    return this.status !== "error";
  }

  /**
   * Gives a play session fresh script modules, so module-level state (e.g. a
   * score in an exported object) starts over every time, like in the exported game.
   */
  async freshForPlay(): Promise<void> {
    if (!this.lastCode) return;
    if (!this.used) {
      this.used = true;
      return;
    }
    const mod = await this.load(this.lastCode);
    this.registry.load((mod.modules ?? {}) as Record<string, Record<string, unknown>>);
  }

  private async build(): Promise<boolean> {
    const editor = this.editor;
    this.status = "building";
    editor.emit("scripts");
    try {
      this.signature = await scriptSignature(editor.fs);
      const files = await readScripts(editor.fs);
      this.fileCount = Object.keys(files).length;
      exposeRuntime();
      const result = await compileScripts(await this.getEsbuild!(), files);
      if (!result.code) {
        this.status = "error";
        this.errors = result.errors;
        for (const e of result.errors) {
          editor.log("error", `${e.file}:${e.line}:${e.column + 1} ${e.message}`, { file: e.file, line: e.line, column: e.column });
        }
        return false;
      }
      const mod = await this.load(result.code);
      this.registry.load((mod.modules ?? {}) as Record<string, Record<string, unknown>>);
      this.lastCode = result.code;
      this.sourceMap = SourceMapper.fromCode(result.code);
      this.used = false;
      this.errors = [];
      this.status = "ok";
      if (rehydrateMissing(editor.world) > 0) editor.emit("world");
      if (this.fileCount > 0) {
        editor.log("info", `Scripts kompileret: ${this.registry.behaviours.size} behaviours, ${this.registry.systems.length} systemer`);
      }
      editor.play.onScriptsReloaded();
      return true;
    } catch (err) {
      this.status = "error";
      this.errors = [{ file: "", line: 0, column: 0, message: String(err instanceof Error ? err.message : err) }];
      editor.log("error", `Scripts kunne ikke indlæses: ${this.errors[0].message}`);
      return false;
    } finally {
      editor.emit("scripts");
      editor.emit("world");
    }
  }
}
