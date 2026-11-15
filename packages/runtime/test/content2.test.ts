import { beforeAll, describe, expect, it } from "vitest";
import {
  App,
  Assets,
  Behaviour,
  BehaviourRuntime,
  type Entity,
  type SceneEntityData,
  expose,
  instantiate,
  spawnPrefab,
  CharacterController2D,
  Collider2D,
  GamePlugins,
  Input,
  ParticleEmitter2D,
  Particles,
  Physics,
  RigidBody2D,
  ScriptRegistry,
  Scripts,
  ScriptsPlugin,
  TileMap,
  TileMapCollider,
  Transform2D,
  UIButton,
  UICanvas,
  UIImage,
  UILayout,
  UIRect,
  cellAt,
  getTile,
  initPhysics,
  layoutRect,
  mergeTileRects,
  parseTextureMeta,
  propagateTransforms,
  setParent,
  setTile,
  textureMetaToJson,
} from "../src";

beforeAll(async () => {
  await initPhysics();
});

const game = () => new App().addPlugin(GamePlugins());

describe("tilemaps", () => {
  it("merges filled cells into few rectangles", () => {
    const tiles: Record<string, string> = {};
    for (let x = 0; x < 10; x++) for (let y = 0; y < 2; y++) tiles[`${x},${y}`] = "t"; // 10x2 floor
    tiles["5,5"] = "t";
    tiles["6,5"] = "t";
    const rects = mergeTileRects(tiles);
    expect(rects).toHaveLength(2);
    expect(rects).toContainEqual({ x: 0, y: 0, w: 10, h: 2 });
    expect(rects).toContainEqual({ x: 5, y: 5, w: 2, h: 1 });
    // gaps split rows
    expect(mergeTileRects({ "0,0": "a", "2,0": "a" })).toHaveLength(2);
  });

  it("set/get tiles, cells from world positions, and colliders that rebuild on change", () => {
    const app = game();
    const w = app.world;
    const map = w.spawn([Transform2D, { position: { x: -80, y: -80 } }], [TileMap, { tileSize: { x: 16, y: 16 } }], [TileMapCollider]);
    for (let x = 0; x < 10; x++) setTile(w, map, x, 0, "cell_0");
    expect(getTile(w, map, 3, 0)).toBe("cell_0");
    propagateTransforms.run(w);
    expect(cellAt(w, map, { x: -80 + 16 * 2.5, y: -79 })).toEqual({ x: 2, y: 0 });
    const box = w.spawn([Transform2D, { position: { x: 0, y: 0 } }], [RigidBody2D], [Collider2D, { size: { x: 10, y: 10 } }]);
    for (let i = 0; i < 120; i++) app.update(1 / 60);
    // floor top is at -80 + 16 = -64; box half height 5
    expect(w.store(Transform2D).position.y[box]).toBeCloseTo(-59, 0);
    const physics = w.resource(Physics);
    expect(physics.tileColliderCount(map)).toBe(1);
    setTile(w, map, 20, 0, "cell_0");
    app.update(1 / 60);
    expect(physics.tileColliderCount(map)).toBe(2);
    // a character can walk on tiles
    const hero = w.spawn([Transform2D, { position: { x: -60, y: -40 } }], [RigidBody2D], [CharacterController2D], [Collider2D, { size: { x: 8, y: 16 } }]);
    for (let i = 0; i < 60; i++) {
      physics.moveCharacter(hero, 0, -3);
      app.update(1 / 60);
    }
    expect(w.store(CharacterController2D).grounded[hero]).toBe(1);
    expect(w.store(Transform2D).position.y[hero]).toBeCloseTo(-55.5, 1); // -56 plus the 0.5 skin
  });
});

