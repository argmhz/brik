/*
 * The editor without a browser, for the MCP server: it opens a project folder
 * on disk in Node, so an AI can build and test a game while the editor isn't
 * running. Same handlers as the live editor (createBridgeHandlers); only
 * screenshots need the real editor.
 *
 * Node only (uses node:fs), so this is not exported from the editor package's
 * browser entry. The MCP server bundles it on start (see packages/mcp).
 */
import { BridgeError, type BridgeHandler, createBridgeHandlers } from "../core/ai-bridge";
import { type LogLevel, formatArgs } from "../core/console-log";
import { Editor } from "../core/editor";
import { isProject } from "../core/project";
import type { EsbuildLike } from "../core/scripts";
import { imageSize } from "./image-size";
import { NodeFS } from "./node-fs";

export { NodeFS } from "./node-fs";
export { imageSize } from "./image-size";
export { BridgeError };

export interface HeadlessProject {
  editor: Editor;
  fs: NodeFS;
  handlers: Record<string, BridgeHandler>;
  close(): void;
}

let loads = 0;
/** Loads compiled scripts as fresh modules (a new URL every time, like the editor's blob URLs). */
const importCode = (code: string) =>
  import(/* @vite-ignore */ `data:text/javascript;charset=utf-8,${encodeURIComponent(`${code}\n//${loads++}`)}`) as Promise<
    Record<string, unknown>
  >;

const LEVELS: LogLevel[] = ["log", "info", "warn", "error"];

/**
 * Sends console output (the engine's and the game scripts') to the editor's
 * Console, so get_console shows it, and to stderr: stdout belongs to the MCP
 * protocol and must not get stray text. Returns a function that undoes it.
 */
function captureConsole(editor: Editor, write: (line: string) => void): () => void {
  const originals = LEVELS.map((level) => console[level]);
  LEVELS.forEach((level) => {
    console[level] = (...args: unknown[]) => {
      try {
        editor.logConsole(level, args);
        write(`[${level}] ${editor.console.entries.at(-1)?.text ?? formatArgs(args)}`);
      } catch {
        // never let logging break the caller
      }
    };
  });
  return () => LEVELS.forEach((level, i) => (console[level] = originals[i]));
}

/** Opens the Brik project in `dir` (the folder with brik.project.json). */
export async function openHeadless(
  dir: string,
  opts: {
    esbuild: () => Promise<EsbuildLike>;
    /** Where console output goes besides the editor's Console. Default: stderr. */
    log?: (line: string) => void;
  },
): Promise<HeadlessProject> {
  const fs = new NodeFS(dir);
  if (!(await isProject(fs))) {
    throw new BridgeError(`${fs.root} is not a Brik project (there is no brik.project.json). Give the folder that has one.`);
  }
  const editor = await Editor.open(fs, {
    // only the size matters without a renderer
    decode: async (bytes) => {
      const size = imageSize(bytes);
      if (!size) throw new Error("unknown image format");
      return size as unknown as HTMLCanvasElement;
    },
    esbuild: opts.esbuild,
    importCode,
  });
  const handlers = createBridgeHandlers(editor);
  const release = captureConsole(editor, opts.log ?? ((line) => process.stderr.write(`[brik] ${line}\n`)));
  return {
    editor,
    fs,
    handlers,
    close: () => {
      release();
      editor.dispose();
    },
  };
}
