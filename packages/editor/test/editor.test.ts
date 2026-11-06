import { readFileSync } from "node:fs";
import {
  Name,
  Sprite,
  Transform2D,
  childrenOf,
  findBySceneId,
  parentOf,
  serializeScene,
  sliceSprites,
} from "@brik/runtime";
import { describe, expect, it } from "vitest";
import {
  Editor,
  History,
  MemoryFS,
  PROJECT_AI_GUIDE,
  RECOVERY_PATH,
  createProject,
  exportZip,
  importZip,
  reparent,
  setValues,
  walk,
  worldMatrix,
} from "../src";

const fakeDecode = async () => ({ width: 32, height: 16 }) as unknown as HTMLCanvasElement;

async function newEditor() {
  const fs = new MemoryFS("test");
  await createProject(fs, "Test", { "assets/hero.png": new Uint8Array([1, 2, 3]) });
  const editor = await Editor.open(fs, { decode: fakeDecode });
  return { fs, editor };
}

describe("MemoryFS and zip", () => {
  it("lists, reads, writes and removes", async () => {
    const fs = new MemoryFS();
    await fs.writeFile("a/b/c.txt", "hej");
    expect(await fs.readText("a/b/c.txt")).toBe("hej");
    expect((await fs.list("a")).map((e) => [e.name, e.kind])).toEqual([["b", "directory"]]);
    expect(await walk(fs)).toEqual(["a/b/c.txt"]);
    await fs.remove("a");
    expect(await fs.exists("a/b/c.txt")).toBe(false);
  });

  it("round-trips a project through a zip and strips a single top folder", async () => {
    const fs = new MemoryFS();
    await createProject(fs, "Zip");
    const zip = await exportZip(fs);
    const target = new MemoryFS();
    await importZip(target, zip);
    expect((await walk(target)).sort()).toEqual((await walk(fs)).sort());

    // a zip whose files all sit in "Zip/" is unpacked without that folder
    const { zipSync } = await import("fflate");
    const nested = zipSync({ "Zip/brik.project.json": new TextEncoder().encode("{}") });
    const t2 = new MemoryFS();
    await importZip(t2, nested);
    expect(await walk(t2)).toEqual(["brik.project.json"]);
  });
});

describe("History", () => {
  it("undoes, redoes and merges quick edits with the same key", () => {
    let t = 0;
    const h = new History(100, 500, () => t);
    let value = 0;
    const set = (to: number, from: number, mergeKey?: string) => ({
      label: "set",
      mergeKey,
      do: () => (value = to),
      undo: () => (value = from),
    });
    h.execute(set(1, 0, "x"));
    t = 100;
    h.execute(set(2, 1, "x"));
    t = 2000;
    h.execute(set(3, 2, "x")); // too late, new step
    expect(value).toBe(3);
    h.undo();
    expect(value).toBe(2);
    h.undo();
    expect(value).toBe(0); // the two merged edits undo together
    expect(h.canUndo).toBe(false);
    h.redo();
    expect(value).toBe(2);
  });

  it("tracks unsaved changes", () => {
    const h = new History();
    expect(h.dirty).toBe(false);
    h.execute({ label: "a", do() {}, undo() {} });
    expect(h.dirty).toBe(true);
    h.markSaved();
    expect(h.dirty).toBe(false);
    h.undo();
    expect(h.dirty).toBe(true);
  });
});