describe("contacts", () => {
  it("tells which side a trigger was entered from, even though they already overlap (stomp checks)", () => {
    const seen: { who: string; other: Entity; normal: { x: number; y: number } }[] = [];
    class Probe extends Behaviour {
      @expose label = "";
      override onTriggerEnter(other: Entity, contact: { normal: { x: number; y: number } }) {
        seen.push({ who: this.label, other, normal: contact.normal });
      }
    }
    const registry = new ScriptRegistry();
    registry.load({ "probe.ts": { Probe } });
    const app = new App({ fixedHz: 60 }).addPlugin(GamePlugins()).addPlugin(ScriptsPlugin(registry));
    const w = app.world;
    const probe = (label: string) => [Scripts, { list: [{ script: "probe.ts#Probe", props: { label } }] }] as const;
    // an enemy without a body (a trigger), and a hero falling fast onto it: in one step it sinks deep into it
    const enemy = w.spawn([Transform2D, { position: { x: 0, y: 0 } }], [Collider2D, { size: { x: 20, y: 20 }, isTrigger: true }], probe("enemy"));
    const hero = w.spawn(
      [Transform2D, { position: { x: 4, y: 40 } }],
      [RigidBody2D, { type: "kinematic" }],
      [Collider2D, { size: { x: 12, y: 12 } }],
      probe("hero"),
    );
    // a second hero walks into it from the right
    const walker = w.spawn(
      [Transform2D, { position: { x: 40, y: 2 } }],
      [RigidBody2D, { type: "kinematic" }],
      [Collider2D, { size: { x: 12, y: 12 } }],
      probe("walker"),
    );
    const T = w.store(Transform2D);
    for (let i = 0; i < 3; i++) app.update(1 / 60);
    expect(seen).toEqual([]);
    T.position.y[hero] = 6; // 34 units down in one step: deep inside the enemy
    T.position.x[walker] = 13;
    for (let i = 0; i < 3; i++) app.update(1 / 60);
    const of = (who: string, other: Entity) => seen.find((s) => s.who === who && s.other === other)?.normal;
    expect(of("hero", enemy)).toEqual({ x: 0, y: 1 }); // the hero came from above: a stomp
    expect(of("enemy", hero)).toEqual({ x: 0, y: -1 });
    expect(of("walker", enemy)).toEqual({ x: 1, y: 0 }); // from the side: hurt the player
  });
});

describe("world-space UI", () => {
  it("lays out world canvases in their own units, apart from screen UI", () => {
    const app = game();
    const w = app.world;
    const screen = w.spawn([Transform2D], [UICanvas]);
    const hud = w.spawn([Transform2D], [UIRect, { size: { x: 100, y: 20 } }], [UIImage]);
    setParent(w, hud, screen);
    const enemy = w.spawn([Transform2D, { position: { x: 300, y: 50 } }]);
    const bar = w.spawn([Transform2D, { position: { x: 0, y: 24 } }], [UICanvas, { space: "world", referenceSize: { x: 32, y: 5 } }]);
    setParent(w, bar, enemy);
    const fill = w.spawn([Transform2D], [UIRect, { anchorMin: { x: 0, y: 0 }, anchorMax: { x: 0.5, y: 1 }, pivot: { x: 0, y: 0.5 }, size: { x: 0, y: 0 } }], [UIImage]);
    setParent(w, fill, bar);
    const layout = new UILayout();
    layout.update(w, 960, 540);
    expect(layout.elements.map((el) => el.e)).toEqual([hud]);
    expect(layout.byEntity.has(fill)).toBe(false);
    expect(layout.worldCanvases).toHaveLength(1);
    const wc = layout.worldCanvases[0];
    expect(wc.canvas).toBe(bar);
    expect(wc.size).toEqual({ x: 32, y: 5 });
    // half full: 16 of 32 units, from the left edge
    expect(wc.elements[0].rect).toEqual({ x: 0, y: 0, w: 16, h: 5 });
  });
});

