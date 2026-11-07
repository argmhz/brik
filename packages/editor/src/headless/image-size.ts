/**
 * Reads an image's width and height from its header. Headless (in Node) there
 * is no browser to decode images, and the editor only needs their size: sprite
 * rects, grids and atlas layout are all computed from it.
 */
export function imageSize(bytes: Uint8Array): { width: number; height: number } | null {
  const b = bytes;
  const u16be = (i: number) => (b[i] << 8) | b[i + 1];
  const u16le = (i: number) => b[i] | (b[i + 1] << 8);
  const u32be = (i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
  const ascii = (i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n));

  // PNG: signature, then the IHDR chunk
  if (b.length >= 24 && b[0] === 0x89 && ascii(1, 3) === "PNG") return { width: u32be(16), height: u32be(20) };
  // GIF87a / GIF89a
  if (b.length >= 10 && ascii(0, 3) === "GIF") return { width: u16le(6), height: u16le(8) };
  // JPEG: walk the segments to a start-of-frame marker
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1];
      if (marker === 0xff) {
        i++;
        continue;
      }
      const len = u16be(i + 2);
      const sof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (sof) return { width: u16be(i + 7), height: u16be(i + 5) };
      i += 2 + len;
    }
    return null;
  }
  // WebP: RIFF container with a VP8, VP8L or VP8X chunk
  if (b.length >= 30 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") {
    const chunk = ascii(12, 4);
    if (chunk === "VP8 ") return { width: u16le(26) & 0x3fff, height: u16le(28) & 0x3fff };
    if (chunk === "VP8L") {
      const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    if (chunk === "VP8X") {
      return { width: (b[24] | (b[25] << 8) | (b[26] << 16)) + 1, height: (b[27] | (b[28] << 8) | (b[29] << 16)) + 1 };
    }
  }
  return null;
}
