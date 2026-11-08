import { beforeAll, describe, expect, it } from "vitest";
import {
  App,
  Assets,
  CharacterController2D,
  Collider2D,
  GamePlugins,
  Physics,
  RigidBody2D,
  TileMap,
  TileMapCollider,
  Transform2D,
  initPhysics,
  parseTextureMeta,
  setTile,
  textureMetaToJson,
} from "../src/index";

beforeAll(async () => {
  await initPhysics();
});

// a 32x32 tileset with one sprite per collision shape; tiles are 16x16, the map at the origin
function setup() {
  const app = new App().addPlugin(GamePlugins());
  const w = app.world;
  const assets = w.resource(Assets);
  const tex = assets.addTexture({ width: 32, height: 32 } as never, { guid: "tiles", name: "tiles" });
  const rect = { x: 0, y: 0, w: 16, h: 16 };
  for (const collision of ["full", "none", "one-way", "half-bottom", "slope-up", "slope-down"] as const) {
    assets.defineSprite(tex, { id: collision, name: collision, rect, collision });
  }
  const map = w.spawn([Transform2D, { position: { x: 0, y: 0 } }], [TileMap, { tileset: "tiles", tileSize: { x: 16, y: 16 } }], [TileMapCollider]);
  // a floor of full tiles at y -16..0
  for (let x = -10; x < 30; x++) setTile(w, map, x, -1, "full");
  const physics = w.resource(Physics);
  const T = w.store(Transform2D);
  return { app, w, map, physics, T, tex };
}

const hero = (w: App["world"], x: number, y: number) =>
  w.spawn([Transform2D, { position: { x, y } }], [RigidBody2D, { type: "kinematic" }], [CharacterController2D], [Collider2D, { size: { x: 8, y: 16 } }]);

/** Gravity and an optional jump, like a platformer script; returns the hero's y each frame. */
function run(app: App, physics: Physics, e: number, frames: number, opts: { dx?: number; jumpAt?: number; jump?: number } = {}) {
  let vy = 0;
  const ys: number[] = [];
  for (let f = 0; f < frames; f++) {
    const grounded = app.world.store(CharacterController2D).grounded[e] === 1;
    if (grounded) vy = Math.max(vy, -30);
    if (grounded && f === opts.jumpAt) vy = opts.jump ?? 300;
    vy -= 760 / 60;
    physics.moveCharacter(e, opts.dx ?? 0, vy / 60);
    app.update(1 / 60);
    ys.push(app.world.store(Transform2D).position.y[e]);
  }
  return ys;
}

describe("collision shape per tile", () => {
  it("'none' tiles let things through, 'full' ones don't", () => {
    const { app, w, map, physics, T } = setup();
    setTile(w, map, 2, 1, "none"); // a decoration tile standing on the floor at y 16..32
    setTile(w, map, 6, 1, "full");
    const a = hero(w, 2 * 16 + 8, 60);
    const b = hero(w, 6 * 16 + 8, 60);
    run(app, physics, a, 90);
    run(app, physics, b, 90);
    expect(T.position.y[a]).toBeCloseTo(8.5, 1); // on the floor, through the decoration
    expect(T.position.y[b]).toBeCloseTo(40.5, 1); // on top of the full tile (32 + 8 + skin)
  });

  it("half tiles are half as high", () => {
    const { app, w, map, physics, T } = setup();
    setTile(w, map, 2, 0, "half-bottom");
    const a = hero(w, 2 * 16 + 8, 60);
    run(app, physics, a, 90);
    expect(T.position.y[a]).toBeCloseTo(16.5, 1); // 8 (half of 16) + 8 + skin
  });

  it("a character walks up a slope", () => {
    const { app, w, map, physics, T } = setup();
    setTile(w, map, 4, 0, "slope-up"); // rises from y 0 at x 64 to y 16 at x 80
    for (let x = 5; x < 20; x++) setTile(w, map, x, 0, "full");
    const a = hero(w, 30, 8.5);
    run(app, physics, a, 120, { dx: 1.5 });
    // walked up the ramp and onto the block behind it (top 16)
    expect(T.position.x[a]).toBeGreaterThan(84);
    expect(T.position.y[a]).toBeCloseTo(24.5, 0);
  });

  it("changing a sprite's collision rebuilds the colliders", () => {
    const { app, w, map, physics, T, tex } = setup();
    setTile(w, map, 2, 0, "none");
    app.update(1 / 60);
    const assets = w.resource(Assets);
    // the sprite becomes solid, as when the editor saves the meta file
    assets.applyMeta(tex, { guid: "tiles", importer: "texture", settings: tex.settings, slicing: { mode: "manual" }, sprites: [...tex.sprites.values()].map((s) => (s.id === "none" ? { ...s, collision: "full" as const } : s)) });
    const a = hero(w, 2 * 16 + 8, 60);
    run(app, physics, a, 90);
    expect(T.position.y[a]).toBeCloseTo(24.5, 1);
  });

  it("the shape is kept in the meta file, and 'full' is left out", () => {
    const json = textureMetaToJson({
      guid: "g",
      importer: "texture",
      settings: { filter: "nearest", wrap: "clamp", pixelsPerUnit: 1 },
      slicing: { mode: "manual" },
      sprites: [
        { id: "a", name: "a", rect: { x: 0, y: 0, w: 1, h: 1 }, pivot: { x: 0.5, y: 0.5 }, collision: "one-way" },
        { id: "b", name: "b", rect: { x: 0, y: 0, w: 1, h: 1 }, pivot: { x: 0.5, y: 0.5 }, collision: "full" },
      ],
    });
    expect(json).toContain('"collision": "one-way"');
    expect(json.match(/collision/g)).toHaveLength(1);
    expect(parseTextureMeta(json).sprites.map((s) => s.collision)).toEqual(["one-way", undefined]);
  });
});

