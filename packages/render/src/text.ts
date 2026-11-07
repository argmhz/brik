import { TextureAsset } from "@brik/assets";

export interface TextStyle {
  text: string;
  size: number;
  font: string;
  align: string;
  bold: boolean;
  maxWidth: number;
  lineHeight: number;
  /**
   * Pixels rasterized per world unit. Set from how big the text is on screen,
   * so it stays sharp when zoomed in. Default 2.
   */
  resolution?: number;
}

export interface TextImage {
  /** White text on transparent; tinted by the sprite color when drawn. */
  texture: TextureAsset;
  /** Size in world units. */
  width: number;
  height: number;
  /** Normalized x pivot, from the alignment. */
  pivotX: number;
  lastUsed: number;
}

/** Pixels per world unit when nothing better is known. */
const DEFAULT_RESOLUTION = 2;
const MAX_ENTRIES = 512;
/** Largest rasterized text, in pixels per side (big text at high zoom gets a lower resolution). */
const MAX_SIDE = 4096;
/** Resolutions text is rasterized at: zooming re-rasterizes only when crossing a step. */
const STEPS = [1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32];

/** The rasterization step for text shown at `pixelsPerUnit` screen pixels per world unit. */
export function textResolution(pixelsPerUnit: number): number {
  return STEPS.find((s) => s >= pixelsPerUnit - 1e-6) ?? STEPS[STEPS.length - 1];
}

let measureCtx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null | undefined;

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

function context2d() {
  if (measureCtx === undefined) measureCtx = (makeCanvas(1, 1)?.getContext("2d") as typeof measureCtx) ?? null;
  return measureCtx;
}

const fontString = (s: TextStyle, scale: number) =>
  `${s.bold ? "bold " : ""}${Math.max(1, s.size * scale)}px ${s.font || "sans-serif"}`;

/** Splits text into lines, wrapping words at `maxWidth` (world units) when it is > 0. */
export function layoutLines(style: TextStyle, measure: (s: string) => number): string[] {
  const out: string[] = [];
  for (const para of style.text.split("\n")) {
    if (style.maxWidth <= 0) {
      out.push(para);
      continue;
    }
    let line = "";
    for (const word of para.split(/(\s+)/)) {
      const next = line + word;
      if (line.trim() !== "" && measure(next.trimEnd()) > style.maxWidth) {
        out.push(line.trimEnd());
        line = word.trimStart();
      } else line = next;
    }
    out.push(line.trimEnd());
  }
  return out;
}

/**
 * Rasterizes and caches text. Entries that aren't used for a while are evicted
 * and passed to `onEvict` so the renderer can free the GPU copy.
 */
export class TextCache {
  private entries = new Map<string, TextImage>();
  private frame = 0;

  constructor(private readonly onEvict?: (tex: TextureAsset) => void) {}

  get size(): number {
    return this.entries.size;
  }

  get(style: TextStyle): TextImage | null {
    const key = `${style.text}\u0000${style.size}\u0000${style.font}\u0000${style.align}\u0000${style.bold}\u0000${style.maxWidth}\u0000${style.lineHeight}\u0000${style.resolution ?? DEFAULT_RESOLUTION}`;
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

  /** Call once per frame. Drops entries unused for ~2 seconds, or the oldest when over the limit. */
  sweep(): void {
    this.frame++;
    for (const [key, e] of this.entries) {
      if (this.frame - e.lastUsed > 120 || this.entries.size > MAX_ENTRIES) {
        this.entries.delete(key);
        this.onEvict?.(e.texture);
      }
    }
  }

  private rasterize(style: TextStyle): TextImage | null {
    const ctx = context2d();
    if (!ctx) return null;
    ctx.font = fontString(style, 1);
    const lines = layoutLines(style, (s) => ctx.measureText(s).width);
    const lineH = style.size * style.lineHeight;
    const width = Math.max(1, ...lines.map((l) => ctx.measureText(l).width), style.maxWidth > 0 ? 0 : 1);
    const height = Math.max(1, lines.length * lineH);
    const pad = 2;
    // never more pixels than MAX_SIDE on a side
    const RESOLUTION = Math.min(style.resolution ?? DEFAULT_RESOLUTION, MAX_SIDE / (width + pad * 2), MAX_SIDE / (height + pad * 2));
    const cw = Math.ceil((width + pad * 2) * RESOLUTION);
    const ch = Math.ceil((height + pad * 2) * RESOLUTION);
    const canvas = makeCanvas(cw, ch);
    const g = canvas?.getContext("2d") as CanvasRenderingContext2D | null;
    if (!canvas || !g) return null;
    g.scale(RESOLUTION, RESOLUTION);
    g.font = fontString(style, 1);
    g.fillStyle = "#fff";
    g.textBaseline = "middle";
    g.textAlign = style.align === "left" ? "left" : style.align === "right" ? "right" : "center";
    const x = style.align === "left" ? pad : style.align === "right" ? pad + width : pad + width / 2;
    lines.forEach((l, i) => g.fillText(l, x, pad + lineH * (i + 0.5)));
    const texture = new TextureAsset(`text:${Math.random().toString(36).slice(2)}`, "text", {
      filter: "linear",
      wrap: "clamp",
      pixelsPerUnit: RESOLUTION,
    });
    texture.setSource(canvas);
    const totalW = cw / RESOLUTION;
    return {
      texture,
      width: totalW,
      height: ch / RESOLUTION,
      // align the text block's edge (not the padding) with the entity
      pivotX: style.align === "left" ? pad / totalW : style.align === "right" ? (pad + width) / totalW : 0.5,
      lastUsed: this.frame,
    };
  }
}
