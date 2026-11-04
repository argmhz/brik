import {
  ANIMATION_EXTENSION,
  AUDIO_EXTENSIONS,
  type AnimationClip,
  type Assets,
  type Audio,
  PREFAB_EXTENSION,
  type SceneData,
  type TextureAsset,
  type TextureMeta,
  type TextureSource,
  defaultTextureMeta,
  clipToJson,
  newGuid,
  parseClip,
  parsePrefab,
  parseTextureMeta,
  prefabToJson,
  textureMetaToJson,
} from "@brik/runtime";
import { type ProjectFS, basename, extname, joinPath, walk } from "./fs";

export const IMAGE_EXTENSIONS: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

export const SCENE_EXTENSION = ".scene.json";

export type Decoder = (bytes: Uint8Array, mime: string) => Promise<TextureSource>;

/** Decodes an image with an <img> element, like the runtime loader does. */
export const decodeImage: Decoder = (bytes, mime) =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("could not decode image"));
    };
    img.src = url;
  });

export interface TextureEntry {
  path: string;
  meta: TextureMeta;
  asset: TextureAsset;
  /** Object URL for thumbnails in the UI (browser only). */
  url?: string;
}

export function isImage(path: string): boolean {
  return extname(path) in IMAGE_EXTENSIONS;
}

export function isScene(path: string): boolean {
  return path.endsWith(SCENE_EXTENSION);
}

export function isClip(path: string): boolean {
  return path.endsWith(ANIMATION_EXTENSION);
}

export function isPrefab(path: string): boolean {
  return path.endsWith(PREFAB_EXTENSION);
}

export function isAudio(path: string): boolean {
  return extname(path) in AUDIO_EXTENSIONS;
}

/** Asset name from a path: the file name without its (double) extension. */
export function assetName(path: string): string {
  return basename(path).replace(/(\.anim\.json|\.prefab\.json|\.scene\.json|\.[^.]+)$/, "");
}

export interface JsonAssetEntry {
  path: string;
  guid: string;
  name: string;
  /** File text when it was last loaded, to notice outside edits. */
  text: string;
}

export interface SoundEntry {
  path: string;
  guid: string;
  name: string;
}

export function metaPath(path: string): string {
  return `${path}.meta.json`;
}

/** Name used for a texture: the file name without extension. */
export function textureName(path: string): string {
  return basename(path).replace(/\.[^.]+$/, "");
}

/**
 * Keeps the runtime `Assets` in sync with the image files in the project.
 * Every image gets a `.meta.json` with a stable guid; it is created on first sight.
 */
export class AssetDatabase {
  readonly textures = new Map<string, TextureEntry>();
  readonly clips = new Map<string, JsonAssetEntry>();
  readonly prefabs = new Map<string, JsonAssetEntry>();
  readonly sounds = new Map<string, SoundEntry>();
  /** Where sound clips are registered. Set by the editor. */
  audio: Audio | null = null;
  /** Called when a prefab file was changed outside the editor. */
  onPrefabChanged: ((guid: string) => void) | null = null;

  constructor(
    private readonly fs: ProjectFS,
    private readonly assets: Assets,
    private readonly decode: Decoder = decodeImage,
    private readonly makeUrl?: (bytes: Uint8Array, mime: string) => string,
  ) {}

  /** Scans the project. New images are imported, removed ones are dropped. */
  async refresh(): Promise<void> {
    const files = await walk(this.fs);
    const images = files.filter(isImage);
    const present = new Set(images);
    for (const [path, entry] of this.textures) {
      if (!present.has(path)) {
        this.assets.removeTexture(entry.asset);
        if (entry.url) URL.revokeObjectURL(entry.url);
        this.textures.delete(path);
      }
    }
    for (const path of images) {
      if (!this.textures.has(path)) await this.load(path);
    }
    await this.refreshJson(files.filter(isClip), this.clips, (text, path) => {
      const clip = parseClip(text, assetName(path));
      this.assets.addClip(clip);
      return clip.guid;
    }, (guid) => this.assets.removeClip(guid));
    const changed: string[] = [];
    await this.refreshJson(files.filter(isPrefab), this.prefabs, (text, path) => {
      const prefab = parsePrefab(text, assetName(path));
      if (this.prefabs.has(path)) changed.push(prefab.guid);
      this.assets.addPrefab(prefab);
      return prefab.guid;
    }, (guid) => this.assets.removePrefab(guid));
    for (const guid of changed) this.onPrefabChanged?.(guid);
    await this.refreshSounds(files.filter(isAudio));
  }

  private async refreshJson(
    paths: string[],
    map: Map<string, JsonAssetEntry>,
    add: (text: string, path: string) => string,
    remove: (guid: string) => void,
  ): Promise<void> {
    const present = new Set(paths);
    for (const [path, entry] of map) {
      if (!present.has(path)) {
        remove(entry.guid);
        map.delete(path);
      }
    }
    for (const path of paths) {
      let text: string;
      try {
        text = await this.fs.readText(path);
      } catch {
        continue;
      }
      const old = map.get(path);
      if (old && old.text === text) continue;
      try {
        const guid = add(text, path);
        if (old && old.guid !== guid) remove(old.guid);
        map.set(path, { path, guid, name: assetName(path), text });
      } catch (err) {
        console.error(`[brik] could not read ${path}`, err);
      }
    }
  }

