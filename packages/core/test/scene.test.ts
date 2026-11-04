import { describe, expect, it } from "vitest";
import {
  Name,
  SceneId,
  Transform2D,
  World,
  childrenOf,
  defineComponent,
  findBySceneId,
  instantiate,
  loadScene,
  parentOf,
  serializeEntities,
  serializeScene,
  setParent,
  t,
} from "../src";

const Follow = defineComponent("Test.Follow", { target: t.entity(), speed: t.f32(0.3) });
const Tags = defineComponent("Test.Tags", { list: t.ref<string[]>(() => []), kind: t.enum(["a", "b"] as const) });

function buildWorld() {
  const w = new World();
  const root = w.spawn([Name, { value: "root" }], [Transform2D, { position: { x: 1.1, y: 2 } }]);
  const a = w.spawn([Name, { value: "a" }], Transform2D);
  const b = w.spawn([Name, { value: "b" }], Transform2D, [Tags, { list: ["x"], kind: "b" }]);
  setParent(w, a, root);
  setParent(w, b, root);
  w.add(a, Follow, { target: w.ref(b) });
  return { w, root, a, b };
}

describe("Scene serialization", () => {
  it("round-trips entities, hierarchy, refs and entity links", () => {
    const { w } = buildWorld();
    const data = serializeScene(w);
    const json = JSON.parse(JSON.stringify(data));

    const w2 = new World();
    loadScene(w2, json);
    const byName = (n: string) => [...w2.query([Name])].find((e) => w2.store(Name).value[e] === n)!;
    const root = byName("root");
    const a = byName("a");
    const b = byName("b");
    expect(childrenOf(w2, root)).toEqual([a, b]);
    expect(parentOf(w2, a)).toBe(root);
    expect(w2.deref(w2.store(Follow).target[a])).toBe(b);
    expect(w2.read(b, Tags)).toEqual({ list: ["x"], kind: "b" });
    expect(w2.store(Transform2D).position.x[root]).toBeCloseTo(1.1);
    // re-serializing gives the same file
    expect(serializeScene(w2)).toEqual(json);
  });

  it("writes clean floats and skips computed components", () => {
    const { w } = buildWorld();
    const data = serializeScene(w);
    const root = data.entities[0];
    expect((root.components.Transform2D.position as { x: number }).x).toBe(1.1);
    expect(root.components.GlobalTransform2D).toBeUndefined();
    expect(root.components.Children).toBeUndefined();
    expect(root.components.SceneId).toBeUndefined();
  });

  it("orders parents before children", () => {
    const { w } = buildWorld();
    const names = serializeScene(w).entities.map((e) => e.components.Name.value);
    expect(names).toEqual(["root", "a", "b"]);
  });

  it("duplicates with new ids and keeps outside references", () => {
    const { w, root, a } = buildWorld();
    const snapshot = serializeEntities(w, [a]);
    const [copy] = instantiate(w, snapshot, { newIds: true });
    expect(w.store(SceneId).id[copy]).not.toBe(w.store(SceneId).id[a]);
    expect(parentOf(w, copy)).toBe(root); // parent was outside the snapshot, found by id
    expect(childrenOf(w, root)).toHaveLength(3);
  });

  it("restores a deleted subtree with the same ids", () => {
    const { w, root } = buildWorld();
    const snapshot = serializeEntities(w, [root]); // assigns scene ids
    const rootId = w.store(SceneId).id[root];
    for (const e of [...w.entities()]) w.destroy(e);
    instantiate(w, snapshot);
    const r = findBySceneId(w, rootId);
    expect(r).toBeGreaterThanOrEqual(0);
    expect(childrenOf(w, r)).toHaveLength(2);
  });

  it("keeps data for unknown components", () => {
    const w = new World();
    const warn = console.warn;
    console.warn = () => {};
    loadScene(w, {
      version: 1,
      entities: [{ id: "x1", components: { Name: { value: "n" }, "Gone.Component": { hp: 3 } } }],
    });
    console.warn = warn;
    const out = serializeScene(w);
    expect(out.entities[0].components["Gone.Component"]).toEqual({ hp: 3 });
  });

  it("inserts children at a given sibling index", () => {
    const { w, root, a, b } = buildWorld();
    const c = w.spawn(Transform2D);
    setParent(w, c, root, 0);
    expect(childrenOf(w, root)).toEqual([c, a, b]);
  });
});

import { componentView, rehydrateMissing } from "../src";

describe("Views and late components", () => {
  it("reads and writes through a component view", () => {
    const w = new World();
    const e = w.spawn([Transform2D, { position: { x: 1, y: 2 } }], [Tags, { kind: "a" }]);
    const t = componentView(w, Transform2D, e);
    t.position.x += 10;
    t.rotation = 0.5;
    t.position = { x: 3, y: 4 };
    expect(w.read(e, Transform2D)).toMatchObject({ position: { x: 3, y: 4 } });
    expect(w.store(Transform2D).rotation[e]).toBeCloseTo(0.5);
    const tags = componentView(w, Tags, e);
    tags.kind = "b";
    expect(w.read(e, Tags).kind).toBe("b");
  });

  it("restores components that get defined after loading", () => {
    const w = new World();
    const warn = console.warn;
    console.warn = () => {};
    loadScene(w, { version: 1, entities: [{ id: "a", components: { "Late.Health": { hp: 7 } } }] });
    console.warn = warn;
    const Health = defineComponent("Late.Health", { hp: t.f32(100) });
    expect(rehydrateMissing(w)).toBe(1);
    const e = findBySceneId(w, "a");
    expect(w.read(e, Health).hp).toBe(7);
  });

  it("returns the same definition when redefined with the same fields", () => {
    const A = defineComponent("Redef.A", { x: t.f32(1) });
    const B = defineComponent("Redef.A", { x: t.f32(5) });
    expect(B).toBe(A);
    const w = new World();
    expect(w.read(w.spawn(A), A).x).toBe(5); // new default applies
  });
});
