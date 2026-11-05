import { defineComponent } from "../ecs/component";
import type { Entity } from "../ecs/entity";
import { t, withMeta } from "../ecs/schema";
import type { World } from "../ecs/world";
import { type Vec2, mat3 } from "../math";
import { GlobalTransform2D, Transform2D } from "../transform/components";

/** Tiles by cell, `"x,y"` -> sprite id in the tileset texture. */
export type TileData = Record<string, string>;

/**
 * A grid of tiles drawn from one sprite sheet (the tileset). Cell (0, 0) has its
 * bottom-left corner at the entity's position; x grows right and y grows up.
 * Use several TileMaps for layers (background, ground, decoration...).
 */
export const TileMap = defineComponent(
  "TileMap",
  {
    /** Guid of a grid-sliced texture. */
    tileset: withMeta(t.ref<string | null>(() => null), { editor: "texture" }),
    tileSize: t.vec2(16, 16),
    color: t.color(1, 1, 1, 1),
    tiles: withMeta(
      t.ref<TileData>(() => ({})),
      { hidden: true },
    ),
    /** Bumped by `setTile`, so colliders know to rebuild. */
    revision: withMeta(t.u32(0), { hidden: true }),
  },
  { requires: [Transform2D] },
);

/** Gives the TileMap's tiles solid colliders (merged into as few boxes as possible). */
export const TileMapCollider = defineComponent(
  "TileMapCollider",
  {
    friction: withMeta(t.f32(0.5), { min: 0, step: 0.05 }),
    /** Detect overlaps only, e.g. for water or hazard layers. */
    isTrigger: t.bool(false),
  },
  { requires: [TileMap] },
);

export const tileKey = (x: number, y: number) => `${x},${y}`;

export function parseTileKey(key: string): [number, number] {
  const i = key.indexOf(",");
  return [Number(key.slice(0, i)), Number(key.slice(i + 1))];
}

export function getTile(world: World, e: Entity, x: number, y: number): string | null {
  return world.store(TileMap).tiles[e][tileKey(x, y)] ?? null;
}

/** Sets (or with `null`, clears) one tile. */
export function setTile(world: World, e: Entity, x: number, y: number, sprite: string | null): void {
  const M = world.store(TileMap);
  const tiles = M.tiles[e];
  const key = tileKey(x, y);
  if ((tiles[key] ?? null) === sprite) return;
  if (sprite === null) delete tiles[key];
  else tiles[key] = sprite;
  M.revision[e]++;
}

/** The cell under a world position. */
export function cellAt(world: World, e: Entity, p: Vec2): { x: number; y: number } {
  const g = world.store(GlobalTransform2D).matrix;
  const inv = mat3.invert({ a: g.a[e], b: g.b[e], c: g.c[e], d: g.d[e], tx: g.tx[e], ty: g.ty[e] });
  const local = inv ? mat3.transformPoint(inv, p) : p;
  const M = world.store(TileMap);
  return { x: Math.floor(local.x / M.tileSize.x[e]), y: Math.floor(local.y / M.tileSize.y[e]) };
}

/** Bounds of the filled cells, or null if empty. */
export function tileBounds(tiles: TileData): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const key in tiles) {
    const [x, y] = parseTileKey(key);
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return minX === Infinity ? null : { minX, minY, maxX, maxY };
}

/**
 * Covers the filled cells with as few rectangles as possible: runs along each
 * row, then rows with the same run are stacked. Rects are in cells.
 */
export function mergeTileRects(tiles: TileData): { x: number; y: number; w: number; h: number }[] {
  const rows = new Map<number, number[]>();
  for (const key in tiles) {
    const [x, y] = parseTileKey(key);
    let r = rows.get(y);
    if (!r) rows.set(y, (r = []));
    r.push(x);
  }
  // runs per row
  const runs = new Map<number, [number, number][]>();
  for (const [y, xs] of rows) {
    xs.sort((a, b) => a - b);
    const list: [number, number][] = [];
    let start = xs[0];
    let prev = xs[0];
    for (let i = 1; i <= xs.length; i++) {
      const x = xs[i];
      if (x === prev + 1) {
        prev = x;
        continue;
      }
      list.push([start, prev]);
      start = x;
      prev = x;
    }
    runs.set(y, list);
  }
  // stack identical runs on consecutive rows
  const out: { x: number; y: number; w: number; h: number }[] = [];
  const ys = [...runs.keys()].sort((a, b) => a - b);
  const open = new Map<string, { x: number; y: number; w: number; h: number }>();
  let lastY = Number.NaN;
  for (const y of ys) {
    const next = new Map<string, { x: number; y: number; w: number; h: number }>();
    for (const [a, b] of runs.get(y)!) {
      const key = `${a}:${b}`;
      const prev = y === lastY + 1 ? open.get(key) : undefined;
      if (prev) {
        prev.h++;
        next.set(key, prev);
      } else {
        const r = { x: a, y, w: b - a + 1, h: 1 };
        out.push(r);
        next.set(key, r);
      }
    }
    open.clear();
    for (const [k, v] of next) open.set(k, v);
    lastY = y;
  }
  return out;
}
