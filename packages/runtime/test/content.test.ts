import { beforeAll, describe, expect, it } from "vitest";
import {
  AnimationEvent,
  App,
  Assets,
  Audio,
  AudioSource,
  Behaviour,
  Camera2D,
  CameraFollow2D,
  CharacterController2D,
  Collider2D,
  CollisionEnter,
  GamePlugins,
  GlobalTransform2D,
  Physics,
  PrefabInstance,
  RigidBody2D,
  ScriptRegistry,
  Scripts,
  ScriptsPlugin,
  Spawner,
  Sprite,
  SpriteAnimator,
  Transform2D,
  TriggerEnter,
  UILayout,
  Velocity2D,
  setActive,
  setParent,
  frameAt,
  initPhysics,
  parsePrefab,
  playAnimation,
  prefabToJson,
  serializeEntities,
  spawnPrefab,
  type AnimationClip,
} from "../src";

beforeAll(async () => {
  await initPhysics();
});

const game = () => new App().addPlugin(GamePlugins());
const run = (app: App, frames: number, dt = 1 / 60) => {
  for (let i = 0; i < frames; i++) app.update(dt);
};

const ref = (id: string) => ({ texture: "tex", id });
const clip = (mode: AnimationClip["mode"]): AnimationClip => ({
  guid: `clip-${mode}`,
  name: `walk_${mode}`,
  mode,
  frames: [
    { sprite: ref("a"), duration: 0.1 },
    { sprite: ref("b"), duration: 0.1 },
    { sprite: ref("c"), duration: 0.2 },
  ],
  events: [{ frame: 1, name: "step" }],
});

describe("sprite animation", () => {
  it("frameAt handles loop, once and pingpong", () => {
    expect(frameAt(clip("loop"), 0.05).frame).toBe(0);
    expect(frameAt(clip("loop"), 0.15).frame).toBe(1);
    expect(frameAt(clip("loop"), 0.45).frame).toBe(0);
    expect(frameAt(clip("once"), 5)).toEqual({ frame: 2, done: true });
    // pingpong: a b c b a b ...
    const pp = clip("pingpong");
    expect([0.05, 0.15, 0.3, 0.45, 0.55].map((t) => frameAt(pp, t).frame)).toEqual([0, 1, 2, 1, 0]);
  });

  it("SpriteAnimator sets the sprite and sends frame events", () => {
    const app = game();
    const w = app.world;
    w.resource(Assets).addClip(clip("loop"));
    const e = w.spawn([Transform2D], [Sprite]);
    playAnimation(w, e, "walk_loop");
    const events = w.events(AnimationEvent).reader();
    app.update(0.01);
    expect(w.store(Sprite).sprite[e]?.id).toBe("a");
    app.update(0.1);
    expect(w.store(Sprite).sprite[e]?.id).toBe("b");
    expect(events.read().map((ev) => ev.name)).toEqual(["step"]);
    w.store(SpriteAnimator).speed[e] = 0;
    app.update(1);
    expect(w.store(Sprite).sprite[e]?.id).toBe("b");
    expect(() => playAnimation(w, e, "nope")).toThrow(/unknown animation/);
  });
});

