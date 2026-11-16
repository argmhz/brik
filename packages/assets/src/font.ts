/*
 * Bitmap fonts: text drawn letter by letter from an image, so pixel-art text stays sharp. A font is a
 * `<name>.font.json` next to its image. It says where each character is in the image (in pixels, y down,
 * like BMFont), how far to move on after it, and the line height. Text2D and UIText use a bitmap font when
 * their `font` is its name.
 */

/** One character in a bitmap font. All values are in the font image's pixels. */
export interface Glyph {
  /** Rectangle in the image (y down, origin top-left). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Where the rectangle is drawn, from the pen position (x) and the top of the line (y, down). */
  ox: number;
  oy: number;
  /** How far the pen moves on after this character. */
  advance: number;
}

export interface BitmapFont {
  guid: string;
  name: string;
  /** Guid of the image (texture) the characters are in. */
  texture: string;
  /** Pixels from one line to the next. */
  lineHeight: number;
  /** Pixels from the top of a line to the baseline. */
  base: number;
  glyphs: Map<string, Glyph>;
  /** Extra space between two characters, keyed by the pair, e.g. "AV": -1. */
  kerning: Map<string, number>;
}

export const FONT_EXTENSION = ".font.json";

interface FontJson {
  guid: string;
  importer: "font";
  texture: string;
  lineHeight: number;
  base?: number;
  /** char -> [x, y, w, h, ox, oy, advance] */
  glyphs: Record<string, [number, number, number, number, number, number, number]>;
  kerning?: Record<string, number>;
}

export function fontToJson(font: BitmapFont): string {
  const json: FontJson = {
    guid: font.guid,
    importer: "font",
    texture: font.texture,
    lineHeight: font.lineHeight,
    base: font.base,
    glyphs: Object.fromEntries([...font.glyphs].map(([ch, g]) => [ch, [g.x, g.y, g.w, g.h, g.ox, g.oy, g.advance]])),
  };
  if (font.kerning.size > 0) json.kerning = Object.fromEntries(font.kerning);
  // one glyph per line keeps the file readable and the diffs small
  const glyphs = Object.entries(json.glyphs)
    .map(([ch, g]) => `    ${JSON.stringify(ch)}: [${g.join(", ")}]`)
    .join(",\n");
  const { glyphs: _, ...rest } = json;
  const head = JSON.stringify(rest, null, 2).slice(0, -2);
  return `${head},\n  "glyphs": {\n${glyphs}\n  }\n}\n`;
}

export function parseFont(text: string, name: string): BitmapFont {
  const j = JSON.parse(text) as Partial<FontJson>;
  if (typeof j.guid !== "string") throw new Error("Brik: font file has no guid");
  if (typeof j.texture !== "string") throw new Error("Brik: font file has no texture");
  const glyphs = new Map<string, Glyph>();
  for (const [ch, g] of Object.entries(j.glyphs ?? {})) {
    if (!Array.isArray(g) || g.length < 4) continue;
    const [x, y, w, h, ox = 0, oy = 0, advance = w] = g.map(Number);
    glyphs.set(ch, { x, y, w, h, ox, oy, advance });
  }
  const lineHeight = j.lineHeight && j.lineHeight > 0 ? j.lineHeight : Math.max(1, ...[...glyphs.values()].map((g) => g.oy + g.h));
  return {
    guid: j.guid,
    name,
    texture: j.texture,
    lineHeight,
    base: j.base ?? lineHeight,
    glyphs,
    kerning: new Map(Object.entries(j.kerning ?? {}).filter(([, v]) => typeof v === "number")),
  };
}

// ------------------------------------------------------------------ making fonts

export interface GridFontOptions {
  /** Image size in pixels. */
  width: number;
  height: number;
  /** Cell size in pixels. */
  cell: [number, number];
  /** The characters in the image, left to right, top to bottom. Line breaks are ignored. */
  chars: string;
  /** Where the first cell starts, and the gap between cells (pixels). */
  offset?: [number, number];
  spacing?: [number, number];
  /** Pixels between characters. Default 1. */
  letterSpacing?: number;
  /** Extra pixels between lines. Default 1. */
  lineSpacing?: number;
  /**
   * The image's RGBA pixels. With them each character is as wide as its own pixels (a proportional font),
   * and an empty cell is a space. Without them every character is a whole cell (a monospace font).
   */
  pixels?: Uint8ClampedArray | Uint8Array | null;
}

