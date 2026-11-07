import { TextureAsset } from "@brik/assets";
import type { Vec2 } from "@brik/core";

/*
 * Polygons and lines for Shape2D. The sprite batcher draws quads, so these are
 * drawn with Canvas2D into a texture (like text) and shown as a quad over the
 * points' bounds. Rasterized at the size they are shown, so edges stay sharp.
 */

export interface PathStyle {
  points: readonly Vec2[];
  /** Polygon (filled, closed) or line (open, stroked). */
  closed: boolean;
  fill: string;
  stroke: string;
  strokeWidth: number;
  /** Pixels per world unit. */
  resolution: number;
}

export interface PathImage {
  texture: TextureAsset;
  /** Bottom-left of the quad, in the entity's local units. */
  x: number;
  y: number;
  width: number;
  height: number;
  lastUsed: number;
}

const MAX_SIDE = 4096;
const MAX_ENTRIES = 256;

function makeCanvas(w: number, h: number): HTMLCanvasElement | OffscreenCanvas | null {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  if (typeof document !== "undefined") {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    return c;
  }
  return null;
}

/** Bounds of the points, grown by half the stroke (the stroke is centered on the outline). */
export function pathBounds(points: readonly Vec2[], strokeWidth: number): { x: number; y: number; w: number; h: number } | null {
  if (points.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const pad = strokeWidth / 2 + 1;
  return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
}

/** Rasterizes and caches polygons and lines; unused ones are evicted like text. */
export class PathCache {
  private entries = new Map<string, PathImage>();
  private frame = 0;

  constructor(private readonly onEvict?: (tex: TextureAsset) => void) {}

  get(style: PathStyle): PathImage | null {
    const key = JSON.stringify([style.points, style.closed, style.fill, style.stroke, style.strokeWidth, style.resolution]);
    let entry = this.entries.get(key);
    if (!entry) {
      const made = this.rasterize(style);
      if (!made) return null;
      entry = made;
      this.entries.set(key, entry);
    }
    entry.lastUsed = this.frame;
    return entry;
  }

  sweep(): void {
    this.frame++;
    for (const [key, e] of this.entries) {
      if (this.frame - e.lastUsed > 120 || this.entries.size > MAX_ENTRIES) {
        this.entries.delete(key);
        this.onEvict?.(e.texture);
      }
    }
  }

  private rasterize(style: PathStyle): PathImage | null {
    const pts = style.points;
    if (pts.length < 2) return null;
    const b = pathBounds(pts, style.strokeWidth);
    if (!b) return null;
    const res = Math.min(style.resolution, MAX_SIDE / Math.max(1e-6, b.w), MAX_SIDE / Math.max(1e-6, b.h));
    const cw = Math.max(1, Math.ceil(b.w * res));
    const ch = Math.max(1, Math.ceil(b.h * res));
    const canvas = makeCanvas(cw, ch);
    const g = canvas?.getContext("2d") as CanvasRenderingContext2D | null;
    if (!canvas || !g) return null;
    // world y points up, canvas y down
    g.setTransform(res, 0, 0, -res, -b.x * res, (b.y + b.h) * res);
    g.beginPath();
    g.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
    if (style.closed) {
      g.closePath();
      g.fillStyle = style.fill;
      g.fill();
    }
    if (style.strokeWidth > 0) {
      g.lineWidth = style.strokeWidth;
      g.lineJoin = "round";
      g.lineCap = "round";
      g.strokeStyle = style.stroke;
      g.stroke();
    }
    const texture = new TextureAsset(`path:${Math.random().toString(36).slice(2)}`, "path", {
      filter: "linear",
      wrap: "clamp",
      pixelsPerUnit: res,
    });
    texture.setSource(canvas);
    return { texture, x: b.x, y: b.y, width: cw / res, height: ch / res, lastUsed: this.frame };
  }
}

/** A color from 0..1 channels as a CSS string. */
export function cssColor(r: number, g: number, b: number, a: number): string {
  const c = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255);
  return `rgba(${c(r)},${c(g)},${c(b)},${Math.min(1, Math.max(0, a))})`;
}
