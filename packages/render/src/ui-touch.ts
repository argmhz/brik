import { type App, type Entity, type World, defineComponent, t, withMeta } from "@brik/core";
import { Input, type PointerInfo } from "@brik/input";
import { HIDDEN, INTERACTIVE, UIImage, UILayout, UIRect } from "./ui";

/*
 * On-screen controls for phones and tablets: a button that holds an input
 * action and a joystick that drives two axes. They take their own fingers
 * (Input.claim), so a thumb on the joystick and another on the jump button
 * work together, and neither of them clicks UI or fires "Mouse0".
 * Scripts read them like any other input: input.action("jump"), input.axis("horizontal").
 */

/**
 * A button on the screen that holds an input action while a finger is on it, e.g.
 * `action: "jump"` makes `input.action("jump")` down, pressed and released like Space.
 * It stays held until the finger is lifted, even if it slides off. Without a UIImage it is drawn
 * as a circle; with one, the image is tinted.
 */
export const UITouchButton = defineComponent(
  "UITouchButton",
  {
    /** The input action it holds (the actions scripts read, e.g. "jump" or "fire"). */
    action: t.string("jump"),
    /** touch: only on a touch screen (hidden on a computer until the screen is touched). always: also with a mouse. */
    showOn: t.enum(["touch", "always"] as const, "touch"),
    color: t.color(1, 1, 1, 0.35),
    pressedColor: t.color(1, 1, 1, 0.65),
    held: withMeta(t.bool(false), { hidden: true }),
  },
  { requires: [UIRect] },
);

/**
 * A joystick on the screen. A finger that lands in its rect moves the knob, and the knob drives
 * two input axes (`axisX`, `axisY`, -1..1 with y up), added to the keyboard's and gamepad's.
 * With `floating`, the stick appears where the finger lands, so its rect can be a large area
 * (e.g. the left half of the screen).
 */
export const UITouchStick = defineComponent(
  "UITouchStick",
  {
    axisX: t.string("horizontal"),
    axisY: t.string("vertical"),
    /** How far the knob can move from the middle, in UI units. */
    radius: withMeta(t.f32(60), { min: 1, step: 1 }),
    /** Movement smaller than this fraction of the radius counts as none. */
    deadZone: withMeta(t.f32(0.15), { min: 0, max: 0.95, step: 0.05 }),
    /** The stick starts where the finger lands instead of in the middle of the rect. */
    floating: t.bool(false),
    showOn: t.enum(["touch", "always"] as const, "touch"),
    baseColor: t.color(1, 1, 1, 0.2),
    knobColor: t.color(1, 1, 1, 0.55),
    /** The knob's position this frame, -1..1 with y up. */
    value: withMeta(t.vec2(0, 0), { hidden: true }),
    /** Where the stick's middle is, from the middle of the rect, in UI units (moves with `floating`). */
    origin: withMeta(t.vec2(0, 0), { hidden: true }),
    held: withMeta(t.bool(false), { hidden: true }),
  },
  { requires: [UIRect] },
);

INTERACTIVE.push(UITouchButton, UITouchStick);
HIDDEN.push((world, e, layout) => {
  if (layout.touch) return false;
  if (world.has(e, UITouchButton)) return world.store(UITouchButton).showOn[e] === "touch";
  if (world.has(e, UITouchStick)) return world.store(UITouchStick).showOn[e] === "touch";
  return false;
});

/** The pointer an on-screen control holds (held now, or lifted this frame), or undefined. */
function pointerOf(input: Input, e: Entity): PointerInfo | undefined {
  return input.pointers.find((p) => p.owner === e);
}

/** Buttons held last frame, so a button that disappears (deleted, switched off) lets go of its action. */
class TouchState {
  held = new Set<string>();
}

