import { beforeAll, describe, expect, it } from "vitest";
import {
  App,
  Camera2D,
  GamePlugins,
  Light2D,
  Lighting2D,
  Transform2D,
  collectLights,
  initPhysics,
  lightAt,
  lightingOf,
  setActive,
} from "../src/index";

beforeAll(async () => {
  await initPhysics();
});
const game = () => new App().addPlugin(GamePlugins());
const lightAtPos = (w: App["world"], x: number, y: number, extra: Record<string, unknown> = {}, tr: Record<string, unknown> = {}) =>
  w.spawn([Transform2D, { position: { x, y }, ...tr }], [Light2D, extra]);

describe("2D lighting", () => {
  it("collects lights with color times intensity, in world units", () => {
    const app = game();
    const w = app.world;
    lightAtPos(w, 10, 20, { radius: 100, intensity: 2, color: { r: 1, g: 0.5, b: 0.25, a: 1 } });
    app.update(1 / 60);
    const [l] = collectLights(w);
    expect(l).toMatchObject({ x: 10, y: 20, radius: 100, r: 2, g: 1, b: 0.5, cosHalf: -2 });
  });

  it("the entity's scale scales the radius, and its rotation points a spot light", () => {
    const app = game();
    const w = app.world;
    lightAtPos(w, 0, 0, { kind: "spot", radius: 50, angle: 90 }, { rotation: Math.PI / 2, scale: { x: 2, y: 2 } });
    app.update(1 / 60);
    const [l] = collectLights(w);
    expect(l.radius).toBeCloseTo(100);
    expect(l.dirX).toBeCloseTo(0);
    expect(l.dirY).toBeCloseTo(1);
    expect(l.cosHalf).toBeCloseTo(Math.cos(Math.PI / 4));
  });

  it("skips lights that are switched off, have no reach or no intensity, or are outside the view", () => {
    const app = game();
    const w = app.world;
    const off = lightAtPos(w, 0, 0);
    lightAtPos(w, 0, 0, { radius: 0 });
    lightAtPos(w, 0, 0, { intensity: 0 });
    lightAtPos(w, 5000, 0, { radius: 100 });
    app.update(1 / 60);
    setActive(w, off, false);
    app.update(1 / 60);
    expect(collectLights(w)).toHaveLength(1); // only the far one, until we cull by the view
    expect(collectLights(w, { minX: -100, minY: -100, maxX: 100, maxY: 100 })).toHaveLength(0);
    expect(collectLights(w, { minX: 4950, minY: -100, maxX: 5100, maxY: 100 })).toHaveLength(1);
  });

  it("lighting is per camera, and can be switched off", () => {
    const app = game();
    const w = app.world;
    const plain = w.spawn([Transform2D], [Camera2D]);
    const dark = w.spawn([Transform2D], [Camera2D], [Lighting2D, { ambient: { r: 0.1, g: 0.2, b: 0.3, a: 1 } }]);
    expect(lightingOf(w, plain)).toBeNull();
    expect(lightingOf(w, dark)).toEqual({ r: expect.closeTo(0.1), g: expect.closeTo(0.2), b: expect.closeTo(0.3) });
    w.store(Lighting2D).enabled[dark] = 0;
    expect(lightingOf(w, dark)).toBeNull();
  });

  it("light fades from the center to the edge, and a spot light only lights its cone", () => {
    const soft = { softness: 0.6, cosHalf: -2 };
    expect(lightAt(soft, 0)).toBe(1);
    expect(lightAt(soft, 0.5)).toBeGreaterThan(lightAt(soft, 0.8));
    expect(lightAt(soft, 1)).toBe(0);
    // a sharp light stays full until close to the edge
    expect(lightAt({ softness: 0, cosHalf: -2 }, 0.95)).toBe(1);
    const cone = { softness: 0.3, cosHalf: Math.cos(Math.PI / 6) };
    expect(lightAt(cone, 0.3, 1)).toBeGreaterThan(0.9);
    expect(lightAt(cone, 0.3, Math.cos(Math.PI / 2))).toBe(0);
  });
});