describe("one-way platforms", () => {
  // a platform of one-way tiles at y 48..64, over the floor
  const withPlatform = () => {
    const s = setup();
    for (let x = 0; x < 6; x++) setTile(s.w, s.map, x, 3, "one-way");
    return s;
  };

  it("a character jumps up through it and lands on top", () => {
    const { app, w, physics, T } = withPlatform();
    const a = hero(w, 40, 8.5);
    const ys = run(app, physics, a, 120, { jumpAt: 5, jump: 360 });
    expect(Math.max(...ys)).toBeGreaterThan(64 + 8); // went above the platform
    expect(T.position.y[a]).toBeCloseTo(72.5, 1); // and stands on it: 64 + 8 + skin
    expect(w.store(CharacterController2D).grounded[a]).toBe(1);
  });

  it("a character falling onto it lands, and walks off its edge", () => {
    const { app, w, physics, T } = withPlatform();
    const a = hero(w, 40, 120);
    run(app, physics, a, 60);
    expect(T.position.y[a]).toBeCloseTo(72.5, 1);
    run(app, physics, a, 120, { dx: 1.5 });
    expect(T.position.x[a]).toBeGreaterThan(100);
    expect(T.position.y[a]).toBeCloseTo(8.5, 1); // back on the floor
  });

  it("a character walking under it is not stopped", () => {
    const { app, w, map, physics, T } = withPlatform();
    setTile(w, map, 3, 1, "one-way"); // low, at the hero's head height
    const a = hero(w, -40, 8.5);
    run(app, physics, a, 120, { dx: 1.5 });
    expect(T.position.x[a]).toBeGreaterThan(100);
    expect(T.position.y[a]).toBeCloseTo(8.5, 1);
  });

  it("loose bodies treat it as solid", () => {
    const { app, w } = withPlatform();
    const crate = w.spawn([Transform2D, { position: { x: 40, y: 120 } }], [RigidBody2D], [Collider2D, { size: { x: 10, y: 10 } }]);
    for (let i = 0; i < 120; i++) app.update(1 / 60);
    expect(w.store(Transform2D).position.y[crate]).toBeCloseTo(69, 0);
  });

  it("dropThrough lets a character fall through the platform it stands on, but not through the floor", () => {
    const { app, w, physics, T } = withPlatform();
    const a = hero(w, 40, 120);
    run(app, physics, a, 60);
    expect(T.position.y[a]).toBeCloseTo(72.5, 1);
    physics.dropThrough(a);
    run(app, physics, a, 90);
    expect(T.position.y[a]).toBeCloseTo(8.5, 1); // on the floor below
    // and it lands on the platform again later
    run(app, physics, a, 120, { jumpAt: 5, jump: 360 });
    expect(T.position.y[a]).toBeCloseTo(72.5, 1);
  });
});
