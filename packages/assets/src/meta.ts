import type { Terrain, Vec2 } from "@brik/core";
import { type SpriteDef, TILE_COLLISIONS, type TileCollision, type TextureSettings } from "./index";

export type Slicing =
  | { mode: "single" }
  /** Sprites drawn by hand or found automatically; they are stored as they are. */
  | { mode: "manual" }
  | {
      mode: "grid";
      cell: [number, number];
      offset: [number, number];
      spacing: [number, number];
      pivot: [number, number];
    };

/** Import settings stored next to an image as `<file>.meta.json`. */
export interface TextureMeta {
  guid: string;
  importer: "texture";
  settings: TextureSettings;
  slicing: Slicing;
  sprites: SpriteDef[];
  /** Auto-tiling terrains made from this texture's sprites (for TileMaps). */
  terrains?: Terrain[];
}

/** The on-disk shape: rects and pivots as arrays to keep files short. */
interface TextureMetaJson {
  guid: string;
  importer: "texture";
  settings: TextureSettings;
  slicing: Slicing;
  sprites: {
    id: string;
    name: string;
    rect: [number, number, number, number];
    pivot: [number, number];
    /** left, bottom, right, top */
    border?: [number, number, number, number];
    /** left out when "full" */
    collision?: TileCollision;
  }[];
  terrains?: Terrain[];
}

export const DEFAULT_TEXTURE_SETTINGS: TextureSettings = { filter: "nearest", wrap: "clamp", pixelsPerUnit: 1 };

export function defaultTextureMeta(guid: string): TextureMeta {
  return {
    guid,
    importer: "texture",
    settings: { ...DEFAULT_TEXTURE_SETTINGS },
    slicing: { mode: "single" },
    sprites: [],
  };
}

export function textureMetaToJson(meta: TextureMeta): string {
  const json: TextureMetaJson = {
    guid: meta.guid,
    importer: "texture",
    settings: meta.settings,
    slicing: meta.slicing,
    sprites: meta.sprites.map((s) => ({
      id: s.id,
      name: s.name,
      rect: [s.rect.x, s.rect.y, s.rect.w, s.rect.h],
      pivot: [s.pivot.x, s.pivot.y],
      ...(s.border ? { border: [s.border.l, s.border.b, s.border.r, s.border.t] as [number, number, number, number] } : {}),
      ...(s.collision && s.collision !== "full" ? { collision: s.collision } : {}),
    })),
    ...(meta.terrains?.length ? { terrains: meta.terrains } : {}),
  };
  return `${JSON.stringify(json, null, 2)}\n`;
}

export function parseTextureMeta(text: string): TextureMeta {
  const j = JSON.parse(text) as Partial<TextureMetaJson>;
  if (typeof j.guid !== "string") throw new Error("Brik: meta file has no guid");
  return {
    guid: j.guid,
    importer: "texture",
    settings: { ...DEFAULT_TEXTURE_SETTINGS, ...j.settings },
    slicing: j.slicing ?? { mode: "single" },
    sprites: (j.sprites ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      rect: { x: s.rect[0], y: s.rect[1], w: s.rect[2], h: s.rect[3] },
      pivot: { x: s.pivot?.[0] ?? 0.5, y: s.pivot?.[1] ?? 0.5 },
      ...(s.border ? { border: { l: s.border[0], b: s.border[1], r: s.border[2], t: s.border[3] } } : {}),
      ...(s.collision && s.collision !== "full" && TILE_COLLISIONS.includes(s.collision) ? { collision: s.collision } : {}),
    })),
    ...(j.terrains?.length ? { terrains: j.terrains } : {}),
  };
}

/**
 * Computes the sprites for a slicing mode. Grid cells get ids `cell_<i>`, so
 * references stay valid when the image grows or the grid is re-applied.
 * Names that were changed by hand are kept.
 */
export function sliceSprites(
  slicing: Slicing,
  width: number,
  height: number,
  baseName: string,
  previous: SpriteDef[] = [],
): SpriteDef[] {
  if (slicing.mode === "single") return [];
  if (slicing.mode === "manual") return previous.map((s) => structuredClone(s));
  const [cw, ch] = slicing.cell;
  const [ox, oy] = slicing.offset;
  const [sx, sy] = slicing.spacing;
  if (cw <= 0 || ch <= 0) return [];
  const [cols, rows] = gridCount(slicing, width, height);
  const oldById = new Map(previous.map((s) => [s.id, s]));
  const pivot: Vec2 = { x: slicing.pivot[0], y: slicing.pivot[1] };
  const out: SpriteDef[] = [];
  for (let i = 0; i < cols * rows; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const id = `cell_${i}`;
    out.push({
      id,
      name: oldById.get(id)?.name ?? `${baseName}_${i}`,
      rect: { x: ox + col * (cw + sx), y: oy + row * (ch + sy), w: cw, h: ch },
      // pivot comes from the grid settings; 9-slice borders set by hand are kept
      pivot: { ...pivot },
      ...(oldById.get(id)?.border ? { border: { ...oldById.get(id)!.border! } } : {}),
      ...(oldById.get(id)?.collision ? { collision: oldById.get(id)!.collision } : {}),
    });
  }
  return out;
}

