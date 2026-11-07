import { type App, type Entity, Time, type World, defineComponent, defineEvent, t, withMeta } from "@brik/core";
import { Input } from "@brik/input";
import { INTERACTIVE, UIButton, UIClick, UIFocus, UILayout, UIRect, UIText } from "./ui";

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
  /** The focused field's text as of the last frame, for typing without a browser. */
  private base = "";
  private pending: { value?: string; submit?: boolean; tab?: 1 | -1 }[] = [];
  /** True in the frame typing ended (Enter, Escape or lost focus), so the same Enter does not start it again. */
  justEnded = false;

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
    this.base = T.value[e];
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
        if (ev.key === "Tab") {
          // on to the next element, instead of out of the page
          ev.preventDefault();
          this.pending.push({ tab: ev.shiftKey ? -1 : 1 });
        }
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

  /** Types text into the focused field, e.g. from tests or an AI. `\n` submits and `\t` moves on to the next element. */
  type(text: string): void {
    for (const part of text.split(/(\n|\t)/)) {
      if (part === "\n") this.pending.push({ submit: true });
      else if (part === "\t") this.pending.push({ tab: 1 });
      else if (part) this.pending.push({ value: (this.latest() ?? "") + part });
    }
  }

  /** Ends typing and moves on to the next (1) or previous (-1) element, as Tab does. */
  tab(direction: 1 | -1 = 1): void {
    this.pending.push({ tab: direction });
  }

  /** Submits the focused field, as Enter does. */
  submit(): void {
    this.pending.push({ submit: true });
  }

  /** Deletes the last `n` characters of the focused field. */
  erase(n = 1): void {
    const v = this.latest() ?? "";
    this.pending.push({ value: v.slice(0, Math.max(0, v.length - n)) });
  }

  /** Replaces the whole text of the focused field. */
  set(text: string): void {
    this.pending.push({ value: text });
  }

  private latest(): string | undefined {
    for (let i = this.pending.length - 1; i >= 0; i--) if (this.pending[i].value !== undefined) return this.pending[i].value;
    return this.el ? this.el.value : this.base;
  }

  /** @internal Applies what was typed since the last frame. */
  apply(world: World): void {
    const e = this.focused;
    const queue = this.pending;
    this.pending = [];
    this.justEnded = false;
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
      this.base = T.value[e];
      if (p.tab !== undefined) {
        const from = e;
        this.blur(world);
        this.justEnded = true;
        // coming from a field: carry on typing in the next one, like a form
        moveFocus(world, from, p.tab, true);
        break;
      }
      if (p.submit === true) world.emit(UISubmit, { entity: e, value: T.value[e] });
      if (p.submit !== undefined) {
        this.blur(world);
        this.justEnded = true;
        break;
      }
    }
  }

  dispose(): void {
    this.el?.remove();
    this.el = null;
  }
}

/** The elements the keyboard can reach, in the order Tab visits them (the UI's draw order, i.e. the hierarchy's). */
export function focusable(world: World): Entity[] {
  const layout = world.resource(UILayout);
  const B = world.store(UIButton);
  const S = world.store(UISlider);
  const G = world.store(UIToggle);
  const T = world.store(UITextInput);
  const ok = (e: Entity) =>
    (world.has(e, UIButton) && B.interactable[e] !== 0) ||
    (world.has(e, UISlider) && S.interactable[e] !== 0) ||
    (world.has(e, UIToggle) && G.interactable[e] !== 0) ||
    (world.has(e, UITextInput) && T.interactable[e] !== 0);
  // before the first draw there is no layout (headless, tests): fall back to creation order
  const all = layout.elements.length > 0 ? layout.elements.map((el) => el.e) : [...world.query([UIRect])].sort((a, b) => a - b);
  return all.filter(ok);
}

