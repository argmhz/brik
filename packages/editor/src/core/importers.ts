import { type AnimationMode, type SceneEntityData, type SpriteDef, type TileData, newSceneId } from "@brik/runtime";
import { unzlibSync, gunzipSync } from "fflate";

/**
 * Importers for files made in other tools. They are pure functions that turn
 * the tools' JSON into Brik data; `AssetDatabase.importFiles` writes the result.
 */

// ------------------------------------------------------------------ sprite sheets (Aseprite, TexturePacker)

type Box = { x: number; y: number; w: number; h: number };

interface SheetFrame {
  filename?: string;
  frame: Box;
  rotated?: boolean;
  trimmed?: boolean;
  spriteSourceSize?: Box;
  sourceSize?: { w: number; h: number };
  duration?: number;
  pivot?: { x: number; y: number };
}

interface SheetJson {
  frames: Record<string, SheetFrame> | SheetFrame[];
  meta?: {
    app?: string;
    image?: string;
    frameTags?: { name: string; from: number; to: number; direction?: string }[];
    slices?: { name: string; keys: { frame: number; bounds: Box; center?: Box; pivot?: { x: number; y: number } }[] }[];
  };
}

export type JsonKind = "aseprite" | "texturepacker" | "tiled-map" | "tiled-tileset" | null;

/** What kind of tool file a JSON document is, or null if it isn't one we import. */
export function detectJson(data: unknown): JsonKind {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (d.type === "map" && Array.isArray(d.layers)) return "tiled-map";
  if (d.type === "tileset" && typeof d.image === "string") return "tiled-tileset";
  if (d.frames && typeof d.frames === "object" && d.meta && typeof d.meta === "object") {
    const app = String((d.meta as { app?: unknown }).app ?? "");
    return app.includes("aseprite") ? "aseprite" : "texturepacker";
  }
  return null;
}

export interface SheetImport {
  /** Image file name from the JSON (relative to the JSON file). */
  image: string;
  sprites: SpriteDef[];
  /** Animations from Aseprite tags (or one for all frames, if there are no tags but frames have durations). */
  clips: { name: string; mode: AnimationMode; frames: { id: string; duration: number }[] }[];
  warnings: string[];
}

const clean = (s: string) => s.replace(/\.(png|aseprite|ase|gif|jpg|jpeg|webp)$/i, "").replace(/[^\w\- ]+/g, "_").trim();

/**
 * Reads an Aseprite or TexturePacker JSON export (hash or array). Sprite ids are
 * `frame_<i>`, so re-importing keeps references working.
 */
export function importSpriteSheet(json: SheetJson, baseName: string): SheetImport {
  const warnings: string[] = [];
  const list: [string, SheetFrame][] = Array.isArray(json.frames)
    ? json.frames.map((f, i) => [f.filename ?? `${baseName}_${i}`, f])
    : Object.entries(json.frames);
  const sprites: SpriteDef[] = [];
  const names = new Set<string>();
  list.forEach(([key, f], i) => {
    if (f.rotated) warnings.push(`"${key}" er roteret i atlasset; det understøttes ikke, så den ser forkert ud`);
    let name = clean(key) || `${baseName}_${i}`;
    if (names.has(name)) name = `${name}_${i}`;
    names.add(name);
    // pivot: TexturePacker gives it relative to the untrimmed source, y down
    let pivot = { x: 0.5, y: 0.5 };
    const src = f.spriteSourceSize ?? { x: 0, y: 0, w: f.frame.w, h: f.frame.h };
    const size = f.sourceSize ?? { w: f.frame.w, h: f.frame.h };
    const p = f.pivot ?? { x: 0.5, y: 0.5 };
    const ax = p.x * size.w - src.x;
    const ay = p.y * size.h - src.y;
    pivot = { x: ax / Math.max(1, f.frame.w), y: 1 - ay / Math.max(1, f.frame.h) };
    sprites.push({ id: `frame_${i}`, name, rect: { ...f.frame }, pivot });
  });

  // Aseprite slices: a pivot or 9-slice center applies to every frame
  for (const slice of json.meta?.slices ?? []) {
    const key = slice.keys[0];
    if (!key) continue;
    for (const s of sprites) {
      if (key.pivot) {
        s.pivot = { x: (key.bounds.x + key.pivot.x) / s.rect.w, y: 1 - (key.bounds.y + key.pivot.y) / s.rect.h };
      }
      if (key.center) {
        const c = key.center;
        s.border = {
          l: key.bounds.x + c.x,
          t: key.bounds.y + c.y,
          r: s.rect.w - (key.bounds.x + c.x + c.w),
          b: s.rect.h - (key.bounds.y + c.y + c.h),
        };
      }
    }
  }

  const durationOf = (i: number) => Math.max(0.001, (list[i]?.[1].duration ?? 100) / 1000);
  const clips: SheetImport["clips"] = [];
  for (const tag of json.meta?.frameTags ?? []) {
    let idx: number[] = [];
    for (let i = tag.from; i <= tag.to && i < sprites.length; i++) idx.push(i);
    const dir = tag.direction ?? "forward";
    if (dir === "reverse") idx = idx.reverse();
    clips.push({
      name: clean(tag.name) || `anim_${clips.length}`,
      mode: dir === "pingpong" || dir === "pingpong_reverse" ? "pingpong" : "loop",
      frames: idx.map((i) => ({ id: sprites[i].id, duration: durationOf(i) })),
    });
  }
  if (clips.length === 0 && sprites.length > 1 && list.some(([, f]) => f.duration !== undefined)) {
    clips.push({ name: baseName, mode: "loop", frames: sprites.map((s, i) => ({ id: s.id, duration: durationOf(i) })) });
  }
  return { image: json.meta?.image ?? `${baseName}.png`, sprites, clips, warnings };
}

