import { beforeAll, describe, expect, it } from "vitest";
import {
  App,
  Assets,
  Collider2D,
  GamePlugins,
  NavAgent2D,
  NavigationFinished,
  RigidBody2D,
  TileMap,
  TileMapCollider,
  Transform2D,
  findPath,
  gridPath,
  initPhysics,
  lineOpen,
  navigateTo,
  smoothPath,
  stopNavigation,
} from "../src/index";

beforeAll(async () => {
  await initPhysics();
});
const game = () => new App().addPlugin(GamePlugins());

/** Blocked cells from rows of text, top row first: "#" is a wall. Row 0 (the last string) is y = 0. */
function walls(rows: string[]) {
  const set = new Set<string>();
  rows.forEach((row, i) => [...row].forEach((c, x) => c === "#" && set.add(`${x},${rows.length - 1 - i}`)));
  return (x: number, y: number) => set.has(`${x},${y}`) || x < 0 || y < 0 || y >= rows.length || x >= rows[0].length;
}

describe("grid search", () => {
  it("finds the shortest way around a wall, without cutting corners", () => {
    const blocked = walls([
      ".....", //
      ".###.",
      "..#..",
    ]);
    const path = gridPath(blocked, { x: 0, y: 0 }, { x: 4, y: 0 })!;
    expect(path[0]).toEqual({ x: 0, y: 0 });
    expect(path.at(-1)).toEqual({ x: 4, y: 0 });
    for (const c of path) expect(blocked(c.x, c.y)).toBe(false);
    // up the left side, over the top, down the right: never diagonally past a wall corner
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1];
      const b = path[i];
      if (a.x !== b.x && a.y !== b.y) expect(blocked(b.x, a.y) || blocked(a.x, b.y)).toBe(false);
    }
  });

  it("only goes straight when diagonals are off", () => {
    const path = gridPath(() => false, { x: 0, y: 0 }, { x: 3, y: 3 }, { diagonal: false })!;
    expect(path).toHaveLength(7);
    expect(gridPath(() => false, { x: 0, y: 0 }, { x: 3, y: 3 })!).toHaveLength(4);
  });

  it("returns null when the goal is shut in, and gives up after maxNodes", () => {
    const shut = walls([
      "...###",
      "...#.#",
      "...###",
    ]);
    expect(gridPath(shut, { x: 0, y: 0 }, { x: 4, y: 1 })).toBeNull();
    // an open, endless plane: the limit stops the search
    expect(gridPath((x, y) => x === 50 && y > -1000, { x: 0, y: 0 }, { x: 100, y: 0 }, { maxNodes: 200 })).toBeNull();
  });

  it("straightens a path where nothing is in the way", () => {
    const open = () => false;
    const cells = gridPath(open, { x: 0, y: 0 }, { x: 6, y: 2 }, { diagonal: false })!;
    expect(smoothPath(open, cells)).toEqual([{ x: 0, y: 0 }, { x: 6, y: 2 }]);
    const blocked = walls(["..#..", "....."]);
    expect(lineOpen(blocked, { x: 0, y: 1 }, { x: 4, y: 1 })).toBe(false);
    expect(lineOpen(blocked, { x: 0, y: 0 }, { x: 4, y: 0 })).toBe(true);
  });
});

/** A 16-unit tile map from text rows (top first, y = 0 is the last row), with a TileMapCollider. */
function level(app: App, rows: string[], tileset?: string) {
  const tiles: Record<string, string> = {};
  rows.forEach((row, i) => [...row].forEach((c, x) => c !== "." && (tiles[`${x},${rows.length - 1 - i}`] = c === "#" ? "wall" : "plank")));
  return app.world.spawn([Transform2D], [TileMap, { tileSize: { x: 16, y: 16 }, tiles, tileset: tileset ?? null }], [TileMapCollider]);
}