/** Drives the on-screen buttons and joysticks from the pointers they hold. Runs after input has started the frame. */
export function updateTouchControls(world: World): void {
  const input = world.tryResource(Input);
  const layout = world.resource(UILayout);
  if (!input) return;
  layout.touch = input.touchMode;
  const state = world.tryResource(TouchState) ?? world.insertResource(new TouchState());
  const held = new Set<string>();

  const B = world.store(UITouchButton);
  const I = world.store(UIImage);
  for (const e of world.query([UITouchButton])) {
    const p = pointerOf(input, e);
    const down = !!p && p.down;
    B.held[e] = down ? 1 : 0;
    if (down) held.add(`Touch:${B.action[e]}`);
    if (world.has(e, UIImage)) {
      const c = down ? B.pressedColor : B.color;
      I.color.r[e] = c.r[e];
      I.color.g[e] = c.g[e];
      I.color.b[e] = c.b[e];
      I.color.a[e] = c.a[e];
    }
  }
  // let go first, then hold: two buttons for the same action keep it down
  for (const code of state.held) if (!held.has(code)) input.setButton(code, false);
  for (const code of held) input.setButton(code, true);
  state.held = held;

  const S = world.store(UITouchStick);
  for (const e of world.query([UITouchStick])) {
    const p = pointerOf(input, e);
    const el = layout.byEntity.get(e);
    if (!p || !p.down || !el) {
      S.held[e] = 0;
      S.value.x[e] = 0;
      S.value.y[e] = 0;
      S.origin.x[e] = 0;
      S.origin.y[e] = 0;
      continue;
    }
    // UI units from the middle of the rect, y up (pointers are CSS pixels, y down)
    const cx = el.rect.x + el.rect.w / 2;
    const cy = el.rect.y + el.rect.h / 2;
    const toUI = (x: number, y: number) => ({ x: (x - cx) / el.scale, y: (layout.screenH - y - cy) / el.scale });
    if (!S.held[e]) {
      const start = S.floating[e] ? toUI(p.startX, p.startY) : { x: 0, y: 0 };
      S.origin.x[e] = start.x;
      S.origin.y[e] = start.y;
      S.held[e] = 1;
    }
    const at = toUI(p.x, p.y);
    const r = Math.max(1, S.radius[e]);
    let vx = (at.x - S.origin.x[e]) / r;
    let vy = (at.y - S.origin.y[e]) / r;
    const len = Math.hypot(vx, vy);
    const dz = Math.min(0.95, Math.max(0, S.deadZone[e]));
    if (len <= dz) {
      vx = 0;
      vy = 0;
    } else {
      // past the dead zone the value grows from 0, and it stops at the rim
      const k = Math.min(1, (len - dz) / (1 - dz)) / len;
      vx *= k;
      vy *= k;
    }
    S.value.x[e] = vx;
    S.value.y[e] = vy;
    if (S.axisX[e]) input.addAxis(S.axisX[e], vx);
    if (S.axisY[e]) input.addAxis(S.axisY[e], vy);
  }
}

/** On-screen joysticks and buttons. Part of GamePlugins. */
export const UITouchPlugin = {
  name: "brik:ui-touch",
  build(app: App) {
    const world = app.world;
    if (!world.hasResource(UILayout)) world.insertResource(new UILayout());
    const input = world.tryResource(Input);
    if (input) {
      // a finger that lands on an on-screen control belongs to it (the layout is the last drawn one)
      input.claim = (x, y) => {
        const layout = world.resource(UILayout);
        // the first touch after the controls were hidden (a computer, or a key was pressed) must hit them too:
        // show them now instead of after this frame
        if (input.touchMode && !layout.touch) {
          layout.touch = true;
          layout.update(world, layout.screenW, layout.screenH);
        }
        const e = layout.interactiveAt(world, x, y);
        return e >= 0 && (world.has(e, UITouchButton) || world.has(e, UITouchStick)) ? e : -1;
      };
    }
    app.addSystem("preUpdate", { name: "ui.touch", run: updateTouchControls });
  },
};