// ------------------------------------------------------------------ Tiled

interface TiledTileset {
  firstgid?: number;
  source?: string;
  name?: string;
  image?: string;
  imagewidth?: number;
  imageheight?: number;
  tilewidth: number;
  tileheight: number;
  columns: number;
  tilecount?: number;
  margin?: number;
  spacing?: number;
}

interface TiledLayer {
  type: "tilelayer" | "objectgroup" | "group" | "imagelayer";
  name: string;
  visible?: boolean;
  width?: number;
  height?: number;
  data?: number[] | string;
  encoding?: "csv" | "base64";
  compression?: "" | "zlib" | "gzip" | "zstd";
  chunks?: { x: number; y: number; width: number; height: number; data: number[] | string }[];
  objects?: { name?: string; type?: string; class?: string; x: number; y: number; width?: number; height?: number; point?: boolean; ellipse?: boolean; properties?: TiledProperty[] }[];
  layers?: TiledLayer[];
  properties?: TiledProperty[];
}

interface TiledProperty {
  name: string;
  value: unknown;
}

export interface TiledMap {
  type: "map";
  width: number;
  height: number;
  tilewidth: number;
  tileheight: number;
  infinite?: boolean;
  layers: TiledLayer[];
  tilesets: TiledTileset[];
}

/** Sprites for a Tiled tileset image: tile id N becomes sprite `tile_N`. */
export function tilesetSprites(ts: TiledTileset): SpriteDef[] {
  const margin = ts.margin ?? 0;
  const spacing = ts.spacing ?? 0;
  const rows = ts.tilecount ? Math.ceil(ts.tilecount / ts.columns) : Math.floor(((ts.imageheight ?? 0) - 2 * margin + spacing) / (ts.tileheight + spacing));
  const count = ts.tilecount ?? ts.columns * rows;
  const out: SpriteDef[] = [];
  for (let i = 0; i < count; i++) {
    const col = i % ts.columns;
    const row = Math.floor(i / ts.columns);
    out.push({
      id: `tile_${i}`,
      name: `${clean(ts.name ?? "tile")}_${i}`,
      rect: { x: margin + col * (ts.tilewidth + spacing), y: margin + row * (ts.tileheight + spacing), w: ts.tilewidth, h: ts.tileheight },
      pivot: { x: 0.5, y: 0.5 },
    });
  }
  return out;
}

const FLIP_MASK = 0x1fffffff;

