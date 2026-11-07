import { beforeAll, describe, expect, it } from "vitest";
import {
  AnimationEvent,
  App,
  Assets,
  Collider2D,
  CollisionFilter,
  GamePlugins,
  Input,
  Joint2D,
  Physics,
  RigidBody2D,
  Sprite,
  Transform2D,
  TriggerEnter,
  TriggerExit,
  UIRect,
  UISubmit,
  UITextEntry,
  UITextInput,
  initPhysics,
  playAnimation,
  setActive,
  type AnimationClip,
} from "../src/index";

beforeAll(async () => {
  await initPhysics();
});
const game = () => new App().addPlugin(GamePlugins());
const ref = (id: string) => ({ texture: "tex", id });
const circle = { shape: "circle", size: { x: 10, y: 10 } } as const;

describe("animation events", () => {
  const events = (dt: number) => {
    const app = game();
    const w = app.world;
    const c: AnimationClip = {
      guid: "c",
      name: "c",
      mode: "loop",
      frames: Array.from({ length: 8 }, (_, i) => ({ sprite: ref(`s${i}`), duration: 1 / 60 })),
      events: [{ frame: 3, name: "x" }],
    };
    w.resource(Assets).addClip(c);
    const e = w.spawn([Transform2D], [Sprite]);
    playAnimation(w, e, "c");
    const r = w.events(AnimationEvent).reader();
    let n = 0;
    for (let i = 0; i < Math.round(1 / dt); i++) {
      app.update(dt);
      n += r.read().length;
    }
    return n;
  };
  it("are not lost when a long step skips their frame", () => {
    // the clip loops 7.5 times a second: about 7 or 8 events, whatever the frame rate
    for (const dt of [1 / 144, 1 / 60, 1 / 30, 1 / 20]) expect(events(dt)).toBeGreaterThanOrEqual(7);
    expect(events(1 / 144)).toBeLessThanOrEqual(8);
    expect(events(1 / 30)).toBeLessThanOrEqual(8);
  });
});

describe("animation events, fast and short clips", () => {
  const count = (mode: "loop" | "once", dt: number, seconds: number) => {
    const app = game();
    const w = app.world;
    const c: AnimationClip = {
      guid: `f-${mode}`,
      name: `f-${mode}`,
      mode,
      frames: [
        { sprite: ref("a"), duration: 1 / 120 },
        { sprite: ref("b"), duration: 1 / 120 },
      ],
      events: [
        { frame: 0, name: "first" },
        { frame: 1, name: "second" },
      ],
    };
    w.resource(Assets).addClip(c);
    const e = w.spawn([Transform2D], [Sprite]);
    playAnimation(w, e, c.name);
    const r = w.events(AnimationEvent).reader();
    const names: string[] = [];
    for (let i = 0; i < Math.round(seconds / dt); i++) {
      app.update(dt);
      for (const ev of r.read()) names.push(ev.name);
    }
    return names;
  };
  it("a looping clip sends every event at any frame rate (60 loops a second)", () => {
    for (const dt of [1 / 144, 1 / 60, 1 / 30]) {
      const names = count("loop", dt, 1);
      expect(names.filter((n) => n === "first").length).toBeGreaterThanOrEqual(58);
      expect(names.filter((n) => n === "second").length).toBeGreaterThanOrEqual(58);
    }
  });
  it("a once clip sends all its events even when the first step runs past the end", () => {
    for (const dt of [1 / 144, 1 / 30]) expect(count("once", dt, 0.5)).toEqual(["first", "second"]);
  });
});