describe("physics", () => {
  it("a dynamic body falls and lands on a static collider", () => {
    const app = game();
    const w = app.world;
    const ground = w.spawn([Transform2D, { position: { x: 0, y: 0 } }], [Collider2D, { size: { x: 400, y: 20 } }]);
    const box = w.spawn(
      [Transform2D, { position: { x: 0, y: 100 } }],
      [RigidBody2D],
      [Velocity2D],
      [Collider2D, { size: { x: 20, y: 20 } }],
    );
    const hits = w.events(CollisionEnter).reader();
    const pairs: number[][] = [];
    const step = (n: number) => {
      for (let i = 0; i < n; i++) {
        app.update(1 / 60);
        for (const { a, b } of hits.read()) pairs.push([a, b].sort());
      }
    };
    step(30);
    expect(w.store(Transform2D).position.y[box]).toBeLessThan(100);
    expect(w.store(Velocity2D).linear.y[box]).toBeLessThan(0);
    step(150);
    // resting on top: ground half height 10 + box half height 10
    expect(w.store(Transform2D).position.y[box]).toBeCloseTo(20, 0);
    expect(pairs).toContainEqual([ground, box].sort());
    expect(w.resource(Physics).bodyCount).toBe(2);
  });

  it("velocity set from a script moves the body; destroyed entities lose their body", () => {
    const app = game();
    const w = app.world;
    const e = w.spawn([Transform2D], [RigidBody2D, { gravityScale: 0 }], [Velocity2D], [Collider2D]);
    app.update(1 / 60);
    w.store(Velocity2D).linear.x[e] = 120;
    run(app, 60);
    expect(w.store(Transform2D).position.x[e]).toBeCloseTo(120, -1);
    // teleport from a script
    w.store(Transform2D).position.x[e] = -500;
    app.update(1 / 60);
    expect(w.store(Transform2D).position.x[e]).toBeLessThan(-490);
    w.destroy(e);
    app.update(1 / 60);
    expect(w.resource(Physics).bodyCount).toBe(0);
  });

  it("triggers, raycasts and point queries", () => {
    const app = game();
    const w = app.world;
    const zone = w.spawn([Transform2D, { position: { x: 0, y: 0 } }], [Collider2D, { size: { x: 50, y: 50 }, isTrigger: true }]);
    const ball = w.spawn(
      [Transform2D, { position: { x: 0, y: 80 } }],
      [RigidBody2D],
      [Collider2D, { shape: "circle", size: { x: 10, y: 10 } }],
    );
    const wall = w.spawn([Transform2D, { position: { x: 200, y: 0 } }], [Collider2D, { size: { x: 20, y: 200 } }]);
    const enter = w.events(TriggerEnter).reader();
    let entered = false;
    for (let i = 0; i < 40; i++) {
      app.update(1 / 60);
      for (const { a, b } of enter.read()) if ((a === zone && b === ball) || (a === ball && b === zone)) entered = true;
    }
    expect(entered).toBe(true);
    const physics = w.resource(Physics);
    const hit = physics.raycast({ x: 100, y: 50 }, { x: 1, y: 0 }, 500);
    expect(hit?.entity).toBe(wall);
    expect(hit?.point.x).toBeCloseTo(190, 0);
    expect(hit?.normal.x).toBeCloseTo(-1);
    expect(physics.raycast({ x: 100, y: 50 }, { x: -1, y: 0 }, 50)).toBeNull();
    expect(physics.overlapPoint({ x: 200, y: 90 })).toEqual([wall]);
  });

  it("character controller slides along the ground and reports grounded", () => {
    const app = game();
    const w = app.world;
    w.spawn([Transform2D, { position: { x: 0, y: 0 } }], [Collider2D, { size: { x: 1000, y: 20 } }]);
    const wall = w.spawn([Transform2D, { position: { x: 100, y: 40 } }], [Collider2D, { size: { x: 20, y: 60 } }]);
    const hero = w.spawn([Transform2D, { position: { x: 0, y: 40 } }], [RigidBody2D], [CharacterController2D], [Collider2D, { size: { x: 16, y: 24 } }]);
    app.update(1 / 60);
    const physics = w.resource(Physics);
    for (let i = 0; i < 60; i++) {
      physics.moveCharacter(hero, 4, -4);
      app.update(1 / 60);
    }
    const T = w.store(Transform2D);
    expect(w.store(CharacterController2D).grounded[hero]).toBe(1);
    // stopped by the wall (wall left edge 90, hero half width 8)
    expect(T.position.x[hero]).toBeLessThan(83);
    expect(T.position.x[hero]).toBeGreaterThan(75);
    // standing on the ground (top 10, half height 12)
    expect(T.position.y[hero]).toBeCloseTo(22, 0);
    expect(wall).toBeGreaterThan(0);
  });

  it("a character keeps walking when a dynamic body lands on it, and pushes bodies aside", () => {
    const app = game();
    const w = app.world;
    w.spawn([Transform2D, { position: { x: 0, y: -60 } }], [Collider2D, { size: { x: 400, y: 20 } }]);
    const ball = w.spawn([Transform2D, { position: { x: -40, y: 60 } }], [RigidBody2D], [Collider2D, { shape: "circle", size: { x: 24, y: 24 } }]);
    const hero = w.spawn([Transform2D, { position: { x: -100, y: -37.5 } }], [RigidBody2D], [CharacterController2D], [Collider2D, { size: { x: 16, y: 24 } }]);
    const physics = w.resource(Physics);
    app.update(1 / 60);
    for (let i = 0; i < 120; i++) {
      physics.moveCharacter(hero, 1.5, -1);
      app.update(1 / 60);
    }
    const T = w.store(Transform2D);
    expect(T.position.x[hero]).toBeGreaterThan(70);
    // the ball rolled off and is back on the ground, not inside the character
    expect(T.position.y[ball]).toBeCloseTo(-38, 0);
    expect(Math.abs(T.position.x[ball] - T.position.x[hero])).toBeGreaterThan(20);
  });
});