/** The glyphs, line height and base of a font drawn in a grid of equal cells. */
export function gridFont(opts: GridFontOptions): Pick<BitmapFont, "glyphs" | "lineHeight" | "base"> {
  const [cw, ch] = opts.cell.map((v) => Math.max(1, Math.round(v))) as [number, number];
  const [ox, oy] = opts.offset ?? [0, 0];
  const [sx, sy] = opts.spacing ?? [0, 0];
  const letter = opts.letterSpacing ?? 1;
  const cols = Math.max(1, Math.floor((opts.width - ox + sx) / (cw + sx)));
  const rows = Math.max(1, Math.floor((opts.height - oy + sy) / (ch + sy)));
  const chars = [...opts.chars.replace(/[\r\n]/g, "")];
  const px = opts.pixels;
  const solid = (x: number, y: number) => !!px && px[(y * opts.width + x) * 4 + 3] > 16;
  const glyphs = new Map<string, Glyph>();
  chars.forEach((c, i) => {
    if (i >= cols * rows || glyphs.has(c)) return;
    const x = ox + (i % cols) * (cw + sx);
    const y = oy + Math.floor(i / cols) * (ch + sy);
    let left = 0;
    let right = cw - 1;
    if (px) {
      // trim empty columns on both sides
      const used = (cx: number) => {
        for (let yy = 0; yy < ch; yy++) if (solid(x + cx, y + yy)) return true;
        return false;
      };
      while (left < cw && !used(left)) left++;
      while (right >= left && !used(right)) right--;
      if (left > right) {
        // nothing drawn: a space (or a character left empty) is half a cell wide
        glyphs.set(c, { x, y, w: 0, h: 0, ox: 0, oy: 0, advance: Math.max(1, Math.round(cw / 2)) });
        return;
      }
    }
    const w = right - left + 1;
    glyphs.set(c, { x: x + left, y, w, h: ch, ox: 0, oy: 0, advance: w + letter });
  });
  if (!glyphs.has(" ")) glyphs.set(" ", { x: 0, y: 0, w: 0, h: 0, ox: 0, oy: 0, advance: Math.max(1, Math.round(cw / 2)) });
  return { glyphs, lineHeight: ch + (opts.lineSpacing ?? 1), base: ch };
}

export interface BMFontData {
  lineHeight: number;
  base: number;
  /** Image file names, one per page. Brik uses only page 0. */
  pages: string[];
  glyphs: Map<string, Glyph>;
  kerning: Map<string, number>;
  /** Characters on other pages than 0, left out. */
  skipped: number;
}

/** Reads an AngelCode BMFont `.fnt` file, in its text or XML form (made by BMFont, Hiero, Littera, ...). */
export function parseBMFont(text: string): BMFontData {
  const xml = text.trimStart().startsWith("<");
  const lines: { tag: string; attrs: Record<string, string> }[] = [];
  if (xml) {
    for (const m of text.matchAll(/<(\w+)\s([^>]*?)\/?>/g)) lines.push({ tag: m[1], attrs: attrsOf(m[2]) });
  } else {
    for (const line of text.split(/\r?\n/)) {
      const m = /^(\w+)\s+(.*)$/.exec(line.trim());
      if (m) lines.push({ tag: m[1], attrs: attrsOf(m[2]) });
    }
  }
  const num = (a: Record<string, string>, k: string) => Number(a[k] ?? 0) || 0;
  const common = lines.find((l) => l.tag === "common");
  if (!common) throw new Error("Brik: not a BMFont file (no 'common' line)");
  const out: BMFontData = {
    lineHeight: num(common.attrs, "lineHeight"),
    base: num(common.attrs, "base"),
    pages: lines.filter((l) => l.tag === "page").sort((a, b) => num(a.attrs, "id") - num(b.attrs, "id")).map((l) => l.attrs.file ?? ""),
    glyphs: new Map(),
    kerning: new Map(),
    skipped: 0,
  };
  for (const l of lines) {
    if (l.tag === "char") {
      const a = l.attrs;
      if (num(a, "page") !== 0) {
        out.skipped++;
        continue;
      }
      const id = num(a, "id");
      if (id < 0) continue;
      out.glyphs.set(String.fromCodePoint(id), {
        x: num(a, "x"),
        y: num(a, "y"),
        w: num(a, "width"),
        h: num(a, "height"),
        ox: num(a, "xoffset"),
        oy: num(a, "yoffset"),
        advance: num(a, "xadvance"),
      });
    } else if (l.tag === "kerning") {
      const amount = num(l.attrs, "amount");
      if (amount) out.kerning.set(String.fromCodePoint(num(l.attrs, "first")) + String.fromCodePoint(num(l.attrs, "second")), amount);
    }
  }
  if (out.lineHeight <= 0) out.lineHeight = Math.max(1, ...[...out.glyphs.values()].map((g) => g.oy + g.h));
  return out;
}

