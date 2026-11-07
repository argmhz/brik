/**
 * Project storage. Paths are relative and use "/" (e.g. "assets/hero.png").
 *
 * - `HandleFS` wraps a FileSystemDirectoryHandle. That covers both a real folder
 *   picked with the File System Access API (Chrome/Edge) and the browser's
 *   Origin Private File System (all modern browsers).
 * - `MemoryFS` is for tests.
 * - Tauri gets its own implementation in phase 5.
 */
export interface FsEntry {
  name: string;
  path: string;
  kind: "file" | "directory";
}

export interface ProjectFS {
  readonly kind: "fsa" | "opfs" | "memory" | "tauri" | "node";
  readonly name: string;
  list(dir?: string): Promise<FsEntry[]>;
  readFile(path: string): Promise<Uint8Array>;
  readText(path: string): Promise<string>;
  /** Creates parent directories as needed. */
  writeFile(path: string, data: Uint8Array | string): Promise<void>;
  mkdir(path: string): Promise<void>;
  /** Removes a file or a directory with everything in it. */
  remove(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  /** Modification time and size, used to notice changes made outside the editor. */
  stat(path: string): Promise<{ mtime: number; size: number }>;
}

export function splitPath(path: string): string[] {
  return path.split("/").filter((p) => p !== "" && p !== ".");
}

/** Joins and normalizes path parts, resolving ".." (never above the project root). */
export function joinPath(...parts: string[]): string {
  const out: string[] = [];
  for (const p of splitPath(parts.join("/"))) {
    if (p === "..") out.pop();
    else out.push(p);
  }
  return out.join("/");
}

export function dirname(path: string): string {
  return splitPath(path).slice(0, -1).join("/");
}

export function basename(path: string): string {
  return splitPath(path).at(-1) ?? "";
}

export function extname(path: string): string {
  const b = basename(path);
  const i = b.lastIndexOf(".");
  return i > 0 ? b.slice(i).toLowerCase() : "";
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Every file path in the project, recursively. */
export async function walk(fs: ProjectFS, dir = ""): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.list(dir)) {
    if (entry.kind === "file") out.push(entry.path);
    else out.push(...(await walk(fs, entry.path)));
  }
  return out;
}

// ------------------------------------------------------------------ memory

export class MemoryFS implements ProjectFS {
  readonly kind = "memory" as const;
  private files = new Map<string, Uint8Array>();
  private mtimes = new Map<string, number>();
  private clock = 0;
  private dirs = new Set<string>([""]);

  constructor(readonly name = "memory") {}

  async list(dir = ""): Promise<FsEntry[]> {
    const d = joinPath(dir);
    if (!this.dirs.has(d)) throw new Error(`not a directory: ${dir}`);
    const prefix = d ? `${d}/` : "";
    const names = new Map<string, FsEntry["kind"]>();
    for (const p of this.dirs) {
      if (basename(p).startsWith(".")) continue;
      if (p !== d && p.startsWith(prefix) && !p.slice(prefix.length).includes("/")) names.set(p.slice(prefix.length), "directory");
    }
    for (const p of this.files.keys()) {
      if (basename(p).startsWith(".")) continue;
      if (p.startsWith(prefix) && !p.slice(prefix.length).includes("/")) names.set(p.slice(prefix.length), "file");
    }
    return sortEntries([...names].map(([name, kind]) => ({ name, kind, path: joinPath(d, name) })));
  }

  async readFile(path: string): Promise<Uint8Array> {
    const f = this.files.get(joinPath(path));
    if (!f) throw new Error(`file not found: ${path}`);
    return f.slice();
  }

  async readText(path: string): Promise<string> {
    return decoder.decode(await this.readFile(path));
  }

  async writeFile(path: string, data: Uint8Array | string): Promise<void> {
    const p = joinPath(path);
    await this.mkdir(dirname(p));
    this.files.set(p, typeof data === "string" ? encoder.encode(data) : data.slice());
    this.mtimes.set(p, ++this.clock);
  }

  async stat(path: string): Promise<{ mtime: number; size: number }> {
    const p = joinPath(path);
    const f = this.files.get(p);
    if (!f) throw new Error(`file not found: ${path}`);
    return { mtime: this.mtimes.get(p) ?? 0, size: f.length };
  }

  async mkdir(path: string): Promise<void> {
    const parts = splitPath(path);
    for (let i = 1; i <= parts.length; i++) this.dirs.add(parts.slice(0, i).join("/"));
  }

  async remove(path: string): Promise<void> {
    const p = joinPath(path);
    this.files.delete(p);
    for (const f of [...this.files.keys()]) if (f.startsWith(`${p}/`)) this.files.delete(f);
    for (const d of [...this.dirs]) if (d === p || d.startsWith(`${p}/`)) this.dirs.delete(d);
  }

  async exists(path: string): Promise<boolean> {
    const p = joinPath(path);
    return this.files.has(p) || this.dirs.has(p);
  }
}