describe("characters and loose crates", () => {
  // ground top at y 0, a 32x32 crate resting on it (top at 32), hero 16x24
  const scene = () => {
    const app = game();
    const w = app.world;
    w.spawn([Transform2D, { position: { x: 0, y: -10 } }], [Collider2D, { size: { x: 600, y: 20 } }]);
    const crate = w.spawn([Transform2D, { position: { x: 0, y: 16 } }], [RigidBody2D], [Collider2D, { size: { x: 32, y: 32 } }]);
    return { app, w, crate, physics: w.resource(Physics), T: w.store(Transform2D) };
  };

  it("stands on a crate", () => {
    const { app, w, crate, physics, T } = scene();
    const hero = w.spawn([Transform2D, { position: { x: 0, y: 80 } }], [RigidBody2D], [CharacterController2D], [Collider2D, { size: { x: 16, y: 24 } }]);
    run(app, 30); // let the crate settle
    for (let i = 0; i < 90; i++) {
      physics.moveCharacter(hero, 0, -3);
      app.update(1 / 60);
    }
    // on top of the crate (top 32 + half height 12), not pushed through it
    expect(T.position.y[hero]).toBeCloseTo(44, 0);
    expect(w.store(CharacterController2D).grounded[hero]).toBe(1);
    expect(T.position.y[crate]).toBeCloseTo(16, 0);
  });

  it("jumps onto a crate from the side and stays on it", () => {
    const { app, w, crate, physics, T } = scene();
    const hero = w.spawn([Transform2D, { position: { x: -60, y: 12 } }], [RigidBody2D], [CharacterController2D], [Collider2D, { size: { x: 16, y: 24 } }]);
    run(app, 30);
    let vy = 0;
    for (let i = 0; i < 120; i++) {
      if (i === 0) vy = 6; // jump
      vy = Math.max(vy - 0.25, -4);
      // run right while in the air, stand still once on the crate
      const dx = i < 40 ? 1.5 : 0;
      physics.moveCharacter(hero, dx, vy);
      app.update(1 / 60);
    }
    expect(T.position.x[hero]).toBeGreaterThan(-16);
    expect(T.position.x[hero]).toBeLessThan(16);
    expect(T.position.y[hero]).toBeCloseTo(44, 0);
    expect(w.store(CharacterController2D).grounded[hero]).toBe(1);
    expect(T.position.y[crate]).toBeCloseTo(16, 0);
  });

  it("walks into a crate and pushes it along", () => {
    const { app, w, crate, physics, T } = scene();
    const hero = w.spawn([Transform2D, { position: { x: -100, y: 12 } }], [RigidBody2D], [CharacterController2D], [Collider2D, { size: { x: 16, y: 24 } }]);
    run(app, 30);
    for (let i = 0; i < 120; i++) {
      physics.moveCharacter(hero, 2, -2);
      app.update(1 / 60);
    }
    // the crate moved right, and the hero is still beside it, not inside or on top
    expect(T.position.x[crate]).toBeGreaterThan(40);
    expect(T.position.x[hero]).toBeLessThan(T.position.x[crate] - 20);
    expect(T.position.y[hero]).toBeCloseTo(12, 0);
  });
});

