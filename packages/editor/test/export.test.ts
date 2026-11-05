import * as runtime from "@brik/runtime";
import { App, Assets, GamePlugins, type GameManifest, ScriptRegistry, ScriptsPlugin, Transform2D, findBySceneId, loadScene } from "@brik/runtime";
import * as esbuild from "esbuild-wasm";
import { describe, expect, it } from "vitest";
import { Editor, MemoryFS, createPrefab, createProject, exportGame, planAtlas, stripEditorOnly } from "../src";

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
        playerJs: "/* player */",
        drawPage: async (page) => {
          drawn.push(page.placements.length);
          return new Uint8Array([9]);
        },
      },
      { title: "Hop & løb", atlas: true, pack: { maxSize: 256, padding: 2, extrude: 1, pot: false } },
    );
    const f = result.files;
    expect(Object.keys(f).sort()).toEqual(
      ["brik.js", "game.js", "game.json", "images/assets_bg.png", "images/atlas_1.png", "index.html", "sounds/assets_jump.wav"].sort(),
    );
    expect(drawn).toEqual([2]);
    const html = new TextDecoder().decode(f["index.html"]);
    expect(html).toContain("<title>Hop &amp; løb</title>");
    expect(html).toContain('src="brik.js"');

    const m = JSON.parse(new TextDecoder().decode(f["game.json"])) as GameManifest;
    expect(m.startScene).toBe("scenes/main.scene.json");
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

  it("refuses to export when scripts don't compile", async () => {
    const { fs, editor } = await project();
    await fs.writeFile("scripts/Bad.ts", "export const x = ;");
    await editor.saveScene("scenes/main.scene.json");
    await expect(exportGame(editor, { esbuild, playerJs: "", drawPage: async () => new Uint8Array() })).rejects.toThrow(/Scripts har fejl/);
  });
});
