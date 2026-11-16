import { Assets } from "@brik/assets";
import {
  type Entity,
  GlobalTransform2D,
  NULL_REF,
  TileMap,
  TileMapCollider,
  Time,
  Transform2D,
  type Vec2,
  type World,
  defineComponent,
  defineEvent,
  isActive,
  parseTileKey,
  t,
  withMeta,
} from "@brik/core";
import { CharacterController2D, Collider2D, RigidBody2D, Velocity2D } from "./components";

/*
 * Pathfinding on a grid (A*), for enemies that walk around walls in top-down games. The grid's cells are the
 * tiles of a TileMap (or 16 x 16 units without one). A cell is blocked when a solid tile is there (a TileMap
 * with a TileMapCollider; tiles with collision "none" or "one-way" are open) or a static collider (Collider2D
 * without a RigidBody2D, or with a static one). Walls are grown by the walker's radius, so a wide enemy keeps
 * clear of corners. Platformers are not covered: there walking needs jumping, which a grid can't plan.
 */

// ------------------------------------------------------------------ the search (pure)

export interface GridSearchOptions {
  /** Move diagonally too (never cutting a blocked corner). Default true. */
  diagonal?: boolean;
  /** Give up after this many cells, so an unreachable goal can't freeze the game. Default 20000. */
  maxNodes?: number;
}

const SQRT2 = Math.SQRT2;
const DIRS4: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
const DIRS8: [number, number][] = [...DIRS4, [1, 1], [1, -1], [-1, 1], [-1, -1]];

/**
 * A* from `start` to `goal` on a grid where `blocked(x, y)` says which cells can't be entered. Returns the cells
 * from start to goal (both included), or null when there is no way. The cells are whole numbers, in any range.
 */
export function gridPath(
  blocked: (x: number, y: number) => boolean,
  start: { x: number; y: number },
  goal: { x: number; y: number },
  opts: GridSearchOptions = {},
): { x: number; y: number }[] | null {
  const diagonal = opts.diagonal ?? true;
  const maxNodes = opts.maxNodes ?? 20000;
  if (blocked(goal.x, goal.y) || blocked(start.x, start.y)) return null;
  const key = (x: number, y: number) => `${x},${y}`;
  const h = (x: number, y: number) => {
    const dx = Math.abs(x - goal.x);
    const dy = Math.abs(y - goal.y);
    return diagonal ? Math.max(dx, dy) + (SQRT2 - 1) * Math.min(dx, dy) : dx + dy;
  };
  const g = new Map<string, number>();
  const from = new Map<string, string>();
  const closed = new Set<string>();
  const heap = new MinHeap<{ x: number; y: number; k: string }>();
  const sk = key(start.x, start.y);
  g.set(sk, 0);
  heap.push({ x: start.x, y: start.y, k: sk }, h(start.x, start.y));
  const goalKey = key(goal.x, goal.y);
  const dirs = diagonal ? DIRS8 : DIRS4;
  while (heap.size > 0) {
    const cur = heap.pop()!;
    if (closed.has(cur.k)) continue;
    if (cur.k === goalKey) {
      const out: { x: number; y: number }[] = [];
      for (let k: string | undefined = goalKey; k !== undefined; k = from.get(k)) {
        const [x, y] = parseTileKey(k);
        out.push({ x, y });
      }
      return out.reverse();
    }
    closed.add(cur.k);
    if (closed.size > maxNodes) return null;
    const base = g.get(cur.k)!;
    for (const [dx, dy] of dirs) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      if (blocked(nx, ny)) continue;
      // a diagonal step needs both sides open, or it would cut a wall's corner
      if (dx !== 0 && dy !== 0 && (blocked(cur.x + dx, cur.y) || blocked(cur.x, cur.y + dy))) continue;
      const nk = key(nx, ny);
      if (closed.has(nk)) continue;
      const cost = base + (dx !== 0 && dy !== 0 ? SQRT2 : 1);
      if (cost < (g.get(nk) ?? Infinity)) {
        g.set(nk, cost);
        from.set(nk, cur.k);
        heap.push({ x: nx, y: ny, k: nk }, cost + h(nx, ny));
      }
    }
  }
  return null;
}

