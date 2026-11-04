import type { Vec2 } from "@brik/core";
import type { SpriteDef, TextureSettings } from "./index";

export type Slicing =
  | { mode: "single" }
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
}

/** The on-disk shape: rects and pivots as arrays to keep files short. */
interface TextureMetaJson {
  guid: string;
  importer: "texture";
  settings: TextureSettings;
  slicing: Slicing;
  sprites: { id: string; name: string; rect: [number, number, number, number]; pivot: [number, number] }[];
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
    })),
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
    })),
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
  const [cw, ch] = slicing.cell;
  const [ox, oy] = slicing.offset;
  const [sx, sy] = slicing.spacing;
  if (cw <= 0 || ch <= 0) return [];
  const cols = Math.max(0, Math.floor((width - ox + sx) / (cw + sx)));
  const rows = Math.max(0, Math.floor((height - oy + sy) / (ch + sy)));
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
      pivot: { ...pivot },
    });
  }
  return out;
}
