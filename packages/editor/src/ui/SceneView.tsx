import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import { captures } from "./captures";
import { Parallax2D } from "@brik/runtime";
import type { Editor, Tool } from "../core/editor";
import { useVersion } from "./hooks";
import { SceneController } from "./scene-controller";

const TOOLS: { tool: Tool; label: string; key: string }[] = [
  { tool: "move", label: "Flyt", key: "W" },
  { tool: "rotate", label: "Rotér", key: "E" },
  { tool: "scale", label: "Skalér", key: "R" },
];

export function SceneView(props: { editor: Editor; onController?: (c: SceneController | null) => void }) {
  const editor = props.editor;
  const settings = useVersion(editor, "settings");
  const worldVersion = useVersion(editor, "world", "scene");
  const hasParallax = () => (worldVersion(), editor.world.query([Parallax2D]).toArray().length > 0);
  const [info, setInfo] = createSignal("");
  let container!: HTMLDivElement;
  let canvas!: HTMLCanvasElement;
  let overlay!: HTMLCanvasElement;
  let controller: SceneController | null = null;

  const updateInfo = () => {
    if (!controller) return;
    const c = controller.cursor;
    setInfo(`${Math.round(editor.view.zoom * 100)}%   x ${c.x.toFixed(1)}  y ${c.y.toFixed(1)}`);
  };

  onMount(() => {
    try {
      controller = new SceneController(editor, container, canvas, overlay);
      controller.onInfo = updateInfo;
      const c = controller;
      captures.scene = () => c.capture();
      props.onController?.(controller);
      updateInfo();
    } catch (err) {
      setInfo(err instanceof Error ? err.message : String(err));
    }
  });
  onCleanup(() => {
    captures.scene = undefined;
    controller?.dispose();
    props.onController?.(null);
  });

  return (
    <div class="panel" style={{ height: "100%" }}>
      <div class="scene-toolbar">
        <For each={TOOLS}>
          {(t) => (
            <button
              classList={{ active: (settings(), editor.tool === t.tool) }}
              title={`${t.label} (${t.key})`}
              onClick={() => editor.setTool(t.tool)}
            >
              {t.label}
            </button>
          )}
        </For>
        <span class="sep" style={{ width: "1px", height: "18px", background: "var(--border)", margin: "0 4px" }} />
        <button
          classList={{ active: (settings(), editor.snap) }}
          title="Fastgør til grid (hold Ctrl for at skifte midlertidigt)"
          onClick={() => editor.setSnap(!editor.snap)}
        >
          Snap
        </button>
        <select
          style={{ width: "64px" }}
          title="Grid-størrelse"
          value={(settings(), editor.gridSize)}
          onChange={(ev) => {
            editor.gridSize = Number(ev.currentTarget.value);
            editor.emit("settings");
          }}
        >
          <For each={[1, 4, 8, 16, 32, 64]}>{(n) => <option value={n}>{n}</option>}</For>
        </select>
        <button classList={{ active: (settings(), editor.showGrid) }} onClick={() => editor.setShowGrid(!editor.showGrid)}>
          Grid
        </button>
        <Show when={hasParallax()}>
          <button
            classList={{ active: (settings(), editor.showParallax) }}
            title="Vis parallax-lagene, som spillets kamera ser dem fra midten af visningen. Slå fra for at se lagene, hvor de står, når kameraet er i (0, 0)."
            onClick={() => editor.setShowParallax(!editor.showParallax)}
          >
            Parallax
          </button>
        </Show>
        <button title="Fokusér på valgte (F)" onClick={() => controller?.frameSelection()}>
          Fokusér
        </button>
        <span class="spacer" />
        <span class="info">{info()}</span>
      </div>
      <div class="scene-view" ref={container}>
        <canvas ref={canvas} />
        <canvas ref={overlay} class="overlay" />
      </div>
    </div>
  );
}