describe("particles", () => {
  it("emits at a rate, ages and dies, and bursts", () => {
    const app = game();
    const w = app.world;
    const e = w.spawn([Transform2D], [ParticleEmitter2D, { rate: 60, lifetime: { x: 0.5, y: 0.5 }, burst: 10 }]);
    const particles = w.resource(Particles);
    app.update(1 / 60);
    expect(particles.alive(e)).toBe(11); // burst + 1 from the rate
    for (let i = 0; i < 60; i++) app.update(1 / 60);
    // steady state: rate * lifetime
    expect(particles.alive(e)).toBeGreaterThanOrEqual(29);
    expect(particles.alive(e)).toBeLessThanOrEqual(31);
    const pool = particles.pools.get(e)!;
    expect(Math.max(...pool.vy.slice(0, pool.count))).toBeGreaterThan(0); // shooting up
    w.store(ParticleEmitter2D).emitting[e] = 0;
    for (let i = 0; i < 40; i++) app.update(1 / 60);
    expect(particles.alive(e)).toBe(0);
  });

  it("particles with collide land on solid colliders, bounce, and can die on hit; triggers don't count", () => {
    const app = game();
    const w = app.world;
    // a floor at y = 0 (top edge), and a trigger above it that particles fly through
    w.spawn([Transform2D, { position: { x: 0, y: -10 } }], [Collider2D, { size: { x: 400, y: 20 } }]);
    w.spawn([Transform2D, { position: { x: 0, y: 40 } }], [Collider2D, { size: { x: 400, y: 10 }, isTrigger: true }]);
    const drop = { rate: 0, burst: 20, speed: { x: 0, y: 30 }, spread: 1, gravity: { x: 0, y: -400 }, lifetime: { x: 3, y: 3 } };
    const lands = w.spawn([Transform2D, { position: { x: 0, y: 80 } }], [ParticleEmitter2D, { ...drop, collide: true, bounce: 0 }]);
    const falls = w.spawn([Transform2D, { position: { x: 50, y: 80 } }], [ParticleEmitter2D, { ...drop }]);
    const dies = w.spawn([Transform2D, { position: { x: -50, y: 80 } }], [ParticleEmitter2D, { ...drop, collide: true, dieOnHit: true }]);
    const particles = w.resource(Particles);
    for (let i = 0; i < 90; i++) app.update(1 / 60);
    const ys = (e: Entity) => [...particles.pools.get(e)!.y.slice(0, particles.alive(e))];
    expect(particles.alive(lands)).toBe(20);
    expect(Math.min(...ys(lands))).toBeGreaterThan(-0.01); // resting on the floor, not inside it
    expect(Math.max(...ys(lands))).toBeLessThan(2); // and not stuck on the trigger
    expect(Math.min(...ys(falls))).toBeLessThan(-100); // without collide they fall through
    expect(particles.alive(dies)).toBe(0);
  });

  it("local-space particles are kept in the emitter's own space, world-space ones where they were emitted", () => {
    const app = game();
    const w = app.world;
    const still = { rate: 0, burst: 4, speed: { x: 0, y: 0 }, gravity: { x: 0, y: 0 }, spread: 0, lifetime: { x: 5, y: 5 } };
    const world = w.spawn([Transform2D, { position: { x: 100, y: 50 } }], [ParticleEmitter2D, { ...still, space: "world" }]);
    const local = w.spawn([Transform2D, { position: { x: 100, y: 50 } }], [ParticleEmitter2D, { ...still, space: "local" }]);
    app.update(1 / 60);
    const particles = w.resource(Particles);
    expect(particles.pools.get(world)!.x[0]).toBeCloseTo(100);
    expect(particles.pools.get(local)!.x[0]).toBeCloseTo(0);
    expect(particles.pools.get(local)!.y[0]).toBeCloseTo(0);
    // moving the emitter doesn't touch what a local emitter's particles store: the draw step follows it
    w.store(Transform2D).position.x[local] = 400;
    app.update(1 / 60);
    expect(particles.pools.get(local)!.x[0]).toBeCloseTo(0);
  });

  it("a burst in the very first frame starts at the emitter's world position, also under a moved parent", () => {
    const app = game();
    const w = app.world;
    const parent = w.spawn([Transform2D, { position: { x: 200, y: 0 }, scale: { x: 2, y: 2 } }]);
    const e = w.spawn([Transform2D, { position: { x: 10, y: 5 } }], [ParticleEmitter2D, { rate: 0, burst: 3, speed: { x: 0, y: 0 }, gravity: { x: 0, y: 0 }, spread: 0 }]);
    setParent(w, e, parent);
    // no update has run: there is no GlobalTransform2D result yet
    app.update(1 / 60);
    const pool = w.resource(Particles).pools.get(e)!;
    expect(pool.count).toBe(3);
    // 200 + 10 * 2 and 0 + 5 * 2
    expect(pool.x[0]).toBeCloseTo(220);
    expect(pool.y[0]).toBeCloseTo(10);
  });

  it("one-shot emitters destroy themselves", () => {
    const app = game();
    const w = app.world;
    const e = w.spawn([Transform2D], [ParticleEmitter2D, { rate: 0, burst: 5, lifetime: { x: 0.2, y: 0.2 }, autoDestroy: true }]);
    app.update(1 / 60);
    expect(w.resource(Particles).alive(e)).toBe(5);
    for (let i = 0; i < 30; i++) app.update(1 / 60);
    expect(w.isAlive(e)).toBe(false);
  });
});

