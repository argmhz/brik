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
  Scripts,
} from "@brik/runtime";
import { beforeAll, describe, expect, it } from "vitest";
import {
  Editor,
  MemoryFS,
  addComponent,
  addScript,
  applyToPrefab,
  computeOverrides,
  createPrefab,
  createProject,
  deleteEntities,
  overridesFor,
  placePrefab,
  revertOverride,
  revertToPrefab,
  sceneIdOf,
  scriptPropKey,
  setEntityRef,
  setScriptProp,
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

  it("script fields are overridden one at a time", async () => {
    const { editor } = await newEditor();
    const w = editor.world;
    const S = "scripts/Enemy.ts#Enemy";
    const scripts = (id: string) => w.store(Scripts).list[findBySceneId(w, id)];
    const coinId = editor.createEntity("circle", { name: "Enemy" });
    editor.execute(addScript(w, coinId, S));
    editor.execute(setScriptProp(w, coinId, 0, "hp", 3));
    editor.execute(setScriptProp(w, coinId, 0, "speed", 50));
    await createPrefab(editor, coinId);
    const guid = w.store(PrefabInstance).prefab[findBySceneId(w, coinId)];
    const otherId = placePrefab(editor, guid, { x: 100, y: 0 })!;
    const other = () => findBySceneId(w, otherId);
    expect(overridesFor(editor, other()).size).toBe(0);

    // the other instance is tougher: one field differs, not the whole script list
    editor.execute(setScriptProp(w, otherId, 0, "hp", 9));
    expect(overridesFor(editor, other())).toEqual(new Set([scriptPropKey(S, 0, "hp")]));
    expect(w.store(PrefabInstance).overrides[other()]).toHaveLength(1);

    // the prefab changes speed (through the first instance): the other follows on speed and keeps its own hp
    editor.execute(setScriptProp(w, coinId, 0, "speed", 80));
    await applyToPrefab(editor, coinId);
    expect(scripts(otherId)[0].props).toEqual({ hp: 9, speed: 80 });
    expect(scripts(coinId)[0].props).toEqual({ hp: 3, speed: 80 });

    // a new field on the prefab shows up on both without becoming an override
    editor.execute(setScriptProp(w, coinId, 0, "armor", 2));
    await applyToPrefab(editor, coinId);
    expect(scripts(otherId)[0].props).toEqual({ hp: 9, speed: 80, armor: 2 });
    expect(overridesFor(editor, other())).toEqual(new Set([scriptPropKey(S, 0, "hp")]));

    // reverting the one field takes the prefab's value back
    revertOverride(editor, otherId, scriptPropKey(S, 0, "hp"));
    expect(scripts(otherId)[0].props.hp).toBe(3);
    expect(overridesFor(editor, other()).size).toBe(0);

    // adding another script is a change of the whole list, so that is one override of the list
    editor.execute(addScript(w, otherId, "scripts/Other.ts#Other"));
    expect(overridesFor(editor, other())).toEqual(new Set(["Scripts.list"]));
  });

  it("keeps per-field overrides when the prefab changes", async () => {
    const { fs, editor } = await newEditor();
    const w = editor.world;
    const coinId = editor.createEntity("circle", { name: "Coin" });
    editor.createEntity("text", { name: "Label", parentId: coinId });
    editor.createEntity("rect", { name: "Shine", parentId: coinId });
    await createPrefab(editor, coinId);
    const guid = w.store(PrefabInstance).prefab[findBySceneId(w, coinId)];
    const otherId = placePrefab(editor, guid, { x: 100, y: 0 })!;
    const other = () => findBySceneId(w, otherId);
    const childNamed = (root: string, name: string) => childrenOf(w, findBySceneId(w, root)).find((c) => w.store(Name).value[c] === name);

    // the other instance gets its own name and loses a child
    const rename = (id: string, from: string, to: string) =>
      editor.execute(setValues(w, "x", [{ id, component: "Name", before: { value: from }, after: { value: to } }]));
    rename(otherId, "Coin", "Gold");
    editor.execute(deleteEntities(w, [sceneIdOf(w, childNamed(otherId, "Shine")!)]));
    expect(overridesFor(editor, other())).toEqual(new Set(["Name.value"]));
    const own = w.store(PrefabInstance).overrides[other()]!;
    expect(own).toHaveLength(2);
    expect(own.some((k) => k.startsWith("-") && !k.includes(":"))).toBe(true);
    expect(overridesFor(editor, findBySceneId(w, coinId)).size).toBe(0);

    // change the prefab through the first instance
    editor.execute(addComponent(w, coinId, Collider2D));
    rename(sceneIdOf(w, childNamed(coinId, "Label")!), "Label", "Price");
    await applyToPrefab(editor, coinId);
    expect(w.has(other(), Collider2D)).toBe(true); // follows the prefab
    expect(childNamed(otherId, "Price")).toBeDefined();
    expect(w.store(Name).value[other()]).toBe("Gold"); // keeps its own name
    expect(childNamed(otherId, "Shine")).toBeUndefined(); // stays removed
    expect(w.store(Transform2D).position.x[other()]).toBe(100);
    expect(w.store(PrefabInstance).overrides[findBySceneId(w, coinId)]).toEqual([]);

    // prefab entity ids stay short after applying
    const file = JSON.parse(await fs.readText(editor.db.pathOf(guid)!)) as { entities: { id: string }[] };
    expect(file.entities.every((d) => !d.id.includes("/"))).toBe(true);

    // undo takes the whole apply back; redo brings it again
    editor.undo();
    expect(w.has(other(), Collider2D)).toBe(false);
    editor.redo();
    expect(w.has(other(), Collider2D)).toBe(true);

    // one field can be reverted on its own
    revertOverride(editor, otherId, "Name.value");
    expect(w.store(Name).value[other()]).toBe("Coin");
    expect(childNamed(otherId, "Shine")).toBeUndefined();

    // a prefab edited while the scene is closed is picked up when it opens
    await editor.saveScene("scenes/test.scene.json");
    rename(otherId, "Coin", "Silver");
    await editor.saveScene();
    const path = editor.db.pathOf(guid)!;
    const json = JSON.parse(await fs.readText(path));
    json.entities[0].components.Name = { value: "Coin v2" };
    json.entities[0].components.RigidBody2D = { type: "static" };
    await fs.writeFile(path, JSON.stringify(json));
    const again = await Editor.open(fs, { decode: fakeDecode });
    await again.openScene("scenes/test.scene.json");
    const w2 = again.world;
    const o2 = findBySceneId(w2, otherId);
    const c2 = findBySceneId(w2, coinId);
    expect(w2.has(o2, RigidBody2D)).toBe(true);
    expect(w2.store(Name).value[o2]).toBe("Silver");
    expect(w2.store(Name).value[c2]).toBe("Coin v2");
  });

  it("treats fields left out of a prefab file as their defaults", () => {
    const prefab = { version: 1 as const, entities: [{ id: "p", components: { Collider2D: { shape: "circle" }, Name: { value: "Coin" } } }] };
    const instance = [
      {
        id: "i",
        components: {
          Collider2D: { shape: "circle", friction: 0.5, restitution: 0, density: 1, isTrigger: false, offset: { x: 0, y: 0 } },
          Name: { value: "Coin" },
          PrefabInstance: { prefab: "g", overrides: [] },
        },
      },
    ];
    expect(computeOverrides(instance, "i", prefab)).toEqual([]);
    instance[0].components.Collider2D.friction = 0.9;
    expect(computeOverrides(instance, "i", prefab)).toEqual(["p:Collider2D.friction"]);
  });

  it("updates nested prefabs and refuses prefabs inside themselves", async () => {
    const { fs, editor } = await newEditor();
    const w = editor.world;
    const wheelId = editor.createEntity("circle", { name: "Wheel" });
    await createPrefab(editor, wheelId);
    const wheel = w.store(PrefabInstance).prefab[findBySceneId(w, wheelId)];
    const carId = editor.createEntity("rect", { name: "Car" });
    placePrefab(editor, wheel, { x: 10, y: 0 }, carId);
    await createPrefab(editor, carId);
    const car = w.store(PrefabInstance).prefab[findBySceneId(w, carId)];
    const car2 = placePrefab(editor, car, { x: 0, y: 100 })!;
    const wheelsOf = (id: string) => childrenOf(w, findBySceneId(w, id)).filter((c) => w.store(Name).value[c] === "Wheel");
    expect(wheelsOf(car2)).toHaveLength(1);

    // changing the wheel prefab reaches the car prefab file and both cars
    editor.execute(addComponent(w, wheelId, RigidBody2D));
    await applyToPrefab(editor, wheelId);
    for (const id of [carId, car2]) expect(w.has(wheelsOf(id)[0], RigidBody2D)).toBe(true);
    const carFile = JSON.parse(await fs.readText(editor.db.pathOf(car)!)) as { entities: { components: Record<string, unknown> }[] };
    expect(carFile.entities.some((d) => d.components.PrefabInstance && d.components.RigidBody2D)).toBe(true);
    // the wheel keeps its place in the car
    expect(w.store(Transform2D).position.x[wheelsOf(car2)[0]]).toBe(10);

    // a car inside a wheel, applied to the wheel, would contain itself
    placePrefab(editor, car, { x: 0, y: 0 }, wheelId);
    await expect(applyToPrefab(editor, wheelId)).rejects.toThrow(/sig selv/);
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
