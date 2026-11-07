/*
 * Runtime errors in game scripts point into the bundle esbuild made of all
 * scripts, loaded from a blob: (browser) or data: (Node) URL. This turns those
 * positions back into project files and lines with the bundle's source map,
 * so the Console can say "scripts/Player.ts:42" and open the line.
 */

export interface SourcePosition {
  /** Project-relative path, e.g. "scripts/Player.ts". */
  file: string;
  /** 1-based. */
  line: number;
  /** 0-based, like compile errors. */
  column: number;
}

interface RawSourceMap {
  sources: string[];
  mappings: string;
}

/** [generated column, source index, source line, source column], all 0-based. */
type Segment = [number, number, number, number];

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const DIGIT = new Map([...BASE64].map((c, i) => [c, i]));

/** Decodes the "mappings" field: per generated line, its segments sorted by column. */
function decodeMappings(mappings: string): Segment[][] {
  const lines: Segment[][] = [];
  let src = 0;
  let srcLine = 0;
  let srcCol = 0;
  for (const lineText of mappings.split(";")) {
    const segments: Segment[] = [];
    let genCol = 0;
    for (const part of lineText.split(",")) {
      if (!part) continue;
      const values: number[] = [];
      let shift = 0;
      let value = 0;
      for (const ch of part) {
        const d = DIGIT.get(ch);
        if (d === undefined) break;
        value += (d & 31) << shift;
        if (d & 32) {
          shift += 5;
        } else {
          values.push(value & 1 ? -(value >>> 1) : value >>> 1);
          value = 0;
          shift = 0;
        }
      }
      genCol += values[0] ?? 0;
      if (values.length < 4) continue; // a segment without a source
      src += values[1];
      srcLine += values[2];
      srcCol += values[3];
      segments.push([genCol, src, srcLine, srcCol]);
    }
    lines.push(segments);
  }
  return lines;
}

/** Looks up original positions in one compiled bundle. */
export class SourceMapper {
  private readonly lines: Segment[][];
  private readonly sources: string[];

  constructor(map: RawSourceMap) {
    this.lines = decodeMappings(map.mappings);
    // esbuild names project files after the plugin namespace: "project:scripts/Player.ts"
    this.sources = map.sources.map((s) => s.replace(/^project:/, ""));
  }

  /** Reads the inline source map at the end of esbuild's output, or null when there is none. */
  static fromCode(code: string): SourceMapper | null {
    const m = /\/\/# sourceMappingURL=data:application\/json;(?:charset=utf-8;)?base64,([A-Za-z0-9+/=]+)\s*$/.exec(code);
    if (!m) return null;
    try {
      const json = new TextDecoder().decode(Uint8Array.from(atob(m[1]), (c) => c.charCodeAt(0)));
      return new SourceMapper(JSON.parse(json) as RawSourceMap);
    } catch {
      return null;
    }
  }

  /** The original position of a generated one (line 1-based, column 1-based, as in stack traces). */
  lookup(line: number, column: number): SourcePosition | null {
    const segments = this.lines[line - 1];
    if (!segments?.length) return null;
    // the last segment that starts at or before the column
    let best: Segment | null = null;
    for (const s of segments) {
      if (s[0] <= column - 1) best = s;
      else break;
    }
    best ??= segments[0];
    const file = this.sources[best[1]];
    // only project scripts; the bundle's own glue (the entry, "brik") isn't useful to show
    if (!file || file.startsWith("brik-")) return null;
    return { file, line: best[2] + 1, column: best[3] };
  }
}

/**
 * A stack frame location at the end of a line: "(url:line:col)" (V8) or
 * "@url:line:col" (Firefox, Safari). Only blob: and data: URLs, which is how
 * the editor loads the script bundle.
 */
const FRAME = /(\(|@|at )((?:blob|data):[^\s]*?):(\d+):(\d+)(\)?)\s*$/;

/**
 * Rewrites a stack trace so frames in the script bundle show the project file
 * and line, and returns the first such position (the place the error came
 * from). When the error passed through the scripts, the engine's frames below
 * the last script frame are left out: they only say who called the script.
 */
export function mapStack(stack: string, mapper: SourceMapper | null): { text: string; at: SourcePosition | null } {
  let at: SourcePosition | null = null;
  let lastScriptFrame = -1;
  const lines = stack.split("\n").map((line, i) => {
    const m = FRAME.exec(line);
    if (!m || !mapper) return line;
    const pos = mapper.lookup(Number(m[3]), Number(m[4]));
    if (!pos) return line;
    at ??= pos;
    lastScriptFrame = i;
    const where = `${pos.file}:${pos.line}:${pos.column + 1}`;
    return line.slice(0, m.index) + m[1] + where + m[5];
  });
  return { text: (lastScriptFrame >= 0 ? lines.slice(0, lastScriptFrame + 1) : lines).join("\n"), at };
}