/** Moves the keyboard focus from `from` to the next (1) or previous (-1) element, wrapping around. With `typeInTextFields`, a text field starts typing at once. */
function moveFocus(world: World, from: Entity, direction: 1 | -1, typeInTextFields = false): void {
  const focus = world.resource(UIFocus);
  const list = focusable(world);
  if (list.length === 0) {
    focus.entity = -1;
    return;
  }
  const at = list.indexOf(from);
  const next = at < 0 ? (direction > 0 ? list[0] : list[list.length - 1]) : list[(at + direction + list.length) % list.length];
  focus.entity = next;
  if (typeInTextFields && world.has(next, UITextInput)) world.resource(UITextEntry).focus(world, next);
}

/**
 * Keyboard use of the UI. Tab and Shift+Tab move between buttons, sliders, toggles and text fields;
 * Enter or Space presses a button or flips a toggle; Left and Right move a slider; Enter starts typing in a
 * text field; Escape lets go. It does nothing until Tab has been pressed once.
 */
export function updateFocus(world: World): void {
  const input = world.tryResource(Input);
  const focus = world.resource(UIFocus);
  if (!input) return;
  const entry = world.resource(UITextEntry);
  // typing owns the keyboard; mouse presses hand it back to the pointer
  if (entry.focused >= 0) {
    focus.entity = entry.focused;
    return;
  }
  if (entry.justEnded) return;
  if (input.key("Mouse0").pressed) {
    focus.entity = -1;
    return;
  }
  const list = focusable(world);
  if (focus.entity >= 0 && !list.includes(focus.entity)) focus.entity = -1;

  if (input.key("Tab").pressed) {
    if (list.length === 0) return;
    const shift = input.key("ShiftLeft").down || input.key("ShiftRight").down;
    moveFocus(world, focus.entity, shift ? -1 : 1);
    return;
  }
  const f = focus.entity;
  if (f < 0) return;
  if (input.key("Escape").pressed) {
    focus.entity = -1;
    return;
  }
  const activate = input.key("Enter").pressed || input.key("Space").pressed;
  if (world.has(f, UIButton) && activate) world.emit(UIClick, { entity: f });
  if (world.has(f, UIToggle) && activate) {
    const G = world.store(UIToggle);
    G.on[f] = G.on[f] ? 0 : 1;
    world.emit(UIValueChanged, { entity: f, value: G.on[f] !== 0 });
  }
  if (world.has(f, UITextInput) && input.key("Enter").pressed) entry.focus(world, f);
  if (world.has(f, UISlider)) {
    const dir = (input.key("ArrowRight").pressed ? 1 : 0) - (input.key("ArrowLeft").pressed ? 1 : 0);
    if (dir !== 0) {
      const S = world.store(UISlider);
      const span = S.max[f] - S.min[f];
      const v = snap(S.value[f] + dir * (S.step[f] > 0 ? S.step[f] : span / 20), S.min[f], S.max[f], S.step[f]);
      if (v !== S.value[f]) {
        S.value[f] = v;
        world.emit(UIValueChanged, { entity: f, value: v });
      }
    }
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

  // Enter from the Input (e.g. injected by tests or an AI) submits too, not only the hidden field's keydown.
  // A real Enter reaches both; the second submit is dropped because the first ends typing.
  if (entry.focused >= 0 && input?.key("Enter").pressed) entry.submit();
  if (entry.focused >= 0 && input?.key("Tab").pressed) entry.tab(input.key("ShiftLeft").down || input.key("ShiftRight").down ? -1 : 1);
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
    if (!app.world.hasResource(UIFocus)) app.world.insertResource(new UIFocus());
    // Tab is the key that moves between elements: keep the browser from moving its own focus instead
    app.world.tryResource(Input)?.bindAction("ui.tab", "Tab");
    app.addSystem("preUpdate", { name: "ui.widgets", run: updateWidgets });
    app.addSystem("preUpdate", { name: "ui.focus", run: updateFocus });
  },
};
