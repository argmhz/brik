import { describe, expect, it } from "vitest";
import { Assets } from "../src";

const fakeImage = (width: number, height: number) => ({ width, height }) as unknown as HTMLCanvasElement;

describe("Assets", () => {
  it("slices a grid and resolves UVs (v0 = bottom edge)", () => {
    const assets = new Assets();
    const tex = assets.addTexture(fakeImage(64, 32), { name: "hero", settings: { pixelsPerUnit: 16 } });
    const refs = assets.sliceGrid(tex, { cell: [16, 16] });
    expect(refs).toHaveLength(8);
    const r = assets.resolve(assets.sprite("hero_5"))!;
    // cell 5 = column 1, row 1 -> pixels x 16..32, y 16..32
    expect(r.u0).toBeCloseTo(0.25);
    expect(r.u1).toBeCloseTo(0.5);
    expect(r.v0).toBeCloseTo(1);
    expect(r.v1).toBeCloseTo(0.5);
    expect(r.width).toBe(1);
    expect(r.height).toBe(1);
  });

  it("honours offset, spacing and count", () => {
    const assets = new Assets();
    const tex = assets.addTexture(fakeImage(40, 10), { name: "s" });
    const refs = assets.sliceGrid(tex, { cell: [8, 8], offset: [1, 1], spacing: [2, 0], count: 3 });
    expect(refs.map((r) => assets.spriteDef(r)!.rect.x)).toEqual([1, 11, 21]);
  });

  it("finds sprites by plain and qualified names", () => {
    const assets = new Assets();
    const tex = assets.addTexture(fakeImage(10, 10), { name: "ui" });
    const ref = assets.defineSprite(tex, { name: "button", rect: { x: 0, y: 0, w: 10, h: 10 } });
    expect(assets.sprite("button")).toEqual(ref);
    expect(assets.sprite("ui/button")).toEqual(ref);
    expect(() => assets.sprite("missing")).toThrow(/missing/);
  });

  it("resolves the whole texture with id ''", () => {
    const assets = new Assets();
    const tex = assets.addTexture(fakeImage(20, 10));
    const r = assets.resolve(assets.fullSprite(tex))!;
    expect([r.u0, r.v0, r.u1, r.v1, r.width, r.height]).toEqual([0, 1, 1, 0, 20, 10]);
  });
});

import { type Slicing, parseTextureMeta, sliceSprites, textureMetaToJson } from "../src";

describe("Texture meta", () => {
  it("slices a grid with stable ids and keeps renamed sprites", () => {
    const grid: Slicing = { mode: "grid", cell: [16, 16], offset: [0, 0], spacing: [0, 0], pivot: [0.5, 0] };
    const first = sliceSprites(grid, 32, 16, "hero");
    expect(first.map((s) => s.id)).toEqual(["cell_0", "cell_1"]);
    first[1].name = "hero_jump";
    const again = sliceSprites(grid, 48, 16, "hero", first);
    expect(again.map((s) => s.name)).toEqual(["hero_0", "hero_jump", "hero_2"]);
    expect(again[2].pivot).toEqual({ x: 0.5, y: 0 });
  });

  it("round-trips through JSON", () => {
    const meta = {
      guid: "g1",
      importer: "texture" as const,
      settings: { filter: "nearest" as const, wrap: "clamp" as const, pixelsPerUnit: 16 },
      slicing: { mode: "single" as const },
      sprites: [{ id: "a", name: "a", rect: { x: 1, y: 2, w: 3, h: 4 }, pivot: { x: 0.5, y: 0 } }],
    };
    const text = textureMetaToJson(meta);
    expect(text).toContain('"rect": [\n        1,');
    expect(parseTextureMeta(text)).toEqual(meta);
  });

  it("applies meta to a texture and replaces old sprite names", () => {
    const assets = new Assets();
    const tex = assets.addTexture(fakeImage(32, 16), { guid: "t", name: "sheet" });
    const sprites = sliceSprites(
      { mode: "grid", cell: [16, 16], offset: [0, 0], spacing: [0, 0], pivot: [0.5, 0.5] },
      32,
      16,
      "sheet",
    );
    assets.applyMeta(tex, { guid: "t", importer: "texture", settings: tex.settings, slicing: { mode: "single" }, sprites });
    expect(assets.sprite("sheet_1")).toEqual({ texture: "t", id: "cell_1" });
    assets.applyMeta(tex, { guid: "t", importer: "texture", settings: tex.settings, slicing: { mode: "single" }, sprites: [] });
    expect(() => assets.sprite("sheet_1")).toThrow();
  });
});
