import { unzipSync, zipSync } from "fflate";
import { type ProjectFS, joinPath, walk } from "./fs";

/** Packs the whole project into a zip file. */
export async function exportZip(fs: ProjectFS): Promise<Uint8Array> {
  const files: Record<string, Uint8Array> = {};
  for (const path of await walk(fs)) files[path] = await fs.readFile(path);
  return zipSync(files, { level: 6 });
}

/**
 * Unpacks a zip into the project. If every entry sits in one top-level folder
 * (as when you zip a folder), that folder is stripped.
 */
export async function importZip(fs: ProjectFS, data: Uint8Array): Promise<number> {
  const entries = Object.entries(unzipSync(data)).filter(([p]) => !p.endsWith("/") && !p.startsWith("__MACOSX/"));
  const tops = new Set(entries.map(([p]) => p.split("/")[0]));
  const strip = tops.size === 1 && entries.every(([p]) => p.includes("/"));
  for (const [path, bytes] of entries) {
    const target = strip ? path.slice(path.indexOf("/") + 1) : path;
    await fs.writeFile(joinPath(target), bytes);
  }
  return entries.length;
}
