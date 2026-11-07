import * as runtime from "@brik/runtime";
import { App, Assets, GamePlugins, type GameManifest, ScriptRegistry, ScriptsPlugin, Transform2D, findBySceneId, loadScene } from "@brik/runtime";
import * as esbuild from "esbuild-wasm";
import { describe, expect, it } from "vitest";
import { DEFAULT_BUILD, Editor, MemoryFS, createPrefab, createProject, exportGame, planAtlas, stripEditorOnly } from "../src";
import { encodePng } from "../src/core/png";
import { imageSize } from "../src/headless";

const fakeDecode = async (bytes: Uint8Array) =>
  // sizes encoded in the fake "image": first two bytes
  ({ width: bytes[0] ?? 8, height: bytes[1] ?? 8 }) as unknown as HTMLCanvasElement;
const importCode = (code: string) => import(/* @vite-ignore */ `data:text/javascript;charset=utf-8,${encodeURIComponent(code)}`);

async function project() {
  const fs = new MemoryFS("Spil");
  await createProject(fs, "Mit Spil", {
    "assets/a.png": new Uint8Array([32, 16]),
    "assets/b.png": new Uint8Array([20, 20]),
    "assets/bg.png": new Uint8Array([64, 64]),
    "assets/jump.wav": new Uint8Array([1, 2, 3, 4]),
    "scripts/Mover.ts": `import { Behaviour, expose } from "brik";
export class Mover extends Behaviour {
  @expose speed = 10;
  onUpdate(dt: number) { this.transform.position.x += this.speed * dt; }
}
`,
  });
  const editor = await Editor.open(fs, { decode: fakeDecode as never, esbuild: async () => esbuild, importCode });
  // background repeats, so it can't go on an atlas page
  const bg = editor.db.textures.get("assets/bg.png")!;
  await editor.db.saveMeta("assets/bg.png", { ...bg.meta, settings: { ...bg.meta.settings, wrap: "repeat" } });
  return { fs, editor };
}