function attrsOf(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of s.matchAll(/(\w+)=(?:"([^"]*)"|(\S+))/g)) out[m[1]] = m[2] ?? m[3];
  return out;
}

// ------------------------------------------------------------------ layout

export interface BitmapQuad {
  glyph: Glyph;
  /** Top-left of the glyph's rectangle in the text block, in font pixels (y down). */
  x: number;
  y: number;
}

export interface BitmapTextLayout {
  quads: BitmapQuad[];
  /** Size of the text block in font pixels. */
  width: number;
  height: number;
  lines: number;
}

/** The glyph drawn for a character: itself, else the other case (many pixel fonts have only capitals), else "?". */
export function glyphFor(font: BitmapFont, c: string): Glyph | undefined {
  return font.glyphs.get(c) ?? font.glyphs.get(c.toUpperCase()) ?? font.glyphs.get(c.toLowerCase()) ?? font.glyphs.get("?");
}

const spaceAdvance = (font: BitmapFont) => glyphFor(font, " ")?.advance ?? Math.max(1, Math.round(font.lineHeight / 3));

/** Width of one line of text in font pixels (the last character counts its rectangle, not its advance). */
export function measureBitmapLine(font: BitmapFont, line: string): number {
  let pen = 0;
  let right = 0;
  let prev = "";
  for (const c of line) {
    const g = c === " " ? undefined : glyphFor(font, c);
    pen += font.kerning.get(prev + c) ?? 0;
    if (g) {
      if (g.w > 0) right = Math.max(right, pen + g.ox + g.w);
      pen += g.advance;
    } else pen += spaceAdvance(font);
    prev = c;
  }
  return Math.max(right, 0);
}

/**
 * Lays text out in font pixels: line breaks, word wrap at `maxWidth` (font pixels, 0 for none) and
 * alignment within the widest line.
 */
export function layoutBitmapText(font: BitmapFont, text: string, maxWidth = 0, align: "left" | "center" | "right" | string = "left"): BitmapTextLayout {
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    if (maxWidth <= 0) {
      lines.push(para);
      continue;
    }
    let line = "";
    for (const word of para.split(/( +)/)) {
      const next = line + word;
      if (line.trim() !== "" && measureBitmapLine(font, next.trimEnd()) > maxWidth) {
        lines.push(line.trimEnd());
        line = word.trimStart();
      } else line = next;
    }
    lines.push(line.trimEnd());
  }
  const widths = lines.map((l) => measureBitmapLine(font, l));
  const width = Math.max(0, ...widths);
  const quads: BitmapQuad[] = [];
  lines.forEach((line, i) => {
    let pen = align === "right" ? width - widths[i] : align === "center" ? Math.round((width - widths[i]) / 2) : 0;
    let prev = "";
    for (const c of line) {
      pen += font.kerning.get(prev + c) ?? 0;
      const g = c === " " ? undefined : glyphFor(font, c);
      if (g) {
        if (g.w > 0 && g.h > 0) quads.push({ glyph: g, x: pen + g.ox, y: i * font.lineHeight + g.oy });
        pen += g.advance;
      } else pen += spaceAdvance(font);
      prev = c;
    }
  });
  // the last line ends at its glyphs, not at the gap to a next line
  const lastBottom = Math.max(font.base, ...quads.filter((q) => q.y >= (lines.length - 1) * font.lineHeight).map((q) => q.y + q.glyph.h - (lines.length - 1) * font.lineHeight));
  const height = (lines.length - 1) * font.lineHeight + Math.min(font.lineHeight, lastBottom);
  return { quads, width, height, lines: lines.length };
}
