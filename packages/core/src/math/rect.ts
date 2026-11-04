import type { Vec2 } from "./vec2";

/** Axis-aligned rectangle. `x, y` is the minimum corner. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const rect = {
  create(x = 0, y = 0, w = 0, h = 0): Rect {
    return { x, y, w, h };
  },
  contains(r: Rect, p: Vec2): boolean {
    return p.x >= r.x && p.y >= r.y && p.x < r.x + r.w && p.y < r.y + r.h;
  },
  intersects(a: Rect, b: Rect): boolean {
    return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  },
};

/** RGBA color with components in 0..1. */
export interface Color {
  r: number;
  g: number;
  b: number;
  a: number;
}

export const color = {
  create(r = 1, g = 1, b = 1, a = 1): Color {
    return { r, g, b, a };
  },
  /** Parses `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa`. */
  hex(hex: string): Color {
    let h = hex.startsWith("#") ? hex.slice(1) : hex;
    if (h.length === 3 || h.length === 4) {
      h = [...h].map((ch) => ch + ch).join("");
    }
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16) / 255;
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) : 1 };
  },
};
