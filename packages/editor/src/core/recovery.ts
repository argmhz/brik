import type { SceneData } from "@brik/runtime";
import type { ProjectFS } from "./fs";

/** Where unsaved scene changes are kept. `.brik/` is git-ignored. */
export const RECOVERY_PATH = ".brik/recovery.json";

export interface RecoveryData {
  version: 1;
  /** The scene file the changes belong to, or null for a scene that was never saved. */
  scenePath: string | null;
  /** When the copy was written (ms since 1970). */
  savedAt: number;
  scene: SceneData;
}

export async function readRecovery(fs: ProjectFS): Promise<RecoveryData | null> {
  try {
    if (!(await fs.exists(RECOVERY_PATH))) return null;
    const data = JSON.parse(await fs.readText(RECOVERY_PATH)) as RecoveryData;
    return data?.version === 1 && data.scene ? data : null;
  } catch (err) {
    console.warn("[brik] could not read the recovery file", err);
    return null;
  }
}

export async function removeRecovery(fs: ProjectFS): Promise<void> {
  if (await fs.exists(RECOVERY_PATH)) await fs.remove(RECOVERY_PATH);
}

export interface AutosaveTarget {
  readonly fs: ProjectFS;
  /** True when the scene has changes that aren't saved. */
  readonly dirty: boolean;
  /** True while the game runs; the world then holds play state, not the scene. */
  readonly playing: boolean;
  readonly scenePath: string | null;
  snapshot(): SceneData;
}

/**
 * Keeps a copy of unsaved scene changes in `.brik/recovery.json`, written a
 * moment after the last change, and removes it once the scene is saved. The
 * scene file itself is never touched.
 */
export class Autosave {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private writing: Promise<void> = Promise.resolve();
  /** Whether a recovery file is on disk (as far as we know). */
  private onDisk = false;
  paused = false;

  constructor(
    private readonly target: AutosaveTarget,
    readonly delayMs = 1500,
  ) {}

  /** Call after every change to the scene (and after saving). */
  changed(): void {
    if (this.paused) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.delayMs);
  }

  /** Writes or removes the recovery file right away. */
  flush(): Promise<void> {
    // one write at a time, so an old snapshot never lands after a newer one
    this.writing = this.writing.then(() => this.write()).catch((err) => console.warn("[brik] autosave failed", err));
    return this.writing;
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.paused = true;
  }

  private async write(): Promise<void> {
    const t = this.target;
    if (this.paused) return;
    if (t.playing) {
      // try again after play mode; the scene snapshot is restored when it stops
      this.changed();
      return;
    }
    if (!t.dirty) {
      if (this.onDisk) await removeRecovery(t.fs);
      this.onDisk = false;
      return;
    }
    const data: RecoveryData = { version: 1, scenePath: t.scenePath, savedAt: Date.now(), scene: t.snapshot() };
    await t.fs.writeFile(RECOVERY_PATH, JSON.stringify(data));
    this.onDisk = true;
  }

  /** Tells the autosave that a recovery file may exist (e.g. one found at startup). */
  markOnDisk(): void {
    this.onDisk = true;
  }
}