describe("UI", () => {
  it("lays out anchored and stretched rects", () => {
    const app = game();
    const w = app.world;
    const canvas = w.spawn([Transform2D], [UICanvas, { referenceSize: { x: 800, y: 600 } }]);
    // top-right corner, 100x40, 10 units in from the corner
    const corner = w.spawn([Transform2D], [UIRect, { anchorMin: { x: 1, y: 1 }, anchorMax: { x: 1, y: 1 }, pivot: { x: 1, y: 1 }, position: { x: -10, y: -10 }, size: { x: 100, y: 40 } }]);
    // full-width bar at the bottom, 50 high
    const bar = w.spawn([Transform2D], [UIRect, { anchorMin: { x: 0, y: 0 }, anchorMax: { x: 1, y: 0 }, pivot: { x: 0.5, y: 0 }, size: { x: 0, y: 50 } }]);
    setParent(w, corner, canvas);
    setParent(w, bar, canvas);
    expect(layoutRect(w, corner, { x: 0, y: 0, w: 800, h: 600 })).toEqual({ x: 690, y: 550, w: 100, h: 40 });
    const layout = w.resource(UILayout);
    propagateTransforms.run(w);
    // a 1600x1200 screen scales the 800x600 reference by 2
    layout.update(w, 1600, 1200);
    expect(layout.byEntity.get(corner)!.rect).toEqual({ x: 1380, y: 1100, w: 200, h: 80 });
    expect(layout.byEntity.get(bar)!.rect).toEqual({ x: 0, y: 0, w: 1600, h: 100 });
  });

  it("buttons hover, tint and click; scripts get onClick", () => {
    let clicks = 0;
    class ClickMe extends Behaviour {
      override onClick() {
        clicks++;
      }
    }
    const registry = new ScriptRegistry();
    registry.load({ "c.ts": { ClickMe } });
    const app = new App().addPlugin(GamePlugins()).addPlugin(ScriptsPlugin(registry));
    const w = app.world;
    const canvas = w.spawn([Transform2D], [UICanvas, { scaleMode: "constant" }]);
    const btn = w.spawn(
      [Transform2D],
      [UIRect, { size: { x: 100, y: 40 } }],
      [UIImage],
      [UIButton, { hover: { r: 0, g: 1, b: 0, a: 1 } }],
      [Scripts, { list: [{ script: "c.ts#ClickMe", props: {} }] }],
    );
    setParent(w, btn, canvas);
    propagateTransforms.run(w);
    w.resource(UILayout).update(w, 400, 300); // button covers x 150..250, y 130..170
    const input = w.resource(Input);
    input.injectPointer(200, 150);
    app.update(1 / 60);
    expect(w.store(UIButton).hovered[btn]).toBe(1);
    expect(w.store(UIImage).color.g[btn]).toBe(1);
    expect(w.store(UIImage).color.r[btn]).toBe(0);
    input.inject("down", "Mouse0");
    app.update(1 / 60);
    input.inject("up", "Mouse0");
    app.update(1 / 60);
    app.update(1 / 60);
    expect(clicks).toBe(1);
    // releasing outside the button is not a click
    input.inject("down", "Mouse0");
    app.update(1 / 60);
    input.injectPointer(10, 10);
    input.inject("up", "Mouse0");
    app.update(1 / 60);
    app.update(1 / 60);
    expect(clicks).toBe(1);
  });
});

describe("sprite meta", () => {
  it("round-trips 9-slice borders and manual slicing", () => {
    const meta = parseTextureMeta(
      textureMetaToJson({
        guid: "g",
        importer: "texture",
        settings: { filter: "nearest", wrap: "clamp", pixelsPerUnit: 1 },
        slicing: { mode: "manual" },
        sprites: [{ id: "a", name: "panel", rect: { x: 0, y: 0, w: 24, h: 24 }, pivot: { x: 0.5, y: 0.5 }, border: { l: 8, b: 6, r: 8, t: 6 } }],
      }),
    );
    expect(meta.slicing.mode).toBe("manual");
    expect(meta.sprites[0].border).toEqual({ l: 8, b: 6, r: 8, t: 6 });
  });
});

describe("exposed entity fields", () => {
  it("resolves scene ids to entities, also in spawned prefab copies", () => {
    class Follower extends Behaviour {
      @expose({ type: "entity" }) target: Entity = -1;
    }
    const registry = new ScriptRegistry();
    registry.load({ "f.ts": { Follower } });
    const app = new App().addPlugin(GamePlugins()).addPlugin(ScriptsPlugin(registry));
    const w = app.world;
    const script = (id: string | null) => ({ list: [{ script: "f.ts#Follower", props: { target: { $entity: id } } }] });
    const data: SceneEntityData[] = [
      { id: "leader", components: { Transform2D: {} } },
      { id: "follower", components: { Transform2D: {}, Scripts: script("leader") } },
      { id: "lost", components: { Transform2D: {}, Scripts: script("nobody") } },
    ];
    const [leader, follower, lost] = instantiate(w, data);
    app.update(1 / 60);
    const rt = w.resource(BehaviourRuntime);
    expect(rt.find(follower, Follower)!.target).toBe(leader);
    expect(rt.find(lost, Follower)!.target).toBe(-1);

    // a prefab copy points at its own copy of the leader
    w.resource(Assets).addPrefab({ guid: "p1", name: "Pair", data: { version: 1, entities: data.slice(0, 2) } });
    const root = spawnPrefab(w, "Pair");
    app.update(1 / 60);
    const copies = w.query([Scripts]).toArray().filter((e) => e !== follower && e !== lost);
    expect(copies).toHaveLength(1);
    const copyTarget = rt.find(copies[0], Follower)!.target;
    expect(copyTarget).toBe(root);
    expect(copyTarget).not.toBe(leader);
  });
});
