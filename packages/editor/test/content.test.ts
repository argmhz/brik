import {
  CameraFollow2D,
  Collider2D,
  Name,
  PrefabInstance,
  RigidBody2D,
  Transform2D,
  childrenOf,
  findBySceneId,
  initPhysics,
  serializeScene,
} from "@brik/runtime";
import { beforeAll, describe, expect, it } from "vitest";
import {
  Editor,
  MemoryFS,
  addComponent,
  applyToPrefab,
  createPrefab,
  createProject,
  placePrefab,
  revertToPrefab,
  setEntityRef,
  setValues,
} from "../src";

const fakeDecode = async () => ({ width: 32, height: 16 }) as unknown as HTMLCanvasElement;

async function newEditor() {
  const fs = new MemoryFS("test");
  await createProject(fs, "Test", { "assets/hero.png": new Uint8Array([1, 2, 3]) });
  const editor = await Editor.open(fs, { decode: fakeDecode });
  return { fs, editor };
}

beforeAll(async () => {
  await initPhysics();
});

describe("prefabs in the editor", () => {
  it("creates a prefab, places instances, applies and reverts", async () => {
    const { fs, editor } = await newEditor();
    const w = editor.world;
    const coin = editor.createEntity("circle", { name: "Coin", x: 50, y: 10 });
    const child = editor.createEntity("text", { name: "Label", parentId: coin });
    const path = await createPrefab(editor, coin);
    expect(path).toBe("prefabs/Coin.prefab.json");
    expect(await fs.exists(path)).toBe(true);
    const e = findBySceneId(w, coin);
    expect(w.has(e, PrefabInstance)).toBe(true);
    // the instance keeps its place; the prefab file has the root at 0,0
    expect(w.store(Transform2D).position.x[e]).toBe(50);
    expect(JSON.parse(await fs.readText(path)).entities[0].components.Transform2D.position).toEqual({ x: 0, y: 0 });
    expect(findBySceneId(w, child)).toBe(-1); // child ids are now derived from the instance id
    expect(childrenOf(w, e)).toHaveLength(1);

    const guid = w.store(PrefabInstance).prefab[e];
    const other = placePrefab(editor, guid, { x: -40, y: 0 })!;
    const o = findBySceneId(w, other);
    expect(w.store(Name).value[o]).toBe("Coin");
    expect(childrenOf(w, o)).toHaveLength(1);

    // edit the first instance and apply: the other one follows, but keeps its position
    editor.execute(addComponent(w, coin, Collider2D));
    const n = await applyToPrefab(editor, coin);
    expect(n).toBe(2);
    const o2 = findBySceneId(w, other);
    expect(w.has(o2, Collider2D)).toBe(true);
    expect(w.store(Transform2D).position.x[o2]).toBe(-40);

    // undo brings back the old version of the other instance
    editor.undo();
    expect(w.has(findBySceneId(w, other), Collider2D)).toBe(false);
    editor.redo();

    // revert throws away local edits
    const before = findBySceneId(w, other);
    editor.execute(setValues(w, "x", [{ id: other, component: "Name", before: { value: "Coin" }, after: { value: "Changed" } }]));
    expect(w.store(Name).value[before]).toBe("Changed");
    revertToPrefab(editor, other);
    expect(w.store(Name).value[findBySceneId(w, other)]).toBe("Coin");

    // the scene round-trips with the link
    const saved = serializeScene(w);
    expect(saved.entities.some((d) => d.components.PrefabInstance?.prefab === guid)).toBe(true);
  });

  it("updates instances when the prefab file changes on disk", async () => {
    const { fs, editor } = await newEditor();
    const w = editor.world;
    const id = editor.createEntity("rect", { name: "Box" });
    const path = await createPrefab(editor, id);
    const json = JSON.parse(await fs.readText(path));
    json.entities[0].components.RigidBody2D = { type: "static" };
    await fs.writeFile(path, JSON.stringify(json));
    await editor.db.refresh();
    expect(w.has(findBySceneId(w, id), RigidBody2D)).toBe(true);
  });
});

