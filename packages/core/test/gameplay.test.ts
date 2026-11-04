import { describe, expect, it } from "vitest";
import {
  App,
  CorePlugin,
  GameplayPlugin,
  Lifetime,
  Tags,
  Timer,
  TimerFinished,
  Transform2D,
  Tween,
  Tweens,
  easings,
  findByTag,
  setParent,
} from "../src";

const makeApp = () => new App().addPlugin(CorePlugin).addPlugin(GameplayPlugin);

describe("gameplay helpers", () => {
  it("Lifetime destroys the entity and its children", () => {
    const app = makeApp();
    const w = app.world;
    const e = w.spawn([Transform2D], [Lifetime, { seconds: 0.5 }]);
    const child = w.spawn([Transform2D]);
    setParent(w, child, e);
    for (let i = 0; i < 20; i++) app.update(0.02);
    expect(w.isAlive(e)).toBe(true);
    for (let i = 0; i < 20; i++) app.update(0.02);
    expect(w.isAlive(e)).toBe(false);
    expect(w.isAlive(child)).toBe(false);
  });

  it("Timer sends TimerFinished, and repeats", () => {
    const app = makeApp();
    const w = app.world;
    const once = w.spawn([Timer, { duration: 0.1 }]);
    const rep = w.spawn([Timer, { duration: 0.1, repeat: true }]);
    const reader = w.events(TimerFinished).reader();
    const seen: number[] = [];
    for (let i = 0; i < 30; i++) {
      app.update(1 / 60);
      for (const ev of reader.read()) seen.push(ev.entity);
    }
    expect(seen.filter((e) => e === once)).toHaveLength(1);
    expect(seen.filter((e) => e === rep)).toHaveLength(5);
    expect(w.store(Timer).running[once]).toBe(0);
  });

  it("Tween component animates a field and removes itself", () => {
    const app = makeApp();
    const w = app.world;
    const e = w.spawn(
      [Transform2D, { position: { x: 10, y: 0 } }],
      [Tween, { property: "position.x", to: 110, duration: 1, easing: "linear" }],
    );
    for (let i = 0; i < 10; i++) app.update(0.05);
    expect(w.store(Transform2D).position.x[e]).toBeCloseTo(60);
    for (let i = 0; i < 12; i++) app.update(0.05);
    expect(w.store(Transform2D).position.x[e]).toBeCloseTo(110);
    expect(w.has(e, Tween)).toBe(false);
  });

  it("yoyo tweens go back and forth", () => {
    const app = makeApp();
    const w = app.world;
    const e = w.spawn([Transform2D], [Tween, { property: "rotation", from: 0, fromCurrent: false, to: 1, duration: 1, easing: "linear", loop: "yoyo" }]);
    for (let i = 0; i < 30; i++) app.update(0.05);
    expect(w.store(Transform2D).rotation[e]).toBeCloseTo(0.5);
    expect(w.has(e, Tween)).toBe(true);
  });

  it("Tweens resource: to, after, every, and cancel on destroy", () => {
    const app = makeApp();
    const w = app.world;
    const tw = w.resource(Tweens);
    const e = w.spawn([Transform2D]);
    let done = 0;
    tw.to(e, Transform2D, "scale.x", 3, 0.2, { easing: "linear", onDone: () => done++ });
    let afters = 0;
    let ticks = 0;
    tw.after(0.1, () => afters++);
    tw.every(0.05, () => ticks++, e);
    for (let i = 0; i < 12; i++) app.update(0.025); // 0.3 s
    expect(w.store(Transform2D).scale.x[e]).toBeCloseTo(3);
    expect(done).toBe(1);
    expect(afters).toBe(1);
    expect(ticks).toBe(6);
    w.destroy(e);
    app.update(0.1);
    expect(ticks).toBe(6);
    expect(tw.active).toBe(0);
    expect(() => tw.to(w.spawn([Transform2D]), Transform2D, "nope", 1, 1)).toThrow(/not a number/);
  });

  it("easings start at 0 and end at 1", () => {
    for (const [name, f] of Object.entries(easings)) {
      expect(f(0), name).toBeCloseTo(0);
      expect(f(1), name).toBeCloseTo(1);
    }
  });

  it("finds entities by tag", () => {
    const w = makeApp().world;
    const a = w.spawn([Tags, { list: ["enemy", "flying"] }]);
    w.spawn([Tags, { list: ["pickup"] }]);
    expect(findByTag(w, "enemy")).toEqual([a]);
  });
});