/** The open cell nearest to (x, y) within `range` cells (rings outward), or null. */
export function nearestOpenCell(blocked: (x: number, y: number) => boolean, x: number, y: number, range = 8): { x: number; y: number } | null {
  if (!blocked(x, y)) return { x, y };
  for (let r = 1; r <= range; r++) {
    let best: { x: number; y: number } | null = null;
    let bestD = Infinity;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r || blocked(x + dx, y + dy)) continue;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = { x: x + dx, y: y + dy };
        }
      }
    }
    if (best) return best;
  }
  return null;
}

/** Whether a straight line from cell a to cell b (centers) only crosses open cells. */
export function lineOpen(blocked: (x: number, y: number) => boolean, a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  // every cell the segment touches (a "supercover" line), so it never squeezes between two diagonal walls
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const nx = Math.abs(dx);
  const ny = Math.abs(dy);
  const sx = Math.sign(dx);
  const sy = Math.sign(dy);
  let x = a.x;
  let y = a.y;
  for (let ix = 0, iy = 0; ix < nx || iy < ny; ) {
    const t = (0.5 + ix) * ny - (0.5 + iy) * nx;
    if (t === 0) {
      // through a corner exactly: both neighbours must be open
      if (blocked(x + sx, y) || blocked(x, y + sy)) return false;
      x += sx;
      y += sy;
      ix++;
      iy++;
    } else if (t < 0) {
      x += sx;
      ix++;
    } else {
      y += sy;
      iy++;
    }
    if (blocked(x, y)) return false;
  }
  return true;
}

/** Drops the cells a straight line can skip: from each point, the farthest one still in plain view. */
export function smoothPath(blocked: (x: number, y: number) => boolean, cells: { x: number; y: number }[]): { x: number; y: number }[] {
  if (cells.length <= 2) return cells.slice();
  const out = [cells[0]];
  let i = 0;
  while (i < cells.length - 1) {
    let j = cells.length - 1;
    while (j > i + 1 && !lineOpen(blocked, cells[i], cells[j])) j--;
    out.push(cells[j]);
    i = j;
  }
  return out;
}

class MinHeap<T> {
  private items: T[] = [];
  private keys: number[] = [];
  get size(): number {
    return this.items.length;
  }
  push(item: T, k: number): void {
    const a = this.items;
    const ks = this.keys;
    let i = a.length;
    a.push(item);
    ks.push(k);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (ks[p] <= k) break;
      a[i] = a[p];
      ks[i] = ks[p];
      i = p;
    }
    a[i] = item;
    ks[i] = k;
  }
  pop(): T | undefined {
    const a = this.items;
    const ks = this.keys;
    if (a.length === 0) return undefined;
    const top = a[0];
    const last = a.pop()!;
    const lk = ks.pop()!;
    if (a.length > 0) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= a.length) break;
        const r = l + 1;
        const c = r < a.length && ks[r] < ks[l] ? r : l;
        if (ks[c] >= lk) break;
        a[i] = a[c];
        ks[i] = ks[c];
        i = c;
      }
      a[i] = last;
      ks[i] = lk;
    }
    return top;
  }
}

// ------------------------------------------------------------------ the world's grid

/** A navigation grid: cells of `cellW` x `cellH` world units, cell (0, 0) with its bottom-left corner at `origin`. */
export interface NavGrid {
  originX: number;
  originY: number;
  cellW: number;
  cellH: number;
  /** Blocked cells, `"x,y"`. */
  blocked: Set<string>;
  /** Walls grown by the walker's radius, filed under every cell they touch: for checking straight lines. */
  walls: Map<string, Box[]>;
  isBlocked(x: number, y: number): boolean;
  cellAt(p: Vec2): { x: number; y: number };
  centerOf(x: number, y: number): Vec2;
}

