import { For, Show, createEffect, createSignal, lazy, on, onCleanup, onMount, Suspense } from "solid-js";
import { SCENE_EXTENSION } from "../core/asset-db";
import type { Editor } from "../core/editor";
import { basename, joinPath } from "../core/fs";
import { exportZip } from "../core/zip";
import { AssetBrowser } from "./AssetBrowser";
import { ConsolePanel } from "./Console";
import { GameView } from "./GameView";
import { Hierarchy } from "./Hierarchy";
import { Inspector } from "./Inspector";
import { SceneView } from "./SceneView";
import { reportError, toast, typingInField, useVersion } from "./hooks";
import type { SceneController } from "./scene-controller";
import {
  type BottomTab,
  type CenterTab,
  bottomTab,
  centerTab,
  codeActions,
  openFiles,
  setBottomTab,
  setCenterTab,
} from "./ui-state";

// Monaco is big, so the code editor is only loaded when first opened
const CodePanel = lazy(() => import("./CodeEditor"));

function stored(key: string, fallback: number): number {
  try {
    const v = Number(localStorage.getItem(`brik.layout.${key}`));
    return Number.isFinite(v) && v > 0 ? v : fallback;
  } catch {
    return fallback;
  }
}

function store(key: string, value: number): void {
  try {
    localStorage.setItem(`brik.layout.${key}`, String(Math.round(value)));
  } catch {
    // storage unavailable, layout just isn't remembered
  }
}

/** A draggable divider. `onDrag` gets the pointer position in client pixels. */
function Splitter(props: { dir: "v" | "h"; onDrag: (pos: number) => void }) {
  const [dragging, setDragging] = createSignal(false);
  return (
    <div
      class={`splitter ${props.dir}`}
      classList={{ dragging: dragging() }}
      onPointerDown={(ev) => {
        const el = ev.currentTarget;
        el.setPointerCapture(ev.pointerId);
        setDragging(true);
        const move = (e: PointerEvent) => props.onDrag(props.dir === "v" ? e.clientX : e.clientY);
        const up = () => {
          setDragging(false);
          el.removeEventListener("pointermove", move);
          el.removeEventListener("pointerup", up);
        };
        el.addEventListener("pointermove", move);
        el.addEventListener("pointerup", up);
      }}
    />
  );
}

function Tabs<T extends string>(props: { tabs: { id: T; label: () => string }[]; value: () => T; onSelect: (id: T) => void }) {
  return (
    <div class="tabs">
      <For each={props.tabs}>
        {(t) => (
          <button class="tab" classList={{ active: props.value() === t.id }} onClick={() => props.onSelect(t.id)}>
            {t.label()}
          </button>
        )}
      </For>
    </div>
  );
}

