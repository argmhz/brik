import type { FsEntry, ProjectFS } from "./fs";
import { joinPath } from "./fs";

/**
 * Project files on the native file system, for the Tauri desktop app.
 * Paths given to it are relative to the project folder, like every ProjectFS.
 */

/** True when running inside the Brik desktop app. */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

const fsApi = () => import("@tauri-apps/plugin-fs");

export class TauriFS implements ProjectFS {
  readonly kind = "tauri" as const;
  readonly name: string;

  /** Path separator of the root: a backslash for Windows paths (C:\Spil, \\server\share), otherwise "/". */
  private readonly sep: string;

  constructor(readonly root: string) {
    this.name = root.split(/[\\/]/).filter(Boolean).pop() ?? root;
    this.sep = /^[A-Za-z]:\\|^\\\\/.test(root) ? "\\" : "/";
  }

  private abs(path: string): string {
    const rel = joinPath(path);
    return rel ? `${this.root.replace(/[\\/]+$/, "")}${this.sep}${rel.split("/").join(this.sep)}` : this.root;
  }

  async list(dir = ""): Promise<FsEntry[]> {
    const { readDir } = await fsApi();
    const entries = await readDir(this.abs(dir));
    return entries
      .filter((e) => !e.name.startsWith("."))
      .map((e) => ({ name: e.name, path: joinPath(dir, e.name), kind: e.isDirectory ? ("directory" as const) : ("file" as const) }))
      .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "directory" ? -1 : 1));
  }

  async readFile(path: string): Promise<Uint8Array> {
    const { readFile } = await fsApi();
    return readFile(this.abs(path));
  }

  async readText(path: string): Promise<string> {
    return new TextDecoder().decode(await this.readFile(path));
  }

  async writeFile(path: string, data: Uint8Array | string): Promise<void> {
    const { writeFile, mkdir } = await fsApi();
    const parent = joinPath(path).split("/").slice(0, -1).join("/");
    await mkdir(this.abs(parent), { recursive: true }); // also creates the root folder if it is missing
    await writeFile(this.abs(path), typeof data === "string" ? new TextEncoder().encode(data) : data);
  }

  async mkdir(path: string): Promise<void> {
    const { mkdir } = await fsApi();
    await mkdir(this.abs(path), { recursive: true });
  }

  async remove(path: string): Promise<void> {
    const { remove } = await fsApi();
    await remove(this.abs(path), { recursive: true });
  }

  async exists(path: string): Promise<boolean> {
    const { exists } = await fsApi();
    return exists(this.abs(path));
  }

  async stat(path: string): Promise<{ mtime: number; size: number }> {
    const { stat } = await fsApi();
    const s = await stat(this.abs(path));
    return { mtime: s.mtime ? new Date(s.mtime).getTime() : 0, size: s.size };
  }
}

const RECENT_KEY = "brik.desktop.recent";

/** Folders opened recently in the desktop app, newest first. */
export function recentTauriFolders(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}

export function rememberTauriFolder(path: string): void {
  try {
    const next = [path, ...recentTauriFolders().filter((p) => p !== path)].slice(0, 8);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // storage blocked: just don't remember
  }
}

/** Asks for a folder with the native dialog. Null if cancelled. */
export async function pickTauriFolder(title = "Vælg projektmappe"): Promise<TauriFS | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const path = await open({ directory: true, multiple: false, title });
  if (typeof path !== "string") return null;
  rememberTauriFolder(path);
  return new TauriFS(path);
}

/**
 * Saves bytes as a file the user picks. In the desktop app that is a native
 * save dialog; in the browser it is a normal download.
 */
export async function saveBytes(fileName: string, bytes: Uint8Array, mime = "application/octet-stream"): Promise<boolean> {
  if (isTauri()) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const path = await save({ defaultPath: fileName });
    if (!path) return false;
    const { writeFile } = await fsApi();
    await writeFile(path, bytes);
    return true;
  }
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return true;
}