/** Cell size when there is no TileMap to take it from. */
export const DEFAULT_NAV_CELL = 16;

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** The TileMap whose cells the grid uses: `map`, else the first with a solid TileMapCollider, else any. */
function gridMap(world: World, map?: Entity): Entity | null {
  if (map !== undefined && map >= 0 && world.isAlive(map) && world.has(map, TileMap)) return map;
  const TC = world.store(TileMapCollider);
  let any: Entity | null = null;
  for (const e of world.query([TileMap, GlobalTransform2D])) {
    if (!isActive(world, e)) continue;
    if (world.has(e, TileMapCollider) && !TC.isTrigger[e]) return e;
    any ??= e;
  }
  return any;
}

/** World boxes of everything that blocks walking: solid tiles and static colliders. `skip` is left out (the walker itself). */
function obstacles(world: World, skip?: Entity): { boxes: Box[]; stamp: string } {
  const boxes: Box[] = [];
  const parts: string[] = [];
  const G = world.store(GlobalTransform2D).matrix;
  const M = world.store(TileMap);
  const TC = world.store(TileMapCollider);
  const assets = world.tryResource(Assets);
  for (const e of world.query([TileMapCollider, TileMap, GlobalTransform2D])) {
    if (TC.isTrigger[e] || !isActive(world, e)) continue;
    const tw = M.tileSize.x[e];
    const th = M.tileSize.y[e];
    parts.push(`m${e}:${M.revision[e]}:${G.tx[e]}:${G.ty[e]}:${tw}:${th}:${G.a[e]}:${G.d[e]}`);
    const tex = M.tileset[e] ? assets?.textures.get(M.tileset[e] as string) : undefined;
    const tiles = M.tiles[e];
    for (const k in tiles) {
      const collision = tex?.sprites.get(tiles[k])?.collision ?? "full";
      if (collision === "none" || collision === "one-way") continue;
      const [cx, cy] = parseTileKey(k);
      boxes.push(worldBox(G.a[e], G.b[e], G.c[e], G.d[e], G.tx[e], G.ty[e], cx * tw, cy * th, (cx + 1) * tw, (cy + 1) * th));
    }
  }
  const C = world.store(Collider2D);
  const RB = world.store(RigidBody2D);
  for (const e of world.query([Collider2D, GlobalTransform2D])) {
    if (e === skip || C.isTrigger[e] || !isActive(world, e)) continue;
    if (world.has(e, RigidBody2D) && RB.type[e] !== "static") continue;
    if (world.has(e, CharacterController2D)) continue;
    const hw = C.size.x[e] / 2;
    const hh = (C.shape[e] === "circle" ? C.size.x[e] : C.size.y[e]) / 2;
    const ox = C.offset.x[e];
    const oy = C.offset.y[e];
    const b = worldBox(G.a[e], G.b[e], G.c[e], G.d[e], G.tx[e], G.ty[e], ox - hw, oy - hh, ox + hw, oy + hh);
    boxes.push(b);
    parts.push(`c${b.x0.toFixed(1)},${b.y0.toFixed(1)},${b.x1.toFixed(1)},${b.y1.toFixed(1)}`);
  }
  return { boxes, stamp: parts.join("|") };
}

/** The world-space bounding box of a local rectangle under a 2D transform. */
function worldBox(a: number, b: number, c: number, d: number, tx: number, ty: number, x0: number, y0: number, x1: number, y1: number): Box {
  const xs = [a * x0 + c * y0, a * x1 + c * y0, a * x0 + c * y1, a * x1 + c * y1];
  const ys = [b * x0 + d * y0, b * x1 + d * y0, b * x0 + d * y1, b * x1 + d * y1];
  return { x0: Math.min(...xs) + tx, y0: Math.min(...ys) + ty, x1: Math.max(...xs) + tx, y1: Math.max(...ys) + ty };
}