/** Tile gids of a layer's data in any encoding. */
export function decodeTiledData(data: number[] | string, encoding?: string, compression?: string): number[] {
  if (Array.isArray(data)) return data;
  if (encoding === "csv") return data.split(",").map((s) => Number(s.trim()) || 0);
  const bin = Uint8Array.from(atob(data.trim()), (c) => c.charCodeAt(0));
  let bytes = bin;
  if (compression === "zlib") bytes = unzlibSync(bin);
  else if (compression === "gzip") bytes = gunzipSync(bin);
  else if (compression === "zstd") throw new Error("zstd-komprimerede Tiled-lag understøttes ikke. Gem kortet med CSV eller zlib.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: number[] = [];
  for (let i = 0; i + 3 < bytes.length; i += 4) out.push(view.getUint32(i, true));
  return out;
}

const prop = (props: TiledProperty[] | undefined, name: string) => props?.find((p) => p.name === name)?.value;

export interface TiledImport {
  /** Prefab entities: a root with one child per tile layer and tileset, and one per object. */
  entities: SceneEntityData[];
  warnings: string[];
}

/**
 * Turns a Tiled map into prefab data. `tilesets` are the map's tilesets with
 * external ones already loaded, and `guidOf` gives the texture guid for each.
 * Layers named like "collision", "ground", "solid" or with a `collides`
 * property get a TileMapCollider. Tiled's y axis points down; ours points up.
 */
export function importTiledMap(map: TiledMap, name: string, tilesets: TiledTileset[], guidOf: (ts: TiledTileset) => string): TiledImport {
  const warnings: string[] = [];
  const rootId = newSceneId();
  const entities: SceneEntityData[] = [
    { id: rootId, components: { Name: { value: name }, Transform2D: { position: { x: 0, y: 0 } } } },
  ];
  const sorted = [...tilesets].sort((a, b) => (b.firstgid ?? 1) - (a.firstgid ?? 1));
  const tilesetOf = (gid: number) => sorted.find((t) => gid >= (t.firstgid ?? 1));
  const mapH = map.height;
  let flipped = false;
  let order = 0;

  const addTileLayer = (layer: TiledLayer) => {
    // gather cells per tileset
    const perTileset = new Map<TiledTileset, TileData>();
    const put = (x: number, y: number, raw: number) => {
      if (!raw) return;
      if (raw > FLIP_MASK) flipped = true;
      const gid = raw & FLIP_MASK;
      const ts = tilesetOf(gid);
      if (!ts) return;
      let tiles = perTileset.get(ts);
      if (!tiles) perTileset.set(ts, (tiles = {}));
      tiles[`${x},${mapH - 1 - y}`] = `tile_${gid - (ts.firstgid ?? 1)}`;
    };
    if (layer.chunks) {
      for (const c of layer.chunks) {
        const data = decodeTiledData(c.data, layer.encoding, layer.compression);
        data.forEach((g, i) => put(c.x + (i % c.width), c.y + Math.floor(i / c.width), g));
      }
    } else if (layer.data !== undefined) {
      const w = layer.width ?? map.width;
      decodeTiledData(layer.data, layer.encoding, layer.compression).forEach((g, i) => put(i % w, Math.floor(i / w), g));
    }
    const solid = /collision|collide|ground|solid|wall/i.test(layer.name) || prop(layer.properties, "collides") === true;
    for (const [ts, tiles] of perTileset) {
      entities.push({
        id: newSceneId(),
        components: {
          Name: { value: perTileset.size > 1 ? `${layer.name} (${ts.name ?? "tileset"})` : layer.name },
          Transform2D: { position: { x: 0, y: 0 } },
          Parent: { entity: rootId },
          ...(layer.visible === false ? { Active: { self: false } } : {}),
          TileMap: { tileset: guidOf(ts), tileSize: { x: map.tilewidth, y: map.tileheight }, tiles },
          SortingOrder: { layer: 0, order: order, ySort: false },
          ...(solid ? { TileMapCollider: {} } : {}),
        },
      });
    }
    order++;
  };

  const addObjects = (layer: TiledLayer) => {
    for (const o of layer.objects ?? []) {
      const w = o.width ?? 0;
      const h = o.height ?? 0;
      // Tiled positions are the top-left corner (y down); ours are the center (y up)
      const x = o.x + w / 2;
      const y = mapH * map.tileheight - (o.y + h / 2);
      const components: SceneEntityData["components"] = {
        Name: { value: o.name || o.class || o.type || layer.name },
        Transform2D: { position: { x, y } },
        Parent: { entity: rootId },
      };
      const kind = o.class ?? o.type ?? "";
      if (!o.point && w > 0 && h > 0) {
        components.Collider2D = {
          shape: o.ellipse ? "circle" : "box",
          size: { x: w, y: h },
          isTrigger: prop(o.properties, "trigger") === true || /trigger|zone|area/i.test(kind),
        };
      }
      if (kind) components.Tags = { list: [kind] };
      entities.push({ id: newSceneId(), components });
    }
  };

  const walk = (layers: TiledLayer[]) => {
    for (const layer of layers) {
      if (layer.type === "tilelayer") addTileLayer(layer);
      else if (layer.type === "objectgroup") addObjects(layer);
      else if (layer.type === "group") walk(layer.layers ?? []);
      else warnings.push(`Lag "${layer.name}" (${layer.type}) springes over`);
    }
  };
  walk(map.layers);
  if (flipped) warnings.push("Spejlede/roterede tiles importeres uden spejling");
  return { entities, warnings };
}
