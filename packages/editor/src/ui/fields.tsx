import type { SpriteRef } from "@brik/runtime";
import { For, type JSX, Show, createEffect } from "solid-js";
import type { Editor } from "../core/editor";
import { MenuItem, openPopup } from "./Popup";
import { DND } from "./hooks";

/** Calls `onDelta(pixels)` while the pointer is dragged horizontally. */
export function scrubHandlers(onDelta: (dx: number, ev: PointerEvent) => void, onEnd?: () => void) {
  return {
    onPointerDown(ev: PointerEvent) {
      if (ev.button !== 0) return;
      const el = ev.currentTarget as HTMLElement;
      el.setPointerCapture(ev.pointerId);
      let last = ev.clientX;
      const move = (e: PointerEvent) => {
        const dx = e.clientX - last;
        last = e.clientX;
        if (dx !== 0) onDelta(dx, e);
      };
      const up = () => {
        el.removeEventListener("pointermove", move);
        el.removeEventListener("pointerup", up);
        onEnd?.();
      };
      el.addEventListener("pointermove", move);
      el.addEventListener("pointerup", up);
      ev.preventDefault();
    },
  };
}

function format(v: number, integer: boolean): string {
  if (!Number.isFinite(v)) return String(v);
  if (integer) return String(Math.round(v));
  return String(Number(v.toFixed(4)));
}

/**
 * A number input that only overwrites its text while not focused, so typing is
 * never interrupted by updates. Commits on Enter or blur.
 */
export function NumberBox(props: {
  value: () => number;
  onCommit: (v: number) => void;
  integer?: boolean;
  min?: number;
  max?: number;
}) {
  let el!: HTMLInputElement;
  createEffect(() => {
    const v = props.value();
    if (document.activeElement !== el) el.value = format(v, !!props.integer);
  });
  const commit = () => {
    // allow simple math like "16*3"
    const text = el.value.trim().replace(",", ".");
    let v = /^[-+*/().\d\s]+$/.test(text) ? Number(Function(`"use strict";return (${text})`)()) : Number(text);
    if (!Number.isFinite(v)) {
      el.value = format(props.value(), !!props.integer);
      return;
    }
    if (props.integer) v = Math.round(v);
    if (props.min !== undefined) v = Math.max(props.min, v);
    if (props.max !== undefined) v = Math.min(props.max, v);
    if (v !== props.value()) props.onCommit(v);
    el.value = format(v, !!props.integer);
  };
  return (
    <input
      ref={el}
      type="text"
      inputmode="decimal"
      onKeyDown={(ev) => {
        if (ev.key === "Enter") el.blur();
        if (ev.key === "Escape") {
          el.value = format(props.value(), !!props.integer);
          el.blur();
        }
      }}
      onBlur={commit}
    />
  );
}

/** One labelled number in a group (x / y / w / h …). The letter can be dragged to scrub. */
export function Part(props: {
  letter: string;
  value: () => number;
  onCommit: (v: number, live: boolean) => void;
  step?: number;
  integer?: boolean;
  min?: number;
  max?: number;
}) {
  const scrub = scrubHandlers((dx, ev) => {
    const step = (props.step ?? 0.1) * (ev.shiftKey ? 10 : ev.altKey ? 0.1 : 1);
    let v = props.value() + dx * step;
    if (props.integer) v = Math.round(v);
    if (props.min !== undefined) v = Math.max(props.min, v);
    if (props.max !== undefined) v = Math.min(props.max, v);
    props.onCommit(Number(v.toFixed(4)), true);
  });
  return (
    <div class="part">
      <span class={props.letter.toLowerCase()} {...scrub} title="Træk for at ændre">
        {props.letter}
      </span>
      <NumberBox
        value={props.value}
        onCommit={(v) => props.onCommit(v, false)}
        integer={props.integer}
        min={props.min}
        max={props.max}
      />
    </div>
  );
}

export function Checkbox(props: { value: () => boolean; onChange: (v: boolean) => void }) {
  return (
    <input type="checkbox" checked={props.value()} onChange={(ev) => props.onChange(ev.currentTarget.checked)} />
  );
}

