import { describe, expect, it } from "vitest";
import {
  App,
  GamePlugins,
  Input,
  Transform2D,
  UIButton,
  UICanvas,
  UIClick,
  UIImage,
  UILayout,
  UIRect,
  UITouchButton,
  UITouchStick,
  propagateTransforms,
  setParent,
} from "../src/index";

/*
 * On-screen controls. A 960x540 screen with a "constant" canvas, so UI units are
 * CSS pixels and y up in UI is y down on the screen (screenY = 540 - uiY).
 */
const H = 540;

function setup() {
  const app = new App().addPlugin(GamePlugins());
  const w = app.world;
  const canvas = w.spawn([Transform2D], [UICanvas, { scaleMode: "constant" }]);
  const corner = (x: number, y: number, size: number) =>
    [UIRect, { anchorMin: { x: 0, y: 0 }, anchorMax: { x: 0, y: 0 }, pivot: { x: 0.5, y: 0.5 }, position: { x, y }, size: { x: size, y: size } }] as const;
  // stick centred at (120, 120), button at (840, 120), a normal UI button at (480, 270)
  const stick = w.spawn([Transform2D], corner(120, 120, 200), [UITouchStick, { radius: 60, deadZone: 0 }]);
  const jump = w.spawn([Transform2D], corner(840, 120, 100), [UITouchButton, { action: "jump" }]);
  const menu = w.spawn([Transform2D], corner(480, 270, 100), [UIButton], [UIImage]);
  for (const e of [stick, jump, menu]) setParent(w, e, canvas);
  const input = w.resource(Input);
  input.touchMode = true;
  propagateTransforms.run(w);
  const frame = () => {
    app.update(1 / 60);
    // the renderer lays out the UI after each frame; there is none here
    w.resource(UILayout).update(w, 960, H);
  };
  frame();
  return { app, w, input, stick, jump, menu, frame };
}

describe("on-screen controls", () => {
  it("a finger on the button holds its action, and lifting it releases", () => {
    const { input, frame, w, jump } = setup();
    input.injectTouch("down", 1, 840, H - 120);
    frame();
    expect(input.action("jump")).toEqual({ down: true, pressed: true, released: false });
    expect(w.store(UITouchButton).held[jump]).toBe(1);
    frame();
    expect(input.action("jump")).toEqual({ down: true, pressed: false, released: false });
    // sliding off keeps it held
    input.injectTouch("move", 1, 600, H - 300);
    frame();
    expect(input.action("jump").down).toBe(true);
    input.injectTouch("up", 1, 600, H - 300);
    frame();
    expect(input.action("jump")).toEqual({ down: false, pressed: false, released: true });
    frame();
    expect(input.action("jump").released).toBe(false);
    expect(input.pointers).toHaveLength(0);
  });

  it("the stick drives the axes, clamped to its rim, with y up", () => {
    const { input, frame, w, stick } = setup();
    input.injectTouch("down", 1, 120, H - 120);
    frame();
    expect(input.axis("horizontal")).toBe(0);
    // 30 right of the middle: half the radius
    input.injectTouch("move", 1, 150, H - 120);
    frame();
    expect(input.axis("horizontal")).toBeCloseTo(0.5);
    expect(input.axis("vertical")).toBeCloseTo(0);
    // far up: clamped to 1
    input.injectTouch("move", 1, 120, H - 400);
    frame();
    expect(input.axis("vertical")).toBeCloseTo(1);
    expect(input.axis("horizontal")).toBeCloseTo(0);
    expect(w.store(UITouchStick).value.y[stick]).toBeCloseTo(1);
    input.injectTouch("up", 1, 120, H - 400);
    frame();
    expect(input.axis("vertical")).toBe(0);
    expect(w.store(UITouchStick).held[stick]).toBe(0);
  });

  it("a floating stick starts where the finger lands", () => {
    const { input, frame, w, stick } = setup();
    w.store(UITouchStick).floating[stick] = 1;
    input.injectTouch("down", 1, 60, H - 60);
    frame();
    expect(input.axis("horizontal")).toBe(0);
    expect(w.store(UITouchStick).origin.x[stick]).toBe(-60);
    input.injectTouch("move", 1, 60, H - 120);
    frame();
    expect(input.axis("vertical")).toBeCloseTo(1);
  });

  it("two fingers work together, and neither is the mouse", () => {
    const { input, frame } = setup();
    input.injectTouch("down", 1, 120, H - 120);
    input.injectTouch("down", 2, 840, H - 120);
    frame();
    input.injectTouch("move", 1, 60, H - 120);
    frame();
    expect(input.axis("horizontal")).toBeCloseTo(-1);
    expect(input.action("jump").down).toBe(true);
    // claimed fingers don't press Mouse0 (so "fire" doesn't go off)
    expect(input.key("Mouse0").down).toBe(false);
    expect(input.action("fire").down).toBe(false);
  });

  it("a finger elsewhere still taps normal UI buttons", () => {
    const { input, frame, w, menu } = setup();
    const clicks = w.events(UIClick).reader();
    // hold the stick with one finger and tap the button with another
    input.injectTouch("down", 1, 120, H - 120);
    input.injectTouch("down", 2, 480, H - 270);
    frame();
    expect(input.key("Mouse0").down).toBe(true);
    input.injectTouch("up", 2, 480, H - 270);
    frame();
    expect(clicks.read().map((c) => c.entity)).toEqual([menu]);
  });

  it("controls meant for touch are hidden and ignore the mouse until the screen is touched", () => {
    const { input, frame, w, stick, jump } = setup();
    input.touchMode = false;
    frame();
    frame();
    const layout = w.resource(UILayout);
    expect(layout.byEntity.has(stick)).toBe(false);
    expect(layout.byEntity.has(jump)).toBe(false);
    // a press there is a plain mouse press
    input.injectPointer(840, H - 120);
    input.inject("down", "Mouse0");
    frame();
    expect(input.action("jump").down).toBe(false);
    // showOn "always" shows it with a mouse too
    w.store(UITouchButton).showOn[jump] = "always";
    frame();
    expect(layout.byEntity.has(jump)).toBe(true);
  });

  it("the first touch while the controls are hidden lands on them, not on the mouse", () => {
    const { input, frame } = setup();
    input.touchMode = false;
    frame();
    frame();
    input.injectTouch("down", 1, 120, H - 120);
    input.injectTouch("move", 1, 180, H - 120);
    frame();
    expect(input.axis("horizontal")).toBeCloseTo(1);
    expect(input.action("fire").down).toBe(false);
  });

  it("a button that disappears lets go of its action", () => {
    const { input, frame, w, jump } = setup();
    input.injectTouch("down", 1, 840, H - 120);
    frame();
    expect(input.action("jump").down).toBe(true);
    w.destroy(jump);
    frame();
    expect(input.action("jump")).toEqual({ down: false, pressed: false, released: true });
  });

  it("the keyboard still works alongside the controls", () => {
    const { input, frame } = setup();
    input.inject("down", "Space");
    frame();
    expect(input.action("jump").pressed).toBe(true);
    expect(input.touchMode).toBe(true);
  });
});
