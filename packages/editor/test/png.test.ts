import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { encodePng, parseHexColor } from "../src/core/png";

describe("png", () => {
  it("encodes RGBA pixels that zlib can read back", () => {
    const w = 3;
    const h = 2;
    const rgba = new Uint8Array(w * h * 4).map((_, i) => (i * 37) % 256);
    const png = encodePng(w, h, rgba);
    expect([...png.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const view = new DataView(png.buffer);
    expect(String.fromCharCode(...png.slice(12, 16))).toBe("IHDR");
    expect([view.getUint32(16), view.getUint32(20)]).toEqual([w, h]);
    const idatLen = view.getUint32(33);
    expect(String.fromCharCode(...png.slice(37, 41))).toBe("IDAT");
    const raw = inflateSync(png.slice(41, 41 + idatLen));
    for (let y = 0; y < h; y++) {
      expect(raw[y * (w * 4 + 1)]).toBe(0);
      expect([...raw.slice(y * (w * 4 + 1) + 1, (y + 1) * (w * 4 + 1))]).toEqual([...rgba.slice(y * w * 4, (y + 1) * w * 4)]);
    }
  });

  it("splits big images into several stored blocks", () => {
    const w = 200;
    const h = 100; // 80 KB of pixel data, more than one 64 KB block
    const rgba = new Uint8Array(w * h * 4).fill(200);
    const png = encodePng(w, h, rgba);
    const idatLen = new DataView(png.buffer).getUint32(33);
    expect(inflateSync(png.slice(41, 41 + idatLen)).length).toBe(h * (w * 4 + 1));
  });

  it("parses hex colours", () => {
    expect(parseHexColor("#fff")).toEqual([255, 255, 255, 255]);
    expect(parseHexColor("3fa34d")).toEqual([0x3f, 0xa3, 0x4d, 255]);
    expect(parseHexColor("#00000080")).toEqual([0, 0, 0, 128]);
    expect(parseHexColor("red")).toBeNull();
  });
});
