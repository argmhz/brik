import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { type FsEntry, type ProjectFS, joinPath } from "../core/fs";

/** A project folder on disk, for running the editor in Node (headless). */
export class NodeFS implements ProjectFS {
  readonly kind = "node" as const;
  readonly name: string;
  readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
    this.name = basename(this.root);
  }

  /** Paths stay inside the project folder (joinPath drops ".." above the root). */
  private abs(path: string): string {
    return join(this.root, ...joinPath(path).split("/").filter(Boolean));
  }

  async list(dir = ""): Promise<FsEntry[]> {
    const entries = await readdir(this.abs(dir), { withFileTypes: true });
    return entries
      .filter((e) => !e.name.startsWith(".") && e.name !== "node_modules" && (e.isFile() || e.isDirectory()))
      .map((e) => ({ name: e.name, path: joinPath(dir, e.name), kind: e.isDirectory() ? ("directory" as const) : ("file" as const) }))
      .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "directory" ? -1 : 1));
  }

  async readFile(path: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(this.abs(path)));
  }

  async readText(path: string): Promise<string> {
    return readFile(this.abs(path), "utf8");
  }

  async writeFile(path: string, data: Uint8Array | string): Promise<void> {
    const p = this.abs(path);
    await mkdir(join(p, ".."), { recursive: true });
    await writeFile(p, data);
  }

  async mkdir(path: string): Promise<void> {
    await mkdir(this.abs(path), { recursive: true });
  }

  async remove(path: string): Promise<void> {
    if (!joinPath(path)) throw new Error("Brik: refusing to remove the project folder itself");
    await rm(this.abs(path), { recursive: true, force: true });
  }

  async exists(path: string): Promise<boolean> {
    try {
      await stat(this.abs(path));
      return true;
    } catch {
      return false;
    }
  }

  async stat(path: string): Promise<{ mtime: number; size: number }> {
    const s = await stat(this.abs(path));
    return { mtime: s.mtimeMs, size: s.size };
  }
}
