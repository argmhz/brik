import { type Slicing, type TextureAsset, autoSliceRects, guessGrid } from "@brik/runtime";

type GridSlicing = Extract<Slicing, { mode: "grid" }>;

/** The texture's pixels (RGBA), or null while it isn't loaded. */
export function texturePixels(tex: TextureAsset): Uint8ClampedArray | null {
  const img = tex.source as CanvasImageSource | null;
  if (!img || !tex.width || !tex.height) return null;
  const c = document.createElement("canvas");
  c.width = tex.width;
  c.height = tex.height;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, tex.width, tex.height).data;
}

/**
 * The grid to start from when switching a texture to grid mode: one cell per
 * sprite found in the image (e.g. 8 frames in a row give 8 columns), or 16x16
 * cells when nothing is found.
 */
export function startGrid(tex: TextureAsset): { slicing: GridSlicing; guessed: { cols: number; rows: number } | null } {
  const px = texturePixels(tex);
  const guess = px ? guessGrid(autoSliceRects(px, tex.width, tex.height), tex.width, tex.height) : null;
  const fallback = Math.max(1, Math.min(16, tex.width, tex.height));
  return {
    slicing: { mode: "grid", cell: guess?.cell ?? [fallback, fallback], offset: [0, 0], spacing: [0, 0], pivot: [0.5, 0.5] },
    guessed: guess ? { cols: guess.cols, rows: guess.rows } : null,
  };
}