describe("Editor", () => {
  it("opens a new project with its start scene and imports images", async () => {
    const { fs, editor } = await newEditor();
    expect(editor.scenePath).toBe("scenes/main.scene.json");
    expect([...editor.world.query([Name])].map((e) => editor.entityName(e))).toEqual(["Main Camera"]);
    expect(editor.db.textures.has("assets/hero.png")).toBe(true);
    expect(await fs.exists("assets/hero.png.meta.json")).toBe(true);
    expect(editor.dirty).toBe(false);
  });

  it("creates, undoes and redoes entities with the same id", async () => {
    const { editor } = await newEditor();
    const id = editor.createEntity("sprite", { name: "Hero", x: 5 });
    expect(editor.selection).toEqual([id]);
    expect(editor.dirty).toBe(true);
    editor.undo();
    expect(findBySceneId(editor.world, id)).toBe(-1);
    expect(editor.selection).toEqual([]);
    editor.redo();
    const e = findBySceneId(editor.world, id);
    expect(editor.world.store(Transform2D).position.x[e]).toBe(5);
    expect(editor.world.has(e, Sprite)).toBe(true);
  });

  it("deletes a subtree and restores it at the same sibling index", async () => {
    const { editor } = await newEditor();
    const w = editor.world;
    const parent = editor.createEntity("empty", { name: "P" });
    const a = editor.createEntity("empty", { name: "A", parentId: parent });
    const b = editor.createEntity("empty", { name: "B", parentId: parent });
    const c = editor.createEntity("empty", { name: "C", parentId: b });
    editor.select([b]);
    editor.deleteSelection();
    expect(findBySceneId(w, c)).toBe(-1);
    editor.undo();
    const pe = findBySceneId(w, parent);
    expect(childrenOf(w, pe).map((e) => editor.entityName(e))).toEqual(["A", "B"]);
    expect(parentOf(w, findBySceneId(w, c))).toBe(findBySceneId(w, b));
    void a;
  });

  it("duplicates the selection with new ids", async () => {
    const { editor } = await newEditor();
    const a = editor.createEntity("empty", { name: "A" });
    editor.createEntity("empty", { name: "child", parentId: a });
    editor.select([a]);
    editor.duplicateSelection();
    const [copy] = editor.selection;
    expect(copy).not.toBe(a);
    const ce = findBySceneId(editor.world, copy);
    expect(editor.entityName(ce)).toBe("A");
    expect(childrenOf(editor.world, ce)).toHaveLength(1);
  });

  it("reparents while keeping the world position", async () => {
    const { editor } = await newEditor();
    const w = editor.world;
    const p = editor.createEntity("empty", { name: "P", x: 100 });
    editor.execute(
      setValues(w, "rot", [{ id: p, component: "Transform2D", before: { rotation: 0 }, after: { rotation: Math.PI / 2 } }]),
    );
    const c = editor.createEntity("empty", { name: "C", x: 10, y: 0 });
    editor.execute(reparent(w, [c], p)!);
    const ce = findBySceneId(w, c);
    const m = worldMatrix(w, ce);
    expect(m.tx).toBeCloseTo(10);
    expect(m.ty).toBeCloseTo(0);
    // a parent can't be moved into its own child
    expect(reparent(w, [p], c)).toBeNull();
    editor.undo();
    expect(parentOf(w, ce)).toBe(-1);
    expect(w.store(Transform2D).position.x[ce]).toBeCloseTo(10);
  });

  it("saves the scene and reloads the same data", async () => {
    const { fs, editor } = await newEditor();
    editor.createEntity("empty", { name: "Saved", x: 3 });
    const before = serializeScene(editor.world);
    await editor.saveScene();
    expect(editor.dirty).toBe(false);
    await editor.openScene("scenes/main.scene.json");
    expect(serializeScene(editor.world)).toEqual(before);
    expect(JSON.parse(await fs.readText("scenes/main.scene.json")).version).toBe(1);
  });

  it("re-slices a texture through its meta file and keeps sprite refs", async () => {
    const { fs, editor } = await newEditor();
    const entry = editor.db.textures.get("assets/hero.png")!;
    const slicing = { mode: "grid", cell: [16, 16], offset: [0, 0], spacing: [0, 0], pivot: [0.5, 0] } as const;
    const meta = {
      ...entry.meta,
      slicing: { ...slicing, cell: [16, 16] as [number, number], offset: [0, 0] as [number, number], spacing: [0, 0] as [number, number], pivot: [0.5, 0] as [number, number] },
      sprites: sliceSprites(
        { mode: "grid", cell: [16, 16], offset: [0, 0], spacing: [0, 0], pivot: [0.5, 0] },
        32,
        16,
        "hero",
      ),
    };
    await editor.db.saveMeta("assets/hero.png", meta);
    expect(editor.assets.sprite("hero_1")).toEqual({ texture: entry.meta.guid, id: "cell_1" });
    expect(JSON.parse(await fs.readText("assets/hero.png.meta.json")).sprites).toHaveLength(2);

    // a fresh editor on the same files gets the same guid
    const again = await Editor.open(fs, { decode: fakeDecode });
    expect(again.db.textures.get("assets/hero.png")!.meta.guid).toBe(entry.meta.guid);
  });
});

describe("autosave and recovery", () => {
  it("keeps unsaved changes in .brik and offers them when the project is opened again", async () => {
    const { fs, editor } = await newEditor();
    const scene = editor.scenePath;
    const before = await fs.readText(scene!);
    editor.createEntity("sprite", { name: "Unsaved" });
    await editor.autosave.flush();
    // the scene file itself is untouched
    expect(await fs.readText(scene!)).toBe(before);
    expect(await fs.exists(RECOVERY_PATH)).toBe(true);
    editor.dispose();

    // "the page was reloaded"
    const again = await Editor.open(fs, { decode: fakeDecode });
    expect(again.recovery?.scenePath).toBe(scene);
    // nothing is thrown away before the user has chosen
    await again.autosave.flush();
    expect(await fs.exists(RECOVERY_PATH)).toBe(true);
    again.restoreRecovery();
    const names = () => serializeScene(again.world).entities.map((e) => e.components.Name?.value);
    expect(names()).toContain("Unsaved");
    expect(again.dirty).toBe(true);
    expect(again.scenePath).toBe(scene);

    // saving removes the copy
    await again.saveScene();
    await again.autosave.flush();
    expect(again.dirty).toBe(false);
    expect(await fs.exists(RECOVERY_PATH)).toBe(false);
  });

  it("discarding removes the copy, and undoing back to the saved state does too", async () => {
    const { fs, editor } = await newEditor();
    editor.createEntity("empty", { name: "X" });
    await editor.autosave.flush();
    editor.dispose();
    const again = await Editor.open(fs, { decode: fakeDecode });
    await again.discardRecovery();
    expect(again.recovery).toBeNull();
    expect(await fs.exists(RECOVERY_PATH)).toBe(false);

    again.createEntity("empty", { name: "Y" });
    await again.autosave.flush();
    expect(await fs.exists(RECOVERY_PATH)).toBe(true);
    again.history.undo();
    await again.autosave.flush();
    expect(await fs.exists(RECOVERY_PATH)).toBe(false);
  });
});

describe("CLAUDE.md", () => {
  it("is written into new projects, and Mosehop's copy matches it", async () => {
    const { fs } = await newEditor();
    expect(await fs.readText("CLAUDE.md")).toBe(PROJECT_AI_GUIDE);
    expect(PROJECT_AI_GUIDE).toMatch(/moveCharacter/);
    const mosehop = readFileSync(new URL("../../../examples/mosehop/CLAUDE.md", import.meta.url), "utf8");
    expect(mosehop).toBe(PROJECT_AI_GUIDE);
  });
});