export function EditorRoot(props: { editor: Editor; onClose: () => void }) {
  const editor = props.editor;
  const scene = useVersion(editor, "scene");
  const play = useVersion(editor, "play");
  const scripts = useVersion(editor, "scripts");
  const consoleV = useVersion(editor, "console");
  const [left, setLeft] = createSignal(stored("left", 240));
  const [right, setRight] = createSignal(stored("right", 300));
  const [bottom, setBottom] = createSignal(stored("bottom", 220));
  let controller: SceneController | null = null;
  let root!: HTMLDivElement;

  const mode = () => (play(), editor.play.mode);

  const save = async (saveAs = false) => {
    let path = editor.scenePath;
    if (!path || saveAs) {
      const suggestion = path ? basename(path).replace(SCENE_EXTENSION, "") : "main";
      const name = prompt("Gem scene som:", suggestion);
      if (!name) return;
      path = name.includes("/") ? name : joinPath("scenes", name);
    }
    try {
      const saved = await editor.saveScene(path);
      toast(`Gemt ${saved}`);
    } catch (err) {
      reportError(err, "Kunne ikke gemme");
    }
  };

  const newScene = () => {
    if (editor.dirty && !confirm("Scenen har ændringer, der ikke er gemt. Fortsæt?")) return;
    editor.newScene();
  };

  const downloadZip = async () => {
    try {
      const data = await exportZip(editor.fs);
      const url = URL.createObjectURL(new Blob([data as BlobPart], { type: "application/zip" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${editor.settings.name}.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      reportError(err, "Eksport fejlede");
    }
  };

  const close = () => {
    if (editor.dirty && !confirm("Scenen har ændringer, der ikke er gemt. Luk alligevel?")) return;
    props.onClose();
  };

  const togglePlay = async () => {
    if (editor.play.active) {
      editor.play.stop();
      return;
    }
    if (await editor.play.start()) setCenterTab("game");
    else setBottomTab("console");
  };

  // jump back to the scene when play stops
  createEffect(
    on(mode, (m, prev) => {
      if (m === "edit" && prev && prev !== "edit" && centerTab() === "game") setCenterTab("scene");
    }),
  );

  const onKey = (ev: KeyboardEvent) => {
    if (ev.defaultPrevented) return;
    const mod = ev.ctrlKey || ev.metaKey;
    const key = ev.key.toLowerCase();
    if (mod && key === "s") {
      ev.preventDefault();
      if (centerTab() === "code" && codeActions.save) codeActions.save();
      else save(ev.shiftKey);
      return;
    }
    if (mod && key === "p") {
      ev.preventDefault();
      togglePlay();
      return;
    }
    if (typingInField()) return;
    if (mod && key === "z") {
      ev.preventDefault();
      if (ev.shiftKey) editor.redo();
      else editor.undo();
    } else if (mod && key === "y") {
      ev.preventDefault();
      editor.redo();
    } else if (mod && key === "d") {
      ev.preventDefault();
      editor.duplicateSelection();
    } else if (mod || editor.play.mode === "play") {
      // while the game runs, plain keys belong to the game
      return;
    } else if (key === "delete" || key === "backspace") editor.deleteSelection();
    else if (key === "w") editor.setTool("move");
    else if (key === "e") editor.setTool("rotate");
    else if (key === "r") editor.setTool("scale");
    else if (key === "f") controller?.frameSelection();
    else if (key === "escape") editor.select([]);
  };

  const beforeUnload = (ev: BeforeUnloadEvent) => {
    if (editor.dirty || codeActions.dirty?.()) ev.preventDefault();
  };

  // pick up changes made outside the editor (e.g. scripts edited in VS Code)
  const checkExternal = async () => {
    try {
      await editor.scripts.poll();
    } catch (err) {
      reportError(err);
    }
  };
  const onFocus = async () => {
    await checkExternal();
    await editor.db.refresh().catch(reportError);
    editor.emit("assets");
  };
  let poll: ReturnType<typeof setInterval>;

  onMount(() => {
    // handle for debugging from the browser console
    (window as unknown as { __brikEditor?: Editor }).__brikEditor = editor;
    window.addEventListener("keydown", onKey);
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("focus", onFocus);
    poll = setInterval(() => document.hasFocus() && checkExternal(), 1500);
  });
  onCleanup(() => {
    window.removeEventListener("keydown", onKey);
    window.removeEventListener("beforeunload", beforeUnload);
    window.removeEventListener("focus", onFocus);
    clearInterval(poll);
  });

  const sceneTitle = () => {
    scene();
    return editor.scenePath ? basename(editor.scenePath).replace(SCENE_EXTENSION, "") : "Unavngiven scene";
  };

  const scriptStatus = () => {
    scripts();
    const s = editor.scripts;
    if (!s.enabled) return null;
    if (s.status === "building") return { text: "Kompilerer…", cls: "" };
    if (s.status === "error") return { text: `${s.errors.length} scriptfejl`, cls: "error" };
    if (s.fileCount === 0) return null;
    return { text: "Scripts ✓", cls: "ok" };
  };

  const clampSide = (v: number) => Math.min(Math.max(v, 160), innerWidth * 0.4);

  const centerTabs: { id: CenterTab; label: () => string }[] = [
    { id: "scene", label: () => "Scene" },
    { id: "game", label: () => "Spil" },
    { id: "code", label: () => `Kode${openFiles().length ? ` (${openFiles().length})` : ""}` },
  ];
  const bottomTabs: { id: BottomTab; label: () => string }[] = [
    { id: "assets", label: () => "Assets" },
    {
      id: "console",
      label: () => {
        consoleV();
        const errors = editor.console.count("error");
        return errors ? `Console (${errors} ✕)` : "Console";
      },
    },
  ];

  return (
    <div class="editor" classList={{ playing: mode() !== "edit" }} ref={root}>
      <div class="menubar">
        <span class="title">Brik</span>
        <span class="scene-name" title={editor.fs.kind === "fsa" ? "Mappe på disken" : "Browser-projekt"}>
          {editor.settings.name} · {sceneTitle()}
          <span class="dirty-dot">{(scene(), editor.dirty) ? " ●" : ""}</span>
        </span>
        <button onClick={newScene}>Ny scene</button>
        <button onClick={() => save()} title="Ctrl+S" disabled={mode() !== "edit"}>
          Gem
        </button>
        <button onClick={() => save(true)} title="Ctrl+Shift+S" disabled={mode() !== "edit"}>
          Gem som…
        </button>
        <span class="sep" />
        <button
          disabled={mode() !== "edit" || !(scene(), editor.history.canUndo)}
          title={`Fortryd ${(scene(), editor.history.undoLabel ?? "")} (Ctrl+Z)`}
          onClick={() => editor.undo()}
        >
          ↶
        </button>
        <button
          disabled={mode() !== "edit" || !(scene(), editor.history.canRedo)}
          title={`Gentag ${(scene(), editor.history.redoLabel ?? "")} (Ctrl+Shift+Z)`}
          onClick={() => editor.redo()}
        >
          ↷
        </button>
        <span class="spacer" />
        <div class="play-controls">
          <button class="play-button" classList={{ active: mode() !== "edit" }} onClick={togglePlay} title="Play / Stop (Ctrl+P)">
            {mode() === "edit" ? "▶ Play" : "■ Stop"}
          </button>
          <button
            classList={{ active: mode() === "paused" }}
            disabled={mode() === "edit"}
            onClick={() => (mode() === "paused" ? editor.play.resume() : editor.play.pause())}
            title="Pause"
          >
            ❚❚
          </button>
          <button disabled={mode() === "edit"} onClick={() => editor.play.step()} title="Ét billede frem">
            ⏭
          </button>
        </div>
        <span class="spacer" />
        <Show when={scriptStatus()}>
          {(st) => (
            <button class={`ghost script-status ${st().cls}`} onClick={() => setBottomTab("console")}>
              {st().text}
            </button>
          )}
        </Show>
        <button onClick={downloadZip} title="Download hele projektet som .zip">
          Eksportér .zip
        </button>
        <button onClick={close}>Luk projekt</button>
      </div>
      <div class="workspace" style={{ "grid-template-columns": `${left()}px 4px 1fr 4px ${right()}px` }}>
        <Hierarchy editor={editor} />
        <Splitter
          dir="v"
          onDrag={(x) => {
            setLeft(clampSide(x));
            store("left", left());
          }}
        />
        <div style={{ display: "grid", "grid-template-rows": `1fr 4px ${bottom()}px`, "min-width": 0, "min-height": 0 }}>
          <div class="panel" style={{ "min-height": 0 }}>
            <Tabs tabs={centerTabs} value={centerTab} onSelect={setCenterTab} />
            <div class="tab-page" style={{ display: centerTab() === "scene" ? "flex" : "none" }}>
              <SceneView editor={editor} onController={(c) => (controller = c)} />
            </div>
            <div class="tab-page" style={{ display: centerTab() === "game" ? "flex" : "none" }}>
              <GameView editor={editor} />
            </div>
            <div class="tab-page" style={{ display: centerTab() === "code" ? "flex" : "none" }}>
              <Show
                when={openFiles().length > 0}
                fallback={<div class="empty-note">Dobbeltklik på et script i Assets for at åbne det her.</div>}
              >
                <Suspense fallback={<div class="empty-note">Indlæser kode-editor…</div>}>
                  <CodePanel editor={editor} />
                </Suspense>
              </Show>
            </div>
          </div>
          <Splitter
            dir="h"
            onDrag={(y) => {
              const r = root.getBoundingClientRect();
              setBottom(Math.min(Math.max(r.bottom - y, 90), r.height * 0.7));
              store("bottom", bottom());
            }}
          />
          <div class="panel" style={{ "min-height": 0 }}>
            <Tabs tabs={bottomTabs} value={bottomTab} onSelect={setBottomTab} />
            <div class="tab-page" style={{ display: bottomTab() === "assets" ? "flex" : "none" }}>
              <AssetBrowser editor={editor} />
            </div>
            <div class="tab-page" style={{ display: bottomTab() === "console" ? "flex" : "none" }}>
              <ConsolePanel editor={editor} />
            </div>
          </div>
        </div>
        <Splitter
          dir="v"
          onDrag={(x) => {
            setRight(clampSide(innerWidth - x));
            store("right", right());
          }}
        />
        <Inspector editor={editor} />
      </div>
    </div>
  );
}
