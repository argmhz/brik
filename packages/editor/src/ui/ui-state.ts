import { createSignal } from "solid-js";

import { isShown, resetActivePanels, showPanel } from "./dock-state";

/** UI state shared between panels (one editor is open at a time). */

export const [openFiles, setOpenFiles] = createSignal<string[]>([]);
export const [activeFile, setActiveFile] = createSignal<string | null>(null);
/** A line the code editor should scroll to (set when clicking an error in the console). */
export const [revealAt, setRevealAt] = createSignal<{ path: string; line: number; column: number } | null>(null);

/** Opens a file in the code editor tab. */
export function openFile(path: string, line?: number, column = 0): void {
  if (!openFiles().includes(path)) setOpenFiles([...openFiles(), path]);
  setActiveFile(path);
  showPanel("code");
  if (line) setRevealAt({ path, line, column });
}

export function closeFile(path: string): void {
  const files = openFiles().filter((p) => p !== path);
  setOpenFiles(files);
  if (activeFile() === path) setActiveFile(files.at(-1) ?? null);
  if (files.length === 0 && isShown("code")) showPanel("scene");
}

export function resetUiState(): void {
  resetActivePanels();
  setOpenFiles([]);
  setActiveFile(null);
  setRevealAt(null);
  setToolWindow(null);
}

/** Hooks the code editor registers so global shortcuts and the unload warning can reach it. */
export const codeActions: { save: (() => Promise<void>) | null; dirty: (() => boolean) | null } = {
  save: null,
  dirty: null,
};

/** A full-screen tool window: the sprite editor (textures) or the animation editor (clips). */
export type ToolWindow = { kind: "sprite" | "animation" | "build"; path: string } | null;
export const [toolWindow, setToolWindow] = createSignal<ToolWindow>(null);