// ------------------------------------------------------------------ handles

export class HandleFS implements ProjectFS {
  constructor(
    readonly root: FileSystemDirectoryHandle,
    readonly kind: "fsa" | "opfs",
    readonly name = root.name,
  ) {}

  private async dir(path: string, create: boolean): Promise<FileSystemDirectoryHandle> {
    let h = this.root;
    for (const part of splitPath(path)) h = await h.getDirectoryHandle(part, { create });
    return h;
  }

  async list(dir = ""): Promise<FsEntry[]> {
    const h = await this.dir(dir, false);
    const out: FsEntry[] = [];
    // entries() is missing from some TS DOM lib versions
    for await (const [name, child] of (h as unknown as AsyncIterable<[string, FileSystemHandle]>)) {
      if (name.startsWith(".")) continue;
      out.push({ name, path: joinPath(dir, name), kind: child.kind === "directory" ? "directory" : "file" });
    }
    return sortEntries(out);
  }

  async readFile(path: string): Promise<Uint8Array> {
    const parent = await this.dir(dirname(path), false);
    const file = await (await parent.getFileHandle(basename(path))).getFile();
    return new Uint8Array(await file.arrayBuffer());
  }

  async readText(path: string): Promise<string> {
    return decoder.decode(await this.readFile(path));
  }

  async stat(path: string): Promise<{ mtime: number; size: number }> {
    const parent = await this.dir(dirname(path), false);
    const file = await (await parent.getFileHandle(basename(path))).getFile();
    return { mtime: file.lastModified, size: file.size };
  }

  async writeFile(path: string, data: Uint8Array | string): Promise<void> {
    const parent = await this.dir(dirname(path), true);
    const handle = await parent.getFileHandle(basename(path), { create: true });
    const writable = await handle.createWritable();
    await writable.write(typeof data === "string" ? data : (data as BufferSource));
    await writable.close();
  }

  async mkdir(path: string): Promise<void> {
    await this.dir(path, true);
  }

  async remove(path: string): Promise<void> {
    const parent = await this.dir(dirname(path), false);
    await parent.removeEntry(basename(path), { recursive: true });
  }

  async exists(path: string): Promise<boolean> {
    try {
      const parent = await this.dir(dirname(path), false);
      const name = basename(path);
      if (!name) return true;
      try {
        await parent.getFileHandle(name);
        return true;
      } catch {
        await parent.getDirectoryHandle(name);
        return true;
      }
    } catch {
      return false;
    }
  }
}

function sortEntries(entries: FsEntry[]): FsEntry[] {
  return entries.sort((a, b) =>
    a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "directory" ? -1 : 1,
  );
}

// ------------------------------------------------------------------ browser helpers

const OPFS_DIR = "brik-projects";

export function supportsFolderPicker(): boolean {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

async function opfsRoot(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(OPFS_DIR, { create: true });
}

/** Projects stored inside the browser (OPFS). */
export async function listBrowserProjects(): Promise<string[]> {
  const fs = new HandleFS(await opfsRoot(), "opfs");
  return (await fs.list()).filter((e) => e.kind === "directory").map((e) => e.name);
}

export async function openBrowserProject(name: string, create = false): Promise<HandleFS> {
  const root = await opfsRoot();
  return new HandleFS(await root.getDirectoryHandle(name, { create }), "opfs", name);
}

export async function deleteBrowserProject(name: string): Promise<void> {
  await (await opfsRoot()).removeEntry(name, { recursive: true });
}

/** Asks the user for a folder on disk (Chrome/Edge). */
export async function pickFolder(): Promise<HandleFS> {
  const picker = (window as unknown as { showDirectoryPicker(o: object): Promise<FileSystemDirectoryHandle> })
    .showDirectoryPicker;
  const handle = await picker.call(window, { mode: "readwrite", id: "brik-project" });
  await rememberFolder(handle);
  return new HandleFS(handle, "fsa");
}

// The last picked folder is kept in IndexedDB, so it can be reopened with one click.

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("brik-editor", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("handles");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function rememberFolder(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await idb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("handles", "readwrite");
    tx.objectStore("handles").put(handle, "last");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function lastFolder(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const db = await idb();
    return await new Promise((resolve) => {
      const req = db.transaction("handles").objectStore("handles").get("last");
      req.onsuccess = () => resolve((req.result as FileSystemDirectoryHandle) ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/** Reopens a remembered folder. Must be called from a click (the browser asks for permission). */
export async function reopenFolder(handle: FileSystemDirectoryHandle): Promise<HandleFS> {
  const h = handle as unknown as {
    queryPermission(o: object): Promise<string>;
    requestPermission(o: object): Promise<string>;
  };
  const opts = { mode: "readwrite" };
  if ((await h.queryPermission(opts)) !== "granted" && (await h.requestPermission(opts)) !== "granted") {
    throw new Error("Adgang til mappen blev afvist");
  }
  return new HandleFS(handle, "fsa");
}
