import wasmURL from "esbuild-wasm/esbuild.wasm?url";
import { Show, createSignal } from "solid-js";
import { render } from "solid-js/web";
import type { LogLevel } from "../core/console-log";
import { Editor } from "../core/editor";
import type { ProjectFS } from "../core/fs";
import { writeProjectTypes } from "../core/project";
import type { EsbuildLike } from "../core/scripts";
import { EditorRoot } from "./EditorRoot";
import { PopupHost } from "./Popup";
import { RecoveryDialog, offerRecovery } from "./RecoveryDialog";
import { StartScreen } from "./StartScreen";
import { reportError, toastState } from "./hooks";
import { resetUiState } from "./ui-state";
import "./styles.css";

const makeUrl = (bytes: Uint8Array, mime: string) => URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));

/**
 * esbuild-wasm can only be initialized once per page. The promise lives on
 * globalThis so a hot-reloaded copy of this module doesn't initialize it again.
 */
const holder = globalThis as { __brikEsbuild?: Promise<EsbuildLike> };
const loadEsbuild = () =>
  (holder.__brikEsbuild ??= (async () => {
    const esbuild = await import("esbuild-wasm");
    await esbuild.initialize({ wasmURL });
    return esbuild as unknown as EsbuildLike;
  })());

const LEVELS: LogLevel[] = ["log", "info", "warn", "error"];

/** Mirrors console output into the editor's console panel. Returns a function that undoes it. */
function captureConsole(editor: Editor): () => void {
  const originals = LEVELS.map((level) => console[level]);
  LEVELS.forEach((level, i) => {
    console[level] = (...args: unknown[]) => {
      originals[i].apply(console, args);
      try {
        editor.logConsole(level, args);
      } catch {
        // never let logging break the caller
      }
    };
  });
  return () => LEVELS.forEach((level, i) => (console[level] = originals[i]));
}

function Root() {
  const [editor, setEditor] = createSignal<Editor | null>(null);
  const [loading, setLoading] = createSignal(false);
  let releaseConsole: (() => void) | null = null;

  const open = async (fs: ProjectFS) => {
    setLoading(true);
    try {
      const ed = await Editor.open(fs, { makeUrl, esbuild: loadEsbuild });
      if (ed.recovery) await offerRecovery(ed);
      releaseConsole = captureConsole(ed);
      resetUiState();
      setEditor(ed);
      // types for VS Code & co. (not needed for the editor itself, so in the background)
      import("../generated/brik-types.json")
        .then((t) => writeProjectTypes(fs, t.default as Record<string, string>))
        .catch((err) => console.warn("Kunne ikke skrive typer til projektet", err));
      // handy for poking around in the devtools console
      Object.assign(globalThis, { editor: ed });
    } catch (err) {
      reportError(err, "Kunne ikke åbne projektet");
    } finally {
      setLoading(false);
    }
  };

  const close = () => {
    releaseConsole?.();
    releaseConsole = null;
    resetUiState();
    editor()?.dispose();
    setEditor(null);
  };

  return (
    <>
      <Show
        when={editor()}
        fallback={
          <Show when={!loading()} fallback={<div class="empty-note">Åbner projekt…</div>}>
            <StartScreen onOpen={open} />
          </Show>
        }
      >
        {(ed) => <EditorRoot editor={ed()} onClose={close} />}
      </Show>
      <PopupHost />
      <RecoveryDialog />
      <Show when={toastState()}>{(t) => <div class="toast" classList={{ error: t().error }}>{t().text}</div>}</Show>
    </>
  );
}

/** Mounts the editor into an element. Returns a function that unmounts it. */
export function mountEditor(el: HTMLElement): () => void {
  return render(() => <Root />, el);
}
