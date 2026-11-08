import { Camera2D, Physics, Renderer, type World, propagateTransforms } from "@brik/runtime";
import { Show, createSignal, onCleanup, onMount } from "solid-js";
import type { Editor } from "../core/editor";
import { captures } from "./captures";
import { useVersion } from "./hooks";

/** Shows the game through its own cameras. Receives the game's pointer input in play mode. */
export function GameView(props: { editor: Editor }) {
  const editor = props.editor;
  const play = useVersion(editor, "play");
  const settings = useVersion(editor, "settings");
  const [error, setError] = createSignal("");
  const [noCamera, setNoCamera] = createSignal(false);
  let container!: HTMLDivElement;
  let canvas!: HTMLCanvasElement;
  let overlay!: HTMLCanvasElement;
  let raf = 0;
  let renderer: Renderer | undefined;

  onMount(() => {
    try {
      renderer = new Renderer(canvas);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return;
    }
    editor.play.element = container;
    const draw = () => {
      const world = editor.world;
      if (!editor.play.active) propagateTransforms.run(world);
      setNoCamera(world.query([Camera2D]).isEmpty());
      renderer!.render(world);
      drawColliders(world);
    };
    /** The physics' own shapes over the game, in the first camera's view. */
    const drawColliders = (world: World) => {
      const ctx = overlay.getContext("2d")!;
      const dpr = Math.min(devicePixelRatio || 1, 2);
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (overlay.width !== Math.round(w * dpr) || overlay.height !== Math.round(h * dpr)) {
        overlay.width = Math.round(w * dpr);
        overlay.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      if (!editor.showColliders || !editor.play.active) return;
      const physics = world.tryResource(Physics);
      const lines = physics?.debugLines();
      const C = world.store(Camera2D);
      const cam = world
        .query([Camera2D])
        .toArray()
        .sort((a, b) => C.priority[a] - C.priority[b])[0];
      if (!physics || !lines || cam === undefined) return;
      const p = { x: 0, y: 0 };
      const at = (x: number, y: number) => renderer!.worldToScreen(world, cam, { x, y }, p);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "rgba(80, 230, 255, 0.95)";
      ctx.beginPath();
      for (let i = 0; i + 3 < lines.length; i += 4) {
        const a = at(lines[i], lines[i + 1]);
        ctx.moveTo(a.x, a.y);
        const b = at(lines[i + 2], lines[i + 3]);
        ctx.lineTo(b.x, b.y);
      }
      ctx.stroke();
      // one-way tiles: their top edge is what characters land on
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(255, 170, 40, 0.95)";
      ctx.beginPath();
      for (const s of physics.oneWayEdges()) {
        const a = at(s.x0, s.y);
        ctx.moveTo(a.x, a.y);
        const b = at(s.x1, s.y);
        ctx.lineTo(b.x, b.y);
      }
      ctx.stroke();
    };
    const frame = () => {
      raf = requestAnimationFrame(frame);
      if (container.clientWidth === 0) return; // tab hidden
      draw();
    };
    captures.game = () => {
      if (container.clientWidth === 0) return null;
      draw(); // and read it back in the same task, before the canvas is cleared
      if (!editor.showColliders || !editor.play.active) return canvas.toDataURL("image/png");
      const out = document.createElement("canvas");
      out.width = canvas.width;
      out.height = canvas.height;
      const ctx = out.getContext("2d")!;
      ctx.drawImage(canvas, 0, 0);
      ctx.drawImage(overlay, 0, 0, out.width, out.height);
      return out.toDataURL("image/png");
    };
    captures.gameSize = () => (container.clientWidth > 0 ? { w: container.clientWidth, h: container.clientHeight } : null);
    raf = requestAnimationFrame(frame);
  });

  onCleanup(() => {
    captures.game = undefined;
    captures.gameSize = undefined;
    cancelAnimationFrame(raf);
    renderer?.dispose();
    if (editor.play.element === container) editor.play.element = null;
  });

  return (
    <div class="scene-view game-view" ref={container} tabIndex={0}>
      <canvas ref={canvas} />
      <canvas ref={overlay} class="overlay" />
      <button
        class="game-toggle"
        tabIndex={-1}
        // keep the click away from the game, and the focus too (so Space doesn't press the button)
        onPointerDown={(ev) => {
          ev.stopPropagation();
          ev.preventDefault();
        }}
        classList={{ active: (settings(), editor.showColliders) }}
        title="Vis fysikkens collidere oven på spillet, mens det kører. Envejsplatformes overkant er orange."
        onClick={() => editor.setShowColliders(!editor.showColliders)}
      >
        Collidere
      </button>
      <Show when={error() || noCamera()}>
        <div class="game-note">{error() || "Scenen har intet kamera. Tilføj en entity med Camera2D."}</div>
      </Show>
      <Show when={!error() && !noCamera() && (play(), !editor.play.active)}>
        <div class="game-note subtle">Tryk Play for at starte spillet</div>
      </Show>
    </div>
  );
}
