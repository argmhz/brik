import { describe, expect, it } from "vitest";
import { NULL_REF, World, componentView, defineComponent, defineEvent, t, withInit } from "../src";

const Pos = defineComponent("Test.Pos", { p: t.vec2(), z: t.f32(5) });
const Vel = defineComponent("Test.Vel", { v: t.vec2(1, 2) });
const Tag = defineComponent("Test.Tag");
const Label = defineComponent("Test.Label", { text: t.string("hi"), items: t.ref<number[]>(() => []) });
const Flag = defineComponent("Test.Flag", { on: t.bool(true), target: t.entity() });

describe("World entities", () => {
  it("spawns and destroys entities and recycles indices", () => {
    const w = new World({ initialCapacity: 16 });
    const a = w.spawn();
    const b = w.spawn();
    expect(w.isAlive(a)).toBe(true);
    expect(w.entityCount).toBe(2);
    w.destroy(a);
    expect(w.isAlive(a)).toBe(false);
    expect(w.entityCount).toBe(1);
    const c = w.spawn();
    expect(c).toBe(a); // reused index
    expect(w.isAlive(b)).toBe(true);
  });

  it("detects stale refs through generations", () => {
    const w = new World();
    const a = w.spawn();
    const ref = w.ref(a);
    expect(w.deref(ref)).toBe(a);
    w.destroy(a);
    const b = w.spawn();
    expect(b).toBe(a);
    expect(w.deref(ref)).toBe(-1);
    expect(w.deref(w.ref(b))).toBe(b);
    expect(w.deref(NULL_REF)).toBe(-1);
  });

  it("grows past the initial capacity and keeps data", () => {
    const w = new World({ initialCapacity: 16 });
    const ents: number[] = [];
    for (let i = 0; i < 100; i++) ents.push(w.spawn([Pos, { p: { x: i, y: -i } }]));
    const s = w.store(Pos);
    for (const e of ents) {
      expect(s.p.x[e]).toBe(e);
      expect(s.p.y[e]).toBe(-e);
    }
  });
});

describe("Components", () => {
  it("applies defaults and initial values", () => {
    const w = new World();
    const e = w.spawn([Pos, { p: { x: 3 } }], Vel, Label);
    expect(w.read(e, Pos)).toEqual({ p: { x: 3, y: 0 }, z: 5 });
    expect(w.read(e, Vel)).toEqual({ v: { x: 1, y: 2 } });
    expect(w.read(e, Label).text).toBe("hi");
  });

  it("does not share ref defaults between entities", () => {
    const w = new World();
    const a = w.spawn(Label);
    const b = w.spawn(Label);
    w.store(Label).items[a].push(1);
    expect(w.store(Label).items[b]).toEqual([]);
  });

  it("resets data when a component is re-added to a recycled entity", () => {
    const w = new World();
    const a = w.spawn([Pos, { z: 99 }]);
    w.destroy(a);
    const b = w.spawn(Pos);
    expect(b).toBe(a);
    expect(w.store(Pos).z[b]).toBe(5);
  });

  it("adds, removes and checks components", () => {
    const w = new World();
    const e = w.spawn(Pos);
    expect(w.has(e, Pos)).toBe(true);
    expect(w.has(e, Tag)).toBe(false);
    w.add(e, Tag);
    expect(w.has(e, Tag)).toBe(true);
    w.remove(e, Pos);
    expect(w.has(e, Pos)).toBe(false);
    expect(w.componentsOf(e).map((c) => c.name)).toEqual(["Test.Tag"]);
  });

  it("stores bools and entity refs", () => {
    const w = new World();
    const target = w.spawn();
    const e = w.spawn([Flag, { on: false, target: w.ref(target) }]);
    const v = w.read(e, Flag);
    expect(v.on).toBe(false);
    expect(w.deref(v.target)).toBe(target);
  });

  it("adds required components", () => {
    const Req = defineComponent("Test.Req", { n: t.f32() });
    const Needs = defineComponent("Test.Needs", {}, { requires: [Req] });
    const w = new World();
    const e = w.spawn(Needs);
    expect(w.has(e, Req)).toBe(true);
  });

  it("runs onAdd and onRemove hooks, including on destroy", () => {
    const log: string[] = [];
    const Hooked = defineComponent(
      "Test.Hooked",
      {},
      { onAdd: (_, e) => log.push(`add ${e}`), onRemove: (_, e) => log.push(`remove ${e}`) },
    );
    const w = new World();
    const e = w.spawn(Hooked);
    w.remove(e, Hooked);
    w.add(e, Hooked);
    w.destroy(e);
    expect(log).toEqual([`add ${e}`, `remove ${e}`, `add ${e}`, `remove ${e}`]);
  });
});