type GridSlicing = Extract<Slicing, { mode: "grid" }>;

/** How many columns and rows a grid gives on an image of `width` x `height`. */
export function gridCount(g: GridSlicing, width: number, height: number): [number, number] {
  const [cw, ch] = g.cell;
  const [ox, oy] = g.offset;
  const [sx, sy] = g.spacing;
  if (cw <= 0 || ch <= 0) return [0, 0];
  return [Math.max(0, Math.floor((width - ox + sx) / (cw + sx))), Math.max(0, Math.floor((height - oy + sy) / (ch + sy)))];
}

/** The cell size that splits the image (after offset and spacing) into `cols` x `rows` cells. */
export function cellForCount(g: GridSlicing, width: number, height: number, cols: number, rows: number): [number, number] {
  const [ox, oy] = g.offset;
  const [sx, sy] = g.spacing;
  const c = Math.max(1, Math.round(cols));
  const r = Math.max(1, Math.round(rows));
  return [Math.max(1, Math.floor((width - ox + sx) / c) - sx), Math.max(1, Math.floor((height - oy + sy) / r) - sy)];
}

/**
 * Guesses a grid from the sprites found in an image (see autoSliceRects): as
 * many columns as the widest row of sprites and as many rows as there are rows,
 * each cell an equal share of the image. Null when nothing was found.
 */
export function guessGrid(
  rects: { x: number; y: number; w: number; h: number }[],
  width: number,
  height: number,
): { cell: [number, number]; cols: number; rows: number } | null {
  if (rects.length === 0) return null;
  const rows: (typeof rects)[] = [];
  for (const r of [...rects].sort((a, b) => a.y - b.y)) {
    const row = rows.find((rw) => r.y < rw[0].y + rw[0].h && rw[0].y < r.y + r.h);
    if (row) row.push(r);
    else rows.push([r]);
  }
  const cols = Math.max(...rows.map((r) => r.length));
  return { cell: [Math.max(1, Math.floor(width / cols)), Math.max(1, Math.floor(height / rows.length))], cols, rows: rows.length };
}

/**
 * Finds sprites in an image by transparency: every group of touching pixels
 * (including diagonals) with alpha above `alphaThreshold` becomes one rect.
 * Overlapping rects are merged, tiny ones (`minSize`) dropped. Sorted in rows,
 * top to bottom, left to right.
 *
 * The default threshold (16 of 255) ignores nearly invisible pixels: AI
 * generated and lossy compressed images often have faint specks all over the
 * background, which would otherwise become hundreds of sprites.
 */
export function autoSliceRects(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  opts: { alphaThreshold?: number; minSize?: number; padding?: number } = {},
): { x: number; y: number; w: number; h: number }[] {
  const threshold = opts.alphaThreshold ?? 16;
  const minSize = opts.minSize ?? 2;
  const pad = opts.padding ?? 0;
  const seen = new Uint8Array(width * height);
  const stack: number[] = [];
  let rects: { x: number; y: number; w: number; h: number }[] = [];
  for (let start = 0; start < width * height; start++) {
    if (seen[start] || rgba[start * 4 + 3] <= threshold) continue;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % width;
      const y = (i - x) / width;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const j = ny * width + nx;
          if (!seen[j] && rgba[j * 4 + 3] > threshold) {
            seen[j] = 1;
            stack.push(j);
          }
        }
      }
    }
    rects.push({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 });
  }
  // merge rects that overlap (e.g. a detached eye inside a head's bounding box)
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i];
        const b = rects[j];
        if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) {
          const x = Math.min(a.x, b.x);
          const y = Math.min(a.y, b.y);
          rects[i] = { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
          rects.splice(j, 1);
          merged = true;
          break outer;
        }
      }
    }
  }
  rects = rects.filter((r) => r.w >= minSize || r.h >= minSize);
  if (pad > 0) {
    rects = rects.map((r) => {
      const x = Math.max(0, r.x - pad);
      const y = Math.max(0, r.y - pad);
      return { x, y, w: Math.min(width, r.x + r.w + pad) - x, h: Math.min(height, r.y + r.h + pad) - y };
    });
  }
  // rows: rects whose vertical ranges overlap the row's first rect share a row
  rects.sort((a, b) => a.y - b.y);
  const rows: (typeof rects)[] = [];
  for (const r of rects) {
    const row = rows.find((rw) => r.y < rw[0].y + rw[0].h && rw[0].y < r.y + r.h);
    if (row) row.push(r);
    else rows.push([r]);
  }
  return rows.flatMap((row) => row.sort((a, b) => a.x - b.x));
}
