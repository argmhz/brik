import { describe, expect, it } from "vitest";
import { type BitmapFont, fontToJson, glyphFor, gridFont, layoutBitmapText, measureBitmapLine, parseBMFont, parseFont } from "../src";

/** A 3-character grid font image: "A" is 3 px wide, "I" 1 px, the third cell is empty. Cells are 4 x 5. */
function pixels(): Uint8ClampedArray {
  const w = 12;
  const px = new Uint8ClampedArray(w * 5 * 4);
  const set = (x: number, y: number) => (px[(y * w + x) * 4 + 3] = 255);
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 3; x++) set(x, y); // A in cell 0, columns 0..2
    set(4 + 2, y); // I in cell 1, column 2
  }
  return px;
}

const font = (over: Partial<BitmapFont> = {}): BitmapFont => ({
  guid: "f",
  name: "pixel",
  texture: "t",
  kerning: new Map(),
  ...gridFont({ width: 12, height: 5, cell: [4, 5], chars: "AI?", pixels: pixels() }),
  ...over,
});

describe("grid fonts", () => {
  it("measures each letter's own width, and an empty cell is a space-like gap", () => {
    const f = gridFont({ width: 12, height: 5, cell: [4, 5], chars: "AI ", pixels: pixels() });
    expect(f.glyphs.get("A")).toMatchObject({ x: 0, y: 0, w: 3, h: 5, advance: 4 });
    expect(f.glyphs.get("I")).toMatchObject({ x: 6, w: 1, advance: 2 });
    expect(f.glyphs.get(" ")).toMatchObject({ w: 0, advance: 2 });
    expect(f.lineHeight).toBe(6);
    expect(f.base).toBe(5);
  });

  it("without pixels every letter is a whole cell (monospace), and a space is added", () => {
    const f = gridFont({ width: 12, height: 5, cell: [4, 5], chars: "AI\nX", letterSpacing: 0 });
    expect(f.glyphs.get("I")).toMatchObject({ x: 4, w: 4, advance: 4 });
    expect(f.glyphs.get("X")).toMatchObject({ x: 8 });
    expect(f.glyphs.has(" ")).toBe(true);
  });

  it("goes on to the next row of cells", () => {
    const f = gridFont({ width: 8, height: 10, cell: [4, 5], chars: "ABC" });
    expect(f.glyphs.get("C")).toMatchObject({ x: 0, y: 5 });
  });
});

describe("layout", () => {
  it("places letters by their advance, with kerning", () => {
    const f = font({ kerning: new Map([["AI", -1]]) });
    const l = layoutBitmapText(f, "AIA");
    expect(l.quads.map((q) => q.x)).toEqual([0, 3, 5]);
    expect(l.width).toBe(8);
    expect(l.height).toBe(5);
  });

  it("falls back to the other case, then to ?", () => {
    const f = font();
    expect(glyphFor(f, "a")).toBe(f.glyphs.get("A"));
    expect(glyphFor(f, "Z")).toBe(f.glyphs.get("?"));
  });

  it("breaks lines and wraps words, and aligns lines within the block", () => {
    const f = font();
    expect(layoutBitmapText(f, "A\nAA").lines).toBe(2);
    const wrapped = layoutBitmapText(f, "AA AA", measureBitmapLine(f, "AA"));
    expect(wrapped.lines).toBe(2);
    expect(wrapped.height).toBe(6 + 5);
    const right = layoutBitmapText(f, "AA\nI", 0, "right");
    const iQuad = right.quads[2];
    expect(iQuad.x + iQuad.glyph.w).toBe(right.width);
    expect(iQuad.y).toBe(6);
  });
});

describe(".font.json", () => {
  it("round-trips", () => {
    const f = font({ kerning: new Map([["AI", -1]]) });
    const back = parseFont(fontToJson(f), "pixel");
    expect(back.glyphs).toEqual(f.glyphs);
    expect(back.kerning).toEqual(f.kerning);
    expect(back.lineHeight).toBe(f.lineHeight);
    expect(back.texture).toBe("t");
    expect(fontToJson(f)).toContain('\n    "A": [0, 0, 3, 5, 0, 0, 4]');
  });

  it("needs a guid and a texture", () => {
    expect(() => parseFont('{"texture":"t"}', "x")).toThrow(/guid/);
    expect(() => parseFont('{"guid":"g"}', "x")).toThrow(/texture/);
  });
});

describe("BMFont", () => {
  const text = `info face="Pix" size=8
common lineHeight=10 base=8 scaleW=64 scaleH=64 pages=1
page id=0 file="pix_0.png"
chars count=2
char id=65   x=1 y=2 width=5 height=7 xoffset=0 yoffset=1 xadvance=6 page=0
char id=86   x=7 y=2 width=5 height=7 xoffset=0 yoffset=1 xadvance=6 page=0
kernings count=1
kerning first=65 second=86 amount=-1`;

  it("reads the text form", () => {
    const f = parseBMFont(text);
    expect(f.lineHeight).toBe(10);
    expect(f.base).toBe(8);
    expect(f.pages).toEqual(["pix_0.png"]);
    expect(f.glyphs.get("A")).toEqual({ x: 1, y: 2, w: 5, h: 7, ox: 0, oy: 1, advance: 6 });
    expect(f.kerning.get("AV")).toBe(-1);
  });

  it("reads the XML form", () => {
    const xml = `<?xml version="1.0"?><font><common lineHeight="10" base="8"/><pages><page id="0" file="pix.png" /></pages>
      <chars count="1"><char id="66" x="3" y="4" width="5" height="6" xoffset="1" yoffset="2" xadvance="7" page="0" /></chars></font>`;
    const f = parseBMFont(xml);
    expect(f.pages).toEqual(["pix.png"]);
    expect(f.glyphs.get("B")).toEqual({ x: 3, y: 4, w: 5, h: 6, ox: 1, oy: 2, advance: 7 });
  });

  it("is not something else", () => {
    expect(() => parseBMFont("hello")).toThrow(/BMFont/);
  });
});
