import type { AtlasPlan } from "../core/export";

/** Draws an atlas page, repeating each image's edge pixels `extrude` times outward. */
export function drawPageCanvas(page: AtlasPlan["pages"][number], extrude: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = page.w;
  c.height = page.h;
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  // copies a rect of the image to (dx, dy), repeating its edge pixels `e` times outward
  const blit = (src: CanvasImageSource, sx: number, sy: number, w: number, h: number, dx: number, dy: number, e: number) => {
    ctx.drawImage(src, sx, sy, w, h, dx, dy, w, h);
    if (e <= 0) return;
    ctx.drawImage(src, sx, sy, 1, h, dx - e, dy, e, h);
    ctx.drawImage(src, sx + w - 1, sy, 1, h, dx + w, dy, e, h);
    ctx.drawImage(src, sx, sy, w, 1, dx, dy - e, w, e);
    ctx.drawImage(src, sx, sy + h - 1, w, 1, dx, dy + h, w, e);
    ctx.drawImage(src, sx, sy, 1, 1, dx - e, dy - e, e, e);
    ctx.drawImage(src, sx + w - 1, sy, 1, 1, dx + w, dy - e, e, e);
    ctx.drawImage(src, sx, sy + h - 1, 1, 1, dx - e, dy + h, e, e);
    ctx.drawImage(src, sx + w - 1, sy + h - 1, 1, 1, dx + w, dy + h, e, e);
  };
  for (const p of page.placements) {
    const src = p.entry.asset.source as CanvasImageSource | null;
    if (!src) continue;
    // a sheet packed sprite by sprite: each sprite with its own extrude
    if (p.sprites) for (const s of p.sprites) blit(src, s.src.x, s.src.y, s.src.w, s.src.h, p.x + s.x, p.y + s.y, extrude);
    else blit(src, 0, 0, p.entry.asset.width, p.entry.asset.height, p.x, p.y, extrude);
  }
  return c;
}

export async function drawPage(page: AtlasPlan["pages"][number], extrude: number): Promise<Uint8Array> {
  const c = drawPageCanvas(page, extrude);
  const blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("toBlob failed"))), "image/png"));
  return new Uint8Array(await blob.arrayBuffer());
}
