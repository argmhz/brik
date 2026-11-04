import { type JSX, Show, createSignal, onCleanup, onMount } from "solid-js";
import { Portal } from "solid-js/web";

export interface PopupState {
  x: number;
  y: number;
  content: () => JSX.Element;
}

const [popup, setPopup] = createSignal<PopupState | null>(null);

/** Opens a floating menu at a screen position. Closes on outside click or Escape. */
export function openPopup(x: number, y: number, content: () => JSX.Element): void {
  setPopup({ x, y, content });
}

export function closePopup(): void {
  setPopup(null);
}

export function PopupHost() {
  let el: HTMLDivElement | undefined;
  const onDown = (ev: PointerEvent) => {
    if (el && !el.contains(ev.target as Node)) closePopup();
  };
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === "Escape") closePopup();
  };
  onMount(() => {
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey);
  });
  onCleanup(() => {
    window.removeEventListener("pointerdown", onDown, true);
    window.removeEventListener("keydown", onKey);
  });
  return (
    <Show when={popup()}>
      {(p) => (
        <Portal>
          <div
            class="popup"
            ref={(node) => {
              el = node;
              // keep the menu on screen
              requestAnimationFrame(() => {
                const r = node.getBoundingClientRect();
                if (r.right > innerWidth) node.style.left = `${Math.max(4, innerWidth - r.width - 4)}px`;
                if (r.bottom > innerHeight) node.style.top = `${Math.max(4, innerHeight - r.height - 4)}px`;
              });
            }}
            style={{ left: `${p().x}px`, top: `${p().y}px` }}
          >
            {p().content()}
          </div>
        </Portal>
      )}
    </Show>
  );
}

export function MenuItem(props: { onClick: () => void; children: JSX.Element; disabled?: boolean }) {
  return (
    <div
      class="item"
      style={{ opacity: props.disabled ? 0.4 : 1 }}
      onClick={() => {
        if (props.disabled) return;
        closePopup();
        props.onClick();
      }}
    >
      {props.children}
    </div>
  );
}
