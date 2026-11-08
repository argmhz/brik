import { beforeAll, describe, expect, it } from "vitest";
import { App, CameraFX, GamePlugins, Scenes, ScenesPlugin, ScreenFade, Time, Transform2D, initPhysics } from "../src/index";

beforeAll(async () => {
  await initPhysics();
});

const game = () => new App().addPlugin(GamePlugins());
const run = (app: App, frames: number, dt = 1 / 60) => {
  for (let i = 0; i < frames; i++) app.update(dt);
};

describe("camera effects", () => {
  it("a shake moves the view, fades out, and leaves the camera entity alone", () => {
    const app = game();
    const fx = app.world.resource(CameraFX);
    const cam = app.world.spawn([Transform2D, { position: { x: 5, y: 7 } }]);
    fx.shake(10, 0.5);
    let peak = 0;
    for (let i = 0; i < 20; i++) {
      app.update(1 / 60);
      peak = Math.max(peak, Math.hypot(fx.offsetX, fx.offsetY));
    }
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(10 * Math.SQRT2 + 1e-6);
    run(app, 40);
    expect(fx.active).toBe(false);
    expect(fx.offsetX).toBe(0);
    expect(app.world.store(Transform2D).position.x[cam]).toBe(5);
  });

  it("shakes are the same every time (no random jitter in tests or replays)", () => {
    const sample = () => {
      const app = game();
      const fx = app.world.resource(CameraFX);
      fx.shake(10, 0.5);
      const out: number[] = [];
      for (let i = 0; i < 10; i++) {
        app.update(1 / 60);
        out.push(fx.offsetX);
      }
      return out;
    };
    expect(sample()).toEqual(sample());
  });

  it("a zoom punch goes in and settles back to exactly 1", () => {
    const app = game();
    const fx = app.world.resource(CameraFX);
    fx.punch(0.2, 0.2);
    let max = 1;
    for (let i = 0; i < 8; i++) {
      app.update(1 / 60);
      max = Math.max(max, fx.zoomFactor);
    }
    expect(max).toBeGreaterThan(1.05);
    run(app, 20);
    expect(fx.zoomFactor).toBe(1);
  });

  it("hit-stop freezes the game for real time, then restores the speed that was set before", () => {
    const app = game();
    const time = app.world.resource(Time);
    time.timeScale = 0.5;
    const fx = app.world.resource(CameraFX);
    fx.hitStop(0.1, app.world);
    app.update(1 / 60);
    expect(time.dt).toBe(0); // frozen from the next frame
    run(app, 5);
    expect(time.timeScale).toBe(0);
    run(app, 3);
    expect(time.timeScale).toBe(0.5);
  });

  it("slow motion nests: the original speed comes back once", () => {
    const app = game();
    const time = app.world.resource(Time);
    const fx = app.world.resource(CameraFX);
    fx.slowMotion(0.5, 0.2, app.world);
    fx.slowMotion(0.2, 0.1, app.world);
    expect(time.timeScale).toBe(0.2);
    run(app, 20);
    expect(time.timeScale).toBe(1);
  });

  it("reduced motion leaves out shakes and punches, but not hit-stop", () => {
    const app = game();
    const fx = app.world.resource(CameraFX);
    const time = app.world.resource(Time);
    fx.reduceMotion = true;
    fx.shake(10, 0.5);
    fx.punch(0.2, 0.2);
    fx.hitStop(0.1, app.world);
    app.update(1 / 60);
    expect(fx.offsetX).toBe(0);
    expect(fx.zoomFactor).toBe(1);
    expect(time.timeScale).toBe(0);
    // without a browser there is no system setting: "auto" means motion is on
    fx.reduceMotion = "auto";
    expect(fx.motionReduced).toBe(false);
  });

  it("stop() ends everything at once", () => {
    const app = game();
    const time = app.world.resource(Time);
    const fx = app.world.resource(CameraFX);
    fx.shake(10, 5);
    fx.hitStop(5);
    app.update(1 / 60);
    fx.stop(app.world);
    expect(fx.active).toBe(false);
    expect(time.timeScale).toBe(1);
  });
});

describe("scene transitions", () => {
  const scene = (name: string) => ({ version: 1, name, entities: [] }) as never;
  const withScenes = () => {
    const app = game();
    app.addPlugin(ScenesPlugin((p) => scene(p), "scenes/a.scene.json"));
    return app;
  };
  const scenesOf = (app: App) => app.world.resource(Scenes);

  it("switches at once without a fade", async () => {
    const app = withScenes();
    scenesOf(app).load("b");
    await scenesOf(app).loaded();
    app.update(1 / 60);
    expect(scenesOf(app).current).toBe("scenes/b.scene.json");
    expect(app.world.resource(ScreenFade).alpha).toBe(0);
  });

  it("fades out, swaps while the screen is covered, then fades in", async () => {
    const app = withScenes();
    const s = scenesOf(app);
    const fade = app.world.resource(ScreenFade);
    s.load("b", { fade: 0.2 });
    await s.loaded();
    const alphas: number[] = [];
    let swappedAt = -1;
    for (let i = 0; i < 40; i++) {
      app.update(1 / 20);
      alphas.push(fade.alpha);
      if (swappedAt < 0 && s.current === "scenes/b.scene.json") swappedAt = i;
    }
    expect(alphas[0]).toBeGreaterThan(0);
    expect(alphas[0]).toBeLessThan(1);
    expect(swappedAt).toBeGreaterThan(0);
    // fully covered at the moment of the swap
    expect(alphas[swappedAt]).toBe(1);
    expect(alphas[swappedAt - 1]).toBeLessThan(1);
    expect(fade.alpha).toBe(0);
    expect(s.fadingNow).toBe(false);
  });

  it("holds the black screen until a slow scene has loaded", async () => {
    const app = game();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    app.addPlugin(ScenesPlugin(async (p) => (await gate, scene(p)), "scenes/a.scene.json"));
    const s = scenesOf(app);
    s.load("b", { fade: 0.1 });
    run(app, 10, 1 / 20);
    expect(app.world.resource(ScreenFade).alpha).toBe(1);
    expect(s.current).toBe("scenes/a.scene.json");
    release();
    await s.loaded();
    run(app, 10, 1 / 20);
    expect(s.current).toBe("scenes/b.scene.json");
    expect(app.world.resource(ScreenFade).alpha).toBe(0);
  });

  it("carries data to the next scene and keeps it until it is changed", async () => {
    const app = withScenes();
    const s = scenesOf(app);
    s.load("b", { data: { score: 120, lives: 3 } });
    await s.loaded();
    app.update(1 / 60);
    s.load("c", { data: { score: 200 } });
    await s.loaded();
    app.update(1 / 60);
    expect(s.data).toEqual({ score: 200, lives: 3 });
  });

  it("uses the colour it was given", async () => {
    const app = withScenes();
    const s = scenesOf(app);
    s.load("b", { fade: { duration: 1, color: { r: 1, g: 1, b: 1 } } });
    app.update(1 / 10);
    const f = app.world.resource(ScreenFade);
    expect([f.r, f.g, f.b]).toEqual([1, 1, 1]);
    expect(f.alpha).toBeCloseTo(0.1);
  });
});
