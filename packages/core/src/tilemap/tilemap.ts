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
      // saved as rows of characters (see encodeTiles), read back as "x,y" keys
      { hidden: true, save: (v) => encodeTiles(v as TileData), load: decodeTiles },
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

/**
 * Tiles as saved in scene and prefab files: rows of characters, top row first,
 * starting at cell (x, y). Each character is looked up in `legend`; "." is empty.
 */
export interface TileGrid {
  $grid: { x: number; y: number; legend: Record<string, string>; rows: string[] };
}

/** Characters a legend may use: letters first (the sprite name's own initial when free), then digits and signs. */
const LEGEND_CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#@%&*+=~^-_!?<>:;|/()[]{}$";

/**
 * Turns tiles into the compact form for saving. A map that is mostly empty
 * space (or uses very many different sprites) stays as `"x,y"` keys, whichever
 * is smaller.
 */
export function encodeTiles(tiles: TileData): TileData | TileGrid {
  const bounds = tileBounds(tiles);
  if (!bounds) return {};
  const count = Object.keys(tiles).length;
  const w = bounds.maxX - bounds.minX + 1;
  const h = bounds.maxY - bounds.minY + 1;
  // a key costs about 20 characters in a file, a grid cell one
  if (w * h > count * 20) return { ...tiles };
  const sprites = [...new Set(Object.values(tiles))].sort();
  if (sprites.length > LEGEND_CHARS.length) return { ...tiles };
  const legend: Record<string, string> = {};
  const charOf = new Map<string, string>();
  const used = new Set<string>();
  const take = (sprite: string, c: string) => {
    legend[c] = sprite;
    charOf.set(sprite, c);
    used.add(c);
  };
  for (const sprite of sprites) {
    const initial = sprite[0];
    if (initial && LEGEND_CHARS.includes(initial) && !used.has(initial)) take(sprite, initial);
  }
  for (const sprite of sprites) {
    if (charOf.has(sprite)) continue;
    const c = [...LEGEND_CHARS].find((ch) => !used.has(ch))!;
    take(sprite, c);
  }
  const rows: string[] = [];
  for (let y = bounds.maxY; y >= bounds.minY; y--) {
    let row = "";
    for (let x = bounds.minX; x <= bounds.maxX; x++) {
      const sprite = tiles[tileKey(x, y)];
      row += sprite === undefined ? "." : charOf.get(sprite)!;
    }
    rows.push(row.replace(/\.+$/, ""));
  }
  const sortedLegend: Record<string, string> = {};
  for (const c of Object.keys(legend).sort()) sortedLegend[c] = legend[c];
  return { $grid: { x: bounds.minX, y: bounds.maxY, legend: sortedLegend, rows } };
}

/** Reads tiles saved by `encodeTiles` (either form) back into `"x,y"` keys. */
export function decodeTiles(v: unknown): TileData {
  if (v === null || typeof v !== "object") return {};
  const grid = (v as Partial<TileGrid>).$grid;
  if (!grid) return v as TileData;
  const out: TileData = {};
  grid.rows.forEach((row, i) => {
    for (let j = 0; j < row.length; j++) {
      const sprite = grid.legend[row[j]];
      if (sprite !== undefined) out[tileKey(grid.x + j, grid.y - i)] = sprite;
    }
  });
  return out;
}

/** Cells per side of a tile chunk. Drawing and colliders work chunk by chunk. */
export const TILE_CHUNK = 16;

/** The tiles of one TILE_CHUNK x TILE_CHUNK block of cells. */
export interface TileChunk {
  /** Chunk coordinates: cell x / TILE_CHUNK, rounded down (same for y). */
  cx: number;
  cy: number;
  /** Tile keys in this chunk. */
  keys: string[];
  /** The chunk's tiles as text, to tell whether a chunk changed between two revisions. */
  content: string;
}

interface ChunkIndex {
  revision: number;
  chunks: Map<string, TileChunk>;
}

const chunkIndexes = new WeakMap<TileData, ChunkIndex>();

/**
 * The tiles grouped in chunks of TILE_CHUNK x TILE_CHUNK cells, keyed `"cx,cy"`.
 * Cached per tiles object and rebuilt when `revision` changes, so pass the
 * TileMap's revision (edits go through `setTile`, which bumps it, or replace
 * the tiles object).
 */
export function tileChunks(tiles: TileData, revision: number): Map<string, TileChunk> {
  const cached = chunkIndexes.get(tiles);
  if (cached && cached.revision === revision) return cached.chunks;
  const chunks = new Map<string, TileChunk>();
  for (const key in tiles) {
    const [x, y] = parseTileKey(key);
    const cx = Math.floor(x / TILE_CHUNK);
    const cy = Math.floor(y / TILE_CHUNK);
    const ck = tileKey(cx, cy);
    let c = chunks.get(ck);
    if (!c) chunks.set(ck, (c = { cx, cy, keys: [], content: "" }));
    c.keys.push(key);
  }
  for (const c of chunks.values()) {
    c.keys.sort();
    c.content = c.keys.map((k) => `${k}=${tiles[k]}`).join(";");
  }
  chunkIndexes.set(tiles, { revision, chunks });
  return chunks;
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