describe("export", () => {
  it("plans atlas pages: packed by filter, repeat textures on their own", async () => {
    const { editor } = await project();
    const plan = await planAtlas(editor, { atlas: true, pack: { maxSize: 256, padding: 2, extrude: 1, pot: false } });
    const packed = plan.pages.filter((p) => !p.standalone);
    expect(packed).toHaveLength(1);
    expect(packed[0].placements.map((p) => p.entry.path).sort()).toEqual(["assets/a.png", "assets/b.png"]);
    expect(plan.pages.find((p) => p.standalone)?.wrap).toBe("repeat");
  });

  it("strips EditorOnly entities and their children", () => {
    const out = stripEditorOnly([
      { id: "a", components: { EditorOnly: {} } },
      { id: "b", components: { Parent: { entity: "a" } } },
      { id: "c", components: {} },
    ]);
    expect(out.map((d) => d.id)).toEqual(["c"]);
  });

  it("writes a complete static game that the runtime can load", async () => {
    const { editor } = await project();
    const id = editor.createEntity("sprite", { name: "Hero", sprite: { texture: editor.db.textures.get("assets/a.png")!.meta.guid, id: "" } });
    editor.execute({
      label: "script",
      do: () => editor.world.add(findBySceneId(editor.world, id), runtime.Scripts, { list: [{ script: "scripts/Mover.ts#Mover", props: { speed: 60 } }] }),
      undo: () => {},
    });
    editor.createEntity("empty", { name: "Marker", extra: { EditorOnly: {} } });
    await createPrefab(editor, editor.createEntity("circle", { name: "Ball" }));
    await editor.saveScene("scenes/main.scene.json");

    const drawn: number[] = [];
    const result = await exportGame(
      editor,
      {
        esbuild,
        playerFiles: { "brik.js": "/* player */", "brik-physics.js": "/* rapier */" },
        drawPage: async (page) => {
          drawn.push(page.placements.length);
          return new Uint8Array([9]);
        },
      },
      { title: "Hop & løb", atlas: true, pack: { maxSize: 256, padding: 2, extrude: 1, pot: false } },
    );
    const f = result.files;
    expect(Object.keys(f).sort()).toEqual(
      [
        "brik.js",
        "brik-physics.js",
        "game.js",
        "game.json",
        "icons/icon-192.png",
        "icons/icon-512.png",
        "images/assets_bg.png",
        "images/atlas_1.png",
        "index.html",
        "manifest.webmanifest",
        "sounds/assets_jump.wav",
        "sw.js",
      ].sort(),
    );
    expect(drawn).toEqual([2]);
    const html = new TextDecoder().decode(f["index.html"]);
    expect(html).toContain("<title>Hop &amp; løb</title>");
    expect(html).toContain('src="brik.js"');

    const m = JSON.parse(new TextDecoder().decode(f["game.json"])) as GameManifest;
    expect(m.startScene).toBe("scenes/main.scene.json");
    // no colliders or bodies: the player won't fetch brik-physics.js
    expect(m.usesPhysics).toBe(false);
    expect(m.textures).toHaveLength(3);
    expect(m.sounds[0]).toMatchObject({ name: "jump", file: "sounds/assets_jump.wav" });
    expect(m.prefabs.map((p) => p.name)).toEqual(["Ball"]);
    const names = m.scenes["scenes/main.scene.json"].entities.map((e) => e.components.Name?.value);
    expect(names).toContain("Hero");
    expect(names).not.toContain("Marker");
    // minified, with no source map
    const js = new TextDecoder().decode(f["game.js"]);
    expect(js).not.toContain("sourceMappingURL");
    expect(result.report[0].bytes).toBeGreaterThanOrEqual(result.report.at(-1)!.bytes);

    // load it like the player does: scripts, textures as atlas regions, the scene
    (globalThis as Record<string, unknown>).__brik = runtime;
    const mod = (await importCode(js)) as { modules: Record<string, Record<string, unknown>> };
    const registry = new ScriptRegistry();
    registry.load(mod.modules);
    const app = new App().addPlugin(GamePlugins()).addPlugin(ScriptsPlugin(registry));
    const assets = app.world.resource(Assets);
    const a = m.textures.find((t) => t.name === "a")!;
    const tex = assets.addTexture({ width: 256, height: 256 } as never, { guid: a.guid, name: a.name });
    tex.region = { x: a.region[0], y: a.region[1], w: a.region[2], h: a.region[3] };
    const r = assets.resolve({ texture: a.guid, id: "" })!;
    expect(r.width).toBe(32);
    expect(r.u0).toBeCloseTo(a.region[0] / 256);
    loadScene(app.world, m.scenes[m.startScene]);
    const hero = app.world.query([runtime.Name]).toArray().find((e) => app.world.store(runtime.Name).value[e] === "Hero")!;
    for (let i = 0; i < 30; i++) app.update(1 / 60);
    expect(app.world.store(Transform2D).position.x[hero]).toBeCloseTo(30, 0);
  });

  it("flags games that use physics, so the player loads Rapier before starting", async () => {
    const { editor } = await project();
    editor.createEntity("rect", { name: "Floor", extra: { Collider2D: {} } });
    await editor.saveScene("scenes/main.scene.json");
    const result = await exportGame(editor, { esbuild, playerFiles: { "brik.js": "", "brik-physics.js": "" }, drawPage: async () => new Uint8Array([9]) });
    const m = JSON.parse(new TextDecoder().decode(result.files["game.json"])) as GameManifest;
    expect(m.usesPhysics).toBe(true);
  });

  it("makes the game installable and playable offline: manifest, icons and a service worker", async () => {
    const { editor } = await project();
    await editor.saveScene("scenes/main.scene.json");
    const deps = { esbuild, playerFiles: { "brik.js": "/* player */", "brik-physics.js": "/* rapier */" }, drawPage: async () => new Uint8Array([9]) };
    const result = await exportGame(editor, deps, { atlas: true, pack: { maxSize: 256, padding: 2, extrude: 1, pot: false } });
    const text = (path: string) => new TextDecoder().decode(result.files[path]);

    const html = text("index.html");
    expect(html).toContain('rel="manifest" href="manifest.webmanifest"');
    // the page's own icon, so the browser doesn't ask for /favicon.ico (a 404 on most hosts)
    expect(html).toContain('rel="icon" href="icons/icon-192.png"');
    expect(html).toContain('navigator.serviceWorker.register("sw.js")');
    const manifest = JSON.parse(text("manifest.webmanifest")) as { name: string; start_url: string; icons: { src: string; sizes: string }[] };
    expect(manifest.name).toBe("Mit Spil");
    expect(manifest.start_url).toBe(".");
    expect(manifest.icons.map((i) => i.sizes)).toEqual(["192x192", "512x512"]);
    // the icons are real PNGs of the stated sizes
    expect(imageSize(result.files["icons/icon-512.png"])).toEqual({ width: 512, height: 512 });
    expect(imageSize(result.files["icons/icon-192.png"])).toEqual({ width: 192, height: 192 });

    // the game uses no physics: the big engine file is saved when first fetched, not up front
    const sw = text("sw.js");
    const precache = JSON.parse(/const FILES = (\[.*\]);/.exec(sw)![1]) as string[];
    expect(precache).toEqual(expect.arrayContaining(["./", "index.html", "brik.js", "game.json", "manifest.webmanifest", "icons/icon-512.png"]));
    expect(precache).not.toContain("brik-physics.js");
    expect(precache).not.toContain("sw.js");

    // run the worker in a made-up browser: it installs the files, serves from the cache, drops old caches
    const stores = new Map<string, Map<string, string>>([["brik:https://x.test/g/:old", new Map()]]);
    const added: string[][] = [];
    const listeners: Record<string, (e: any) => void> = {};
    const net: string[] = [];
    const sandbox: Record<string, unknown> = {
      self: {
        registration: { scope: "https://x.test/g/" },
        location: { origin: "https://x.test" },
        skipWaiting: async () => {},
        clients: { claim: async () => {} },
        addEventListener: (type: string, fn: (e: any) => void) => (listeners[type] = fn),
      },
      caches: {
        open: async (name: string) => {
          if (!stores.has(name)) stores.set(name, new Map());
          return {
            addAll: async (files: string[]) => void added.push(files),
            put: async (req: { url: string }, res: string) => void stores.get(name)!.set(req.url, res),
          };
        },
        keys: async () => [...stores.keys()],
        delete: async (k: string) => stores.delete(k),
        match: async (req: { url: string }, o: { cacheName: string }) => stores.get(o.cacheName)?.get(req.url),
      },
      fetch: async (req: { url: string }) => {
        net.push(req.url);
        return { ok: true, clone: () => "copy", url: req.url };
      },
      URL,
    };
    new Function(...Object.keys(sandbox), sw)(...Object.values(sandbox));
    let waited: Promise<unknown> = Promise.resolve();
    listeners.install({ waitUntil: (p: Promise<unknown>) => (waited = p) });
    await waited;
    expect(added[0]).toEqual(precache);
    listeners.activate({ waitUntil: (p: Promise<unknown>) => (waited = p) });
    await waited;
    expect([...stores.keys()]).toEqual([expect.stringMatching(/^brik:https:\/\/x\.test\/g\/:[0-9a-f]{8}$/)]);
    // a file that wasn't cached goes to the network once and is then kept
    const request = { method: "GET", url: "https://x.test/g/brik-physics.js" };
    let answer: Promise<unknown> | undefined;
    listeners.fetch({ request, respondWith: (p: Promise<unknown>) => (answer = p) });
    await answer;
    await new Promise((r) => setTimeout(r, 0));
    expect(net).toEqual([request.url]);
    listeners.fetch({ request, respondWith: (p: Promise<unknown>) => (answer = p) });
    expect(await answer).toBe("copy");
    expect(net).toHaveLength(1);
    // other sites' and non-GET requests are left alone
    let touched = false;
    listeners.fetch({ request: { method: "POST", url: request.url }, respondWith: () => (touched = true) });
    listeners.fetch({ request: { method: "GET", url: "https://cdn.test/a.js" }, respondWith: () => (touched = true) });
    expect(touched).toBe(false);

    // the version follows the content: a changed script means a new cache
    await editor.fs.writeFile("scripts/Mover.ts", "export const x = 1;\n");
    const again = await exportGame(editor, deps, { atlas: true, pack: { maxSize: 256, padding: 2, extrude: 1, pot: false } });
    const version = (code: string) => /const VERSION = "([0-9a-f]+)"/.exec(code)![1];
    expect(version(new TextDecoder().decode(again.files["sw.js"]))).not.toBe(version(sw));
  });

  it("uses the project's own icon.png, and can be switched off", async () => {
    const { fs, editor } = await project();
    await editor.saveScene("scenes/main.scene.json");
    const deps = { esbuild, playerFiles: { "brik.js": "", "brik-physics.js": "" }, drawPage: async () => new Uint8Array([9]) };
    await fs.writeFile("icon.png", encodePng(256, 256, new Uint8Array(256 * 256 * 4)));
    const own = await exportGame(editor, deps, DEFAULT_BUILD);
    const manifest = JSON.parse(new TextDecoder().decode(own.files["manifest.webmanifest"])) as { icons: { src: string; sizes: string }[] };
    expect(manifest.icons).toEqual([{ src: "icons/icon.png", sizes: "256x256", type: "image/png", purpose: "any" }]);
    expect(imageSize(own.files["icons/icon.png"])).toEqual({ width: 256, height: 256 });

    const off = await exportGame(editor, deps, { ...DEFAULT_BUILD, pwa: false });
    for (const f of ["sw.js", "manifest.webmanifest", "icons/icon-192.png"]) expect(off.files[f]).toBeUndefined();
    const html = new TextDecoder().decode(off.files["index.html"]);
    expect(html).not.toContain("serviceWorker");
    expect(html).not.toContain("manifest");
    // no icon file, but still no request for /favicon.ico
    expect(html).toContain('rel="icon" href="data:,"');
  });

  it("refuses to export when scripts don't compile", async () => {
    const { fs, editor } = await project();
    await fs.writeFile("scripts/Bad.ts", "export const x = ;");
    await editor.saveScene("scenes/main.scene.json");
    await expect(exportGame(editor, { esbuild, playerFiles: {}, drawPage: async () => new Uint8Array() })).rejects.toThrow(/Scripts har fejl/);
  });
});
