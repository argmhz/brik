import { Assets, PrefabInstance, TileMap, TileMapCollider, Collider2D, spawnPrefab, App, GamePlugins } from "@brik/runtime";
import { zlibSync } from "fflate";
import { describe, expect, it } from "vitest";
import { Editor, MemoryFS, createProject, decodeTiledData, detectJson, importSpriteSheet, importTiledMap, tilesetSprites } from "../src";

const enc = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));
const fakeDecode = async () => ({ width: 64, height: 32 }) as unknown as HTMLCanvasElement;

const aseprite = {
  frames: [
    { filename: "hero 0.aseprite", frame: { x: 0, y: 0, w: 16, h: 16 }, duration: 100 },
    { filename: "hero 1.aseprite", frame: { x: 16, y: 0, w: 16, h: 16 }, duration: 150 },
    { filename: "hero 2.aseprite", frame: { x: 32, y: 0, w: 16, h: 16 }, duration: 100 },
    { filename: "hero 3.aseprite", frame: { x: 48, y: 0, w: 16, h: 16 }, duration: 100 },
  ],
  meta: {
    app: "https://www.aseprite.org/",
    image: "hero.png",
    frameTags: [
      { name: "idle", from: 0, to: 0, direction: "forward" },
      { name: "run", from: 1, to: 3, direction: "pingpong" },
    ],
    slices: [{ name: "feet", keys: [{ frame: 0, bounds: { x: 0, y: 0, w: 16, h: 16 }, pivot: { x: 8, y: 16 } }] }],
  },
};

const tiledMap = {
  type: "map",
  width: 4,
  height: 3,
  tilewidth: 16,
  tileheight: 16,
  tilesets: [{ firstgid: 1, source: "dungeon.tsj" }],
  layers: [
    { type: "tilelayer", name: "Ground", width: 4, height: 3, data: [0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 2, 3] },
    { type: "tilelayer", name: "Deco", width: 4, height: 3, encoding: "csv", data: "0,5,0,0,0,0,0,0,0,0,0,0" },
    { type: "objectgroup", name: "Objects", objects: [{ name: "Spawn", x: 8, y: 8, point: true }, { name: "Exit", class: "trigger", x: 48, y: 16, width: 16, height: 16 }] },
  ],
};
const tileset = { type: "tileset", name: "dungeon", image: "dungeon.png", imagewidth: 64, imageheight: 32, tilewidth: 16, tileheight: 16, columns: 4, tilecount: 8, margin: 0, spacing: 0 };