describe("editor assets", () => {
  it("makes animation clips from sprites and loads them back", async () => {
    const { fs, editor } = await newEditor();
    const tex = editor.db.textures.get("assets/hero.png")!;
    await editor.db.saveMeta("assets/hero.png", {
      ...tex.meta,
      slicing: { mode: "grid", cell: [16, 16], offset: [0, 0], spacing: [0, 0], pivot: [0.5, 0.5] },
      sprites: [
        { id: "cell_0", name: "hero_0", rect: { x: 0, y: 0, w: 16, h: 16 }, pivot: { x: 0.5, y: 0.5 } },
        { id: "cell_1", name: "hero_1", rect: { x: 16, y: 0, w: 16, h: 16 }, pivot: { x: 0.5, y: 0.5 } },
      ],
    });
    const refs = ["cell_0", "cell_1"].map((id) => ({ texture: tex.meta.guid, id }));
    const { path, clip } = await editor.createAnimation(refs, "hero_run", 8);
    expect(path).toBe("assets/hero_run.anim.json");
    expect(editor.assets.clip("hero_run")?.frames).toHaveLength(2);
    expect(clip.frames[0].duration).toBeCloseTo(0.125);

    // a fresh editor picks the clip up from disk
    const again = await Editor.open(fs, { decode: fakeDecode });
    expect(again.assets.clip("hero_run")?.guid).toBe(clip.guid);
    expect(again.db.clips.get(path)?.name).toBe("hero_run");
  });

  it("imports sounds with a stable guid", async () => {
    const { fs, editor } = await newEditor();
    await editor.db.importFiles([{ name: "jump.wav", bytes: new Uint8Array([0, 1, 2]) }]);
    const entry = editor.db.sounds.get("assets/jump.wav")!;
    expect(entry.name).toBe("jump");
    expect(editor.db.audio?.clip("jump")?.guid).toBe(entry.guid);
    const again = await Editor.open(fs, { decode: fakeDecode });
    expect(again.db.sounds.get("assets/jump.wav")?.guid).toBe(entry.guid);
  });

  it("sets entity references by scene id, with undo", async () => {
    const { editor } = await newEditor();
    const w = editor.world;
    const cam = editor.createEntity("camera");
    const hero = editor.createEntity("sprite", { name: "Hero" });
    editor.execute(addComponent(w, cam, CameraFollow2D));
    editor.execute(setEntityRef(w, cam, "CameraFollow2D", "target", hero));
    const c = findBySceneId(w, cam);
    expect(w.deref(w.store(CameraFollow2D).target[c])).toBe(findBySceneId(w, hero));
    // delete + undo re-creates the hero with a new entity index; the ref follows it
    editor.select([hero]);
    editor.deleteSelection();
    editor.undo();
    editor.undo();
    expect(w.deref(w.store(CameraFollow2D).target[c])).toBe(-1);
    editor.redo();
    expect(w.deref(w.store(CameraFollow2D).target[c])).toBe(findBySceneId(w, hero));
  });

  it("plays with physics and restores the scene on stop", async () => {
    const { editor } = await newEditor();
    const w = editor.world;
    const ground = editor.createEntity("rect", { name: "Ground", y: -50, extra: { Collider2D: { size: { x: 200, y: 20 } } } });
    const box = editor.createEntity("rect", { name: "Box", y: 50, extra: { RigidBody2D: {}, Collider2D: {} } });
    expect(ground).toBeTruthy();
    expect(await editor.play.start()).toBe(true);
    for (let i = 0; i < 30; i++) editor.play.step();
    expect(w.store(Transform2D).position.y[findBySceneId(w, box)]).toBeLessThan(50);
    editor.play.stop();
    expect(w.store(Transform2D).position.y[findBySceneId(w, box)]).toBe(50);
  });
});
