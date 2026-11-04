import { createSignal, onCleanup } from "solid-js";
import type { Editor, EditorEvent } from "../core/editor";

/**
 * A counter that ticks whenever one of the editor events fires. Read it inside
 * a memo or JSX expression to re-run that code on changes.
 */
export function useVersion(editor: Editor, ...events: EditorEvent[]): () => number {
  const [v, set] = createSignal(0, { equals: false });
  for (const ev of events) onCleanup(editor.on(ev, () => set((n) => n + 1)));
  return v;
}

const [toastState, setToastState] = createSignal<{ text: string; error: boolean } | null>(null);
let toastTimer: ReturnType<typeof setTimeout> | undefined;

/** Shows a short message at the bottom of the screen. */
export function toast(text: string, error = false): void {
  setToastState({ text, error });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => setToastState(null), error ? 5000 : 2200);
}

export function reportError(err: unknown, what = "Noget gik galt"): void {
  console.error(err);
  toast(`${what}: ${err instanceof Error ? err.message : String(err)}`, true);
}

export { toastState };

/** True when keyboard focus is in a text field, so shortcuts should be ignored. */
export function typingInField(): boolean {
  const el = document.activeElement;
  return el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
}

/** Drag-and-drop payload types used inside the editor. */
export const DND = {
  entities: "application/x-brik-entities",
  sprite: "application/x-brik-sprite",
  asset: "application/x-brik-asset",
} as const;
