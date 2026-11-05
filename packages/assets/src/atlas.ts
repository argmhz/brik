/** Atlas packing with MaxRects (best short side fit). Pure math, so it can run in a worker. */

export interface PackItem {
  id: string;
  w: number;
  h: number;
}

export interface PackOptions {
  /** Largest page size in pixels (width and height). */
  maxSize: number;
  /** Empty pixels between items (on top of `extrude`). */
  padding: number;
  /** Pixels each item's edge is repeated outward, against bleeding at odd zoom levels. */
  extrude: number;
  /** Round page sizes up to powers of two. */
  pot: boolean;
}

export interface PackedItem {
  id: string;
  page: number;
  /** Where the item's own pixels go (inside its extrude border). */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PackResult {
  pages: { w: number; h: number; /** 0..1, share of the page covered by items */ used: number }[];
  items: PackedItem[];
  /** Items too big for `maxSize`. They are not in `items`. */
  oversized: string[];
}

export const DEFAULT_PACK_OPTIONS: PackOptions = { maxSize: 2048, padding: 2, extrude: 1, pot: false };

interface Free {
  x: number;
  y: number;
  w: number;
  h: number;
}

class Bin {
  free: Free[];
  used: Free[] = [];
  constructor(readonly size: number) {
    this.free = [{ x: 0, y: 0, w: size, h: size }];
  }

  /** Best short side fit. Returns null if it doesn't fit. */
  insert(w: number, h: number): Free | null {
    let best: Free | null = null;
    let bestShort = Infinity;
    let bestLong = Infinity;
    for (const f of this.free) {
      if (w > f.w || h > f.h) continue;
      const short = Math.min(f.w - w, f.h - h);
      const long = Math.max(f.w - w, f.h - h);
      if (short < bestShort || (short === bestShort && long < bestLong)) {
        best = { x: f.x, y: f.y, w, h };
        bestShort = short;
        bestLong = long;
      }
    }
    if (best) this.place(best);
    return best;
  }

  private place(node: Free): void {
    const next: Free[] = [];
    for (const f of this.free) {
      if (node.x >= f.x + f.w || node.x + node.w <= f.x || node.y >= f.y + f.h || node.y + node.h <= f.y) {
        next.push(f);
        continue;
      }
      // split the free rect around the node into up to four maximal rects
      if (node.x > f.x) next.push({ x: f.x, y: f.y, w: node.x - f.x, h: f.h });
      if (node.x + node.w < f.x + f.w) next.push({ x: node.x + node.w, y: f.y, w: f.x + f.w - node.x - node.w, h: f.h });
      if (node.y > f.y) next.push({ x: f.x, y: f.y, w: f.w, h: node.y - f.y });
      if (node.y + node.h < f.y + f.h) next.push({ x: f.x, y: node.y + node.h, w: f.w, h: f.y + f.h - node.y - node.h });
    }
    // drop free rects contained in others
    this.free = next.filter(
      (a, i) =>
        !next.some(
          (b, j) => i !== j && a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h && (j < i || a.w !== b.w || a.h !== b.h || a.x !== b.x || a.y !== b.y),
        ),
    );
    this.used.push(node);
  }
}

const nextPot = (n: number) => 2 ** Math.ceil(Math.log2(Math.max(1, n)));

/** Packs items onto as few pages as needed. Biggest items go first. */
export function packRects(items: PackItem[], options: Partial<PackOptions> = {}): PackResult {
  const o = { ...DEFAULT_PACK_OPTIONS, ...options };
  const border = o.extrude;
  // each item takes its size plus extrude on both sides plus padding on the right/bottom
  const cell = (it: PackItem) => ({ w: it.w + border * 2 + o.padding, h: it.h + border * 2 + o.padding });
  const oversized: string[] = [];
  const queue = items
    .filter((it) => {
      const c = cell(it);
      const fits = c.w - o.padding <= o.maxSize && c.h - o.padding <= o.maxSize;
      if (!fits) oversized.push(it.id);
      return fits;
    })
    .sort((a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h) || b.w * b.h - a.w * a.h || a.id.localeCompare(b.id));

  // the bin is a bit bigger than maxSize so the last padding on the right/bottom edge doesn't count
  const bins: Bin[] = [];
  const out: PackedItem[] = [];
  for (const it of queue) {
    const c = cell(it);
    let placed: Free | null = null;
    let page = 0;
    for (; page < bins.length && !placed; page++) placed = bins[page].insert(c.w, c.h);
    if (placed) page--;
    else {
      bins.push(new Bin(o.maxSize + o.padding));
      page = bins.length - 1;
      placed = bins[page].insert(c.w, c.h)!;
    }
    out.push({ id: it.id, page, x: placed.x + border, y: placed.y + border, w: it.w, h: it.h });
  }

  const pages = bins.map((_, i) => {
    let w = 1;
    let h = 1;
    let area = 0;
    for (const it of out) {
      if (it.page !== i) continue;
      w = Math.max(w, it.x + it.w + border);
      h = Math.max(h, it.y + it.h + border);
      area += it.w * it.h;
    }
    if (o.pot) {
      w = nextPot(w);
      h = nextPot(h);
    }
    return { w, h, used: area / (w * h) };
  });
  return { pages, items: out, oversized };
}