/**
 * Builds navigation grids and keeps them until a wall changes (a tile is set, a static collider moves).
 * A resource: `world.resource(Navigation)`.
 */
export class Navigation {
  private cache = new Map<string, NavGrid>();

  /** The grid for walkers of `radius` world units, on `map`'s cells (see NavAgent2D.map). */
  grid(world: World, opts: { radius?: number; map?: Entity; skip?: Entity } = {}): NavGrid {
    const map = gridMap(world, opts.map);
    const G = world.store(GlobalTransform2D).matrix;
    const M = world.store(TileMap);
    const cellW = map !== null ? Math.abs(M.tileSize.x[map] * G.a[map]) || DEFAULT_NAV_CELL : DEFAULT_NAV_CELL;
    const cellH = map !== null ? Math.abs(M.tileSize.y[map] * G.d[map]) || DEFAULT_NAV_CELL : DEFAULT_NAV_CELL;
    const originX = map !== null ? G.tx[map] : 0;
    const originY = map !== null ? G.ty[map] : 0;
    // at least a little under half a cell: a wall thinner than a cell, off the grid, would otherwise fall between
    // two cell centers and be walked through; a one-tile corridor still fits
    const radius = Math.max(0, opts.radius ?? 0, 0.45 * Math.min(cellW, cellH));
    const { boxes, stamp } = obstacles(world, opts.skip);
    const key = `${originX},${originY},${cellW},${cellH},${radius}|${stamp}`;
    let grid = this.cache.get(key);
    if (grid) return grid;
    if (this.cache.size > 32) this.cache.clear();

    // a cell is blocked when its center is inside a wall grown by the walker's radius
    const blocked = new Set<string>();
    const walls = new Map<string, Box[]>();
    const eps = 1e-6;
    for (const bx of boxes) {
      const grown = { x0: bx.x0 - radius, y0: bx.y0 - radius, x1: bx.x1 + radius, y1: bx.y1 + radius };
      const cx0 = Math.floor((grown.x0 - originX) / cellW);
      const cx1 = Math.floor((grown.x1 - originX) / cellW);
      const cy0 = Math.floor((grown.y0 - originY) / cellH);
      const cy1 = Math.floor((grown.y1 - originY) / cellH);
      if ((cx1 - cx0 + 1) * (cy1 - cy0 + 1) <= 1_000_000) {
        for (let y = cy0; y <= cy1; y++) {
          for (let x = cx0; x <= cx1; x++) {
            const k = `${x},${y}`;
            const list = walls.get(k);
            if (list) list.push(grown);
            else walls.set(k, [grown]);
          }
        }
      }
      const x0 = Math.ceil((bx.x0 - radius - originX) / cellW - 0.5 + eps);
      const x1 = Math.floor((bx.x1 + radius - originX) / cellW - 0.5 - eps);
      const y0 = Math.ceil((bx.y0 - radius - originY) / cellH - 0.5 + eps);
      const y1 = Math.floor((bx.y1 + radius - originY) / cellH - 0.5 - eps);
      if ((x1 - x0 + 1) * (y1 - y0 + 1) > 1_000_000) continue; // a giant floor collider would be every cell
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) blocked.add(`${x},${y}`);
    }
    grid = {
      originX,
      originY,
      cellW,
      cellH,
      blocked,
      walls,
      isBlocked: (x, y) => blocked.has(`${x},${y}`),
      cellAt: (p) => ({ x: Math.floor((p.x - originX) / cellW), y: Math.floor((p.y - originY) / cellH) }),
      centerOf: (x, y) => ({ x: originX + (x + 0.5) * cellW, y: originY + (y + 0.5) * cellH }),
    };
    this.cache.set(key, grid);
    return grid;
  }

  /** Forgets every grid, e.g. after walls changed in a way it can't see. */
  invalidate(): void {
    this.cache.clear();
  }
}

