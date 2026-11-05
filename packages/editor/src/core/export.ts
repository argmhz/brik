import {
  type GameManifest,
  type PackOptions,
  type PackResult,
  type SceneData,
  type SceneEntityData,
  DEFAULT_PACK_OPTIONS,
  packRects,
} from "@brik/runtime";
import { IMAGE_EXTENSIONS, type TextureEntry, isScene } from "./asset-db";
import type { Editor } from "./editor";
import { refreshSceneData, resolvePrefabs } from "./prefabs";
import { extname, walk } from "./fs";
import { type EsbuildLike, compileScripts, readScripts } from "./scripts";

export interface BuildSettings {
  /** Shown as the page title. Default: the project name. */
  title?: string;
  /** Pack textures into atlas pages. Off: every image is copied as is. */
  atlas: boolean;
  pack: PackOptions;
}

export const DEFAULT_BUILD: BuildSettings = { atlas: true, pack: { ...DEFAULT_PACK_OPTIONS } };

/** One image placed on an atlas page. */
export interface Placement {
  entry: TextureEntry;
  x: number;
  y: number;
}

export interface AtlasPlan {
  /** Pages to draw. `standalone` pages are copied from the project as they are. */
  pages: {
    w: number;
    h: number;
    used: number;
    filter: "nearest" | "linear";
    wrap: "clamp" | "repeat";
    placements: Placement[];
    standalone?: TextureEntry;
  }[];
  warnings: string[];
}

export interface ExportDeps {
  esbuild: EsbuildLike;
  /** The built player (brik.js). */
  playerJs: string;
  /** Draws an atlas page to PNG bytes (browser: canvas). Needed when packing. */
  drawPage?: (page: AtlasPlan["pages"][number], extrude: number) => Promise<Uint8Array>;
  /** Packs rects, e.g. in a Web Worker. Default: on this thread. */
  pack?: (items: { id: string; w: number; h: number }[], options: PackOptions) => Promise<PackResult>;
}

export interface ExportResult {
  files: Record<string, Uint8Array>;
  manifest: GameManifest;
  atlas: AtlasPlan;
  /** Every file with its size, largest first. */
  report: { path: string; bytes: number }[];
  warnings: string[];
}

const enc = new TextEncoder();

/**
 * Decides which textures go on which atlas page. Textures with repeat-wrap and
 * textures bigger than a page get pages of their own; the rest are grouped by
 * filter so each page has one sampling mode.
 */