describe("physics cleanup", () => {
  it("frees a world after a character walked through a trigger", () => {
    const app = game();
    const w = app.world;
    w.spawn([Transform2D, { position: { x: 0, y: -60 } }], [Collider2D, { size: { x: 300, y: 20 } }]);
    const zone = w.spawn([Transform2D, { position: { x: -40, y: -30 } }], [Collider2D, { size: { x: 40, y: 40 }, isTrigger: true }]);
    const hero = w.spawn([Transform2D, { position: { x: -100, y: -37.5 } }], [RigidBody2D], [CharacterController2D], [Collider2D, { size: { x: 16, y: 24 } }]);
    const enter = w.events(TriggerEnter).reader();
    let entered = false;
    const physics = w.resource(Physics);
    for (let i = 0; i < 120; i++) {
      physics.moveCharacter(hero, 1.5, -2);
      app.update(1 / 60);
      for (const { a, b } of enter.read()) if ((a === zone && b === hero) || (a === hero && b === zone)) entered = true;
    }
    // the character walks through the trigger, which reports it
    expect(entered).toBe(true);
    expect(w.store(Transform2D).position.x[hero]).toBeGreaterThan(50);
    expect(() => physics.reset()).not.toThrow();
    expect(physics.bodyCount).toBe(0);
  });
});

describe("camera follow", () => {
  it("snaps or smoothly follows a target, with bounds", () => {
    const app = game();
    const w = app.world;
    const target = w.spawn([Transform2D, { position: { x: 300, y: 50 } }]);
    const cam = w.spawn([Transform2D], [CameraFollow2D, { target: w.ref(target), smoothing: 0, useBounds: true, bounds: { x: -100, y: -100, w: 300, h: 300 } }]);
    app.update(1 / 60);
    const T = w.store(Transform2D);
    expect(T.position.x[cam]).toBe(200);
    expect(T.position.y[cam]).toBe(50);
    expect(w.store(GlobalTransform2D).matrix.tx[cam]).toBe(200);
    w.store(CameraFollow2D).smoothing[cam] = 0.5;
    w.store(CameraFollow2D).useBounds[cam] = 0;
    app.update(1 / 60);
    expect(T.position.x[cam]).toBeGreaterThan(200);
    expect(T.position.x[cam]).toBeLessThan(300);
  });

  it("keeps the whole view inside the bounds, whatever the screen size", () => {
    const app = game();
    const w = app.world;
    const target = w.spawn([Transform2D, { position: { x: 1000, y: -1000 } }]);
    const level = { x: 0, y: 0, w: 1000, h: 200 };
    const cam = w.spawn(
      [Transform2D],
      [Camera2D, { zoom: 2 }],
      [CameraFollow2D, { target: w.ref(target), smoothing: 0, useBounds: true, bounds: level }],
    );
    // what the renderer reports after drawing a frame
    const layout = w.tryResource(UILayout) ?? w.insertResource(new UILayout());
    const T = w.store(Transform2D);
    const at = (sw: number, sh: number) => {
      layout.screenW = sw;
      layout.screenH = sh;
      app.update(1 / 60);
      return { x: T.position.x[cam], y: T.position.y[cam] };
    };
    // 800x300 px at zoom 2 shows 400x150 world units: the right edge of the view sits on the level's
    expect(at(800, 300)).toEqual({ x: 800, y: 75 });
    // a wider screen shows more, so the camera stops earlier
    expect(at(1200, 300)).toEqual({ x: 700, y: 75 });
    // taller than the level: centered on it
    expect(at(800, 600).y).toBe(100);
    // "center" is the old behaviour: only the camera's middle stays inside
    w.store(CameraFollow2D).boundsMode[cam] = "center";
    expect(at(800, 300)).toEqual({ x: 1000, y: 0 });
  });
});

