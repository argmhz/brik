import { describe, expect, it } from "vitest";
import { type WheelInput, wheelAction } from "../src/ui/wheel";

const wheel = (o: Partial<WheelInput>): WheelInput => ({ deltaX: 0, deltaY: 0, deltaMode: 0, shiftKey: false, ctrlKey: false, metaKey: false, ...o });

describe("mouse wheel in the scene view", () => {
  it("the wheel alone zooms: in when rolled up, out when rolled down", () => {
    const up = wheelAction(wheel({ deltaY: -100 }));
    const down = wheelAction(wheel({ deltaY: 100 }));
    expect(up.kind).toBe("zoom");
    expect(up.kind === "zoom" && up.factor).toBeGreaterThan(1);
    expect(down.kind === "zoom" && down.factor).toBeLessThan(1);
  });

  it("Shift pans sideways, also when the browser already turned it into deltaX", () => {
    expect(wheelAction(wheel({ deltaY: 100, shiftKey: true }))).toEqual({ kind: "pan", dx: 100, dy: 0 });
    expect(wheelAction(wheel({ deltaX: 100, shiftKey: true }))).toEqual({ kind: "pan", dx: 100, dy: 0 });
  });

  it("Ctrl (or Cmd) pans up and down", () => {
    expect(wheelAction(wheel({ deltaY: -60, ctrlKey: true }))).toEqual({ kind: "pan", dx: 0, dy: -60 });
    expect(wheelAction(wheel({ deltaY: 60, metaKey: true }))).toEqual({ kind: "pan", dx: 0, dy: 60 });
  });

  it("sideways scrolling (touchpad, tilting wheel) pans sideways", () => {
    expect(wheelAction(wheel({ deltaX: -30 }))).toEqual({ kind: "pan", dx: -30, dy: 0 });
  });

  it("wheels that count in lines or pages move as far as in pixels", () => {
    expect(wheelAction(wheel({ deltaY: 3, deltaMode: 1, shiftKey: true }))).toEqual({ kind: "pan", dx: 120, dy: 0 });
    expect(wheelAction(wheel({ deltaY: 1, deltaMode: 2, ctrlKey: true }), 600)).toEqual({ kind: "pan", dx: 0, dy: 600 });
  });
});
