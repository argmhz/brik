import * as runtime from "@brik/runtime";
import {
  App,
  Assets,
  Audio,
  type GameManifest,
  ScenesPlugin,
  ScriptRegistry,
  ScriptsPlugin,
  createGame,
  initPhysics,
  loadScene,
} from "@brik/runtime";

export interface StartOptions {
  canvas: HTMLCanvasElement;
  /** URL of the folder with game.json. Default: the page's folder. */
  base?: string;
  /** 0..1 while loading. */
  onProgress?: (done: number, label: string) => void;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`could not load ${url}`));
    img.src = url;
  });
}

/** Loads an exported game (game.json and its files) and starts it. */
export async function startGame(opts: StartOptions): Promise<App> {
  const base = new URL(opts.base ?? ".", location.href);
  const url = (file: string) => new URL(file, base).href;
  const progress = opts.onProgress ?? (() => {});

  progress(0, "game.json");
  const manifest = (await (await fetch(url("game.json"))).json()) as GameManifest;
  if (manifest.format !== "brik-game") throw new Error("Brik: game.json is not a Brik game");
  document.title = manifest.title;

  // scripts import "brik"; the bundle reads it from this global
  (globalThis as Record<string, unknown>).__brik = runtime;

  const steps = manifest.pages.length + manifest.sounds.length + 3;
  let done = 0;
  const step = (label: string) => progress(++done / steps, label);

  await initPhysics();
  step("fysik");

  const app = createGame({ canvas: opts.canvas, physics: manifest.physics });
  const world = app.world;
  const assets = world.resource(Assets);

  const pages = await Promise.all(
    manifest.pages.map(async (p) => {
      const img = await loadImage(url(p.file));
      step(p.file);
      return img;
    }),
  );
  for (const t of manifest.textures) {
    const page = manifest.pages[t.page];
    const tex = assets.addTexture(pages[t.page], {
      guid: t.guid,
      name: t.name,
      settings: { filter: page.filter, wrap: page.wrap, pixelsPerUnit: t.pixelsPerUnit },
    });
    tex.region = { x: t.region[0], y: t.region[1], w: t.region[2], h: t.region[3] };
    for (const s of t.sprites) {
      assets.defineSprite(tex, {
        id: s.id,
        name: s.name,
        rect: { x: s.rect[0], y: s.rect[1], w: s.rect[2], h: s.rect[3] },
        pivot: { x: s.pivot[0], y: s.pivot[1] },
        border: s.border ? { l: s.border[0], b: s.border[1], r: s.border[2], t: s.border[3] } : undefined,
      });
    }
  }
  for (const c of manifest.clips) assets.addClip(c);
  for (const p of manifest.prefabs) assets.addPrefab({ guid: p.guid, name: p.name, data: { version: 1, entities: p.entities } });

  const audio = world.resource(Audio);
  await Promise.all(
    manifest.sounds.map(async (s) => {
      const bytes = new Uint8Array(await (await fetch(url(s.file))).arrayBuffer());
      audio.addClip(s.guid, s.name, bytes);
      step(s.file);
    }),
  );

  const registry = new ScriptRegistry();
  if (manifest.scripts) {
    const mod = (await import(/* @vite-ignore */ url(manifest.scripts))) as { modules: Record<string, Record<string, unknown>> };
    registry.load(mod.modules);
  }
  step("scripts");
  app.addPlugin(ScriptsPlugin(registry));
  app.addPlugin(
    ScenesPlugin((path) => {
      const scene = manifest.scenes[path];
      if (!scene) throw new Error(`Brik: no scene "${path}" in this game`);
      return scene;
    }, manifest.startScene),
  );

  const start = manifest.scenes[manifest.startScene];
  if (!start) throw new Error(`Brik: start scene "${manifest.startScene}" is missing`);
  loadScene(world, start);
  step("scene");
  app.start();
  return app;
}
