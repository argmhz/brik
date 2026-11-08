/**
 * Saved game data that survives closing the game: score, the level reached, settings.
 * A resource, `world.resource(SaveData)`, and `this.save` in scripts.
 *
 * ```ts
 * this.save.set("level", 3);
 * const level = this.save.get("level", 1); // 1 when nothing is saved yet
 * ```
 *
 * Values are stored as JSON (numbers, strings, booleans, lists and plain objects) in
 * the browser's localStorage under the game's name, the moment they are set. Where
 * localStorage isn't there (private windows that block it, tests) they live in memory
 * until the game closes.
 */
export class SaveData {
  private data: Record<string, unknown> | null = null;

  /** `key` names this game's save in localStorage, e.g. "brik-save:Marz World". */
  constructor(readonly key: string, private readonly storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null = defaultStorage()) {}

  /** The saved value, or `fallback` when there is none. You get a copy: call set to save changes. */
  get<T>(name: string, fallback: T): T;
  get<T = unknown>(name: string): T | undefined;
  get(name: string, fallback?: unknown): unknown {
    const all = this.load();
    return name in all ? structuredClone(all[name]) : fallback;
  }

  /** Saves a value right away. `undefined` removes it. */
  set(name: string, value: unknown): void {
    const all = this.load();
    if (value === undefined) delete all[name];
    else all[name] = JSON.parse(JSON.stringify(value)) as unknown;
    this.write();
  }

  has(name: string): boolean {
    return name in this.load();
  }

  delete(name: string): void {
    this.set(name, undefined);
  }

  /** Names of everything saved. */
  keys(): string[] {
    return Object.keys(this.load());
  }

  /** Forgets everything this game has saved (a "new game" or "reset" button). */
  clear(): void {
    this.data = {};
    try {
      this.storage?.removeItem(this.key);
    } catch {
      // storage refused: the save is gone from memory anyway
    }
  }

  private load(): Record<string, unknown> {
    if (this.data) return this.data;
    let parsed: unknown = null;
    try {
      const text = this.storage?.getItem(this.key);
      parsed = text ? JSON.parse(text) : null;
    } catch {
      // unreadable or blocked: start empty
    }
    this.data = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    return this.data;
  }

  private write(): void {
    try {
      this.storage?.setItem(this.key, JSON.stringify(this.data ?? {}));
    } catch (err) {
      console.warn(`[brik] could not save game data (${this.key})`, err);
    }
  }
}

function defaultStorage(): Storage | null {
  // only in a browser (Node warns as soon as localStorage is looked at)
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

/** The localStorage key for a game's save. */
export const saveKey = (game: string): string => `brik-save:${game || "game"}`;
