import { type App, type Entity, Time, type World, defineComponent, defineEvent, t, withMeta } from "@brik/core";
import { Input } from "@brik/input";
import { INTERACTIVE, UILayout, UIRect, UIText } from "./ui";

/*
 * Interactive UI elements beyond the button: a slider, a toggle and a text
 * field. They react to the mouse through UILayout's hit test, send
 * UIValueChanged (and UISubmit for text), and scripts get onValueChanged /
 * onSubmit. The renderer draws the slider and toggle; a text field shows its
 * text through a UIText on the same entity.
 */

/** A horizontal slider. Drag it, or click on the track. */
export const UISlider = defineComponent(
  "UISlider",
  {
    value: t.f32(0.5),
    min: t.f32(0),
    max: t.f32(1),
    /** Snap to multiples of this (0: smooth). */
    step: withMeta(t.f32(0), { min: 0 }),
    interactable: t.bool(true),
    trackColor: t.color(0.2, 0.22, 0.28, 1),
    fillColor: t.color(0.3, 0.55, 1, 1),
    handleColor: t.color(1, 1, 1, 1),
    dragging: withMeta(t.bool(false), { hidden: true }),
  },
  { requires: [UIRect] },
);

/** A checkbox: a box at the left of its rect with a check mark when on. Put a UIText child next to it as the label. */
export const UIToggle = defineComponent(
  "UIToggle",
  {
    on: t.bool(false),
    interactable: t.bool(true),
    boxColor: t.color(0.2, 0.22, 0.28, 1),
    checkColor: t.color(0.3, 0.55, 1, 1),
    down: withMeta(t.bool(false), { hidden: true }),
  },
  { requires: [UIRect] },
);

/** A one-line text field. Click it and type; Enter sends UISubmit. Its UIText shows the text. */
export const UITextInput = defineComponent(
  "UITextInput",
  {
    value: t.string(""),
    /** Shown while the field is empty. */
    placeholder: t.string("Skriv her…"),
    /** 0: no limit. */
    maxLength: withMeta(t.i32(0), { min: 0 }),
    interactable: t.bool(true),
    focused: withMeta(t.bool(false), { hidden: true }),
  },
  { requires: [UIRect, UIText] },
);

/** A slider, toggle or text field changed: a number, a boolean or a string. */
export const UIValueChanged = defineEvent<{ entity: Entity; value: number | boolean | string }>("UIValueChanged");
/** Enter was pressed in a text field. */
export const UISubmit = defineEvent<{ entity: Entity; value: string }>("UISubmit");

INTERACTIVE.push(UISlider, UIToggle, UITextInput);

/** Slider value for a pointer x (CSS pixels), snapped to `step`. */
export function sliderValueAt(world: World, e: Entity, x: number): number {
  const el = world.resource(UILayout).byEntity.get(e);
  const S = world.store(UISlider);
  if (!el) return S.value[e];
  const lo = S.min[e];
  const hi = S.max[e];
  // the handle stays inside the track, so the usable width is the rect minus a handle
  const handle = el.rect.h * 0.8;
  const f = Math.min(1, Math.max(0, (x - el.rect.x - handle / 2) / Math.max(1, el.rect.w - handle)));
  return snap(lo + (hi - lo) * f, lo, hi, S.step[e]);
}

function snap(v: number, lo: number, hi: number, step: number): number {
  const s = step > 0 ? lo + Math.round((v - lo) / step) * step : v;
  return Math.min(Math.max(lo, hi), Math.max(Math.min(lo, hi), Number(s.toFixed(6))));
}

/**
 * Typing into text fields. A hidden HTML <input> receives the keys, so
 * keyboard layouts, æøå, paste and on-screen keyboards work. Without a
 * document (headless, tests) only `type()` feeds it.
 */
export class UITextEntry {
  focused: Entity = -1;
  private el: HTMLInputElement | null = null;
  private pending: { value?: string; submit?: boolean }[] = [];