export function TextBox(props: { value: () => string; onCommit: (v: string) => void; placeholder?: string }) {
  let el!: HTMLInputElement;
  createEffect(() => {
    const v = props.value();
    if (document.activeElement !== el) el.value = v;
  });
  return (
    <input
      ref={el}
      type="text"
      placeholder={props.placeholder}
      onKeyDown={(ev) => ev.key === "Enter" && el.blur()}
      onBlur={() => el.value !== props.value() && props.onCommit(el.value)}
    />
  );
}

// ------------------------------------------------------------------ colors

export function toHex(r: number, g: number, b: number): string {
  const h = (n: number) =>
    Math.round(Math.max(0, Math.min(1, n)) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

export function fromHex(hex: string): { r: number; g: number; b: number } {
  const n = (i: number) => parseInt(hex.slice(i, i + 2), 16) / 255;
  return { r: n(1), g: n(3), b: n(5) };
}

// ------------------------------------------------------------------ sprites

/** A small preview of one sprite, cropped from its texture with CSS. */
export function SpriteThumb(props: { editor: Editor; sprite: () => SpriteRef | null; size?: number }) {
  const style = (): JSX.CSSProperties => {
    const size = props.size ?? 24;
    const ref = props.sprite();
    if (!ref) return { width: `${size}px`, height: `${size}px` };
    const entry = props.editor.db.byGuid(ref.texture);
    const tex = entry?.asset;
    if (!entry?.url || !tex || !tex.width) return { width: `${size}px`, height: `${size}px` };
    const def = ref.id ? tex.sprites.get(ref.id) : undefined;
    const r = def?.rect ?? { x: 0, y: 0, w: tex.width, h: tex.height };
    const scale = size / Math.max(r.w, r.h);
    return {
      width: `${size}px`,
      height: `${size}px`,
      "background-image": `url(${entry.url})`,
      "background-size": `${tex.width * scale}px ${tex.height * scale}px`,
      "background-position": `${-r.x * scale + (size - r.w * scale) / 2}px ${-r.y * scale + (size - r.h * scale) / 2}px`,
    };
  };
  return <div class="sprite-thumb" style={style()} />;
}

export function spriteLabel(editor: Editor, ref: SpriteRef | null): string {
  if (!ref) return "Ingen";
  const entry = editor.db.byGuid(ref.texture);
  if (!entry) return "Mangler texture";
  if (!ref.id) return entry.asset.name;
  return entry.asset.sprites.get(ref.id)?.name ?? "Mangler sprite";
}

/** All sprites in the project, grouped by texture, for pickers. */
export function allSprites(editor: Editor): { texture: string; sprites: SpriteRef[] }[] {
  return [...editor.db.textures.values()]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((t) => ({
      texture: t.asset.name,
      sprites:
        t.meta.sprites.length > 0
          ? t.meta.sprites.map((s) => ({ texture: t.meta.guid, id: s.id }))
          : [{ texture: t.meta.guid, id: "" }],
    }));
}

export function SpriteField(props: { editor: Editor; value: () => SpriteRef | null; onChange: (v: SpriteRef | null) => void }) {
  const editor = props.editor;
  const open = (ev: MouseEvent) => {
    const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    openPopup(r.left, r.bottom + 2, () => (
      <>
        <MenuItem onClick={() => props.onChange(null)}>Ingen</MenuItem>
        <For each={allSprites(editor)}>
          {(group) => (
            <>
              <div class="group">{group.texture}</div>
              <For each={group.sprites}>
                {(s) => (
                  <MenuItem onClick={() => props.onChange(s)}>
                    <SpriteThumb editor={editor} sprite={() => s} />
                    {spriteLabel(editor, s)}
                  </MenuItem>
                )}
              </For>
            </>
          )}
        </For>
        <Show when={editor.db.textures.size === 0}>
          <div class="group">Ingen billeder i projektet endnu</div>
        </Show>
      </>
    ));
  };
  return (
    <button
      class="sprite-field"
      onClick={open}
      onDragOver={(ev) => ev.dataTransfer?.types.includes(DND.sprite) && ev.preventDefault()}
      onDrop={(ev) => {
        const raw = ev.dataTransfer?.getData(DND.sprite);
        if (raw) props.onChange(JSON.parse(raw) as SpriteRef);
      }}
      title="Vælg sprite, eller træk en sprite hertil fra assets"
    >
      <SpriteThumb editor={editor} sprite={props.value} />
      <span>{spriteLabel(editor, props.value())}</span>
    </button>
  );
}
