import { For, Show, createEffect, createSignal, lazy, on, onCleanup, onMount, Suspense } from "solid-js";
import { SCENE_EXTENSION } from "../core/asset-db";
import type { Editor, TileTool } from "../core/editor";
import { TileMap } from "@brik/runtime";
import { basename, joinPath } from "../core/fs";
import { exportZip } from "../core/zip";
import { saveBytes } from "../core/tauri-fs";
import { AssetBrowser } from "./AssetBrowser";
import { ConsolePanel } from "./Console";
import { GameView } from "./GameView";
import { Hierarchy } from "./Hierarchy";
import { Inspector } from "./Inspector";
import { SceneView } from "./SceneView";
import { reportError, toast, typingInField, useVersion } from "./hooks";
import type { SceneController } from "./scene-controller";
import { codeActions, openFiles, setToolWindow, toolWindow } from "./ui-state";
import { type PanelId, draggingPanel, isShown, layout, resetLayout, showPanel } from "./dock-state";
import { DockZone, DropStrip } from "./Dock";
import { AI_PORT, aiActivity, aiState, startAiConnection } from "./ai-connection";
import { SpriteEditor } from "./SpriteEditor";
import { AnimationEditor } from "./AnimationEditor";
import { BuildWindow } from "./BuildWindow";

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
      await saveBytes(`${editor.settings.name}.zip`, await exportZip(editor.fs), "application/zip");
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
    if (await editor.play.start()) showPanel("game");
    else showPanel("console");
  };

  // jump back to the scene when play stops
  createEffect(
    on(mode, (m, prev) => {
      if (m === "edit" && prev && prev !== "edit" && isShown("game")) showPanel("scene");
    }),
  );

  const tileKeys: Record<string, TileTool> = { b: "paint", x: "erase", g: "fill", u: "rect", i: "pick" };
  const tileMapSelected = () => {
    const e = editor.selectedEntities();
    return e.length === 1 && editor.world.has(e[0], TileMap);
  };

  const onKey = (ev: KeyboardEvent) => {
    if (ev.defaultPrevented || toolWindow()) return;
    const mod = ev.ctrlKey || ev.metaKey;
    const key = ev.key.toLowerCase();
    if (mod && key === "s") {
      ev.preventDefault();
      if (isShown("code") && codeActions.save) codeActions.save();
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
    else if (tileKeys[key] && tileMapSelected()) editor.setTileTool(tileKeys[key], undefined);
    else if (key === "escape" && editor.tileTool) editor.setTileTool(null);
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
  const ai = startAiConnection(editor);
  onCleanup(() => ai.dispose());
  const aiTitle = () => {
    const state = aiState();
    const head =
      state === "off"
        ? "AI er slået fra. Klik for at lade en AI (fx Claude Code) arbejde i editoren via Brik-MCP-serveren."
        : state === "waiting"
          ? `Venter på Brik-MCP-serveren på port ${AI_PORT}. Start den fra din AI-klient. Klik for at slå AI fra.`
          : "AI er forbundet. Alle AI-ændringer kan fortrydes med Ctrl+Z. Klik for at afbryde.";
    const recent = aiActivity();
    return recent.length ? `${head}\n\nSeneste:\n${recent.join("\n")}` : head;
  };

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

  const labels: Record<PanelId, () => string> = {
    hierarchy: () => "Hierarki",
    inspector: () => "Inspector",
    scene: () => "Scene",
    game: () => "Spil",
    code: () => `Kode${openFiles().length ? ` (${openFiles().length})` : ""}`,
    assets: () => "Assets",
    console: () => {
      consoleV();
      const errors = editor.console.count("error");
      return errors ? `Console (${errors} ✕)` : "Console";
    },
  };

  // every panel is created once and moved between dock zones as it is
  const page = (content: () => unknown) => (<div class="tab-page dock-page">{content() as any}</div>) as HTMLElement;
  const panels = new Map<PanelId, HTMLElement>([
    ["hierarchy", page(() => <Hierarchy editor={editor} />)],
    ["inspector", page(() => <Inspector editor={editor} />)],
    ["scene", page(() => <SceneView editor={editor} onController={(c) => (controller = c)} />)],
    ["game", page(() => <GameView editor={editor} />)],
    [
      "code",
      page(() => (
        <Show when={openFiles().length > 0} fallback={<div class="empty-note">Dobbeltklik på et script i Assets for at åbne det her.</div>}>
          <Suspense fallback={<div class="empty-note">Indlæser kode-editor…</div>}>
            <CodePanel editor={editor} />
          </Suspense>
        </Show>
      )),
    ],
    ["assets", page(() => <AssetBrowser editor={editor} />)],
    ["console", page(() => <ConsolePanel editor={editor} />)],
  ]);

  const has = (z: "left" | "center" | "bottom" | "right") => layout().zones[z].length > 0;
  /** An empty side zone is hidden, or a thin drop strip while a tab is dragged. */
  const sideWidth = (z: "left" | "right", size: number) => (has(z) ? `${size}px 4px` : draggingPanel() ? "36px 0px" : "0px 0px");
  const columns = () => {
    const [l, lgap] = sideWidth("left", left()).split(" ");
    const [r, rgap] = sideWidth("right", right()).split(" ");
    return `${l} ${lgap} 1fr ${rgap} ${r}`;
  };
  const rows = () => {
    if (!has("bottom")) return draggingPanel() ? "1fr 0px 44px" : "1fr 0px 0px";
    if (!has("center")) return draggingPanel() ? "44px 0px 1fr" : "0px 0px 1fr";
    return `1fr 4px ${bottom()}px`;
  };
  const zone = (z: "left" | "center" | "bottom" | "right") => (
    // grid cells must always exist, so empty zones render a placeholder
    <Show when={has(z)} fallback={<Show when={draggingPanel()} fallback={<div />}>{<DropStrip zone={z} />}</Show>}>
      <DockZone zone={z} panels={panels} labels={labels} />
    </Show>
  );

  return (
    <div class="editor" classList={{ playing: mode() !== "edit" }} ref={root}>
      <div class="menubar">
        <span class="title">Brik</span>
        <span class="scene-name" title={editor.fs.kind === "fsa" || editor.fs.kind === "tauri" ? "Mappe på disken" : "Browser-projekt"}>
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
            <button class={`ghost script-status ${st().cls}`} onClick={() => showPanel("console")}>
              {st().text}
            </button>
          )}
        </Show>
        <button class={`ghost ai-status ${aiState()}`} title={aiTitle()} onClick={() => ai.setEnabled(aiState() === "off")}>
          <span class="ai-dot" />
          AI
        </button>
        <button
          class="primary"
          disabled={mode() !== "edit"}
          onClick={() => setToolWindow({ kind: "build", path: "" })}
          title="Byg spillet til web (itch.io, GitHub Pages …)"
        >
          Byg spil
        </button>
        <button onClick={downloadZip} title="Download hele projektet (kildefilerne) som .zip">
          Projekt .zip
        </button>
        <button class="ghost" onClick={resetLayout} title="Sæt panelerne tilbage, hvor de var fra start">
          ⊞
        </button>
        <button onClick={close}>Luk projekt</button>
      </div>
      <div class="workspace" style={{ "grid-template-columns": columns() }}>
        {zone("left")}
        <Show when={has("left")} fallback={<div />}>
          <Splitter
            dir="v"
            onDrag={(x) => {
              setLeft(clampSide(x));
              store("left", left());
            }}
          />
        </Show>
        <div style={{ display: "grid", "grid-template-rows": rows(), "min-width": 0, "min-height": 0 }}>
          {zone("center")}
          <Show when={has("center") && has("bottom")} fallback={<div />}>
            <Splitter
              dir="h"
              onDrag={(y) => {
                const r = root.getBoundingClientRect();
                setBottom(Math.min(Math.max(r.bottom - y, 90), r.height * 0.7));
                store("bottom", bottom());
              }}
            />
          </Show>
          {zone("bottom")}
        </div>
        <Show when={has("right")} fallback={<div />}>
          <Splitter
            dir="v"
            onDrag={(x) => {
              setRight(clampSide(innerWidth - x));
              store("right", right());
            }}
          />
        </Show>
        {zone("right")}
      </div>
      <Show when={toolWindow()} keyed>
        {(w) =>
          w.kind === "sprite" ? (
            <SpriteEditor editor={editor} path={w.path} onClose={() => setToolWindow(null)} />
          ) : w.kind === "build" ? (
            <BuildWindow editor={editor} onClose={() => setToolWindow(null)} />
          ) : (
            <AnimationEditor editor={editor} path={w.path} onClose={() => setToolWindow(null)} />
          )
        }
      </Show>
    </div>
  );
}
