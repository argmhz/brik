import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import TsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";
import { For, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import type { Editor } from "../core/editor";
import { readScripts } from "../core/scripts";
import types from "../generated/brik-types.json";
import { reportError, toast, useVersion } from "./hooks";
import { activeFile, closeFile, codeActions, openFiles, revealAt, setActiveFile, setRevealAt } from "./ui-state";

let configured = false;

function configureMonaco(): void {
  if (configured) return;
  configured = true;
  (self as unknown as { MonacoEnvironment: monaco.Environment }).MonacoEnvironment = {
    getWorker: (_id, label) => (label === "typescript" || label === "javascript" ? new TsWorker() : new EditorWorker()),
  };
  const ts = monaco.languages.typescript;
  ts.typescriptDefaults.setCompilerOptions({
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
    experimentalDecorators: true,
    strict: true,
    noEmit: true,
    allowNonTsExtensions: true,
  });
  ts.typescriptDefaults.setEagerModelSync(true);
  for (const [path, content] of Object.entries(types as Record<string, string>)) {
    ts.typescriptDefaults.addExtraLib(content, `file:///node_modules/${path}`);
  }
}

const uriOf = (path: string) => monaco.Uri.parse(`file:///project/${path}`);

interface Doc {
  model: monaco.editor.ITextModel;
  saved: number;
  view: monaco.editor.ICodeEditorViewState | null;
}

export default function CodePanel(props: { editor: Editor }) {
  const editor = props.editor;
  const scripts = useVersion(editor, "scripts");
  const docs = new Map<string, Doc>();
  const [dirtyTick, setDirtyTick] = createSignal(0);
  let host!: HTMLDivElement;
  let code: monaco.editor.IStandaloneCodeEditor | undefined;
  /** Bumped when the editor or a file has finished loading, so a waiting line jump can run. */
  const [loaded, setLoaded] = createSignal(0);

  configureMonaco();

  const isDirty = (path: string) => {
    dirtyTick();
    const d = docs.get(path);
    return !!d && d.model.getAlternativeVersionId() !== d.saved;
  };

  /** Creates (or returns) the model for a file. All scripts get models so imports between them type-check. */
  const ensureDoc = (path: string, text: string): Doc => {
    let d = docs.get(path);
    if (d) return d;
    const model = monaco.editor.getModel(uriOf(path)) ?? monaco.editor.createModel(text, "typescript", uriOf(path));
    d = { model, saved: model.getAlternativeVersionId(), view: null };
    model.onDidChangeContent(() => setDirtyTick((n) => n + 1));
    docs.set(path, d);
    return d;
  };

  /** Loads every script, and refreshes clean ones that changed on disk. */
  const syncFromDisk = async () => {
    const files = await readScripts(editor.fs).catch(() => ({}) as Record<string, string>);
    for (const [path, text] of Object.entries(files)) {
      const d = docs.get(path);
      if (!d) ensureDoc(path, text);
      else if (!isDirty(path) && d.model.getValue() !== text) {
        d.model.setValue(text);
        d.saved = d.model.getAlternativeVersionId();
      }
    }
    for (const path of openFiles()) {
      if (path in files) continue;
      if (!(await editor.fs.exists(path))) {
        // deleted outside the code editor: close its tab unless it has unsaved work
        if (!isDirty(path)) {
          docs.get(path)?.model.dispose();
          docs.delete(path);
          closeFile(path);
        }
      } else if (!docs.has(path)) {
        // open but not a script (yet), still needs a model
        ensureDoc(path, await editor.fs.readText(path).catch(() => ""));
      }
    }
    setDirtyTick((n) => n + 1);
  };

  const show = (path: string | null) => {
    if (!code || !path) return;
    const d = docs.get(path);
    if (!d) return;
    const current = code.getModel();
    if (current === d.model) return;
    for (const other of docs.values()) if (other.model === current) other.view = code.saveViewState();
    code.setModel(d.model);
    if (d.view) code.restoreViewState(d.view);
    code.focus();
  };

  const save = async (path = activeFile()) => {
    if (!path) return;
    const d = docs.get(path);
    if (!d) return;
    try {
      await editor.fs.writeFile(path, d.model.getValue());
      d.saved = d.model.getAlternativeVersionId();
      setDirtyTick((n) => n + 1);
      const ok = await editor.scripts.rebuild();
      toast(ok ? `Gemt ${path}` : `Gemt ${path}, men scriptet har fejl`, !ok);
    } catch (err) {
      reportError(err, "Kunne ikke gemme");
    }
  };

  const close = (path: string) => {
    if (isDirty(path) && !confirm(`${path} har ændringer, der ikke er gemt. Luk alligevel?`)) return;
    const d = docs.get(path);
    if (d && isDirty(path)) {
      // drop the unsaved edits
      editor.fs.readText(path).then((t) => d.model.setValue(t), () => {});
    }
    closeFile(path);
  };

  onMount(async () => {
    code = monaco.editor.create(host, {
      theme: "vs-dark",
      automaticLayout: true,
      fontSize: 13,
      tabSize: 2,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      fixedOverflowWidgets: true,
    });
    code.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => save());
    codeActions.save = () => save();
    codeActions.dirty = () => [...docs.keys()].some(isDirty);
    await syncFromDisk();
    show(activeFile());
    setLoaded((n) => n + 1);
  });

  onCleanup(() => {
    codeActions.save = null;
    codeActions.dirty = null;
    code?.dispose();
    for (const d of docs.values()) d.model.dispose();
  });

  // open newly requested files
  createEffect(() => {
    const path = activeFile();
    const files = openFiles();
    if (!path || !code) return;
    if (docs.has(path)) show(path);
    else
      syncFromDisk().then(() => {
        show(path);
        setLoaded((n) => n + 1);
      });
    void files;
  });

  // scripts were rebuilt (maybe after an outside edit): refresh clean files and error markers
  createEffect(() => {
    scripts();
    if (!code) return;
    syncFromDisk().then(() => {
      const errors = editor.scripts.errors;
      for (const [path, d] of docs) {
        monaco.editor.setModelMarkers(
          d.model,
          "brik",
          errors
            .filter((e) => e.file === path)
            .map((e) => ({
              severity: monaco.MarkerSeverity.Error,
              message: e.message,
              startLineNumber: e.line,
              startColumn: e.column + 1,
              endLineNumber: e.line,
              endColumn: (e.lineText?.length ?? e.column + 1) + 1,
            })),
        );
      }
    });
  });

  // jump to a line (e.g. clicked in the console); waits for the editor and the file to load
  createEffect(() => {
    loaded();
    const r = revealAt();
    if (!r || !code || activeFile() !== r.path || !docs.has(r.path)) return;
    show(r.path);
    code.revealLineInCenter(r.line);
    code.setPosition({ lineNumber: r.line, column: r.column + 1 });
    code.focus();
    setRevealAt(null);
  });

  return (
    <div class="code-panel">
      <div class="code-tabs">
        <For each={openFiles()}>
          {(path) => (
            <div class="code-tab" classList={{ active: activeFile() === path }} onClick={() => setActiveFile(path)} title={path}>
              {path.split("/").pop()}
              {isDirty(path) ? " ●" : ""}
              <button
                class="ghost"
                title="Luk"
                onClick={(ev) => {
                  ev.stopPropagation();
                  close(path);
                }}
              >
                ×
              </button>
            </div>
          )}
        </For>
      </div>
      <div class="code-host" ref={host} />
    </div>
  );
}
