/**
 * Draws a small 16x16 pixel-art sprite sheet onto a canvas, so the demo needs
 * no image files. Layout (cells of 16x16, 4 columns):
 *
 *   row 0: hero walk, 4 frames
 *   row 1: coin spin, 4 frames
 *   row 2: grass, grass with flowers, stone, gem (white, tinted at runtime)
 */
export function drawSpriteSheet(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 48;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;

  for (let f = 0; f < 4; f++) drawHero(ctx, f * 16, 0, f);
  for (let f = 0; f < 4; f++) drawCoin(ctx, f * 16, 16, f);
  drawGrass(ctx, 0, 32, false);
  drawGrass(ctx, 16, 32, true);
  drawStone(ctx, 32, 32);
  drawGem(ctx, 48, 32);
  return canvas;
}

function px(ctx: CanvasRenderingContext2D, color: string, x: number, y: number, w = 1, h = 1) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

function drawHero(ctx: CanvasRenderingContext2D, ox: number, oy: number, frame: number) {
  const bob = frame % 2 === 1 ? 1 : 0;
  const y = oy + bob;
  // body
  px(ctx, "#1d2b53", ox + 3, y + 3, 10, 10);
  px(ctx, "#29adff", ox + 4, y + 4, 8, 8);
  px(ctx, "#83e1ff", ox + 4, y + 4, 8, 2);
  // antenna
  px(ctx, "#1d2b53", ox + 7, y + 1, 2, 2);
  px(ctx, "#ff004d", ox + 7, y + 0, 2, 1);
  // eyes (looking right)
  px(ctx, "#fff1e8", ox + 8, y + 6, 2, 3);
  px(ctx, "#fff1e8", ox + 11, y + 6, 1, 3);
  px(ctx, "#000000", ox + 9, y + 7, 1, 2);
  // feet alternate
  const left = frame === 1 ? 1 : 0;
  const right = frame === 3 ? 1 : 0;
  px(ctx, "#1d2b53", ox + 4, oy + 13 - left, 3, 2);
  px(ctx, "#1d2b53", ox + 9, oy + 13 - right, 3, 2);
}

function drawCoin(ctx: CanvasRenderingContext2D, ox: number, oy: number, frame: number) {
  const widths = [10, 6, 2, 6];
  const w = widths[frame];
  const x = ox + 8 - w / 2;
  px(ctx, "#ab5236", x, oy + 3, w, 10);
  px(ctx, "#ffa300", x, oy + 2, w, 11);
  if (w > 2) {
    px(ctx, "#ffec27", x + 1, oy + 3, w - 2, 9);
    px(ctx, "#ffa300", ox + 8 - Math.max(1, w / 4), oy + 5, Math.max(1, w / 2), 5);
  }
}

function drawGrass(ctx: CanvasRenderingContext2D, ox: number, oy: number, flowers: boolean) {
  px(ctx, "#008751", ox, oy, 16, 16);
  // deterministic speckle
  let seed = flowers ? 7 : 3;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % 16);
  for (let i = 0; i < 14; i++) px(ctx, "#00a85f", ox + rnd(), oy + rnd(), 1, 2);
  if (flowers) {
    px(ctx, "#ff77a8", ox + 3, oy + 4, 2, 2);
    px(ctx, "#fff1e8", ox + 11, oy + 9, 2, 2);
    px(ctx, "#ffec27", ox + 6, oy + 12, 2, 2);
  }
}

function drawStone(ctx: CanvasRenderingContext2D, ox: number, oy: number) {
  drawGrass(ctx, ox, oy, false);
  px(ctx, "#5f574f", ox + 3, oy + 5, 10, 8);
  px(ctx, "#83769c", ox + 4, oy + 4, 8, 7);
  px(ctx, "#c2c3c7", ox + 5, oy + 5, 3, 2);
}

function drawGem(ctx: CanvasRenderingContext2D, ox: number, oy: number) {
  for (let r = 0; r < 7; r++) {
    const w = r < 3 ? 4 + r * 4 : 14 - (r - 3) * 4 + 2;
    px(ctx, r < 3 ? "#ffffff" : "#c2c3c7", ox + 8 - w / 2, oy + 2 + r * 2, w, 2);
  }
  px(ctx, "#ffffff", ox + 5, oy + 4, 2, 2);
}
