import { type TileData, type World, tileBounds, tileKey } from "@brik/runtime";
import { setValues } from "./commands";
import type { EditCommand } from "./history";

/** Cells on a line between two cells (Bresenham), so fast strokes leave no gaps. */
export function lineCells(x0: number, y0: number, x1: number, y1: number): [number, number][] {
  const out: [number, number][] = [];
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  for (;;) {
    out.push([x, y]);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
  return out;
}

/** Sets every cell in a rectangle (inclusive corners) to `sprite`, or clears them with null. */
export function fillRect(tiles: TileData, x0: number, y0: number, x1: number, y1: number, sprite: string | null): void {
  for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
      if (sprite === null) delete tiles[tileKey(x, y)];
      else tiles[tileKey(x, y)] = sprite;
    }
  }
}

/**
 * Flood-fills the area of same tiles (or same emptiness) around a cell. An empty
 * area is limited to the map's current bounds, so it never runs off forever.
 * Returns how many cells changed.
 */
export function floodFill(tiles: TileData, x: number, y: number, sprite: string | null, maxCells = 20000): number {
  const target = tiles[tileKey(x, y)] ?? null;
  if (target === sprite) return 0;
  const b = tileBounds(tiles) ?? { minX: x, minY: y, maxX: x, maxY: y };
  const minX = Math.min(b.minX, x);
  const minY = Math.min(b.minY, y);
  const maxX = Math.max(b.maxX, x);
  const maxY = Math.max(b.maxY, y);
  const stack: [number, number][] = [[x, y]];
  const seen = new Set<string>();
  let changed = 0;
  while (stack.length && changed < maxCells) {
    const [cx, cy] = stack.pop()!;
    if (cx < minX || cx > maxX || cy < minY || cy > maxY) continue;
    const key = tileKey(cx, cy);
    if (seen.has(key) || (tiles[key] ?? null) !== target) continue;
    seen.add(key);
    if (sprite === null) delete tiles[key];
    else tiles[key] = sprite;
    changed++;
    stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
  }
  return changed;
}

/** Undoable change of a TileMap's tiles. `before` and `after` must not be mutated afterwards. */
export function setTilesCommand(world: World, id: string, before: TileData, after: TileData, label = "Mal tiles"): EditCommand {
  return setValues(world, label, [{ id, component: "TileMap", before: { tiles: before }, after: { tiles: after } }]);
}
