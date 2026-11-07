import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { encodePng } from "../src/core/png";
import { NodeFS, imageSize } from "../src/headless";

describe("headless helpers", () => {
  it("reads image sizes from PNG, GIF, JPEG and WebP headers", () => {
    expect(imageSize(encodePng(37, 5, new Uint8Array(37 * 5 * 4)))).toEqual({ width: 37, height: 5 });
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x2c, 0x01, 0x10, 0x00]);
    expect(imageSize(gif)).toEqual({ width: 300, height: 16 });
    // SOI, an APP0 segment, then SOF0 with height 480, width 640
    const jpeg = new Uint8Array([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0xe0, 0x02, 0x80, 0x03,
    ]);
    expect(imageSize(jpeg)).toEqual({ width: 640, height: 480 });
    // RIFF....WEBPVP8X: canvas size minus one, 24 bits each
    const webp = new Uint8Array(30);
    webp.set([..."RIFF"].map((c) => c.charCodeAt(0)), 0);
    webp.set([..."WEBPVP8X"].map((c) => c.charCodeAt(0)), 8);
    webp.set([0xcf, 0x07, 0x00, 0x9a, 0x02, 0x00], 24); // 1999 -> 2000, 666 -> 667
    expect(imageSize(webp)).toEqual({ width: 2000, height: 667 });
    expect(imageSize(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  it("NodeFS keeps paths inside the project folder", async () => {
    const dir = mkdtempSync(join(tmpdir(), "brik-nodefs-"));
    try {
      const fs = new NodeFS(dir);
      await fs.writeFile("a/b.txt", "hej");
      await fs.writeFile(".hidden/x", "1");
      expect(await fs.readText("a/b.txt")).toBe("hej");
      expect((await fs.list()).map((e) => e.name)).toEqual(["a"]);
      // ".." can't climb out of the root
      await fs.writeFile("../../escape.txt", "x");
      expect(await fs.exists("escape.txt")).toBe(true);
      await expect(fs.remove("")).rejects.toThrow(/project folder/);
      await fs.remove("a");
      expect(await fs.exists("a/b.txt")).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