describe("prefabs", () => {
  it("round-trips through JSON and spawns copies with fresh ids", () => {
    const app = game();
    const w = app.world;
    const root = w.spawn([Transform2D, { position: { x: 5, y: 5 } }], [Collider2D]);
    const json = prefabToJson("p1", { version: 1, entities: serializeEntities(w, [root]) });
    const prefab = parsePrefab(json, "Coin");
    w.resource(Assets).addPrefab(prefab);
    const a = spawnPrefab(w, "Coin", { position: { x: 100, y: 0 } });
    const b = spawnPrefab(w, "p1");
    expect(a).not.toBe(b);
    expect(w.store(Transform2D).position.x[a]).toBe(100);
    expect(w.store(Transform2D).position.x[b]).toBe(5);
    expect(w.store(PrefabInstance).prefab[a]).toBe("p1");
    expect(w.has(a, Collider2D)).toBe(true);
    expect(() => spawnPrefab(w, "Nope")).toThrow(/unknown prefab/);
  });

  it("Spawner keeps at most maxAlive copies", () => {
    const app = game();
    const w = app.world;
    const proto = w.spawn([Transform2D]);
    w.resource(Assets).addPrefab({ guid: "p", name: "Thing", data: { version: 1, entities: serializeEntities(w, [proto]) } });
    w.destroy(proto);
    w.spawn([Transform2D, { position: { x: 7, y: 0 } }], [Spawner, { prefab: "p", interval: 0.1, maxAlive: 3 }]);
    run(app, 60);
    const spawned = w.query([PrefabInstance]).toArray();
    expect(spawned).toHaveLength(3);
    expect(spawned.every((e) => w.store(Transform2D).position.x[e] === 7)).toBe(true);
  });
});

describe("audio without WebAudio", () => {
  it("is a silent no-op", () => {
    const app = game();
    const w = app.world;
    const audio = w.resource(Audio);
    audio.addClip("g", "jump", new Uint8Array([1, 2, 3]));
    w.spawn([AudioSource, { clip: "g" }]);
    app.update(1 / 60);
    expect(audio.context).toBeNull();
    expect(audio.play("jump").playing).toBe(false);
    expect(audio.playingCount).toBe(0);
  });
});

describe("behaviour hooks", () => {
  it("dispatches collisions, triggers and timers to scripts", () => {
    const log: string[] = [];
    class Probe extends Behaviour {
      override onCollisionEnter(other: number) {
        log.push(`hit:${other}`);
      }
      override onTimer() {
        log.push("timer");
      }
      override onStart() {
        this.after(0.05, () => log.push("after"));
      }
    }
    const registry = new ScriptRegistry();
    registry.load({ "probe.ts": { Probe } });
    const app = new App().addPlugin(GamePlugins()).addPlugin(ScriptsPlugin(registry));
    const w = app.world;
    const ground = w.spawn([Transform2D], [Collider2D, { size: { x: 200, y: 10 } }]);
    w.spawn(
      [Transform2D, { position: { x: 0, y: 30 } }],
      [RigidBody2D],
      [Collider2D, { size: { x: 10, y: 10 } }],
      [Scripts, { list: [{ script: "probe.ts#Probe", props: {} }] }],
    );
    run(app, 60);
    expect(log).toContain(`hit:${ground}`);
    expect(log).toContain("after");
  });
});