export interface FindPathOptions extends GridSearchOptions {
  /** The walker's radius in world units: walls are grown by it. Default 0. */
  radius?: number;
  /** The TileMap whose cells make the grid. Default: the first TileMap with a solid TileMapCollider. */
  map?: Entity;
  /** Straighten the path where nothing is in the way. Default true. */
  smooth?: boolean;
  /** An entity whose own collider is not a wall (the walker). */
  self?: Entity;
}

/**
 * A walkable path from `from` to `to` in world units, as points to walk through (the last one is `to`, or the
 * nearest reachable spot when `to` is inside a wall). Null when there is no way. See the top of this file for what
 * counts as a wall.
 */
export function findPath(world: World, from: Vec2, to: Vec2, opts: FindPathOptions = {}): Vec2[] | null {
  const nav = world.tryResource(Navigation) ?? world.insertResource(new Navigation());
  const grid = nav.grid(world, { radius: opts.radius, map: opts.map, skip: opts.self });
  const blocked = (x: number, y: number) => grid.isBlocked(x, y);
  const s = grid.cellAt(from);
  const gc = grid.cellAt(to);
  const start = nearestOpenCell(blocked, s.x, s.y, 2);
  const goal = nearestOpenCell(blocked, gc.x, gc.y, 8);
  if (!start || !goal) return null;
  const cells = gridPath(blocked, start, goal, opts);
  if (!cells) return null;
  // the walker walks from where it is, not from its cell's center, and to the exact spot when that is open
  const points: Vec2[] = [{ x: from.x, y: from.y }, ...cells.slice(1).map((c) => grid.centerOf(c.x, c.y))];
  if (goal.x === gc.x && goal.y === gc.y) {
    if (points.length > 1) points[points.length - 1] = { x: to.x, y: to.y };
    else points.push({ x: to.x, y: to.y });
  }
  if (opts.smooth === false) return points.slice(1);
  // from each point, on to the farthest one in plain view (checked on the real line, against the grown walls)
  const out: Vec2[] = [];
  let i = 0;
  while (i < points.length - 1) {
    let j = points.length - 1;
    while (j > i + 1 && !segmentOpen(grid, points[i], points[j])) j--;
    out.push(points[j]);
    i = j;
  }
  return out;
}

/**
 * Whether the walker can go straight from a to b: no point on the line (sampled every eighth of a cell) is in a
 * blocked cell or inside a wall grown by its radius. The start itself isn't checked: a walker pressed against a
 * wall can still leave it.
 */
export function segmentOpen(grid: NavGrid, a: Vec2, b: Vec2): boolean {
  const step = Math.min(grid.cellW, grid.cellH) / 8;
  const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step);
  for (let k = 1; k <= n; k++) {
    const x = a.x + ((b.x - a.x) * k) / n;
    const y = a.y + ((b.y - a.y) * k) / n;
    const c = grid.cellAt({ x, y });
    if (grid.isBlocked(c.x, c.y)) return false;
    for (const w of grid.walls.get(`${c.x},${c.y}`) ?? []) if (x > w.x0 && x < w.x1 && y > w.y0 && y < w.y1) return false;
  }
  return true;
}

// ------------------------------------------------------------------ walking

export type NavStatus = "idle" | "moving" | "arrived" | "no-path";

/**
 * Walks the entity to a place or after another entity, around walls (see `findPath`). Set `target` to chase an
 * entity, or call `this.navigateTo(x, y)` / `this.navigateTo(entity)` from a script. With a CharacterController2D
 * it moves through the physics (sliding along walls); otherwise its position is moved directly.
 * `onArrive()` is called in the entity's scripts when it gets there.
 */
