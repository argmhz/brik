import { Camera2D, Renderer, propagateTransforms } from "@brik/runtime";
import { Show, createSignal, onCleanup, onMount } from "solid-js";
import type { Editor } from "../core/editor";
import { useVersion } from "./hooks";

/** Shows the game through its own cameras. Receives the game's pointer input in play mode. */
export function GameView(props: { editor: Editor }) {
  const editor = props.editor;
  const play = useVersion(editor, "play");
  const [error, setError] = createSignal("");
  const [noCamera, setNoCamera] = createSignal(false);
  let container!: HTMLDivElement;
  let canvas!: HTMLCanvasElement;
  let raf = 0;

  onMount(() => {
    let renderer: Renderer;
    try {
      renderer = new Renderer(canvas);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return;
    }
    editor.play.element = container;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      if (container.clientWidth === 0) return; // tab hidden
      const world = editor.world;
      if (!editor.play.active) propagateTransforms.run(world);
      setNoCamera(world.query([Camera2D]).isEmpty());
      renderer.render(world);
    };
    raf = requestAnimationFrame(frame);
  });

  onCleanup(() => {
    cancelAnimationFrame(raf);
    if (editor.play.element === container) editor.play.element = null;
  });

  return (
    <div class="scene-view game-view" ref={container} tabIndex={0}>
      <canvas ref={canvas} />
      <Show when={error() || noCamera()}>
        <div class="game-note">{error() || "Scenen har intet kamera. Tilføj en entity med Camera2D."}</div>
      </Show>
      <Show when={!error() && !noCamera() && (play(), !editor.play.active)}>
        <div class="game-note subtle">Tryk Play for at starte spillet</div>
      </Show>
    </div>
  );
}