  /** Starts typing into a field. */
  focus(world: World, e: Entity): void {
    if (this.focused === e) {
      // clicked again: take the keyboard back if something else had it
      this.el?.focus();
      return;
    }
    this.blur(world);
    this.focused = e;
    world.store(UITextInput).focused[e] = 1;
    const T = world.store(UITextInput);
    if (typeof document === "undefined") return;
    if (!this.el) {
      const el = document.createElement("input");
      el.type = "text";
      el.setAttribute("aria-hidden", "true");
      el.autocomplete = "off";
      Object.assign(el.style, { position: "fixed", left: "0", top: "0", width: "1px", height: "1px", opacity: "0", pointerEvents: "none" });
      el.addEventListener("input", () => this.pending.push({ value: el.value }));
      el.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") this.pending.push({ submit: true });
        if (ev.key === "Escape") this.pending.push({ submit: false });
      });
      // the page's focus moved elsewhere (another field, the editor): stop typing
      el.addEventListener("blur", () => this.pending.push({ submit: false }));
      document.body.appendChild(el);
      this.el = el;
    }
    this.el.maxLength = T.maxLength[e] > 0 ? T.maxLength[e] : 524288;
    this.el.value = T.value[e];
    this.el.focus();
    this.el.setSelectionRange(this.el.value.length, this.el.value.length);
    // the blur of the field we just left must not end this one
    this.pending = [];
  }

  blur(world: World): void {
    if (this.focused >= 0 && world.isAlive(this.focused) && world.has(this.focused, UITextInput)) {
      world.store(UITextInput).focused[this.focused] = 0;
    }
    this.focused = -1;
    this.el?.blur();
  }

  /** Types text into the focused field, e.g. from tests or an AI. `\n` submits. */
  type(text: string): void {
    for (const part of text.split(/(\n)/)) {
      if (part === "\n") this.pending.push({ submit: true });
      else if (part) this.pending.push({ value: (this.latest() ?? "") + part });
    }
  }

  private latest(): string | undefined {
    for (let i = this.pending.length - 1; i >= 0; i--) if (this.pending[i].value !== undefined) return this.pending[i].value;
    return this.el?.value;
  }

  /** @internal Applies what was typed since the last frame. */
  apply(world: World): void {
    const e = this.focused;
    const queue = this.pending;
    this.pending = [];
    if (e < 0 || !world.isAlive(e) || !world.has(e, UITextInput)) {
      this.focused = -1;
      return;
    }
    const T = world.store(UITextInput);
    for (const p of queue) {
      if (p.value !== undefined) {
        const max = T.maxLength[e];
        const v = max > 0 ? p.value.slice(0, max) : p.value;
        if (v !== T.value[e]) {
          T.value[e] = v;
          if (this.el && this.el.value !== v) this.el.value = v;
          world.emit(UIValueChanged, { entity: e, value: v });
        }
      }
      if (p.submit === true) world.emit(UISubmit, { entity: e, value: T.value[e] });
      if (p.submit !== undefined) {
        this.blur(world);
        break;
      }
    }
  }

  dispose(): void {
    this.el?.remove();
    this.el = null;
  }
}

/** Mouse handling for sliders, toggles and text fields, and the text fields' displayed text. */
export function updateWidgets(world: World): void {
  const layout = world.resource(UILayout);
  const input = world.tryResource(Input);
  const entry = world.resource(UITextEntry);
  const mouse = input?.key("Mouse0");
  const hit = input?.pointer.inside ? layout.interactiveAt(world, input.pointer.x, input.pointer.y) : -1;
  const S = world.store(UISlider);
  const G = world.store(UIToggle);
  const T = world.store(UITextInput);

  if (mouse?.pressed) {
    if (hit >= 0 && world.has(hit, UISlider) && S.interactable[hit]) S.dragging[hit] = 1;
    if (hit >= 0 && world.has(hit, UIToggle) && G.interactable[hit]) G.down[hit] = 1;
    // clicking a text field focuses it; clicking anywhere else ends typing
    if (hit >= 0 && world.has(hit, UITextInput) && T.interactable[hit]) entry.focus(world, hit);
    else if (entry.focused >= 0) entry.blur(world);
  }

  for (const e of world.query([UISlider])) {
    if (!S.dragging[e]) continue;
    if (input && (mouse?.down || mouse?.pressed)) {
      const v = sliderValueAt(world, e, input.pointer.x);
      if (v !== S.value[e]) {
        S.value[e] = v;
        world.emit(UIValueChanged, { entity: e, value: v });
      }
    }
    if (!mouse?.down || mouse.released) S.dragging[e] = 0;
  }

  if (mouse?.released) {
    for (const e of world.query([UIToggle])) {
      if (!G.down[e]) continue;
      G.down[e] = 0;
      if (hit === e) {
        G.on[e] = G.on[e] ? 0 : 1;
        world.emit(UIValueChanged, { entity: e, value: G.on[e] !== 0 });
      }
    }
  }

  entry.apply(world);

  // the field's UIText shows its text (or the placeholder) and a blinking caret
  const X = world.store(UIText);
  const blink = Math.floor(world.resource(Time).elapsed * 2) % 2 === 0;
  for (const e of world.query([UITextInput])) {
    const focused = entry.focused === e;
    const shown = T.value[e] || (focused ? "" : T.placeholder[e]);
    X.text[e] = focused && blink ? `${shown}|` : shown;
  }
}

/** Sliders, toggles and text fields. Part of GamePlugins. */
export const UIWidgetsPlugin = {
  name: "brik:ui-widgets",
  build(app: App) {
    if (!app.world.hasResource(UITextEntry)) app.world.insertResource(new UITextEntry());
    app.addSystem("preUpdate", { name: "ui.widgets", run: updateWidgets });
  },
};