export const NavAgent2D = defineComponent(
  "NavAgent2D",
  {
    /** An entity to walk after (e.g. the player). Empty: walk to `destination` once `navigateTo` is called. */
    target: t.entity(),
    destination: t.vec2(0, 0),
    /** World units per second. */
    speed: withMeta(t.f32(60), { min: 0, step: 5 }),
    /** Stop this close to the goal (world units). */
    stopDistance: withMeta(t.f32(4), { min: 0, step: 1 }),
    /** How wide the walker is, from its center (world units). 0: from its Collider2D. */
    radius: withMeta(t.f32(0), { min: 0, step: 1 }),
    /** Seconds between new paths while chasing a moving target. */
    repathInterval: withMeta(t.f32(0.5), { min: 0.05, step: 0.05 }),
    /** Walk diagonally too. Off: only up, down, left and right. */
    diagonal: t.bool(true),
    /** The TileMap whose cells make the grid. Empty: the first TileMap with a TileMapCollider. */
    map: t.entity(),
    /** What it is doing (read-only). */
    status: withMeta(t.enum(["idle", "moving", "arrived", "no-path"] as const, "idle"), { hidden: true }),
    /** The points still ahead (read-only). */
    path: withMeta(
      t.ref<Vec2[]>(() => []),
      { hidden: true },
    ),
    /** How fast it moved last step, to face or animate by (read-only). */
    velocity: withMeta(t.vec2(0, 0), { hidden: true }),
    repathIn: withMeta(t.f32(0), { hidden: true }),
  },
  { requires: [Transform2D] },
);

/** Sent when a NavAgent2D gets to its destination (not when chasing a target), or finds no way there. */
export const NavigationFinished = defineEvent<{ entity: Entity; reached: boolean }>("NavigationFinished");

/** Sends the agent to a point, or after an entity. Adds a NavAgent2D if needed. */
export function navigateTo(world: World, e: Entity, goal: Vec2 | Entity): void {
  if (!world.has(e, NavAgent2D)) world.add(e, NavAgent2D);
  const N = world.store(NavAgent2D);
  if (typeof goal === "number") {
    N.target[e] = world.ref(goal);
  } else {
    N.target[e] = NULL_REF;
    N.destination.x[e] = goal.x;
    N.destination.y[e] = goal.y;
  }
  N.status[e] = "moving";
  N.path[e] = [];
  N.repathIn[e] = 0;
}

/** Stops the agent where it is. */
export function stopNavigation(world: World, e: Entity): void {
  if (!world.has(e, NavAgent2D)) return;
  const N = world.store(NavAgent2D);
  N.target[e] = NULL_REF;
  N.status[e] = "idle";
  N.path[e] = [];
  N.velocity.x[e] = 0;
  N.velocity.y[e] = 0;
}

/** The radius a walker keeps from walls: its NavAgent2D's radius, or a little under half its collider's smaller side. */
export function walkerRadius(world: World, e: Entity): number {
  if (world.has(e, NavAgent2D) && world.store(NavAgent2D).radius[e] > 0) return world.store(NavAgent2D).radius[e];
  if (!world.has(e, Collider2D)) return 0;
  const C = world.store(Collider2D);
  const g = world.store(GlobalTransform2D).matrix;
  const scale = Math.max(Math.hypot(g.a[e], g.b[e]), Math.hypot(g.c[e], g.d[e]));
  const w = C.size.x[e];
  const h = C.shape[e] === "circle" ? w : C.size.y[e];
  // a little under half, so an agent as wide as a corridor still fits through it
  return (Math.min(w, h) / 2) * scale * 0.9;
}