describe("joints", () => {
  it("a world-point joint on an inactive body does not crash the physics step", () => {
    const app = game();
    const w = app.world;
    const b = w.spawn([Transform2D], [RigidBody2D], [Collider2D, circle], [Joint2D, { type: "hinge" }]);
    // a failing system is logged, not thrown
    const logged: unknown[][] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => void logged.push(a);
    try {
      setActive(w, b, false);
      for (let i = 0; i < 20; i++) app.update(1 / 60);
      setActive(w, b, true);
      for (let i = 0; i < 20; i++) app.update(1 / 60);
    } finally {
      console.error = orig;
    }
    expect(logged).toEqual([]);
    expect(w.resource(Physics).jointCount).toBe(1);
  });

  it("deleting the connected body ends the joint instead of hooking the body to the origin", () => {
    const app = game();
    const w = app.world;
    const a = w.spawn([Transform2D, { position: { x: 500, y: 500 } }], [RigidBody2D, { type: "kinematic" }], [Collider2D, circle]);
    const b = w.spawn(
      [Transform2D, { position: { x: 540, y: 500 } }],
      [RigidBody2D],
      [Collider2D, circle],
      [Joint2D, { type: "hinge", anchor: { x: -20, y: 0 }, connectedAnchor: { x: 20, y: 0 } }],
    );
    w.store(Joint2D).connected[b] = w.ref(a);
    for (let i = 0; i < 10; i++) app.update(1 / 60);
    expect(w.resource(Physics).jointCount).toBe(1);
    w.destroy(a);
    for (let i = 0; i < 30; i++) app.update(1 / 60);
    expect(w.resource(Physics).jointCount).toBe(0);
    // it falls straight down, still far from the origin
    expect(w.store(Transform2D).position.x[b]).toBeGreaterThan(400);
  });
});

describe("contact exits", () => {
  const sensor = (w: App["world"], x: number, ...extra: Parameters<App["world"]["spawn"]>) =>
    w.spawn([Transform2D, { position: { x, y: 0 } }], [RigidBody2D, { type: "kinematic" }], [Collider2D, { shape: "circle", size: { x: 20, y: 20 }, isTrigger: true }], ...extra);
  const run = (change: (w: App["world"], b: number) => void, extra: Parameters<App["world"]["spawn"]> = []) => {
    const app = game();
    const w = app.world;
    sensor(w, 0, ...extra);
    const b = sensor(w, 5, ...extra);
    const en = w.events(TriggerEnter).reader();
    const ex = w.events(TriggerExit).reader();
    let enters = 0;
    let exits = 0;
    const step = (n: number) => {
      for (let i = 0; i < n; i++) {
        app.update(1 / 60);
        enters += en.read().length;
        exits += ex.read().length;
      }
    };
    step(5);
    change(w, b);
    step(5);
    step(5);
    return { enters, exits };
  };

  it("deleting an overlapping body sends TriggerExit once", () => {
    expect(run((w, b) => w.destroy(b))).toEqual({ enters: 1, exits: 1 });
  });
  it("switching an overlapping body off sends TriggerExit once", () => {
    expect(run((w, b) => setActive(w, b, false))).toEqual({ enters: 1, exits: 1 });
  });
  it("changing group and mask under a contact sends TriggerExit once", () => {
    const r = run(
      (w, b) => {
        w.store(CollisionFilter).group[b] = 2;
        w.store(CollisionFilter).mask[b] = 0;
      },
      [[CollisionFilter, { group: 1, mask: 0xffff }]] as never,
    );
    expect(r).toEqual({ enters: 1, exits: 1 });
  });
  it("a normal exit is sent once, not twice", () => {
    const r = run((w, b) => {
      w.store(Transform2D).position.x[b] = 500;
    });
    expect(r).toEqual({ enters: 1, exits: 1 });
  });
});

describe("text fields", () => {
  it("Enter from the Input submits the focused field", () => {
    const app = game();
    const w = app.world;
    const e = w.spawn([Transform2D], [UIRect], [UITextInput]);
    const entry = w.resource(UITextEntry);
    entry.focus(w, e);
    entry.type("hej");
    app.update(1 / 60);
    const sub = w.events(UISubmit).reader();
    const input = w.resource(Input);
    input.inject("down", "Enter");
    app.update(1 / 60);
    input.inject("up", "Enter");
    app.update(1 / 60);
    const got = sub.read();
    expect(got.length).toBe(1);
    expect(got[0].value).toBe("hej");
    expect(entry.focused).toBe(-1);
  });
});
