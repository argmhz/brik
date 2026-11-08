import type { App, Rect, SceneData, Vec2 } from "@brik/core";
import type { AnimationClip } from "./clip";
import type { TextureMeta } from "./meta";

export * from "./meta";
export * from "./clip";
export * from "./atlas";

/** A saved entity tree, stored as `<name>.prefab.json`. */
export interface PrefabAsset {
  guid: string;
  name: string;
  data: SceneData;
}

/**
 * A reference to one sprite. Components and scripts always point at sprites
 * through this, never at raw texture coordinates, so atlases can be repacked
 * without breaking anything. `id: ""` means "the whole texture".
 */
export interface SpriteRef {
  readonly texture: string;
  readonly id: string;
}

export interface SpriteDef {
  /** Stable id. Survives renames and re-slicing. */
  id: string;
  name: string;
  /** Pixel rectangle in the source image (y down, origin top-left). */
  rect: Rect;
  /** Normalized pivot, y up: (0.5, 0.5) is the center, (0.5, 0) bottom-center. */
  pivot: Vec2;
  /** 9-slice borders in pixels (left, bottom, right, top). Missing means no 9-slice. */
  border?: SpriteBorder;
  /** How the sprite collides when it is a tile in a TileMap with a TileMapCollider. Missing means "full". */
  collision?: TileCollision;
}

/**
 * The collision shape of a tile:
 * - "full": the whole cell is solid (the default)
 * - "none": decoration, nothing collides
 * - "one-way": a platform you can jump up through and land on (characters only; loose bodies see it as solid)
 * - "half-bottom": the lower half of the cell is solid
 * - "slope-up": a ramp rising to the right; "slope-down": falling to the right
 */
export type TileCollision = "full" | "none" | "one-way" | "half-bottom" | "slope-up" | "slope-down";
export const TILE_COLLISIONS: readonly TileCollision[] = ["full", "none", "one-way", "half-bottom", "slope-up", "slope-down"];

export interface SpriteBorder {
  l: number;
  b: number;
  r: number;
  t: number;
}

export interface TextureSettings {
  filter: "nearest" | "linear";
  wrap: "clamp" | "repeat";
  /** Source pixels per world unit. 1 means one world unit is one pixel. */
  pixelsPerUnit: number;
}

export type TextureSource = HTMLImageElement | HTMLCanvasElement | ImageBitmap | OffscreenCanvas;

export class TextureAsset {
  source: TextureSource | null = null;
  width = 0;
  height = 0;
  status: "loading" | "ready" | "error" = "loading";
  /** Bumped whenever the pixels or settings change, so the GPU copy is refreshed. */
  version = 0;
  readonly sprites = new Map<string, SpriteDef>();
  ready: Promise<TextureAsset>;
  /**
   * Where this texture sits inside its source image, when several textures share
   * one atlas page (exported games). Null means the whole source.
   */
  region: Rect | null = null;

  constructor(
    readonly guid: string,
    public name: string,
    public settings: TextureSettings,
  ) {
    this.ready = Promise.resolve(this);
  }

  /** Replaces the pixels, e.g. after the source file changed. */
  setSource(source: TextureSource): void {
    this.source = source;
    this.width = source.width;
    this.height = source.height;
    this.status = "ready";
    this.version++;
  }
}

/** Everything the renderer needs to draw one sprite. */
export interface ResolvedSprite {
  texture: TextureAsset;
  /** UVs, with v0 at the bottom edge of the sprite and v1 at the top. */
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  /** Size in world units. */
  width: number;
  height: number;
  pivotX: number;
  pivotY: number;
  /** 9-slice borders in world units, or null. */
  border: SpriteBorder | null;
  /** Pixels per world unit of the texture. */
  ppu: number;
}

export interface GridSliceOptions {
  /** Cell size in pixels. */
  cell: [number, number];
  offset?: [number, number];
  spacing?: [number, number];
  /** Number of cells to take. Default: as many as fit. */
  count?: number;
  /** Sprites are named `${prefix}_${i}`. Default: the texture name. */
  prefix?: string;
  pivot?: Vec2;
}

const emptyMeta: TextureMeta = {
  guid: "",
  importer: "texture",
  settings: { filter: "linear", wrap: "clamp", pixelsPerUnit: 1 },
  slicing: { mode: "single" },
  sprites: [],
};

const DEFAULT_SETTINGS: TextureSettings = { filter: "linear", wrap: "clamp", pixelsPerUnit: 1 };

export function newGuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

