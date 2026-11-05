import { beforeEach, describe, expect, it, vi } from "vitest";

// A tiny in-memory stand-in for @tauri-apps/plugin-fs, keyed by absolute path.
const files = new Map<string, Uint8Array>();
const dirs = new Set<string>();
const calls: string[] = [];

vi.mock("@tauri-apps/plugin-fs", () => ({
  readDir: async (p: string) => {
    const names = new Map<string, boolean>();
    for (const f of files.keys()) if (f.startsWith(`${p}/`) && !f.slice(p.length + 1).includes("/")) names.set(f.slice(p.length + 1), false);
    for (const d of dirs) if (d.startsWith(`${p}/`) && !d.slice(p.length + 1).includes("/")) names.set(d.slice(p.length + 1), true);
    return [...names].map(([name, isDirectory]) => ({ name, isDirectory, isFile: !isDirectory, isSymlink: false }));
  },
  readFile: async (p: string) => {
    const f = files.get(p);
    if (!f) throw new Error(`no such file: ${p}`);
    return f;
  },
  writeFile: async (p: string, data: Uint8Array) => {
    const parent = p.slice(0, p.lastIndexOf("/"));
    if (!dirs.has(parent)) throw new Error(`no such directory: ${parent}`);
    files.set(p, data);
  },
  mkdir: async (p: string, o?: { recursive?: boolean }) => {
    calls.push(`mkdir ${p} ${o?.recursive ? "recursive" : ""}`);
    const parts = p.split("/");
    for (let i = 2; i <= parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
  },
  remove: async (p: string) => {
    for (const f of [...files.keys()]) if (f === p || f.startsWith(`${p}/`)) files.delete(f);
    for (const d of [...dirs]) if (d === p || d.startsWith(`${p}/`)) dirs.delete(d);
  },
  exists: async (p: string) => files.has(p) || dirs.has(p),
  stat: async (p: string) => ({ size: files.get(p)?.length ?? 0, mtime: new Date(1000) }),
}));

const { TauriFS } = await import("../src/core/tauri-fs");

describe("TauriFS", () => {
  beforeEach(() => {
    files.clear();
    dirs.clear();
    calls.length = 0;
  });

  it("maps project paths to absolute paths and creates folders as needed", async () => {
    const fs = new TauriFS("/home/me/Spil/");
    expect(fs.name).toBe("Spil");
    await fs.writeFile("scenes/main.scene.json", '{"version":1}');
    expect([...files.keys()]).toEqual(["/home/me/Spil/scenes/main.scene.json"]);
    expect(await fs.readText("./scenes/../scenes/main.scene.json")).toBe('{"version":1}');
    expect(await fs.exists("scenes")).toBe(true);
  });

  it("creates the project folder itself when it is missing", async () => {
    const fs = new TauriFS("/out/game");
    await fs.writeFile("index.html", "<!doctype html>");
    expect(files.has("/out/game/index.html")).toBe(true);
    expect(calls).toContain("mkdir /out/game recursive");
  });

  it("uses backslashes under a Windows root", async () => {
    const fs = new TauriFS("C:\\Users\\me\\Spil");
    expect(fs.name).toBe("Spil");
    await fs.mkdir("scenes/levels");
    expect(calls).toEqual(["mkdir C:\\Users\\me\\Spil\\scenes\\levels recursive"]);
  });

  it("lists folders first, hides dot files and removes recursively", async () => {
    const fs = new TauriFS("/p");
    await fs.writeFile("b.txt", "b");
    await fs.writeFile(".git/HEAD", "x");
    await fs.writeFile("assets/a.png", new Uint8Array([1, 2, 3]));
    expect((await fs.list()).map((e) => `${e.kind}:${e.path}`)).toEqual(["directory:assets", "file:b.txt"]);
    expect((await fs.list("assets")).map((e) => e.path)).toEqual(["assets/a.png"]);
    expect(await fs.stat("assets/a.png")).toEqual({ size: 3, mtime: 1000 });
    await fs.remove("assets");
    expect(await fs.exists("assets/a.png")).toBe(false);
  });
});
