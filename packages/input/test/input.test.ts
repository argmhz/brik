import { App } from "@brik/core";
import { describe, expect, it } from "vitest";
import { Input, InputPlugin } from "../src";

describe("Input", () => {
  it("reports pressed / down / released per frame", () => {
    const app = new App().addPlugin(InputPlugin());
    const input = app.world.resource(Input);
    input.inject("down", "Space");
    app.update(0.016);
    expect(input.action("jump")).toEqual({ down: true, pressed: true, released: false });
    app.update(0.016);
    expect(input.action("jump")).toEqual({ down: true, pressed: false, released: false });
    input.inject("up", "Space");
    app.update(0.016);
    expect(input.action("jump")).toEqual({ down: false, pressed: false, released: true });
  });

  it("catches a tap that starts and ends within one frame", () => {
    const input = new Input();
    input.inject("down", "Space");
    input.inject("up", "Space");
    input._beginFrame();
    expect(input.action("jump")).toEqual({ down: false, pressed: true, released: true });
  });

  it("combines axis keys", () => {
    const input = new Input();
    input.inject("down", "KeyD");
    input._beginFrame();
    expect(input.axis("horizontal")).toBe(1);
    input.inject("down", "ArrowLeft");
    input._beginFrame();
    expect(input.axis("horizontal")).toBe(0);
  });

  it("supports custom bindings", () => {
    const input = new Input().bindAction("dash", "ShiftLeft", "Mouse2");
    input.inject("down", "Mouse2");
    input._beginFrame();
    expect(input.action("dash").pressed).toBe(true);
    expect(() => input.action("nope")).toThrow(/nope/);
  });
});
