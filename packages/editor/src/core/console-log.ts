export type LogLevel = "log" | "info" | "warn" | "error";

export interface LogEntry {
  id: number;
  level: LogLevel;
  text: string;
  /** Identical messages in a row are collapsed into one entry with a count. */
  count: number;
  time: number;
  /** Source location, when known (compile errors). */
  file?: string;
  line?: number;
  column?: number;
}

/** The messages shown in the editor's console panel. */
export class LogStore {
  entries: LogEntry[] = [];
  private nextId = 1;

  constructor(readonly limit = 500) {}

  add(level: LogLevel, text: string, loc?: { file?: string; line?: number; column?: number }): LogEntry {
    const last = this.entries.at(-1);
    if (last && last.level === level && last.text === text && last.file === loc?.file && last.line === loc?.line) {
      last.count++;
      last.time = Date.now();
      return last;
    }
    const entry: LogEntry = { id: this.nextId++, level, text, count: 1, time: Date.now(), ...loc };
    this.entries.push(entry);
    if (this.entries.length > this.limit) this.entries.splice(0, this.entries.length - this.limit);
    return entry;
  }

  clear(): void {
    this.entries = [];
  }

  count(level: LogLevel): number {
    return this.entries.filter((e) => e.level === level).reduce((n, e) => n + e.count, 0);
  }
}

/** Turns console arguments into one line of text. */
export function formatArgs(args: unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === "string") return a;
      if (a instanceof Error) return a.stack && !a.stack.startsWith(a.message) ? `${a.message}\n${a.stack}` : (a.stack ?? a.message);
      if (typeof a === "object" && a !== null) {
        try {
          return JSON.stringify(a);
        } catch {
          return String(a);
        }
      }
      return String(a);
    })
    .join(" ");
}
