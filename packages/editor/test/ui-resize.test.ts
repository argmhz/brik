import { UIRect, mat3 } from "@brik/runtime";
import { describe, expect, it } from "vitest";
import { Editor, MemoryFS, createProject } from "../src";
import { SceneController } from "../src/ui/scene-controller";

const fakeDecode = async () => ({ width: 32, height: 16 }) as unknown as HTMLCanvasElement;

/** The resize math of the scene view, without a renderer or a DOM. */
async function setup() {
  const fs = new MemoryFS("t");
  await createProject(fs, "T", {});
  const editor = await Editor.open(fs, { decode: fakeDecode });
  const id = editor.createEntity("ui-image", {});
  const e = editor.selectedEntities()[0];
  editor.world.write(e, UIRect, { size: { x: 100, y: 50 }, position: { x: 0, y: 0 }, pivot: { x: 0.5, y: 0.5 } });
  const c = Object.create(SceneController.prototype) as Record<string, any>;
  Object.assign(c, {
    editor,
    uiCamera: () => -1,
    globalOf: () => mat3.identity(),
    uiUnitsPerWorld: () => 1,
  });
  const resize = (hx: number, hy: number, dx: number, dy: number, snap = false) => {
    editor.snap = snap;
    const drag = {
      kind: "ui-resize",
      id,
      e,
      hx,
      hy,
      startWorld: { x: 0, y: 0 },
      start: { position: { x: 0, y: 0 }, size: { x: 100, y: 50 } },
      shown: { x: 100, y: 50 },
      moved: true,
    };
    c.applyUIResize(drag, { x: dx, y: dy }, false);
    return editor.world.read(e, UIRect);
  };
  return { resize };
}

describe("resizing UI in the scene view", () => {
  it("moves the dragged edge and keeps the opposite one still", async () => {
    const { resize } = await setup();
    // right edge +20: wider, and the centre pivot moves half of it
    let r = resize(1, 0, 20, 0);
    expect(r.size).toEqual({ x: 120, y: 50 });
    expect(r.position.x).toBeCloseTo(10);
    // left edge +20 (to the right): narrower, centre moves right too
    r = resize(-1, 0, 20, 0);
    expect(r.size.x).toBe(80);
    expect(r.position.x).toBeCloseTo(10);
    // top-right corner
    r = resize(1, 1, 10, 30);
    expect(r.size).toEqual({ x: 110, y: 80 });
    expect(r.position).toEqual({ x: 5, y: 15 });
  });

  it("never goes below 1 unit and snaps the size to the grid", async () => {
    const { resize } = await setup();
    expect(resize(1, 0, -500, 0).size.x).toBe(1);
    const r = resize(1, 0, 13, 0, true); // grid 16 by default: 113 -> 112
    expect(r.size.x % 16).toBe(0);
  });
});