/** Moves every NavAgent2D a step along its path. Runs in fixedUpdate, before physics. */
export function updateNavAgents(world: World, move: (e: Entity, dx: number, dy: number) => void): void {
  const dt = world.resource(Time).dt;
  const N = world.store(NavAgent2D);
  const G = world.store(GlobalTransform2D).matrix;
  for (const e of world.query([NavAgent2D, GlobalTransform2D])) {
    if (!isActive(world, e)) continue;
    const target = N.target[e] === NULL_REF ? -1 : world.deref(N.target[e]);
    const chasing = target >= 0 && world.has(target, GlobalTransform2D);
    if (N.target[e] !== NULL_REF && !chasing) {
      // the target is gone (e.g. destroyed): stop
      N.target[e] = NULL_REF;
      N.status[e] = "idle";
    }
    if (!chasing && N.status[e] !== "moving") {
      N.velocity.x[e] = N.velocity.y[e] = 0;
      continue;
    }
    const pos = { x: G.tx[e], y: G.ty[e] };
    const goal = chasing ? { x: G.tx[target], y: G.ty[target] } : { x: N.destination.x[e], y: N.destination.y[e] };
    const stop = N.stopDistance[e];
    if (Math.hypot(goal.x - pos.x, goal.y - pos.y) <= stop) {
      N.velocity.x[e] = N.velocity.y[e] = 0;
      N.path[e] = [];
      if (N.status[e] !== "arrived") {
        N.status[e] = "arrived";
        if (!chasing) world.emit(NavigationFinished, { entity: e, reached: true });
      }
      continue;
    }
    if (chasing) N.status[e] = "moving";
    N.repathIn[e] -= dt;
    let path = N.path[e];
    if (path.length === 0 || N.repathIn[e] <= 0) {
      N.repathIn[e] = N.repathInterval[e];
      const map = N.map[e] === NULL_REF ? -1 : world.deref(N.map[e]);
      const found = findPath(world, pos, goal, { radius: walkerRadius(world, e), map: map >= 0 ? map : undefined, diagonal: N.diagonal[e] !== 0, self: e });
      if (!found) {
        N.path[e] = [];
        N.velocity.x[e] = N.velocity.y[e] = 0;
        if (N.status[e] !== "no-path") {
          N.status[e] = "no-path";
          if (!chasing) world.emit(NavigationFinished, { entity: e, reached: false });
        }
        // while chasing, try again at the next interval
        continue;
      }
      path = N.path[e] = found;
      N.status[e] = "moving";
    }
    // walk toward the next point, passing points it reaches this step
    let budget = N.speed[e] * dt;
    let x = pos.x;
    let y = pos.y;
    while (budget > 0 && path.length > 0) {
      const p = path[0];
      const d = Math.hypot(p.x - x, p.y - y);
      if (d <= budget) {
        x = p.x;
        y = p.y;
        budget -= d;
        path.shift();
      } else {
        x += ((p.x - x) / d) * budget;
        y += ((p.y - y) / d) * budget;
        budget = 0;
      }
    }
    // an unreachable goal ends at the nearest open spot: arrived as far as it goes
    if (path.length === 0 && !chasing && Math.hypot(goal.x - x, goal.y - y) > stop) {
      N.status[e] = "arrived";
      world.emit(NavigationFinished, { entity: e, reached: false });
    }
    const dx = x - pos.x;
    const dy = y - pos.y;
    N.velocity.x[e] = dt > 0 ? dx / dt : 0;
    N.velocity.y[e] = dt > 0 ? dy / dt : 0;
    move(e, dx, dy);
  }
}

/** How an agent without a CharacterController2D is moved: its Velocity2D if it has one, else its position. */
export function moveDirect(world: World, e: Entity, dx: number, dy: number): void {
  if (world.has(e, Velocity2D)) {
    const dt = world.resource(Time).dt;
    const V = world.store(Velocity2D);
    V.linear.x[e] = dt > 0 ? dx / dt : 0;
    V.linear.y[e] = dt > 0 ? dy / dt : 0;
    return;
  }
  const T = world.store(Transform2D);
  // the agent should be a root entity; a child's local position is moved by the same amount, ignoring its parent's rotation
  T.position.x[e] += dx;
  T.position.y[e] += dy;
}
