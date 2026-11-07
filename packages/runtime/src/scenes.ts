import { type App, type SceneData, Time, type World, loadScene } from "@brik/core";
import { ScreenFade } from "@brik/render";

/** Turns "level2" into "scenes/level2.scene.json"; full paths are kept. */
export function scenePath(name: string): string {
  if (name.endsWith(".scene.json")) return name;
  return name.includes("/") ? `${name}.scene.json` : `scenes/${name}.scene.json`;
}

export interface LoadSceneOptions {
  /**
   * Fade out before the switch and in after it. A number is seconds per
   * direction (0.4 is a good start); the colour is black unless set.
   */
  fade?: number | { duration: number; color?: { r: number; g: number; b: number } };
  /** Values to carry into the next scene, merged into `Scenes.data`. */
  data?: Record<string, unknown>;
}

/**
 * Switches scenes while the game runs. Available as a resource: `world.resource(Scenes)`.
 * The switch happens at the start of the next frame, once the scene is loaded.
 *
 * ```ts
 * this.loadScene("level2"); // scenes/level2.scene.json
 * this.loadScene("level2", { fade: 0.4, data: { score: 120 } }); // fade to black, carry the score along
 * ```
 */
export class Scenes {
  /** Path of the scene that is loaded now. */
  current: string | null = null;
  /** How many scene switches have happened (also reloads of the same scene). */
  swaps = 0;
  /**
   * Values that survive scene switches, for score, lives, the player's choices.
   * Fill it with `loadScene(name, { data })` or directly. Cleared only when the game starts over.
   */
  data: Record<string, unknown> = {};
  private fading: { phase: "out" | "in"; t: number; duration: number; r: number; g: number; b: number } | null = null;
  private ready: { path: string; data: SceneData } | null = null;
  private loading: string | null = null;
  private pending: Promise<void> = Promise.resolve();
  /** Called after a scene was swapped in (e.g. to reset systems). */
  onSwap: ((path: string) => void) | null = null;

  constructor(private readonly source: (path: string) => SceneData | Promise<SceneData>) {}

  load(name: string, options: LoadSceneOptions = {}): void {
    const path = scenePath(name);
    if (options.data) Object.assign(this.data, options.data);
    const f = options.fade;
    const duration = typeof f === "number" ? f : f?.duration ?? 0;
    if (duration > 0) {
      const c = (typeof f === "object" && f.color) || { r: 0, g: 0, b: 0 };
      // fading out again while fading in picks up from where the screen is now
      const from = this.fading?.phase === "in" ? 1 - this.fading.t / this.fading.duration : 0;
      this.fading = { phase: "out", t: from * duration, duration, r: c.r, g: c.g, b: c.b };
    } else {
      this.fading = null;
    }
    this.loading = path;
    this.pending = Promise.resolve()
      .then(() => this.source(path))
      .then(
        (data) => {
          // a newer load request wins
          if (this.loading === path) this.ready = { path, data };
        },
        (err) => {
          if (this.loading === path) this.loading = null;
          console.error(`[brik] could not load scene "${path}"`, err);
        },
      );
  }

  /**
   * Resolves once the requested scene has been read (or failed), so it will be
   * swapped in at the start of the next frame. For tools that step frames by
   * hand, like the editor's AI bridge and tests.
   */
  async loaded(): Promise<void> {
    while (this.loading !== null && this.ready === null) {
      const p = this.pending;
      await p;
      if (p === this.pending) break;
    }
  }

  /** True while a requested scene hasn't been swapped in yet. */
  get busy(): boolean {
    return this.loading !== null;
  }

  /** True while the screen is fading out or in around a scene switch. */
  get fadingNow(): boolean {
    return this.fading !== null;
  }

  /** @internal Moves a fade on and swaps in a loaded scene. Runs first thing in a frame. */
  swap(world: World): void {
    const fade = this.fading;
    const screen = world.tryResource(ScreenFade);
    if (fade && screen) {
      fade.t += world.resource(Time).unscaledDt;
      screen.r = fade.r;
      screen.g = fade.g;
      screen.b = fade.b;
      const k = Math.min(1, fade.t / fade.duration);
      screen.alpha = fade.phase === "out" ? k : 1 - k;
      if (fade.phase === "in" && k >= 1) this.fading = null;
    } else if (fade && !screen) {
      this.fading = null; // nothing to draw the fade with
    }
    // wait for the screen to be fully covered before switching
    if (this.fading?.phase === "out" && this.fading.t < this.fading.duration) return;
    const next = this.ready;
    if (!next) return;
    this.ready = null;
    this.loading = null;
    this.onSwap?.(next.path);
    loadScene(world, next.data);
    this.current = next.path;
    this.swaps++;
    if (this.fading) {
      this.fading.phase = "in";
      this.fading.t = 0;
    }
  }
}

/** Scene switching. `source` reads a scene file by path. */
export function ScenesPlugin(source: (path: string) => SceneData | Promise<SceneData>, current: string | null = null) {
  return {
    name: "brik:scenes",
    build(app: App) {
      const scenes = app.world.insertResource(new Scenes(source));
      scenes.current = current;
      app.addSystem("preUpdate", { name: "scenes.swap", run: (w: World) => scenes.swap(w) });
    },
  };
}
