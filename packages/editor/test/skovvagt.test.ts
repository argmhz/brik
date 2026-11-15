import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { Particles, TileMap, Transform2D, UIRect, UIText, findBySceneId, initPhysics } from "@brik/runtime";
import * as esbuild from "esbuild-wasm";
import { beforeAll, describe, expect, it } from "vitest";
import { Editor, MemoryFS, createBridgeHandlers } from "../src";

/*
 * The example game in examples/skovvagt (top-down: a large tilemap, shrooms
 * with health bars in the world, sword sparks that bounce off trees, crystals),
 * played through the AI bridge. It exercises the engine round: query.changed on
 * a list changed in place, contact normals, world-space UI, particle collision
 * and tile chunks.
 */

const ROOT = join(__dirname, "../../../examples/skovvagt");
const fakeDecode = async () => ({ width: 96, height: 16 }) as unknown as HTMLCanvasElement;
let loads = 0;
const importCode = (code: string) =>
  import(/* @vite-ignore */ `data:text/javascript;charset=utf-8,${encodeURIComponent(`${code}\n//${loads++}`)}`);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (name.startsWith(".")) return [];
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

async function open() {
  const fs = new MemoryFS("skovvagt");
  for (const f of files(ROOT)) await fs.writeFile(relative(ROOT, f), new Uint8Array(readFileSync(f)));
  const editor = await Editor.open(fs, { decode: fakeDecode, esbuild: async () => esbuild, importCode });
  return { editor, h: createBridgeHandlers(editor) };
}

const text = (editor: Editor, name: string) => {
  const e = [...editor.world.query([UIText])].find((x) => editor.entityName(x) === name);
  return e === undefined ? undefined : editor.world.store(UIText).text[e];
};

const HERO = "d4ac4003f045de06";
const SHROOM = "eccf9f79e3bf3acd";
const FILL = "eccf9f79e3bf3acd/af248b0da8df0240";

/** Puts the hero at (x, y) and the first shroom `gap` units to its right, then starts the game. */
async function duel(gap: number) {
  const { editor, h } = await open();
  await h.set_fields({ id: HERO, component: "Transform2D", values: { position: { x: 1300, y: 792 } } });
  await h.set_fields({ id: SHROOM, component: "Transform2D", values: { position: { x: 1300 + gap, y: 792 } } });
  await h.play({});
  const pos = (id: string) => {
    const e = findBySceneId(editor.world, id);
    const T = editor.world.store(Transform2D).position;
    return e < 0 ? null : { x: T.x[e], y: T.y[e] };
  };
  return { editor, h, pos };
}

beforeAll(async () => {
  await initPhysics();
});

describe("Skovvagt example", () => {
  it("compiles and starts with five hearts and no crystals", async () => {
    const { editor, h } = await open();
    expect(editor.scripts.status).toBe("ok");
    await h.play({});
    await h.step({ frames: 3 });
    expect(text(editor, "LivTekst")).toBe("Liv: ♥♥♥♥♥");
    expect(text(editor, "KrystalTekst")).toBe("Krystaller: 0/6");
    await h.stop({});
  });

  it("a shroom touching the hero from the right hurts and pushes it to the left", async () => {
    const { editor, h, pos } = await duel(40);
    await h.step({ frames: 90 }); // the shroom walks in (35 units/s)
    expect(text(editor, "LivTekst")).toBe("Liv: ♥♥♥♥");
    expect(pos(HERO)!.x).toBeLessThan(1290);
    expect(Math.abs(pos(HERO)!.y - 792)).toBeLessThan(1);
    await h.stop({});
  });

  it("three sword hits kill a shroom, its health bar follows, and its crystal fills the bag", async () => {
    const { editor, h, pos } = await duel(60);
    await h.step({ frames: 2, hold: ["ArrowRight"] }); // face right
    const fill = () => editor.world.store(UIRect).anchorMax.x[findBySceneId(editor.world, FILL)];
    expect(fill()).toBe(1);
    let swings = 0;
    for (let f = 0; f < 240 && pos(SHROOM); f++) {
      const d = pos(SHROOM)!.x - pos(HERO)!.x;
      if (d < 26) {
        await h.step({ frames: 20, press: ["Space"] });
        swings++;
        if (swings === 1) {
          expect(fill()).toBeCloseTo(2 / 3);
          // sparks fly, and the ones that reach a tree bounce off it
          expect(editor.world.resource(Particles).pools.size).toBeGreaterThan(0);
        }
      } else await h.step({ frames: 1 });
    }
    expect(pos(SHROOM)).toBeNull();
    expect(swings).toBe(3);
    expect(text(editor, "LivTekst")).toBe("Liv: ♥♥♥♥♥");
    // the crystal it dropped is picked up by walking over it
    await h.step({ frames: 30, hold: ["ArrowRight"] });
    expect(text(editor, "KrystalTekst")).toBe("Krystaller: 1/6");
    await h.stop({});
  });

  it("saves its 19,000 tiles as rows of characters and reads them back", async () => {
    const { editor, h } = await open();
    const count = (name: string) => {
      const e = [...editor.world.query([TileMap])].find((x) => editor.entityName(x) === name)!;
      return Object.keys(editor.world.store(TileMap).tiles[e]).length;
    };
    expect(count("Jord")).toBe(16000);
    await editor.saveScene("scenes/copy");
    const text = await editor.fs.readText("scenes/copy.scene.json");
    expect(text).toContain('"$grid"');
    expect(text.length).toBeLessThan(100_000);
    await editor.openScene("scenes/copy.scene.json");
    expect(count("Jord")).toBe(16000);
    expect(count("Skov")).toBe(2977);
    // a tile map in a prefab is read back the same way, so the instance has no overrides
    const [forest] = (await h.find_entities({ name: "Skov" })) as { id: string }[];
    const made = (await h.create_prefab({ id: forest.id })) as { path: string };
    expect(await editor.fs.readText(made.path)).toContain('"$grid"');
    await editor.saveScene("scenes/main");
    // open the project again, so the prefab is read from its file
    const again = await Editor.open(editor.fs, { decode: fakeDecode, esbuild: async () => esbuild, importCode });
    const h2 = createBridgeHandlers(again);
    const info = (await h2.inspect_entity({ id: forest.id })) as { prefab: { overrides: unknown[] } };
    expect(info.prefab.overrides).toEqual([]);
    const placed = (await h2.place_prefab({ prefab: "Skov", x: 0, y: 0 })) as { id: string };
    expect(again.world.store(TileMap).tiles[findBySceneId(again.world, placed.id)]["0,0"]).toBe("tree");
  });
});
