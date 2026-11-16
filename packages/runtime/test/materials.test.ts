import { beforeAll, describe, expect, it } from "vitest";
import {
  App,
  Camera2D,
  GamePlugins,
  PostProcess2D,
  Sprite,
  SpriteMaterial,
  Time,
  Transform2D,
  flashSprite,
  initPhysics,
  packStraight,
  postProcessOf,
} from "../src/index";

beforeAll(async () => {
  await initPhysics();
});
const game = () => new App().addPlugin(GamePlugins());

describe("SpriteMaterial", () => {
  it("flashSprite adds a material, starts full and fades out over the duration", () => {
    const app = game();
    const w = app.world;
    const e = w.spawn([Transform2D], [Sprite]);
    flashSprite(w, e, 0.2, { r: 1, g: 0, b: 0 });
    const M = w.store(SpriteMaterial);
    expect(M.flash[e]).toBe(1);
    expect(M.flashColor.g[e]).toBe(0);
    app.update(0.1);
    expect(M.flash[e]).toBeCloseTo(0.5, 1);
    app.update(0.1);
    app.update(0.1);
    expect(M.flash[e]).toBe(0);
    expect(M.flashLength[e]).toBe(0);
  });

  it("a flash holds while the game is paused (hit-stop)", () => {
    const app = game();
    const w = app.world;
    const e = w.spawn([Transform2D], [Sprite]);
    flashSprite(w, e, 0.1);
    w.resource(Time).timeScale = 0;
    app.update(0.05);
    app.update(0.05);
    expect(w.store(SpriteMaterial).flash[e]).toBe(1);
  });

  it("a flash set by hand stays", () => {
    const app = game();
    const w = app.world;
    const e = w.spawn([Transform2D], [Sprite], [SpriteMaterial, { flash: 0.4 }]);
    app.update(0.5);
    expect(w.store(SpriteMaterial).flash[e]).toBeCloseTo(0.4);
  });

  it("packs the flash color straight, with the amount in alpha", () => {
    expect(packStraight(1, 0, 0, 0.5)).toBe(((128 << 24) | 255) >>> 0);
  });
});

describe("PostProcess2D", () => {
  it("is off without the component, when switched off, and when every effect is neutral", () => {
    const app = game();
    const w = app.world;
    const plain = w.spawn([Transform2D], [Camera2D]);
    const neutral = w.spawn([Transform2D], [Camera2D], [PostProcess2D]);
    const off = w.spawn([Transform2D], [Camera2D], [PostProcess2D, { bloom: 1, enabled: false }]);
    expect(postProcessOf(w, plain)).toBeNull();
    expect(postProcessOf(w, neutral)).toBeNull();
    expect(postProcessOf(w, off)).toBeNull();
  });

  it("gives the effects, clamped to sane values", () => {
    const app = game();
    const w = app.world;
    const cam = w.spawn([Transform2D], [Camera2D], [PostProcess2D, { bloom: 1.5, vignette: 3, pixelate: 3.6, saturation: -1 }]);
    const s = postProcessOf(w, cam)!;
    expect(s.bloom).toBeCloseTo(1.5);
    expect(s.vignette).toBe(1);
    expect(s.pixelate).toBe(4);
    expect(s.saturation).toBe(0);
    expect(s.contrast).toBe(1);
  });
});