describe("findPath in the world", () => {
  it("walks around solid tiles, ending at the exact spot", () => {
    const app = game();
    level(app, [
      ".......",
      "...#...",
      "...#...",
      ".......",
    ]);
    app.update(1 / 60);
    const to = { x: 6 * 16 + 4, y: 2 * 16 + 8 };
    const path = findPath(app.world, { x: 8, y: 40 }, to)!;
    expect(path.at(-1)).toEqual(to);
    // no point lies inside the wall column (x 48..64, y 16..48)
    for (const p of path) expect(p.x > 48 && p.x < 64 && p.y > 16 && p.y < 48).toBe(false);
  });

  it("tiles with collision none or one-way are open", () => {
    const app = game();
    const assets = app.world.resource(Assets);
    const tex = assets.addTexture({ width: 32, height: 16 } as unknown as HTMLCanvasElement, { name: "tiles" });
    assets.defineSprite(tex, { id: "wall", name: "wall", rect: { x: 0, y: 0, w: 16, h: 16 }, pivot: { x: 0.5, y: 0.5 } });
    assets.defineSprite(tex, { id: "plank", name: "plank", rect: { x: 16, y: 0, w: 16, h: 16 }, pivot: { x: 0.5, y: 0.5 }, collision: "none" });
    // a full column of planks: open; the same of walls: shut
    level(app, ["..=..", "..=..", "..=.."], tex.guid);
    app.update(1 / 60);
    expect(findPath(app.world, { x: 8, y: 24 }, { x: 72, y: 24 })).not.toBeNull();
    // straight through the planks
    expect(findPath(app.world, { x: 8, y: 24 }, { x: 72, y: 24 })).toEqual([{ x: 72, y: 24 }]);
    // the same column in walls: around an end of it (the grid goes on outside the map)
    const solid = game();
    level(solid, ["..#..", "..#..", "..#.."]);
    solid.update(1 / 60);
    const p = findPath(solid.world, { x: 8, y: 24 }, { x: 72, y: 24 })!;
    expect(p.some((q) => q.y < 0 || q.y > 48)).toBe(true);
  });

  it("static colliders are walls; moving bodies and triggers are not", () => {
    const app = game();
    const w = app.world;
    // a thin wall entity from y -100 to 100 at x = 3 (off the grid), no TileMap: 16-unit cells from the origin
    w.spawn([Transform2D, { position: { x: 3, y: 0 } }], [Collider2D, { size: { x: 4, y: 200 } }]);
    w.spawn([Transform2D, { position: { x: 0, y: 150 } }], [Collider2D, { size: { x: 16, y: 100 }, isTrigger: true }]);
    w.spawn([Transform2D, { position: { x: 0, y: -150 } }], [RigidBody2D, { type: "dynamic" }], [Collider2D, { size: { x: 16, y: 100 } }]);
    app.update(1 / 60);
    const path = findPath(w, { x: -40, y: 0 }, { x: 40, y: 0 })!;
    expect(path).not.toBeNull();
    // around an end of the wall, through the trigger or past the crate
    expect(path.some((p) => Math.abs(p.y) > 100)).toBe(true);
  });

  it("keeps a wide walker clear of walls: a one-tile gap fits a small one, not a big one", () => {
    const app = game();
    level(app, [
      "#####",
      "#...#",
      "##.##", // the gap at x = 2
      "#...#",
      "#####",
    ]);
    app.update(1 / 60);
    const from = { x: 40, y: 56 };
    const to = { x: 40, y: 24 };
    expect(findPath(app.world, from, to, { radius: 7 })).not.toBeNull();
    const big = findPath(app.world, from, to, { radius: 10 });
    expect(big === null || big.every((p) => p.y > 40)).toBe(true);
  });
});

describe("NavAgent2D", () => {
  it("walks around a wall to its destination and says so", () => {
    const app = game();
    const w = app.world;
    level(app, [
      ".......",
      "...#...",
      "...#...",
      ".......",
    ]);
    const agent = w.spawn([Transform2D, { position: { x: 8, y: 40 } }], [NavAgent2D, { speed: 120 }]);
    const done = w.events(NavigationFinished).reader();
    app.update(1 / 60);
    navigateTo(w, agent, { x: 104, y: 40 });
    const T = w.store(Transform2D);
    let minX = Infinity;
    for (let i = 0; i < 240 && w.store(NavAgent2D).status[agent] === "moving"; i++) {
      app.update(1 / 60);
      // never inside the wall, and never closer to it than its clearance (0.45 cell without a collider)
      const x = T.position.x[agent];
      const y = T.position.y[agent];
      const c = 7;
      expect(x > 48 - c && x < 64 + c && y > 16 - c && y < 48 + c).toBe(false);
      minX = Math.min(minX, x);
    }
    expect(w.store(NavAgent2D).status[agent]).toBe("arrived");
    expect(Math.hypot(T.position.x[agent] - 104, T.position.y[agent] - 40)).toBeLessThan(5);
    expect(done.read()).toEqual([{ entity: agent, reached: true }]);
  });

  it("chases a target and stops when it is gone", () => {
    const app = game();
    const w = app.world;
    const target = w.spawn([Transform2D, { position: { x: 100, y: 0 } }]);
    const agent = w.spawn([Transform2D], [NavAgent2D, { speed: 60, stopDistance: 10 }]);
    app.update(1 / 60);
    navigateTo(w, agent, target);
    for (let i = 0; i < 30; i++) app.update(1 / 60);
    const T = w.store(Transform2D);
    expect(T.position.x[agent]).toBeGreaterThan(20);
    expect(w.store(NavAgent2D).velocity.x[agent]).toBeCloseTo(60, 0);
    w.destroy(target);
    app.update(1 / 60);
    expect(w.store(NavAgent2D).status[agent]).toBe("idle");
    const x = T.position.x[agent];
    app.update(1 / 60);
    expect(T.position.x[agent]).toBe(x);
  });

  it("can be stopped, and does nothing until told where to go", () => {
    const app = game();
    const w = app.world;
    const agent = w.spawn([Transform2D, { position: { x: 5, y: 5 } }], [NavAgent2D]);
    for (let i = 0; i < 10; i++) app.update(1 / 60);
    expect(w.store(Transform2D).position.x[agent]).toBe(5);
    navigateTo(w, agent, { x: 200, y: 5 });
    app.update(1 / 60);
    app.update(1 / 60);
    stopNavigation(w, agent);
    const x = w.store(Transform2D).position.x[agent];
    app.update(1 / 60);
    expect(w.store(Transform2D).position.x[agent]).toBe(x);
    expect(w.store(NavAgent2D).status[agent]).toBe("idle");
  });
});