describe("Queries", () => {
  it("matches all / none / any", () => {
    const w = new World();
    const a = w.spawn(Pos);
    const b = w.spawn(Pos, Vel);
    const c = w.spawn(Vel, Tag);
    expect(new Set(w.query([Pos]))).toEqual(new Set([a, b]));
    expect([...w.query([Pos, Vel])]).toEqual([b]);
    expect([...w.query({ all: [Pos], none: [Vel] })]).toEqual([a]);
    expect(new Set(w.query({ any: [Pos, Tag] }))).toEqual(new Set([a, b, c]));
  });

  it("is cached and stays live as entities change", () => {
    const w = new World();
    const q = w.query([Pos, Vel]);
    expect(w.query([Vel, Pos])).toBe(q);
    const e = w.spawn(Pos);
    expect(q.count()).toBe(0);
    w.add(e, Vel);
    expect(q.count()).toBe(1);
    w.remove(e, Pos);
    expect(q.count()).toBe(0);
  });

  it("allows destroying the current entity while iterating", () => {
    const w = new World();
    for (let i = 0; i < 10; i++) w.spawn([Pos, { z: i }]);
    const seen: number[] = [];
    for (const e of w.query([Pos])) {
      seen.push(e);
      if (w.store(Pos).z[e] % 2 === 0) w.destroy(e);
    }
    expect(seen.length).toBe(10);
    expect(w.query([Pos]).count()).toBe(5);
  });

  it("tracks added and removed entities", () => {
    const w = new World();
    const q = w.query([Pos]);
    const a = w.spawn(Pos);
    expect(q.added()).toEqual([a]); // first call returns current matches
    const b = w.spawn(Pos);
    expect(q.added()).toEqual([b]);
    expect(q.added()).toEqual([]);
    w.destroy(a);
    w.remove(b, Pos);
    expect(q.removed()).toEqual([a, b]);
  });

  it("tracks changed components per query", () => {
    const w = new World();
    const q = w.query([Pos]);
    const other = w.query({ all: [Pos], none: [Vel] });
    const a = w.spawn([Pos, { z: 1 }]);
    const b = w.spawn([Pos, { z: 2 }]);
    expect(q.changed(Pos).sort()).toEqual([a, b]); // first call: every match
    expect(q.changed(Pos)).toEqual([]);

    w.write(a, Pos, { z: 5 });
    componentView(w, Pos, b).z = 7;
    expect(q.changed(Pos).sort()).toEqual([a, b]);
    expect(q.changed(Pos)).toEqual([]);

    // direct store writes are only seen after markChanged
    w.store(Pos).z[a] = 9;
    expect(q.changed(Pos)).toEqual([]);
    w.markChanged(a, Pos);
    expect(q.changed(Pos)).toEqual([a]);

    // each query keeps its own place, and new entities count as changed
    expect(other.changed(Pos).sort()).toEqual([a, b]);
    const c = w.spawn(Pos);
    expect(q.changed(Pos)).toEqual([c]);
    expect(other.changed(Pos)).toEqual([c]);
  });

  it("keeps change ticks when the world grows", () => {
    const w = new World({ initialCapacity: 16 });
    const q = w.query([Pos]);
    const first = w.spawn(Pos);
    q.changed(Pos);
    for (let i = 0; i < 40; i++) w.spawn(Pos);
    q.changed(Pos);
    w.write(first, Pos, { z: 3 });
    expect(q.changed(Pos)).toEqual([first]);
  });
});

describe("Commands", () => {
  it("defers structural changes until flush", () => {
    const w = new World();
    const e = w.commands.spawn(withInit(Pos, { z: 1 }), Vel);
    expect(w.isAlive(e)).toBe(true);
    expect(w.has(e, Pos)).toBe(false);
    w.commands.flush();
    expect(w.has(e, Pos)).toBe(true);
    expect(w.store(Pos).z[e]).toBe(1);
    w.commands.destroy(e);
    expect(w.isAlive(e)).toBe(true);
    w.commands.flush();
    expect(w.isAlive(e)).toBe(false);
  });
});

describe("Resources and events", () => {
  it("stores resources by class", () => {
    class Score {
      value = 0;
    }
    const w = new World();
    w.insertResource(new Score()).value = 3;
    expect(w.resource(Score).value).toBe(3);
    class Missing {}
    expect(() => w.resource(Missing)).toThrow(/Missing/);
  });

  it("delivers each event once per reader, across a frame boundary", () => {
    const Hit = defineEvent<{ dmg: number }>("Hit");
    const w = new World();
    const r1 = w.events(Hit).reader();
    w.emit(Hit, { dmg: 1 });
    expect(r1.read()).toEqual([{ dmg: 1 }]);
    expect(r1.read()).toEqual([]);
    const r2 = w.events(Hit).reader(); // created after the send: sees only newer events
    w.updateEvents();
    w.emit(Hit, { dmg: 2 });
    expect(r1.read()).toEqual([{ dmg: 2 }]);
    expect(r2.read()).toEqual([{ dmg: 2 }]);
    w.updateEvents();
    w.updateEvents();
    expect(r1.read()).toEqual([]);
  });
});