  private async refreshSounds(paths: string[]): Promise<void> {
    const present = new Set(paths);
    for (const [path, entry] of this.sounds) {
      if (!present.has(path)) {
        this.audio?.removeClip(entry.guid);
        this.sounds.delete(path);
      }
    }
    for (const path of paths) {
      if (this.sounds.has(path)) continue;
      const mp = metaPath(path);
      let guid: string | undefined;
      if (await this.fs.exists(mp)) {
        try {
          guid = (JSON.parse(await this.fs.readText(mp)) as { guid?: string }).guid;
        } catch {
          // broken meta, replaced below
        }
      }
      if (!guid) {
        guid = newGuid();
        await this.fs.writeFile(mp, `${JSON.stringify({ guid, importer: "audio" }, null, 2)}\n`);
      }
      const name = assetName(path);
      this.audio?.addClip(guid, name, await this.fs.readFile(path));
      this.sounds.set(path, { path, guid, name });
    }
  }

  /** Writes an animation clip to disk and registers it. */
  async saveClip(path: string, clip: AnimationClip): Promise<void> {
    const text = clipToJson(clip);
    await this.fs.writeFile(path, text);
    const named = { ...clip, name: assetName(path) };
    this.assets.addClip(named);
    this.clips.set(path, { path, guid: clip.guid, name: named.name, text });
  }

  /** Writes a prefab to disk and registers it. Returns its guid. */
  async savePrefab(path: string, data: SceneData, guid = this.prefabs.get(path)?.guid ?? newGuid()): Promise<string> {
    const text = prefabToJson(guid, data);
    await this.fs.writeFile(path, text);
    this.assets.addPrefab({ guid, name: assetName(path), data });
    this.prefabs.set(path, { path, guid, name: assetName(path), text });
    return guid;
  }

  /** Path of a clip, prefab or sound by guid. */
  pathOf(guid: string): string | undefined {
    for (const m of [this.clips, this.prefabs, this.sounds] as Map<string, { guid: string }>[]) {
      for (const [path, e] of m) if (e.guid === guid) return path;
    }
    return undefined;
  }

  /** (Re)imports one image and its meta file. */
  async load(path: string): Promise<TextureEntry | null> {
    let meta: TextureMeta;
    const mp = metaPath(path);
    if (await this.fs.exists(mp)) {
      try {
        meta = parseTextureMeta(await this.fs.readText(mp));
      } catch (err) {
        console.error(`[brik] broken meta file ${mp}, making a new one`, err);
        meta = defaultTextureMeta(newGuid());
        await this.fs.writeFile(mp, textureMetaToJson(meta));
      }
    } else {
      meta = defaultTextureMeta(newGuid());
      await this.fs.writeFile(mp, textureMetaToJson(meta));
    }

    const bytes = await this.fs.readFile(path);
    const mime = IMAGE_EXTENSIONS[extname(path)];
    let source: TextureSource;
    try {
      source = await this.decode(bytes, mime);
    } catch (err) {
      console.error(`[brik] could not read image ${path}`, err);
      return null;
    }

    const old = this.textures.get(path);
    let asset = old?.asset ?? this.assets.textures.get(meta.guid);
    if (asset) asset.setSource(source);
    else asset = this.assets.addTexture(source, { guid: meta.guid, name: textureName(path), settings: meta.settings });
    asset.name = textureName(path);
    this.assets.applyMeta(asset, meta);

    if (old?.url) URL.revokeObjectURL(old.url);
    const entry: TextureEntry = { path, meta, asset, url: this.makeUrl?.(bytes, mime) };
    this.textures.set(path, entry);
    return entry;
  }

  /** Writes new import settings and applies them right away. */
  async saveMeta(path: string, meta: TextureMeta): Promise<void> {
    const entry = this.textures.get(path);
    if (!entry) throw new Error(`Brik editor: ${path} is not an imported texture`);
    await this.fs.writeFile(metaPath(path), textureMetaToJson(meta));
    entry.meta = meta;
    this.assets.applyMeta(entry.asset, meta);
  }

  byGuid(guid: string): TextureEntry | undefined {
    for (const e of this.textures.values()) if (e.meta.guid === guid) return e;
    return undefined;
  }

  /** Copies files (e.g. dropped from the desktop) into a project folder and imports them. */
  async importFiles(files: { name: string; bytes: Uint8Array }[], dir = "assets"): Promise<string[]> {
    const paths: string[] = [];
    for (const f of files) {
      const path = joinPath(dir, f.name);
      await this.fs.writeFile(path, f.bytes);
      paths.push(path);
    }
    await this.refresh();
    return paths;
  }
}
