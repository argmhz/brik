import { TileMap, UICanvas, UIButton, UIText, childrenOf, findBySceneId, parentOf } from "@brik/runtime";
import { describe, expect, it } from "vitest";
import { Editor, MemoryFS, createProject, fillRect, floodFill, lineCells, setTilesCommand } from "../src";

const fakeDecode = async () => ({ width: 32, height: 16 }) as unknown as HTMLCanvasElement;

async function newEditor() {
  const fs = new MemoryFS("test");
  await createProject(fs, "Test", { "assets/hero.png": new Uint8Array([1, 2, 3]) });
  return Editor.open(fs, { decode: fakeDecode });
}

describe("tile tools", () => {
  it("draws gap-free lines", () => {
    expect(lineCells(0, 0, 3, 1)).toEqual([[0, 0], [1, 0], [2, 1], [3, 1]]);
    expect(lineCells(2, 2, 2, 2)).toEqual([[2, 2]]);
  });

  it("fills rects and flood-fills within the map's bounds", () => {
    const t: Record<string, string> = {};
    fillRect(t, 0, 0, 4, 0, "wall"); // floor
    fillRect(t, 0, 0, 0, 3, "wall"); // left wall
    fillRect(t, 4, 0, 4, 3, "wall"); // right wall
    // the empty room (x 1..3, y 1..3) plus nothing outside the bounds
    expect(floodFill(t, 2, 2, "water")).toBe(9);
    expect(t["2,3"]).toBe("water");
    expect(t["5,5"]).toBeUndefined();
    // replace all walls
    expect(floodFill(t, 0, 0, "stone")).toBe(11); // floor 5 + two walls of 3
    // same tile: no change
    expect(floodFill(t, 0, 0, "stone")).toBe(0);
    fillRect(t, 1, 1, 3, 3, null);
    expect(Object.values(t).filter((v) => v === "water")).toHaveLength(0);
  });

  it("paints undoably on a tilemap entity", async () => {
    const editor = await newEditor();
    const id = editor.createEntity("tilemap");
    const e = findBySceneId(editor.world, id);
    const M = editor.world.store(TileMap);
    const before = M.tiles[e];
    const after = { ...before, "0,0": "cell_0" };
    editor.execute(setTilesCommand(editor.world, id, before, after));
    expect(M.tiles[e]["0,0"]).toBe("cell_0");
    editor.undo();
    expect(M.tiles[e]["0,0"]).toBeUndefined();
  });
});

describe("UI entity kinds", () => {
  it("puts UI elements under a canvas, creating one if needed, and gives buttons a label", async () => {
    const editor = await newEditor();
    const w = editor.world;
    const btn = findBySceneId(w, editor.createEntity("ui-button"));
    const canvas = parentOf(w, btn);
    expect(w.has(canvas, UICanvas)).toBe(true);
    expect(w.has(btn, UIButton)).toBe(true);
    expect(w.has(childrenOf(w, btn)[0], UIText)).toBe(true);
    // the next element reuses the canvas
    const text = findBySceneId(w, editor.createEntity("ui-text"));
    expect(parentOf(w, text)).toBe(canvas);
    expect(w.query([UICanvas]).count()).toBe(1);
    // one undo removes the button, its label and the canvas made for it
    editor.undo();
    editor.undo();
    expect(w.query([UICanvas]).count()).toBe(0);
  });
});
