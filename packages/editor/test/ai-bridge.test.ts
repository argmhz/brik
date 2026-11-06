import { RigidBody2D, Transform2D, findBySceneId, initPhysics } from "@brik/runtime";
import * as esbuild from "esbuild-wasm";
import { beforeAll, describe, expect, it } from "vitest";
import { Editor, MemoryFS, createBridgeHandlers, createProject } from "../src";

const fakeDecode = async () => ({ width: 32, height: 16 }) as unknown as HTMLCanvasElement;
const importCode = (code: string) => import(/* @vite-ignore */ `data:text/javascript;charset=utf-8,${encodeURIComponent(code)}`);

async function setup() {
  const fs = new MemoryFS("ai");
  await createProject(fs, "AI", {});
  const editor = await Editor.open(fs, { decode: fakeDecode, esbuild: async () => esbuild, importCode });
  return { fs, editor, h: createBridgeHandlers(editor) };
}

beforeAll(async () => {
  await initPhysics();
});

describe("AI bridge handlers", () => {
  it("describes components and builds a falling box on a floor", async () => {
    const { editor, h } = await setup();
    const [rb] = (await h.list_components({ name: "RigidBody2D" })) as { fields: Record<string, { options?: string[] }> }[];
    expect(rb.fields.type.options).toEqual(["dynamic", "kinematic", "static"]);

    const box = (await h.create_entity({
      kind: "rect",
      name: "Kasse",
      y: 100,
      components: { RigidBody2D: { type: "dynamic" }, Collider2D: { size: { x: 32, y: 32 } } },
    })) as { id: string };
    const floor = (await h.create_entity({ kind: "rect", name: "Gulv", y: -50 })) as { id: string };
    await h.add_component({ id: floor.id, component: "Collider2D", values: { size: { x: 320, y: 32 } } });
    await h.set_fields({ id: floor.id, component: "Transform2D", values: { scale: { x: 10, y: 1 } } });

    const info = (await h.inspect_entity({ id: box.id })) as { components: Record<string, any> };
    expect(info.components.RigidBody2D.type).toBe("dynamic");
    expect(info.components.Transform2D.position).toEqual({ x: 0, y: 100 });
    const tree = (await h.get_hierarchy({})) as { name: string }[];
    expect(tree.map((n) => n.name)).toEqual(expect.arrayContaining(["Kasse", "Gulv"]));

    // play: the box falls and lands on the floor
    await h.play({});
    await h.step({ frames: 180 });
    const y = editor.world.store(Transform2D).position.y[findBySceneId(editor.world, box.id)];
    expect(y).toBeLessThan(100);
    expect(y).toBeGreaterThan(-50);
    await h.stop({});
    expect(editor.world.store(Transform2D).position.y[findBySceneId(editor.world, box.id)]).toBe(100);

    // every change is one undo step
    await h.undo({});
    expect(editor.world.store(Transform2D).scale.x[findBySceneId(editor.world, floor.id)]).toBe(1);
  });

  it("explains mistakes so the AI can correct itself", async () => {
    const { h } = await setup();
    const { id } = (await h.create_entity({ name: "X" })) as { id: string };
    await expect(async () => h.set_fields({ id, component: "Transform2D", values: { positon: { x: 1 } } })).rejects.toThrow(
      /no field "positon".*position/,
    );
    await expect(async () => h.add_component({ id, component: "Rigidbody" })).rejects.toThrow(/list_components/);
    await expect(async () => h.add_component({ id, component: "RigidBody2D", values: { type: "floaty" } })).rejects.toThrow(
      /dynamic, kinematic, static/,
    );
    await expect(async () => h.inspect_entity({ id: "nope" })).rejects.toThrow(/get_hierarchy/);
    await expect(async () => h.read_file({ path: "../secret" })).rejects.toThrow(/inside the project/);
  });

  it("writes scripts, reports compile errors and attaches behaviours", async () => {
    const { editor, h } = await setup();
    const bad = (await h.write_script({ path: "scripts/Spin.ts", content: "export class Spin extends Behaviour { x: number = }" })) as {
      status: string;
      errors: string[];
    };
    expect(bad.status).toBe("error");
    expect(bad.errors[0]).toMatch(/scripts\/Spin\.ts:1/);

    const ok = (await h.write_script({
      path: "scripts/Spin.ts",
      content: `import { Behaviour, expose, type Entity } from "brik";
export class Spin extends Behaviour {
  @expose speed = 2;
  @expose({ type: "entity" }) target: Entity = -1;
  onUpdate(dt: number) { this.transform.rotation += this.speed * dt; }
}`,
    })) as { status: string; behaviours: string[] };
    expect(ok.status).toBe("ok");
    expect(ok.behaviours).toEqual(["scripts/Spin.ts#Spin"]);

    const a = (await h.create_entity({ name: "A" })) as { id: string };
    const b = (await h.create_entity({ name: "B" })) as { id: string };
    await h.attach_script({ id: a.id, script: "Spin" });
    await h.set_script_field({ id: a.id, script: "Spin", key: "speed", value: 5 });
    await h.set_script_field({ id: a.id, script: "Spin", key: "target", value: b.id });
    const info = (await h.inspect_entity({ id: a.id })) as { scripts: { props: Record<string, unknown> }[] };
    expect(info.scripts[0].props).toEqual({ speed: 5, target: { $entity: b.id } });

    await h.play({});
    await h.step({ frames: 30 });
    const live = (await h.inspect_entity({ id: a.id })) as { scripts: { live: Record<string, unknown> }[] };
    expect(live.scripts[0].live.target).toBe(findBySceneId(editor.world, b.id));
    expect(editor.world.store(Transform2D).rotation[findBySceneId(editor.world, a.id)]).toBeGreaterThan(2);
    await expect(async () => h.create_entity({ name: "Mens spillet kører" })).rejects.toThrow(/stop/);
    await h.stop({});
  });

  it("saves scenes and places prefabs", async () => {
    const { editor, fs, h } = await setup();
    const { id } = (await h.create_entity({ kind: "circle", name: "Mønt", components: { RigidBody2D: { type: "static" } } })) as {
      id: string;
    };
    const { path } = (await h.create_prefab({ id })) as { path: string };
    expect(await fs.exists(path)).toBe(true);
    const placed = (await h.place_prefab({ prefab: "Mønt", x: 64, y: 0 })) as { id: string };
    const e = findBySceneId(editor.world, placed.id);
    expect(editor.world.has(e, RigidBody2D)).toBe(true);
    const { saved } = (await h.save_scene({ path: "scenes/ai" })) as { saved: string };
    expect(saved).toBe("scenes/ai.scene.json");
    const assets = (await h.list_assets({ kind: "scenes" })) as { scenes: string[] };
    expect(assets.scenes).toContain("scenes/ai.scene.json");
  });
});
