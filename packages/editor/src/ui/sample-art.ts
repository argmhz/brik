/**
 * A small pixel-art sprite sheet (64x48, 16x16 cells) that new projects start
 * with, so there is something to drag into the scene right away.
 *   row 0: hero walk (4 frames) · row 1: coin spin (4) · row 2: grass, flowers, stone, gem
 */
export async function samplePng(): Promise<Uint8Array> {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 48;
  const ctx = canvas.getContext("2d")!;
  const px = (c: string, x: number, y: number, w = 1, h = 1) => {
    ctx.fillStyle = c;
    ctx.fillRect(x, y, w, h);
  };

  for (let f = 0; f < 4; f++) {
    const ox = f * 16;
    const y = f % 2 === 1 ? 1 : 0;
    px("#1d2b53", ox + 3, y + 3, 10, 10);
    px("#29adff", ox + 4, y + 4, 8, 8);
    px("#83e1ff", ox + 4, y + 4, 8, 2);
    px("#1d2b53", ox + 7, y + 1, 2, 2);
    px("#ff004d", ox + 7, y, 2, 1);
    px("#fff1e8", ox + 8, y + 6, 2, 3);
    px("#fff1e8", ox + 11, y + 6, 1, 3);
    px("#000000", ox + 9, y + 7, 1, 2);
    px("#1d2b53", ox + 4, 13 - (f === 1 ? 1 : 0), 3, 2);
    px("#1d2b53", ox + 9, 13 - (f === 3 ? 1 : 0), 3, 2);
  }
  [10, 6, 2, 6].forEach((w, f) => {
    const x = f * 16 + 8 - w / 2;
    px("#ffa300", x, 18, w, 11);
    if (w > 2) px("#ffec27", x + 1, 19, w - 2, 9);
  });
  for (let i = 0; i < 3; i++) {
    const ox = i * 16;
    px("#008751", ox, 32, 16, 16);
    let seed = 3 + i;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % 16;
    for (let k = 0; k < 14; k++) px("#00a85f", ox + rnd(), 32 + rnd(), 1, 2);
  }
  px("#ff77a8", 19, 36, 2, 2);
  px("#fff1e8", 27, 41, 2, 2);
  px("#5f574f", 35, 37, 10, 8);
  px("#83769c", 36, 36, 8, 7);
  for (let r = 0; r < 7; r++) {
    const w = [4, 8, 12, 16, 12, 8, 4][r];
    px(r < 3 ? "#ffffff" : "#c2c3c7", 56 - w / 2, 34 + r * 2, w, 2);
  }

  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png"),
  );
  return new Uint8Array(await blob.arrayBuffer());
}

/** Import settings for the sample sheet: pixel art, cut into a 16x16 grid. */
export function sampleMeta(guid: string): string {
  const names = ["hero_0", "hero_1", "hero_2", "hero_3", "coin_0", "coin_1", "coin_2", "coin_3", "grass", "flowers", "stone", "gem"];
  return `${JSON.stringify(
    {
      guid,
      importer: "texture",
      settings: { filter: "nearest", wrap: "clamp", pixelsPerUnit: 1 },
      slicing: { mode: "grid", cell: [16, 16], offset: [0, 0], spacing: [0, 0], pivot: [0.5, 0.5] },
      sprites: names.map((name, i) => ({
        id: `cell_${i}`,
        name,
        rect: [(i % 4) * 16, Math.floor(i / 4) * 16, 16, 16],
        pivot: [0.5, 0.5],
      })),
    },
    null,
    2,
  )}\n`;
}