export async function planAtlas(editor: Editor, settings: BuildSettings, pack = defaultPack): Promise<AtlasPlan> {
  const entries = [...editor.db.textures.values()].filter((t) => t.asset.status === "ready").sort((a, b) => a.path.localeCompare(b.path));
  const plan: AtlasPlan = { pages: [], warnings: [] };
  const standalone = (e: TextureEntry) =>
    plan.pages.push({
      w: e.asset.width,
      h: e.asset.height,
      used: 1,
      filter: e.meta.settings.filter,
      wrap: e.meta.settings.wrap,
      placements: [{ entry: e, x: 0, y: 0 }],
      standalone: e,
    });
  if (!settings.atlas) {
    for (const e of entries) standalone(e);
    return plan;
  }
  const groups = new Map<string, TextureEntry[]>();
  for (const e of entries) {
    if (e.meta.settings.wrap === "repeat") {
      standalone(e);
      continue;
    }
    const key = e.meta.settings.filter;
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  for (const [filter, list] of groups) {
    const byPath = new Map(list.map((e) => [e.path, e]));
    const result = await pack(
      list.map((e) => ({ id: e.path, w: e.asset.width, h: e.asset.height })),
      settings.pack,
    );
    for (const id of result.oversized) {
      plan.warnings.push(`${id} er større end ${settings.pack.maxSize} px og får sin egen side`);
      standalone(byPath.get(id)!);
    }
    const first = plan.pages.length;
    for (const p of result.pages) plan.pages.push({ ...p, filter: filter as "nearest" | "linear", wrap: "clamp", placements: [] });
    for (const it of result.items) plan.pages[first + it.page].placements.push({ entry: byPath.get(it.id)!, x: it.x, y: it.y });
  }
  return plan;
}

const defaultPack = async (items: { id: string; w: number; h: number }[], o: PackOptions) => packRects(items, o);

/** Removes entities marked EditorOnly, with their children. */
export function stripEditorOnly(entities: SceneEntityData[]): SceneEntityData[] {
  const dropped = new Set(entities.filter((d) => "EditorOnly" in d.components).map((d) => d.id));
  let grew = true;
  while (grew) {
    grew = false;
    for (const d of entities) {
      const parent = d.components.Parent?.entity;
      if (!dropped.has(d.id) && typeof parent === "string" && dropped.has(parent)) {
        dropped.add(d.id);
        grew = true;
      }
    }
  }
  return entities.filter((d) => !dropped.has(d.id));
}

export function indexHtml(title: string): string {
  const esc = title.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  return `<!doctype html>
<html lang="da">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no" />
    <title>${esc}</title>
    <style>
      html, body { margin: 0; height: 100%; background: #000; overflow: hidden; }
      #game { display: block; width: 100vw; height: 100vh; outline: none; touch-action: none; }
      #loading { position: fixed; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;
        gap: 14px; color: #ccd; font: 14px system-ui, sans-serif; background: #111216; }
      #track { width: min(320px, 70vw); height: 6px; background: #2a2c33; border-radius: 3px; overflow: hidden; }
      #bar { width: 0; height: 100%; background: #4c8dff; transition: width 0.15s; }
    </style>
  </head>
  <body>
    <canvas id="game" tabindex="0"></canvas>
    <div id="loading"><div>${esc}</div><div id="track"><div id="bar"></div></div></div>
    <script type="module" src="brik.js"></script>
  </body>
</html>
`;
}

/**
 * Builds the game as static files: index.html, the player, game.json, atlas
 * pages, sounds and the compiled scripts. Upload the folder (or the zip) to
 * itch.io, GitHub Pages or any web server.
 */
export async function exportGame(editor: Editor, deps: ExportDeps, settings: BuildSettings = DEFAULT_BUILD): Promise<ExportResult> {
  const fs = editor.fs;
  const files: Record<string, Uint8Array> = {};
  const warnings: string[] = [];

  // scripts, minified
  const sources = await readScripts(fs);
  let scripts: string | null = null;
  if (Object.keys(sources).length > 0) {
    const compiled = await compileScripts(deps.esbuild, sources, { minify: true });
    if (!compiled.code) {
      const first = compiled.errors[0];
      throw new Error(`Scripts har fejl: ${first ? `${first.file}:${first.line}: ${first.message}` : "ukendt fejl"}`);
    }
    files["game.js"] = enc.encode(compiled.code);
    scripts = "game.js";
  }

  // scenes
  const paths = await walk(fs);
  const scenes: Record<string, SceneData> = {};
  for (const path of paths.filter(isScene)) {
    const data = refreshSceneData(editor, JSON.parse(await fs.readText(path)) as SceneData);
    scenes[path] = { version: 1, entities: stripEditorOnly(data.entities) };
  }
  const startScene = editor.settings.startScene;
  if (!scenes[startScene]) throw new Error(`Startscenen ${startScene} findes ikke. Gem scenen først.`);

  // textures -> pages
  const atlas = await planAtlas(editor, settings, deps.pack);
  warnings.push(...atlas.warnings);
  const manifestPages: GameManifest["pages"] = [];
  const textures: GameManifest["textures"] = [];
  for (let i = 0; i < atlas.pages.length; i++) {
    const page = atlas.pages[i];
    let file: string;
    if (page.standalone) {
      file = `images/${page.standalone.path.replace(/\//g, "_")}`;
      files[file] = await fs.readFile(page.standalone.path);
    } else {
      if (!deps.drawPage) throw new Error("Brik editor: atlas packing needs drawPage");
      file = `images/atlas_${i}.png`;
      files[file] = await deps.drawPage(page, settings.pack.extrude);
    }
    manifestPages.push({ file, filter: page.filter, wrap: page.wrap });
    for (const pl of page.placements) {
      const e = pl.entry;
      textures.push({
        guid: e.meta.guid,
        name: e.asset.name,
        page: i,
        region: [pl.x, pl.y, e.asset.width, e.asset.height],
        pixelsPerUnit: e.meta.settings.pixelsPerUnit,
        sprites: e.meta.sprites.map((s) => ({
          id: s.id,
          name: s.name,
          rect: [s.rect.x + pl.x, s.rect.y + pl.y, s.rect.w, s.rect.h],
          pivot: [s.pivot.x, s.pivot.y],
          ...(s.border ? { border: [s.border.l, s.border.b, s.border.r, s.border.t] as [number, number, number, number] } : {}),
        })),
      });
    }
  }

  // sounds are copied as they are
  const sounds: GameManifest["sounds"] = [];
  for (const s of editor.db.sounds.values()) {
    const file = `sounds/${s.path.replace(/\//g, "_")}`;
    files[file] = await fs.readFile(s.path);
    sounds.push({ guid: s.guid, name: s.name, file });
  }

  const resolved = resolvePrefabs(new Map([...editor.assets.prefabs.values()].map((p) => [p.guid, p.data])));
  const prefabs: GameManifest["prefabs"] = [...editor.assets.prefabs.values()].map((p) => ({
    guid: p.guid,
    name: p.name,
    entities: stripEditorOnly((resolved.get(p.guid) ?? p.data).entities),
  }));

  const title = settings.title?.trim() || editor.settings.name;
  const manifest: GameManifest = {
    format: "brik-game",
    version: 1,
    title,
    startScene,
    ...(editor.settings.physics ? { physics: editor.settings.physics } : {}),
    pages: manifestPages,
    textures,
    clips: [...editor.assets.clips.values()],
    prefabs,
    sounds,
    scenes,
    scripts,
  };
  files["game.json"] = enc.encode(JSON.stringify(manifest));
  files["brik.js"] = enc.encode(deps.playerJs);
  files["index.html"] = enc.encode(indexHtml(title));

  const report = Object.entries(files)
    .map(([path, bytes]) => ({ path, bytes: bytes.length }))
    .sort((a, b) => b.bytes - a.bytes);
  return { files, manifest, atlas, report, warnings };
}

/** True for image files the exporter knows how to copy. */
export function isExportableImage(path: string): boolean {
  return extname(path) in IMAGE_EXTENSIONS;
}
