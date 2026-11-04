import { describe, expect, it } from "vitest";
import {
  Active,
  App,
  Children,
  CorePlugin,
  GlobalTransform2D,
  Parent,
  Transform2D,
  childrenOf,
  destroyRecursive,
  mat3,
  parentOf,
  setParent,
  system,
} from "../src";

function global(app: App, e: number) {
  const g = app.world.store(GlobalTransform2D).matrix;
  return { a: g.a[e], b: g.b[e], c: g.c[e], d: g.d[e], tx: g.tx[e], ty: g.ty[e] };
}

describe("mat3", () => {
  it("inverts and composes", () => {
    const m = mat3.fromTRS(10, 5, 0.7, 2, 3);
    const inv = mat3.invert(m)!;
    const id = mat3.multiply(m, inv);
    expect(id.a).toBeCloseTo(1);
    expect(id.d).toBeCloseTo(1);
    expect(id.tx).toBeCloseTo(0);
    const d = mat3.decompose(m);
    expect(d.rotation).toBeCloseTo(0.7);
    expect(d.sx).toBeCloseTo(2);
    expect(d.sy).toBeCloseTo(3);
  });
});

describe("Hierarchy", () => {
  it("propagates transforms to children", () => {
    const app = new App().addPlugin(CorePlugin);
    const w = app.world;
    const parent = w.spawn([Transform2D, { position: { x: 10, y: 0 }, rotation: Math.PI / 2 }]);
    const child = w.spawn([Transform2D, { position: { x: 5, y: 0 } }]);
    setParent(w, child, parent);
    app.update(1 / 60);
    const g = global(app, child);
    // rotated 90° around the parent: (5, 0) -> (0, 5), then offset by (10, 0)
    expect(g.tx).toBeCloseTo(10);
    expect(g.ty).toBeCloseTo(5);
  });

  it("adds GlobalTransform2D automatically", () => {
    const app = new App();
    const e = app.world.spawn(Transform2D);
    expect(app.world.has(e, GlobalTransform2D)).toBe(true);
  });

  it("keeps Children in sync and prevents cycles", () => {
    const app = new App();
    const w = app.world;
    const a = w.spawn(Transform2D);
    const b = w.spawn(Transform2D);
    const c = w.spawn(Transform2D);
    setParent(w, b, a);
    setParent(w, c, a);
    expect(childrenOf(w, a)).toEqual([b, c]);
    expect(parentOf(w, b)).toBe(a);
    expect(() => setParent(w, a, b)).toThrow(/cycle/);
    setParent(w, b, c);
    expect(childrenOf(w, a)).toEqual([c]);
    expect(childrenOf(w, c)).toEqual([b]);
    w.destroy(b);
    expect(w.has(c, Children)).toBe(false);
  });

  it("orphans children when a parent is destroyed, or destroys them recursively", () => {
    const app = new App();
    const w = app.world;
    const a = w.spawn(Transform2D);
    const b = w.spawn(Transform2D);
    setParent(w, b, a);
    w.destroy(a);
    expect(w.isAlive(b)).toBe(true);
    expect(w.has(b, Parent)).toBe(false);

    const x = w.spawn(Transform2D);
    const y = w.spawn(Transform2D);
    const z = w.spawn(Transform2D);
    setParent(w, y, x);
    setParent(w, z, y);
    destroyRecursive(w, x);
    expect([x, y, z].some((e) => w.isAlive(e))).toBe(false);
  });

  it("propagates Active to descendants", () => {
    const app = new App().addPlugin(CorePlugin);
    const w = app.world;
    const a = w.spawn(Transform2D, [Active, { self: false }]);
    const b = w.spawn(Transform2D);
    setParent(w, b, a);
    app.update(1 / 60);
    const G = w.store(GlobalTransform2D);
    expect(G.active[a]).toBe(0);
    expect(G.active[b]).toBe(0);
  });
});

describe("App loop", () => {
  it("runs phases in order with fixed steps", () => {
    const app = new App({ fixedHz: 10 });
    const log: string[] = [];
    for (const phase of ["render", "update", "fixedUpdate", "startup", "preUpdate", "postUpdate"] as const) {
      app.addSystem(phase, system(phase, () => log.push(phase)));
    }
    app.update(0.25); // 2 fixed steps at 10 Hz, 0.05 s left over
    expect(log).toEqual(["startup", "preUpdate", "fixedUpdate", "fixedUpdate", "update", "postUpdate", "render"]);
    expect(app.time.alpha).toBeCloseTo(0.5);
    log.length = 0;
    app.update(0.05);
    expect(log).toEqual(["preUpdate", "fixedUpdate", "update", "postUpdate", "render"]);
  });

  it("gives fixedUpdate systems the fixed dt", () => {
    const app = new App({ fixedHz: 50 });
    const dts: number[] = [];
    app.addSystem("fixedUpdate", (w) => dts.push(app.time.dt));
    app.addSystem("update", () => dts.push(app.time.dt));
    app.update(0.1);
    expect(dts.slice(0, -1).every((d) => Math.abs(d - 0.02) < 1e-9)).toBe(true);
    expect(dts.at(-1)).toBeCloseTo(0.1);
  });

  it("keeps running when a system throws", () => {
    const app = new App();
    let ran = 0;
    const orig = console.error;
    console.error = () => {};
    app.addSystem("update", () => {
      throw new Error("boom");
    });
    app.addSystem("update", () => ran++);
    app.update(0.016);
    app.update(0.016);
    console.error = orig;
    expect(ran).toBe(2);
  });
});
