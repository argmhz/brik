import { describe, expect, it } from "vitest";
import { type GamepadLike, Input } from "../src/index";

/** A pretend "standard" gamepad: 17 buttons and 4 axes. */
function pad() {
  const p: GamepadLike & { buttons: { pressed: boolean; value: number }[]; axes: number[] } = {
    connected: true,
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
    axes: [0, 0, 0, 0],
  };
  return p;
}

describe("gamepad", () => {
  it("buttons go down, are pressed for one frame, and are released, like keys", () => {
    const input = new Input();
    const p = pad();
    input.gamepads = () => [p];
    input._beginFrame();
    expect(input.gamepadConnected).toBe(true);
    p.buttons[0].pressed = true; // A
    input._beginFrame();
    expect(input.action("jump")).toEqual({ down: true, pressed: true, released: false });
    input._beginFrame();
    expect(input.action("jump")).toEqual({ down: true, pressed: false, released: false });
    p.buttons[0].pressed = false;
    input._beginFrame();
    expect(input.action("jump")).toEqual({ down: false, pressed: false, released: true });
    expect(input.key("PadA").down).toBe(false);
  });

  it("the left stick drives the horizontal and vertical axes, with a dead zone and y up", () => {
    const input = new Input();
    const p = pad();
    input.gamepads = () => [p];
    p.axes[0] = 0.1; // inside the dead zone
    input._beginFrame();
    expect(input.axis("horizontal")).toBe(0);
    p.axes[0] = 1;
    p.axes[1] = 0;
    input._beginFrame();
    expect(input.axis("horizontal")).toBeCloseTo(1);
    p.axes[0] = 0;
    p.axes[1] = -0.6; // pushed up a bit (the browser reports up as negative)
    input._beginFrame();
    expect(input.axis("vertical")).toBeCloseTo(0.5);
    expect(input.axis("horizontal")).toBe(0);
  });

  it("the d-pad and the triggers count as buttons, and fire is X or the right trigger", () => {
    const input = new Input();
    const p = pad();
    input.gamepads = () => [p];
    p.buttons[14].pressed = true; // d-pad left
    p.buttons[7].value = 0.8; // right trigger, analog
    input._beginFrame();
    expect(input.axis("horizontal")).toBe(-1);
    expect(input.action("fire").pressed).toBe(true);
  });

  it("keyboard and gamepad together never go past -1..1, and a lost gamepad releases its buttons", () => {
    const input = new Input();
    const p = pad();
    input.gamepads = () => [p];
    input.inject("down", "KeyD");
    p.axes[0] = 1;
    p.buttons[0].pressed = true;
    input._beginFrame();
    expect(input.axis("horizontal")).toBe(1);
    p.connected = false;
    input._beginFrame();
    expect(input.gamepadConnected).toBe(false);
    expect(input.action("jump").released).toBe(true);
    expect(input.axis("horizontal")).toBe(1); // the key is still held
  });

  it("without the Gamepad API nothing breaks", () => {
    const input = new Input();
    input.gamepads = () => {
      throw new Error("not allowed");
    };
    input._beginFrame();
    expect(input.gamepadConnected).toBe(false);
  });
});
