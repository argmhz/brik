import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { UIImage, UIText, findBySceneId, initPhysics } from "@brik/runtime";
import * as esbuild from "esbuild-wasm";
import { beforeAll, describe, expect, it } from "vitest";
import { Editor, MemoryFS, createBridgeHandlers } from "../src";

/*
 * The example game in examples/mosehop, played through the AI bridge: the same
 * way an AI tests a game. Keeps the example working as the engine changes.
 */

const ROOT = join(__dirname, "../../../examples/mosehop");
const fakeDecode = async () => ({ width: 64, height: 16 }) as unknown as HTMLCanvasElement;
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
  const fs = new MemoryFS("mosehop");
  for (const f of files(ROOT)) await fs.writeFile(relative(ROOT, f), new Uint8Array(readFileSync(f)));
  const editor = await Editor.open(fs, { decode: fakeDecode, esbuild: async () => esbuild, importCode });
  return { editor, h: createBridgeHandlers(editor) };
}

const text = (editor: Editor, name: string) => {
  const e = [...editor.world.query([UIText])].find((x) => editor.entityName(x) === name);
  return e === undefined ? undefined : editor.world.store(UIText).text[e];
};

beforeAll(async () => {
  await initPhysics();
});

describe("Mosehop example", () => {
  it("compiles and starts with three lives and no coins", async () => {
    const { editor, h } = await open();
    expect(editor.scripts.status).toBe("ok");
    expect(((await h.list_scripts({})) as { name: string }[]).map((s) => s.name).sort()).toEqual(["Hud", "Player", "RestartButton", "Slime"]);
    await h.play({});
    await h.step({ frames: 5 });
    expect(text(editor, "Score")).toBe("Mønter: 0");
    expect(text(editor, "LevelName")).toBe("Bane 1");
    const hearts = [...editor.world.query([UIImage])].filter((e) => editor.entityName(e).startsWith("Heart"));
    expect(hearts.map((e) => editor.world.store(UIImage).sprite[e]?.id)).toEqual(["heart", "heart", "heart"]);
    await h.stop({});
  });

  it("reaching the flag on level 1 loads level 2 and keeps the coins", async () => {
    const { editor, h } = await open();
    const [player] = (await h.find_entities({ name: "Player" })) as { id: string }[];
    // start just left of the flag, with a coin on the way
    await h.set_fields({ id: player.id, component: "Transform2D", values: { position: { x: 990, y: 24 } } });
    await h.play({});
    await h.step({ frames: 20 });
    await h.step({ frames: 50, hold: ["ArrowRight"] });
    expect(text(editor, "Message")).toBe("Bane klaret!");
    expect(text(editor, "Score")).toBe("Mønter: 1");
    // the step that asks for the next scene also shows it (the file is read in between)
    const r = (await h.step({ frames: 80 })) as { sceneLoaded?: string };
    expect(r.sceneLoaded).toBe("scenes/level2.scene.json");
    expect(text(editor, "LevelName")).toBe("Bane 2");
    expect(text(editor, "Score")).toBe("Mønter: 1");
    await h.stop({});
    expect(findBySceneId(editor.world, player.id)).toBeGreaterThanOrEqual(0);
  });

  it("slimes hurt from the side and can be stomped from above", async () => {
    const { editor, h } = await open();
    const [player] = (await h.find_entities({ name: "Player" })) as { id: string }[];
    await h.set_fields({ id: player.id, component: "Transform2D", values: { position: { x: 1040, y: 24 } } });
    const slimesBefore = ((await h.find_entities({ tag: "enemy" })) as unknown[]).length;
    await h.play({});
    await h.step({ frames: 20 });
    await h.step({ frames: 20, hold: ["ArrowLeft", "Space"] });
    await h.step({ frames: 16, hold: ["ArrowLeft"] });
    await h.step({ frames: 40 });
    expect(((await h.find_entities({ tag: "enemy" })) as unknown[]).length).toBe(slimesBefore - 1);
    const hearts = [...editor.world.query([UIImage])].filter((e) => editor.entityName(e).startsWith("Heart"));
    expect(hearts.map((e) => editor.world.store(UIImage).sprite[e]?.id)).toEqual(["heart", "heart", "heart"]);
    await h.stop({});
  });
});
