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

import { autoSliceRects } from "../src";

describe("auto slicing", () => {
  it("finds separate blobs, merges overlaps, sorts in rows", () => {
    const w = 20;
    const h = 10;
    const px = new Uint8Array(w * h * 4);
    const fill = (x0: number, y0: number, x1: number, y1: number) => {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) px[(y * w + x) * 4 + 3] = 255;
    };
    fill(10, 1, 13, 3); // second in the top row
    fill(1, 1, 4, 4); // first in the top row
    fill(3, 3, 3, 3); // inside the first, merged
    fill(2, 7, 6, 8); // bottom row
    px[(9 * w + 19) * 4 + 3] = 255; // 1px noise, dropped
    expect(autoSliceRects(px, w, h)).toEqual([
      { x: 1, y: 1, w: 4, h: 4 },
      { x: 10, y: 1, w: 4, h: 3 },
      { x: 2, y: 7, w: 5, h: 2 },
    ]);
  });
});

import { packRects } from "../src";

describe("atlas packing", () => {
  const overlaps = (a: { x: number; y: number; w: number; h: number }, b: typeof a, gap: number) =>
    a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;

  it("packs without overlap (padding and extrude kept), inside the pages", () => {
    let seed = 1;
    const rnd = (n: number) => 1 + ((seed = (seed * 16807) % 2147483647) % n);
    const items = Array.from({ length: 120 }, (_, i) => ({ id: `s${i}`, w: rnd(64), h: rnd(64) }));
    const r = packRects(items, { maxSize: 512, padding: 2, extrude: 1 });
    expect(r.items).toHaveLength(120);
    expect(r.oversized).toEqual([]);
    for (const a of r.items) {
      const page = r.pages[a.page];
      expect(a.x - 1).toBeGreaterThanOrEqual(0);
      expect(a.y - 1).toBeGreaterThanOrEqual(0);
      expect(a.x + a.w + 1).toBeLessThanOrEqual(page.w);
      expect(a.y + a.h + 1).toBeLessThanOrEqual(page.h);
      for (const b of r.items) {
        // own pixels + extrude (1) on each side + padding (2) between neighbours
        if (a !== b && a.page === b.page) expect(overlaps(a, b, 2 + 2)).toBe(false);
      }
    }
    expect(r.pages[0].used).toBeGreaterThan(0.5);
  });

  it("opens new pages when full, reports oversized items, and rounds to powers of two", () => {
    const r = packRects(
      [
        { id: "a", w: 200, h: 200 },
        { id: "b", w: 200, h: 200 },
        { id: "huge", w: 300, h: 10 },
      ],
      { maxSize: 256, padding: 0, extrude: 0, pot: true },
    );
    expect(r.oversized).toEqual(["huge"]);
    expect(r.pages).toHaveLength(2);
    expect(r.pages[0]).toMatchObject({ w: 256, h: 256 });
  });
});