/**
 * The asset database. Available as a resource: `world.resource(Assets)`.
 *
 * In this phase sprites are defined in code (`defineSprite`, `sliceGrid`).
 * Later the editor writes the same data to `.meta.json` files.
 */
export class Assets {
  readonly textures = new Map<string, TextureAsset>();
  readonly clips = new Map<string, AnimationClip>();
  readonly prefabs = new Map<string, PrefabAsset>();
  private byName = new Map<string, SpriteRef>();

  /** Starts loading an image. The texture can be used right away; it draws once loaded. */
  loadTexture(
    url: string,
    opts: { guid?: string; name?: string; settings?: Partial<TextureSettings> } = {},
  ): TextureAsset {
    const name = opts.name ?? url.split("/").pop()!.replace(/\.[^.]+$/, "");
    const tex = this.register(new TextureAsset(opts.guid ?? newGuid(), name, { ...DEFAULT_SETTINGS, ...opts.settings }));
    tex.ready = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        tex.setSource(img);
        resolve(tex);
      };
      img.onerror = () => {
        tex.status = "error";
        console.error(`[brik] failed to load texture ${url}`);
        reject(new Error(`failed to load ${url}`));
      };
      img.src = url;
    });
    tex.ready.catch(() => {});
    return tex;
  }

  /** Registers an already available image or canvas, e.g. one drawn at runtime. */
  addTexture(
    source: TextureSource,
    opts: { guid?: string; name?: string; settings?: Partial<TextureSettings> } = {},
  ): TextureAsset {
    const tex = this.register(
      new TextureAsset(opts.guid ?? newGuid(), opts.name ?? "texture", { ...DEFAULT_SETTINGS, ...opts.settings }),
    );
    tex.setSource(source);
    return tex;
  }

  /** A reference to the whole texture as one sprite. */
  fullSprite(texture: TextureAsset): SpriteRef {
    return { texture: texture.guid, id: "" };
  }

  defineSprite(
    texture: TextureAsset,
    def: { name: string; rect: Rect; pivot?: Vec2; id?: string; border?: SpriteBorder; collision?: TileCollision },
  ): SpriteRef {
    const sprite: SpriteDef = {
      id: def.id ?? newGuid(),
      name: def.name,
      rect: { ...def.rect },
      pivot: def.pivot ? { ...def.pivot } : { x: 0.5, y: 0.5 },
      ...(def.border ? { border: { ...def.border } } : {}),
      ...(def.collision && def.collision !== "full" ? { collision: def.collision } : {}),
    };
    texture.sprites.set(sprite.id, sprite);
    const ref = { texture: texture.guid, id: sprite.id };
    this.byName.set(sprite.name, ref);
    this.byName.set(`${texture.name}/${sprite.name}`, ref);
    return ref;
  }

  /** Cuts a texture into equally sized cells, left to right, top to bottom. */
  sliceGrid(texture: TextureAsset, opts: GridSliceOptions): SpriteRef[] {
    if (texture.status !== "ready") throw new Error(`Brik: texture "${texture.name}" is not loaded yet`);
    const [cw, ch] = opts.cell;
    const [ox, oy] = opts.offset ?? [0, 0];
    const [sx, sy] = opts.spacing ?? [0, 0];
    const cols = Math.floor((texture.width - ox + sx) / (cw + sx));
    const rows = Math.floor((texture.height - oy + sy) / (ch + sy));
    const max = Math.min(opts.count ?? cols * rows, cols * rows);
    const prefix = opts.prefix ?? texture.name;
    const refs: SpriteRef[] = [];
    for (let i = 0; i < max; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      refs.push(
        this.defineSprite(texture, {
          id: `${prefix}_${i}`,
          name: `${prefix}_${i}`,
          rect: { x: ox + col * (cw + sx), y: oy + row * (ch + sy), w: cw, h: ch },
          pivot: opts.pivot,
        }),
      );
    }
    return refs;
  }

  /**
   * Applies import settings and sprites from a `.meta.json`. Sprite names from
   * the previous meta are forgotten.
   */
  applyMeta(texture: TextureAsset, meta: TextureMeta): void {
    for (const def of texture.sprites.values()) {
      for (const key of [def.name, `${texture.name}/${def.name}`]) {
        if (this.byName.get(key)?.texture === texture.guid) this.byName.delete(key);
      }
    }
    texture.sprites.clear();
    texture.settings = { ...meta.settings };
    for (const s of meta.sprites) this.defineSprite(texture, s);
    texture.version++;
  }

  /** Removes a texture and its sprite names. */
  removeTexture(texture: TextureAsset): void {
    this.applyMeta(texture, { ...emptyMeta, guid: texture.guid, settings: texture.settings });
    this.textures.delete(texture.guid);
  }

  /** Finds a sprite by name: `"hero_0"` or `"heroSheet/hero_0"`. */
  sprite(name: string): SpriteRef {
    const ref = this.byName.get(name);
    if (!ref) throw new Error(`Brik: unknown sprite "${name}"`);
    return ref;
  }

  spriteDef(ref: SpriteRef): SpriteDef | undefined {
    return this.textures.get(ref.texture)?.sprites.get(ref.id);
  }

  /** Looks up where a sprite lives. Null while its texture is loading or if it doesn't exist. */
  /**
   * Why a sprite reference draws nothing, or null when it is fine. `loading` is only a matter of time;
   * the other problems (`kind: "missing"`) will not go away by themselves.
   */
  problem(ref: SpriteRef): { kind: "loading" | "missing"; message: string } | null {
    const tex = this.textures.get(ref.texture);
    if (!tex) return { kind: "missing", message: `texture ${ref.texture} does not exist in the project` };
    if (tex.status === "error") return { kind: "missing", message: `texture "${tex.name}" could not be loaded` };
    if (tex.status !== "ready") return { kind: "loading", message: `texture "${tex.name}" is still loading` };
    if (ref.id !== "" && !tex.sprites.has(ref.id)) return { kind: "missing", message: `texture "${tex.name}" has no sprite "${ref.id}"` };
    return null;
  }

  resolve(ref: SpriteRef, out?: ResolvedSprite): ResolvedSprite | null {
    const tex = this.textures.get(ref.texture);
    if (!tex || tex.status !== "ready") return null;
    let x = tex.region?.x ?? 0;
    let y = tex.region?.y ?? 0;
    let w = tex.region?.w ?? tex.width;
    let h = tex.region?.h ?? tex.height;
    let px = 0.5;
    let py = 0.5;
    let border: SpriteBorder | undefined;
    if (ref.id !== "") {
      const def = tex.sprites.get(ref.id);
      if (!def) return null;
      ({ x, y, w, h } = def.rect);
      px = def.pivot.x;
      py = def.pivot.y;
      border = def.border;
    }
    const ppu = tex.settings.pixelsPerUnit;
    const r = out ?? ({} as ResolvedSprite);
    r.texture = tex;
    r.u0 = x / tex.width;
    r.u1 = (x + w) / tex.width;
    r.v0 = (y + h) / tex.height;
    r.v1 = y / tex.height;
    r.width = w / ppu;
    r.height = h / ppu;
    r.pivotX = px;
    r.pivotY = py;
    r.ppu = ppu;
    r.border = border ? { l: border.l / ppu, b: border.b / ppu, r: border.r / ppu, t: border.t / ppu } : null;
    return r;
  }

  // ------------------------------------------------------------ animations

  /** Adds or replaces an animation clip (by guid). */
  addClip(clip: AnimationClip): AnimationClip {
    this.clips.set(clip.guid, clip);
    return clip;
  }

  removeClip(guid: string): void {
    this.clips.delete(guid);
  }

  /** Finds a clip by guid or by name, e.g. `"hero_run"`. */
  clip(nameOrGuid: string): AnimationClip | undefined {
    const byGuid = this.clips.get(nameOrGuid);
    if (byGuid) return byGuid;
    for (const c of this.clips.values()) if (c.name === nameOrGuid) return c;
    return undefined;
  }

  // ------------------------------------------------------------ prefabs

  addPrefab(prefab: PrefabAsset): PrefabAsset {
    this.prefabs.set(prefab.guid, prefab);
    return prefab;
  }

  removePrefab(guid: string): void {
    this.prefabs.delete(guid);
  }

  /** Finds a prefab by guid or by name, e.g. `"Coin"`. */
  prefab(nameOrGuid: string): PrefabAsset | undefined {
    const byGuid = this.prefabs.get(nameOrGuid);
    if (byGuid) return byGuid;
    for (const p of this.prefabs.values()) if (p.name === nameOrGuid) return p;
    return undefined;
  }

  private register(tex: TextureAsset): TextureAsset {
    this.textures.set(tex.guid, tex);
    return tex;
  }
}

export const AssetsPlugin = {
  name: "brik:assets",
  build(app: App) {
    if (!app.world.hasResource(Assets)) app.world.insertResource(new Assets());
  },
};
