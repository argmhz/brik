import { BehaviourRuntime, Scripts, Transform2D, componentByName, findBySceneId } from "@brik/runtime";
import * as esbuild from "esbuild-wasm";
import { describe, expect, it } from "vitest";
import { Editor, MemoryFS, addScript, compileScripts, createProject, setScriptProp, toClassName } from "../src";

const fakeDecode = async () => ({ width: 16, height: 16 }) as unknown as HTMLCanvasElement;
const importCode = (code: string) =>
  import(/* @vite-ignore */ `data:text/javascript;charset=utf-8,${encodeURIComponent(code)}`);

const SPINNER = `
import { Behaviour, expose } from "brik";
import { degrees } from "./util/math";

export class Spinner extends Behaviour {
  @expose speed = 90;
  @expose({ label: "Navn" }) title = "spin";
  onUpdate(dt: number) {
    this.transform.rotation += degrees(this.speed) * dt;
  }
}
`;
const MATH = `export const degrees = (d: number) => d * Math.PI / 180;`;
const HEALTH = `
import { defineComponent, t, system, Time } from "brik";
export const Health = defineComponent("Game.Health", { hp: t.f32(10) });
export const regen = system("regen", (world) => {
  const H = world.store(Health);
  for (const e of world.query([Health])) H.hp[e] += 1;
}, "fixedUpdate");
`;

async function setup(files: Record<string, string>) {
  const fs = new MemoryFS("scripts");
  await createProject(fs, "S", files);
  const editor = await Editor.open(fs, { decode: fakeDecode, esbuild: async () => esbuild, importCode });
  return { fs, editor };
}

describe("Script compiler", () => {
  it("reports errors with file and line", async () => {
    const result = await compileScripts(esbuild, { "scripts/bad.ts": "export const x = ;\n" });
    expect(result.code).toBeNull();
    expect(result.errors[0]).toMatchObject({ file: "scripts/bad.ts", line: 1 });
  });

  it("rejects imports other than brik and relative files", async () => {
    const result = await compileScripts(esbuild, { "scripts/a.ts": 'import x from "lodash";\nexport default x;' });
    expect(result.errors[0].message).toMatch(/lodash/);
  });

  it("makes class names from file names", () => {
    expect(toClassName("my player.ts")).toBe("MyPlayer");
    expect(toClassName("2d-thing")).toBe("Script2dThing");
  });
});

describe("Scripts in the editor", () => {
  it("compiles on open and lists behaviours, systems and components", async () => {
    const { editor } = await setup({
      "scripts/spinner.ts": SPINNER,
      "scripts/util/math.ts": MATH,
      "scripts/health.ts": HEALTH,
    });
    expect(editor.scripts.status).toBe("ok");
    expect([...editor.scripts.registry.behaviours.keys()]).toEqual(["scripts/spinner.ts#Spinner"]);
    expect(editor.scripts.registry.systems.map((s) => s.id)).toEqual(["scripts/health.ts#regen"]);
    expect(componentByName("Game.Health")).toBeDefined();
  });

  it("runs behaviours and systems in play mode and restores the scene on stop", async () => {
    const { editor } = await setup({
      "scripts/spinner.ts": SPINNER,
      "scripts/util/math.ts": MATH,
      "scripts/health.ts": HEALTH,
    });
    const id = editor.createEntity("empty", { name: "Spin" });
    editor.execute(addScript(editor.world, id, "scripts/spinner.ts#Spinner"));
    editor.execute(setScriptProp(editor.world, id, 0, "speed", 180));
    const Health = componentByName("Game.Health")!;
    const e0 = findBySceneId(editor.world, id);
    editor.world.add(e0, Health);
    const undoBefore = editor.history.undoLabel;

    expect(await editor.play.start()).toBe(true);
    for (let i = 0; i < 60; i++) editor.play.step(1 / 60);
    const e = findBySceneId(editor.world, id);
    expect(editor.world.store(Transform2D).rotation[e]).toBeCloseTo(Math.PI, 2); // 180°/s for 1 s
    expect(editor.world.read(e, Health).hp).toBeGreaterThan(10);

    // edits during play are applied but not recorded
    editor.execute(setScriptProp(editor.world, id, 0, "speed", 0));
    expect(editor.history.undoLabel).toBe(undoBefore);

    editor.play.stop();
    const after = findBySceneId(editor.world, id);
    expect(editor.play.mode).toBe("edit");
    expect(editor.world.store(Transform2D).rotation[after]).toBe(0);
    expect(editor.world.read(after, Scripts).list[0].props).toEqual({ speed: 180 });
  });

  it("hot-reloads changed scripts while playing", async () => {
    const { fs, editor } = await setup({ "scripts/spinner.ts": SPINNER, "scripts/util/math.ts": MATH });
    const id = editor.createEntity("empty");
    editor.execute(addScript(editor.world, id, "scripts/spinner.ts#Spinner"));
    await editor.play.start();
    editor.play.step();
    const runtime = editor.world.resource(BehaviourRuntime);
    const e = findBySceneId(editor.world, id);
    const before = runtime.instance(e, 0)!;
    await fs.writeFile("scripts/spinner.ts", SPINNER.replace("+= degrees", "-= degrees"));
    await editor.scripts.poll();
    editor.play.step();
    const after = runtime.instance(e, 0)!;
    expect(after).not.toBe(before);
    expect((after as unknown as { speed: number }).speed).toBe(90);
    editor.play.stop();
  });

  it("refuses to play with compile errors and logs them", async () => {
    const { editor } = await setup({ "scripts/bad.ts": "export const = 1" });
    expect(editor.scripts.status).toBe("error");
    expect(await editor.play.start()).toBe(false);
    expect(editor.console.entries.some((e) => e.level === "error" && e.file === "scripts/bad.ts")).toBe(true);
  });

  it("brings back script components that a scene used before they compiled", async () => {
    const { fs, editor } = await setup({});
    await fs.writeFile(
      "scenes/main.scene.json",
      JSON.stringify({ version: 1, entities: [{ id: "h", components: { "Game.Health2": { hp: 3 } } }] }),
    );
    const warn = console.warn;
    console.warn = () => {};
    await editor.openScene("scenes/main.scene.json");
    console.warn = warn;
    await fs.writeFile("scripts/h.ts", 'import { defineComponent, t } from "brik";\nexport const H = defineComponent("Game.Health2", { hp: t.f32() });');
    await editor.scripts.poll();
    const e = findBySceneId(editor.world, "h");
    expect(editor.world.read(e, componentByName("Game.Health2")!).hp).toBe(3);
  });
});