describe("importers", () => {
  it("detects tool files", () => {
    expect(detectJson(aseprite)).toBe("aseprite");
    expect(detectJson({ frames: {}, meta: { app: "https://www.codeandweb.com/texturepacker" } })).toBe("texturepacker");
    expect(detectJson(tiledMap)).toBe("tiled-map");
    expect(detectJson(tileset)).toBe("tiled-tileset");
    expect(detectJson({ guid: "x" })).toBeNull();
  });

  it("reads Aseprite frames, tags (as clips) and slice pivots", () => {
    const r = importSpriteSheet(aseprite, "hero");
    expect(r.sprites.map((s) => s.name)).toEqual(["hero 0", "hero 1", "hero 2", "hero 3"]);
    expect(r.sprites[0].pivot).toEqual({ x: 0.5, y: 0 }); // feet slice: bottom center
    expect(r.clips.map((c) => [c.name, c.mode, c.frames.length])).toEqual([
      ["idle", "loop", 1],
      ["run", "pingpong", 3],
    ]);
    expect(r.clips[1].frames[0]).toEqual({ id: "frame_1", duration: 0.15 });
  });

  it("reads TexturePacker hash frames with trimming and pivots", () => {
    const r = importSpriteSheet(
      {
        frames: {
          "coin.png": { frame: { x: 2, y: 2, w: 10, h: 12 }, trimmed: true, spriteSourceSize: { x: 3, y: 2, w: 10, h: 12 }, sourceSize: { w: 16, h: 16 }, pivot: { x: 0.5, y: 0.5 } },
        },
        meta: { app: "https://www.codeandweb.com/texturepacker", image: "sheet.png" },
      },
      "sheet",
    );
    // the pivot stays at the center of the untrimmed 16x16: (8-3)/10, 1-(8-2)/12
    expect(r.sprites[0].pivot.x).toBeCloseTo(0.5);
    expect(r.sprites[0].pivot.y).toBeCloseTo(0.5);
    expect(r.sprites[0].name).toBe("coin");
    expect(r.image).toBe("sheet.png");
  });

  it("decodes Tiled layer data (array, csv, base64 + zlib)", () => {
    const gids = [1, 0, 2147483651, 7]; // third one is flipped horizontally
    const bytes = new Uint8Array(new Uint32Array(gids).buffer);
    const b64 = btoa(String.fromCharCode(...zlibSync(bytes)));
    expect(decodeTiledData(b64, "base64", "zlib")).toEqual(gids);
    expect(decodeTiledData("1, 0,3", "csv")).toEqual([1, 0, 3]);
  });

  it("turns a Tiled map into tilemap layers (y flipped) and objects", () => {
    const sprites = tilesetSprites(tileset);
    expect(sprites).toHaveLength(8);
    expect(sprites[5].rect).toEqual({ x: 16, y: 16, w: 16, h: 16 });
    const r = importTiledMap(tiledMap as never, "level1", [{ ...tileset, firstgid: 1 }], () => "tex-guid");
    const ground = r.entities.find((e) => e.components.Name.value === "Ground")!;
    // bottom row in Tiled (row 2) is y = 0 here
    expect(ground.components.TileMap.tiles).toEqual({ "0,0": "tile_0", "1,0": "tile_1", "2,0": "tile_1", "3,0": "tile_2" });
    expect(ground.components.TileMapCollider).toBeDefined(); // "Ground" is solid
    const deco = r.entities.find((e) => e.components.Name.value === "Deco")!;
    expect(deco.components.TileMap.tiles).toEqual({ "1,2": "tile_4" });
    expect(deco.components.TileMapCollider).toBeUndefined();
    const exit = r.entities.find((e) => e.components.Name.value === "Exit")!;
    // center of the 16x16 rect at (48,16), y up from the map's bottom (48 px high)
    expect(exit.components.Transform2D.position).toEqual({ x: 56, y: 24 });
    expect(exit.components.Collider2D).toMatchObject({ isTrigger: true });
    expect(r.entities.find((e) => e.components.Name.value === "Spawn")!.components.Collider2D).toBeUndefined();
  });

  it("imports dropped files: Aseprite sheet + clips, Tiled map as a prefab", async () => {
    const fs = new MemoryFS("t");
    await createProject(fs, "T");
    const editor = await Editor.open(fs, { decode: fakeDecode });
    await editor.db.importFiles([
      { name: "hero.png", bytes: new Uint8Array([1]) },
      { name: "hero.json", bytes: enc(aseprite) },
      { name: "dungeon.png", bytes: new Uint8Array([2]) },
      { name: "dungeon.tsj", bytes: enc(tileset) },
      { name: "level1.tmj", bytes: enc(tiledMap) },
    ]);
    expect(editor.db.lastImport.warnings).toEqual([]);
    const hero = editor.db.textures.get("assets/hero.png")!;
    expect(hero.meta.slicing.mode).toBe("manual");
    expect(editor.assets.clip("hero_run")?.frames).toHaveLength(3);
    expect(editor.assets.clip("hero_run")?.frames[0].sprite).toEqual({ texture: hero.meta.guid, id: "frame_1" });
    const prefab = editor.assets.prefab("level1")!;
    expect(prefab).toBeDefined();
    // spawn it in a game: the collider layer works
    const app = new App().addPlugin(GamePlugins());
    app.world.resource(Assets).addPrefab(prefab);
    const root = spawnPrefab(app.world, "level1");
    expect(app.world.has(root, PrefabInstance)).toBe(true);
    expect(app.world.query([TileMap]).count()).toBe(2);
    expect(app.world.query([TileMapCollider]).count()).toBe(1);
    expect(app.world.query([Collider2D]).count()).toBe(1);
    expect(editor.db.textures.get("assets/dungeon.png")!.meta.sprites).toHaveLength(8);
  });

  it("warns when the image for a sheet is missing", async () => {
    const fs = new MemoryFS("t");
    await createProject(fs, "T");
    const editor = await Editor.open(fs, { decode: fakeDecode });
    await editor.db.importFiles([{ name: "hero.json", bytes: enc(aseprite) }]);
    expect(editor.db.lastImport.warnings[0]).toMatch(/hero.png mangler/);
  });
});