describe("inactive entities", () => {
  it("scripts, timers and physics sleep while an entity or its parent is off", () => {
    const log: string[] = [];
    class Ticker extends Behaviour {
      override onStart() {
        log.push("start");
        this.every(0.1, () => log.push("tick"));
      }
      override onUpdate() {
        log.push("update");
      }
    }
    const registry = new ScriptRegistry();
    registry.load({ "ticker.ts": { Ticker } });
    const app = new App().addPlugin(GamePlugins()).addPlugin(ScriptsPlugin(registry));
    const w = app.world;
    const parent = w.spawn([Transform2D]);
    const e = w.spawn([Transform2D], [Scripts, { list: [{ script: "ticker.ts#Ticker", props: {} }] }]);
    setParent(w, e, parent);
    setActive(w, e, false);
    run(app, 30);
    // onStart waits until the entity is first switched on
    expect(log).toEqual([]);

    setActive(w, e, true);
    run(app, 30);
    expect(log[0]).toBe("start");
    const ticks = log.filter((l) => l === "tick").length;
    expect(ticks).toBeGreaterThan(2);

    // switching off the parent also stops the child's script and its timers
    setActive(w, parent, false);
    run(app, 2);
    log.length = 0;
    run(app, 30);
    expect(log).toEqual([]);
  });

  it("calls onEnable and onDisable when an entity is switched on and off", () => {
    const log: string[] = [];
    class Lamp extends Behaviour {
      override onEnable() {
        log.push("enable");
      }
      override onStart() {
        log.push("start");
      }
      override onDisable() {
        log.push("disable");
      }
      override onDestroy() {
        log.push("destroy");
      }
    }
    const registry = new ScriptRegistry();
    registry.load({ "lamp.ts": { Lamp } });
    const app = new App().addPlugin(GamePlugins()).addPlugin(ScriptsPlugin(registry));
    const w = app.world;
    const parent = w.spawn([Transform2D]);
    const e = w.spawn([Transform2D], [Scripts, { list: [{ script: "lamp.ts#Lamp", props: {} }] }]);
    setParent(w, e, parent);
    run(app, 2);
    expect(log).toEqual(["enable", "start"]);
    setActive(w, e, false);
    run(app, 2);
    setActive(w, e, true);
    run(app, 2);
    // switching the parent off counts too (it takes effect after the transform pass)
    setActive(w, parent, false);
    run(app, 3);
    setActive(w, parent, true);
    run(app, 3);
    w.destroy(e);
    run(app, 1);
    expect(log).toEqual(["enable", "start", "disable", "enable", "disable", "enable", "disable", "destroy"]);
  });

  it("an inactive body stops falling and its collider is not hit", () => {
    const app = game();
    const w = app.world;
    const box = w.spawn([Transform2D, { position: { x: 0, y: 100 } }], [RigidBody2D], [Collider2D, { size: { x: 20, y: 20 } }]);
    run(app, 2);
    setActive(w, box, false);
    const y = w.store(Transform2D).position.y[box];
    run(app, 30);
    expect(w.store(Transform2D).position.y[box]).toBe(y);
    const physics = w.resource(Physics);
    expect(physics.overlapPoint({ x: 0, y })).toEqual([]);
    expect(physics.raycast({ x: -100, y }, { x: 1, y: 0 }, 500)).toBeNull();

    setActive(w, box, true);
    run(app, 30);
    expect(w.store(Transform2D).position.y[box]).toBeLessThan(y);
  });

  it("a character walks through an inactive wall", () => {
    const app = game();
    const w = app.world;
    w.spawn([Transform2D, { position: { x: 0, y: -20 } }], [Collider2D, { size: { x: 1000, y: 20 } }]);
    const wall = w.spawn([Transform2D, { position: { x: 60, y: 30 } }], [Collider2D, { size: { x: 20, y: 100 } }]);
    const hero = w.spawn(
      [Transform2D, { position: { x: 0, y: 10 } }],
      [RigidBody2D, { type: "kinematic" }],
      [CharacterController2D],
      [Collider2D, { size: { x: 16, y: 16 } }],
    );
    setActive(w, wall, false);
    const physics = w.resource(Physics);
    for (let i = 0; i < 60; i++) {
      physics.moveCharacter(hero, 3, 0);
      app.update(1 / 60);
    }
    expect(w.store(Transform2D).position.x[hero]).toBeGreaterThan(150);
  });
});
