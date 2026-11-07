import { type TileData, parseTileKey, tileKey } from "./tilemap";

/*
 * Auto-tiling (terrains, like rule tiles): instead of choosing each edge and
 * corner tile by hand, you paint with a terrain and every cell picks its
 * sprite from its neighbours. A terrain is an ordered list of rules; each rule
 * has a sprite and a 3x3 pattern saying, for each neighbour, whether it must
 * be the same terrain, must not be, or doesn't matter. The first rule that
 * matches wins.
 *
 * It runs in the editor while painting; the TileMap stores ordinary sprite
 * ids, so the runtime knows nothing about terrains.
 */

/** What a rule asks of one neighbour. */
export const NEIGHBOUR_ANY = 0;
export const NEIGHBOUR_SAME = 1;
export const NEIGHBOUR_OTHER = 2;

/**
 * The 8 neighbours in reading order, as (dx, dy) with y up: top row (NW, N,
 * NE), middle (W, E), bottom row (SW, S, SE).
 */
export const NEIGHBOURS: readonly [number, number][] = [
  [-1, 1],
  [0, 1],
  [1, 1],
  [-1, 0],
  [1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
];

export interface TerrainRule {
  /** Sprite id in the tileset. */
  sprite: string;
  /** 8 values (NEIGHBOUR_ANY / SAME / OTHER) in the order of NEIGHBOURS. */
  neighbours: number[];
}

export interface Terrain {
  id: string;
  name: string;
  rules: TerrainRule[];
}

/** A cell painted with a terrain whose sprite hasn't been picked yet. */
export const TERRAIN_PREFIX = "terrain:";

export const terrainBrush = (t: Terrain | string) => TERRAIN_PREFIX + (typeof t === "string" ? t : t.id);

/** The terrain a tile value belongs to: a terrain brush placeholder, or one of the terrain's sprites. */
export function terrainOf(value: string | undefined, terrains: readonly Terrain[]): Terrain | null {
  if (value === undefined) return null;
  if (value.startsWith(TERRAIN_PREFIX)) {
    const id = value.slice(TERRAIN_PREFIX.length);
    return terrains.find((t) => t.id === id) ?? null;
  }
  return terrains.find((t) => t.rules.some((r) => r.sprite === value)) ?? null;
}

/** The sprite a terrain cell gets, given which neighbours are the same terrain. Null for a terrain without rules. */
export function pickTerrainSprite(terrain: Terrain, same: (dx: number, dy: number) => boolean): string | null {
  const around = NEIGHBOURS.map(([dx, dy]) => same(dx, dy));
  for (const rule of terrain.rules) {
    let ok = true;
    for (let i = 0; i < 8 && ok; i++) {
      const want = rule.neighbours[i] ?? NEIGHBOUR_ANY;
      if (want === NEIGHBOUR_SAME && !around[i]) ok = false;
      else if (want === NEIGHBOUR_OTHER && around[i]) ok = false;
    }
    if (ok) return rule.sprite;
  }
  // nothing matched: the first rule is the terrain's plain tile
  return terrain.rules[0]?.sprite ?? null;
}

/**
 * Picks sprites for terrain cells at `cells` and their neighbours (changing a
 * cell can change the edges around it). Brush placeholders become sprites;
 * terrain sprites are re-picked; other tiles are left alone. Mutates `tiles`.
 */
export function autotile(tiles: TileData, terrains: readonly Terrain[], cells: Iterable<string>): void {
  if (terrains.length === 0) return;
  const todo = new Set<string>();
  for (const key of cells) {
    const [x, y] = parseTileKey(key);
    todo.add(key);
    for (const [dx, dy] of NEIGHBOURS) todo.add(tileKey(x + dx, y + dy));
  }
  // decide every cell from the state before this pass, so the order doesn't matter
  const membership = new Map<string, Terrain | null>();
  const member = (key: string) => {
    if (!membership.has(key)) membership.set(key, terrainOf(tiles[key], terrains));
    return membership.get(key)!;
  };
  const picks: [string, string][] = [];
  for (const key of todo) {
    const terrain = member(key);
    if (!terrain) continue;
    const [x, y] = parseTileKey(key);
    const sprite = pickTerrainSprite(terrain, (dx, dy) => member(tileKey(x + dx, y + dy)) === terrain);
    if (sprite !== null) picks.push([key, sprite]);
  }
  for (const [key, sprite] of picks) tiles[key] = sprite;
}

/** Keys whose tile differs between two versions of a map. */
export function changedTiles(before: TileData, after: TileData): string[] {
  const out: string[] = [];
  for (const k in after) if (before[k] !== after[k]) out.push(k);
  for (const k in before) if (!(k in after)) out.push(k);
  return out;
}

/**
 * Rules for the common 3x3 block layout: corners, edges and a middle, given
 * as 9 sprite ids in reading order (top-left, top, top-right, left, middle,
 * right, bottom-left, bottom, bottom-right). Corners first, then edges, then
 * the middle, so the most specific rule wins.
 */
export function blockTerrainRules(ids: readonly string[]): TerrainRule[] {
  const A = NEIGHBOUR_ANY;
  const O = NEIGHBOUR_OTHER;
  // [N, W, E, S] must be "other" where the tile has an edge
  const rule = (sprite: string, n: boolean, w: boolean, e: boolean, s: boolean): TerrainRule => ({
    sprite,
    neighbours: [A, n ? O : A, A, w ? O : A, e ? O : A, A, s ? O : A, A],
  });
  const [tl, t, tr, l, m, r, bl, b, br] = ids;
  return [
    rule(tl, true, true, false, false),
    rule(tr, true, false, true, false),
    rule(bl, false, true, false, true),
    rule(br, false, false, true, true),
    rule(t, true, false, false, false),
    rule(b, false, false, false, true),
    rule(l, false, true, false, false),
    rule(r, false, false, true, false),
    rule(m, false, false, false, false),
  ];
}
