import {
  Input,
  RigidBody2D,
  TileMap,
  Transform2D,
  UILayout,
  UISlider,
  UITextInput,
  UIToggle,
  blockTerrainRules,
  findBySceneId,
  initPhysics,
} from "@brik/runtime";
import * as esbuild from "esbuild-wasm";
import { beforeAll, describe, expect, it } from "vitest";
import { Editor, MemoryFS, createBridgeHandlers, createProject } from "../src";

const fakeDecode = async () => ({ width: 32, height: 16 }) as unknown as HTMLCanvasElement;
// a new URL per load, like the editor's blob URLs, so every load is a fresh module
let loads = 0;
const importCode = (code: string) =>
  import(/* @vite-ignore */ `data:text/javascript;charset=utf-8,${encodeURIComponent(`${code}\n//${loads++}`)}`);

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

  it("draws pixel art, makes animations and paints tiles", async () => {
    const { editor, fs, h } = await setup();
    const art = (await h.draw_sprites({
      path: "assets/blob",
      palette: { g: "#3fa34d", k: "#000" },
      sprites: { blob_0: [".gg.", "gkkg"], blob_1: ["....", "gggg"] },
    })) as { path: string; guid: string; sprites: string[]; size: number[] };
    expect(art.path).toBe("assets/blob.png");
    expect(art.size).toEqual([4, 2]);
    expect(await fs.exists("assets/blob.png.meta.json")).toBe(true);
    expect(editor.db.textures.get("assets/blob.png")?.meta.sprites.map((s) => s.id)).toEqual(["blob_0", "blob_1"]);
    await expect(async () => h.draw_sprites({ path: "assets/x.png", palette: { g: "#0f0" }, sprites: { a: ["gq"] } })).rejects.toThrow(/"q".*not in the palette/);
    await expect(async () => h.draw_sprites({ path: "assets/x.png", palette: { g: "#0f0" }, sprites: { a: ["g", "gg"] } })).rejects.toThrow(/same length/);

    // redrawing keeps the guid, so references stay valid
    const again = (await h.draw_sprites({ path: "assets/blob.png", palette: { g: "#fff" }, sprites: { blob_0: ["gg", "gg"] } })) as { guid: string };
    expect(again.guid).toBe(art.guid);

    await h.draw_sprites({ path: "assets/blob.png", palette: { g: "#3fa34d" }, sprites: { blob_0: ["g"], blob_1: ["g"] } });
    const clip = (await h.create_animation({ path: "assets/blob_walk", texture: "assets/blob.png", frames: ["blob_0", "blob_1"], fps: 4 })) as {
      name: string;
      guid: string;
    };
    expect(clip.name).toBe("blob_walk");
    expect(editor.assets.clip("blob_walk")?.frames.map((f) => f.duration)).toEqual([0.25, 0.25]);
    await expect(async () => h.create_animation({ path: "assets/a", texture: "assets/blob.png", frames: ["nope"] })).rejects.toThrow(/blob_0, blob_1/);

    // a tile map painted from text rows, read back as text
    const tiles = (await h.draw_sprites({
      path: "assets/tiles.png",
      palette: { g: "#0f0", d: "#840" },
      sprites: { grass: ["g"], dirt: ["d"] },
    })) as { guid: string };
    const { id } = (await h.create_entity({ kind: "tilemap", name: "Level", components: { TileMap: { tileset: tiles.guid } } })) as { id: string };
    const painted = (await h.paint_tiles({
      id,
      map: { x: 0, y: 1, rows: ["gg.g", "dddd"], legend: { g: "grass", d: "dirt", ".": null } },
      rects: [{ x0: 10, y0: 0, x1: 11, y1: 0, tile: "dirt" }],
    })) as { changed: number };
    expect(painted.changed).toBe(9);
    const read = (await h.read_tiles({ id })) as { rows: string[]; legend: Record<string, string>; topLeft: { x: number; y: number } };
    expect(read.legend).toEqual({ g: "grass", d: "dirt" });
    expect(read.topLeft).toEqual({ x: 0, y: 1 });
    expect(read.rows).toEqual(["gg.g........", "dddd......dd"]);
    expect(Object.keys(editor.world.store(TileMap).tiles[findBySceneId(editor.world, id)])).toHaveLength(9);
    await h.undo({});
    expect(Object.keys(editor.world.store(TileMap).tiles[findBySceneId(editor.world, id)])).toHaveLength(0);
    await expect(async () => h.paint_tiles({ id, rects: [{ x0: 0, y0: 0, x1: 0, y1: 0, tile: "lava" }] })).rejects.toThrow(/grass, dirt/);
  });

  it("paints with an auto-tiling terrain, edges and corners picked from the neighbours", async () => {
    const { editor, h } = await setup();
    // a 3x3 block: corners a c g i, edges b d f h, middle e
    const names = ["tl", "t", "tr", "l", "m", "r", "bl", "b", "br"];
    await h.draw_sprites({
      path: "assets/ground.png",
      palette: { x: "#3a3" },
      sprites: Object.fromEntries(names.map((n) => [n, ["x"]])),
    });
    const entry = editor.db.textures.get("assets/ground.png")!;
    const ids = names.map((n) => entry.meta.sprites.find((s) => s.name === n)!.id);
    await editor.db.saveMeta(entry.path, { ...entry.meta, terrains: [{ id: "t1", name: "Jord", rules: blockTerrainRules(ids) }] });

    const { id } = (await h.create_entity({ kind: "tilemap", name: "Level", components: { TileMap: { tileset: entry.meta.guid } } })) as { id: string };
    expect(((await h.read_tiles({ id })) as { terrains: string[] }).terrains).toEqual(["terrain:Jord"]);
    await h.paint_tiles({ id, rects: [{ x0: 0, y0: 0, x1: 3, y1: 2, tile: "terrain:Jord" }] });
    const name = (x: number, y: number) => entry.meta.sprites.find((s) => s.id === editor.world.store(TileMap).tiles[findBySceneId(editor.world, id)][`${x},${y}`])?.name;
    const row = (y: number) => [0, 1, 2, 3].map((x) => name(x, y));
    expect(row(2)).toEqual(["tl", "t", "t", "tr"]);
    expect(row(1)).toEqual(["l", "m", "m", "r"]);
    expect(row(0)).toEqual(["bl", "b", "b", "br"]);
    // erasing a cell fixes the edges around the hole
    await h.paint_tiles({ id, rects: [{ x0: 1, y0: 2, x1: 1, y1: 2, tile: null }] });
    expect(row(2)).toEqual(["tl", undefined, "tl", "tr"]);
    expect(name(1, 1)).toBe("t");
    await expect(async () => h.paint_tiles({ id, rects: [{ x0: 0, y0: 0, x1: 0, y1: 0, tile: "terrain:Lava" }] })).rejects.toThrow(/terrain:Jord/);
  });

  it("keeps the position when components override Transform2D", async () => {
    const { editor, h } = await setup();
    const { id } = (await h.create_entity({ name: "Flag", x: 100, y: 20, components: { Transform2D: { scale: { x: 2, y: 2 } } } })) as {
      id: string;
    };
    const t = editor.world.read(findBySceneId(editor.world, id), Transform2D);
    expect(t.position).toEqual({ x: 100, y: 20 });
    expect(t.scale).toEqual({ x: 2, y: 2 });
  });

  it("holds and presses keys while stepping, and starts every play with fresh modules", async () => {
    const { editor, h } = await setup();
    await h.write_script({
      path: "scripts/Counter.ts",
      content: `export const Count = { jumps: 0 };`,
    });
    const res = (await h.write_script({
      path: "scripts/Walker.ts",
      content: `import { Behaviour, expose } from "brik";
import { Count } from "./Counter";
export class Walker extends Behaviour {
  @expose jumps = 0;
  onUpdate(dt: number) {
    this.transform.position.x += this.input.axis("horizontal") * 60 * dt;
    if (this.input.action("jump").pressed) Count.jumps++;
    this.jumps = Count.jumps;
  }
}`,
    })) as { status: string };
    expect(res.status).toBe("ok");
    const { id } = (await h.create_entity({ name: "W" })) as { id: string };
    await h.attach_script({ id, script: "Walker" });
    const x = () => editor.world.store(Transform2D).position.x[findBySceneId(editor.world, id)];
    const live = async () => ((await h.inspect_entity({ id })) as { scripts: { live: { jumps: number } }[] }).scripts[0].live;

    await h.play({});
    await h.step({ frames: 30, hold: ["ArrowRight"], press: ["Space"] });
    expect(x()).toBeCloseTo(30, 0);
    // held across calls: no new press, and the key stays down
    await h.step({ frames: 30, hold: ["ArrowRight", "Space"] });
    await h.step({ frames: 30, hold: ["ArrowRight", "Space"] });
    expect(x()).toBeCloseTo(90, 0);
    expect((await live()).jumps).toBe(2);
    await h.step({ frames: 10 });
    expect(x()).toBeCloseTo(90, 0);
    await expect(async () => h.step({ hold: ["Right"] })).rejects.toThrow(/ArrowRight/);
    await h.stop({});

    // module state (Count) starts over on the next play, like in an exported game
    await h.play({});
    await h.step({ frames: 2, press: ["Space"] });
    expect((await live()).jumps).toBe(1);
    await h.stop({});
  });

  it("clicks UI buttons and aims the mouse at points in the world", async () => {
    const { editor, h } = await setup();
    const res = (await h.write_script({
      path: "scripts/Clicky.ts",
      content: `import { Behaviour, expose } from "brik";
export class Clicky extends Behaviour {
  @expose clicks = 0;
  @expose aimX = 0;
  @expose aimY = 0;
  onClick() { this.clicks++; }
  onUpdate() {
    const p = this.pointerWorld();
    this.aimX = Math.round(p.x);
    this.aimY = Math.round(p.y);
  }
}`,
    })) as { status: string };
    expect(res.status).toBe("ok");
    const { id } = (await h.create_entity({ kind: "ui-button", name: "Start" })) as { id: string };
    await h.attach_script({ id, script: "Clicky" });
    const live = async () =>
      ((await h.inspect_entity({ id })) as { scripts: { live: { clicks: number; aimX: number; aimY: number } }[] }).scripts[0].live;

    await h.play({});
    // no Game view has drawn in a test, so the bridge lays out the UI itself
    const r = (await h.click({ entity: id })) as { buttonUnderMouse: string | null; clickedButtons: string[] };
    expect(r.buttonUnderMouse).toBe(id);
    expect(r.clickedButtons).toEqual([id]);
    expect((await live()).clicks).toBe(1);

    // a point in the world: the script sees the same point through the camera
    await h.step({ frames: 2, mouse: { x: 120, y: -40 } });
    expect(await live()).toMatchObject({ aimX: 120, aimY: -40 });
    // clicking empty space hits no button
    const miss = (await h.click({ x: 2000, y: 2000 })) as { buttonUnderMouse: string | null; clickedButtons: string[] };
    expect(miss).toMatchObject({ buttonUnderMouse: null, clickedButtons: [] });
    expect((await live()).clicks).toBe(1);
    await expect(async () => h.step({ mouse: { x: 1 } })).rejects.toThrow(/entity/);
    await h.stop({});
  });

  it("a scene switch shows in the same step, and later frames run in the new scene", async () => {
    const { editor, h } = await setup();
    await h.write_script({
      path: "scripts/Switch.ts",
      content: `import { Behaviour } from "brik";
export const Ticks = { b: 0 };
export class GoToB extends Behaviour {
  onStart() { this.loadScene("b"); }
}
export class CountB extends Behaviour {
  onUpdate() { Ticks.b++; }
}`,
    });
    await h.write_script({
      path: "scripts/Probe.ts",
      content: `import { Behaviour, expose } from "brik";
import { Ticks } from "./Switch";
export class Probe extends Behaviour {
  @expose ticks = 0;
  onUpdate() { this.ticks = Ticks.b; }
}`,
    });
    // scene b: a counter and a probe that shows the count
    const { id: b } = (await h.create_entity({ name: "InB" })) as { id: string };
    await h.attach_script({ id: b, script: "CountB" });
    await h.attach_script({ id: b, script: "Probe" });
    await h.save_scene({ path: "scenes/b" });
    // scene a: switches to b right away
    editor.newScene();
    const { id: a } = (await h.create_entity({ name: "InA" })) as { id: string };
    await h.attach_script({ id: a, script: "GoToB" });
    await h.save_scene({ path: "scenes/a" });

    await h.play({});
    const r = (await h.step({ frames: 10 })) as { sceneLoaded?: string };
    expect(r.sceneLoaded).toBe("scenes/b.scene.json");
    const [inB] = (await h.find_entities({ name: "InB" })) as { id: string }[];
    const live = ((await h.inspect_entity({ id: inB.id })) as { scripts: { live?: { ticks: number } }[] }).scripts[1].live;
    // the switch happened in the second frame, so b ran for most of the 10
    expect(live?.ticks).toBeGreaterThanOrEqual(7);
    await h.stop({});
  });

  it("runtime errors in scripts point at the script file and line", async () => {
    const { editor, h } = await setup();
    // the editor UI and headless mode send console output here; do the same in the test
    const original = console.error;
    console.error = (...args: unknown[]) => editor.logConsole("error", args);
    try {
      await h.write_script({ path: "scripts/Helper.ts", content: `export function explode(n: number) {\n  if (n > 2) {\n    throw new Error("bang " + n);\n  }\n}\n` });
      const res = (await h.write_script({
        path: "scripts/Boom.ts",
        content: `import { Behaviour } from "brik";
import { explode } from "./Helper";

export class Boom extends Behaviour {
  n = 0;
  onUpdate() {
    this.n++;
    explode(this.n);
  }
}
`,
      })) as { status: string };
      expect(res.status).toBe("ok");
      const { id } = (await h.create_entity({ name: "B" })) as { id: string };
      await h.attach_script({ id, script: "Boom" });
      await h.play({});
      await h.step({ frames: 4 });
      await h.stop({});
    } finally {
      console.error = original;
    }
    const errors = (await h.get_console({ level: "error" })) as { text: string; at?: string }[];
    const boom = errors.find((e) => e.text.includes("bang"));
    // thrown in Helper.ts line 3, called from Boom.ts line 8
    expect(boom?.at).toBe("scripts/Helper.ts:3");
    expect(boom?.text).toContain("scripts/Helper.ts:3:");
    expect(boom?.text).toContain("scripts/Boom.ts:8:");
    // the bundle's data: URL is gone, and so are the engine frames below the scripts
    expect(boom?.text).not.toContain("data:text/javascript");
    expect(boom?.text).not.toContain("behaviour.ts");
    const entry = editor.console.entries.find((e) => e.text.includes("bang"));
    expect(entry).toMatchObject({ file: "scripts/Helper.ts", line: 3 });
  });

  it("sliders, toggles and text fields in a stack: drag, click and type", async () => {
    const { editor, h } = await setup();
    await h.write_script({
      path: "scripts/Spy.ts",
      content: `import { Behaviour, Name, expose } from "brik";
export const Log: string[] = [];
export class Spy extends Behaviour {
  onValueChanged(v: number | boolean | string) { Log.push(this.get(Name).value + "=" + (typeof v === "number" ? v.toFixed(1) : String(v))); }
  onSubmit(t: string) { Log.push("submit=" + t); }
}
export class Show extends Behaviour {
  @expose log = "";
  onUpdate() { this.log = Log.join(","); }
}`,
    });
    const { id: stack } = (await h.create_entity({ kind: "ui-stack" })) as { id: string };
    await h.attach_script({ id: stack, script: "Show" });
    const kids: Record<string, string> = {};
    for (const kind of ["ui-slider", "ui-toggle", "ui-input"]) {
      kids[kind] = ((await h.create_entity({ kind, parent: stack })) as { id: string }).id;
      await h.attach_script({ id: kids[kind], script: "Spy" });
    }
    const log = async () => ((await h.inspect_entity({ id: stack })) as { scripts: { live: { log: string } }[] }).scripts[0].live.log;
    await h.play({});
    await h.step({ frames: 1 });

    // the stack placed them top to bottom, centered (no renderer in tests: lay out as the Game view would)
    const layout = editor.world.resource(UILayout);
    layout.update(editor.world, 960, 540);
    const rect = (id: string) => layout.byEntity.get(findBySceneId(editor.world, id))!.rect;
    expect(rect(kids["ui-slider"]).y).toBeGreaterThan(rect(kids["ui-toggle"]).y);
    expect(rect(kids["ui-toggle"]).y).toBeGreaterThan(rect(kids["ui-input"]).y);
    const center = (r: { x: number; w: number }) => r.x + r.w / 2;
    expect(center(rect(kids["ui-slider"]))).toBeCloseTo(center(rect(kids["ui-input"])), 0);

    // press on the slider's middle, drag past its right end, let go
    const s = rect(kids["ui-slider"]);
    await h.step({ frames: 2, mouse: { entity: kids["ui-slider"] }, hold: ["Mouse0"] });
    editor.world.resource(Input).injectPointer(s.x + s.w + 40, layout.screenH - (s.y + s.h / 2));
    await h.step({ frames: 3, hold: ["Mouse0"] });
    await h.step({ frames: 2 });
    expect(editor.world.store(UISlider).value[findBySceneId(editor.world, kids["ui-slider"])]).toBe(1);

    // a click turns the toggle on
    await h.click({ entity: kids["ui-toggle"] });
    expect(editor.world.store(UIToggle).on[findBySceneId(editor.world, kids["ui-toggle"])]).toBe(1);

    // click the text field, type, press Enter
    await h.click({ entity: kids["ui-input"] });
    await h.step({ frames: 2, type: "hej\n" });
    const field = findBySceneId(editor.world, kids["ui-input"]);
    expect(editor.world.store(UITextInput).value[field]).toBe("hej");
    expect(editor.world.store(UITextInput).focused[field]).toBe(0);
    await expect(async () => h.step({ type: "mere" })).rejects.toThrow(/Click one first/);

    await h.step({ frames: 1 });
    const events = (await log()).split(",");
    // pressing the middle didn't change it (it starts at 0.5), so only the drag sent a value
    expect(events.filter((e) => e.startsWith("Slider")).at(-1)).toBe("Slider=1.0");
    expect(events).toContain("Slider=1.0");
    expect(events).toContain("Toggle=true");
    expect(events).toContain("Tekstfelt=hej");
    expect(events.at(-1)).toBe("submit=hej");
    await h.stop({});
  });
});

