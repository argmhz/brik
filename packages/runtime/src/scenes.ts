import { type App, type SceneData, type World, loadScene } from "@brik/core";

/** Turns "level2" into "scenes/level2.scene.json"; full paths are kept. */
export function scenePath(name: string): string {
  if (name.endsWith(".scene.json")) return name;
  return name.includes("/") ? `${name}.scene.json` : `scenes/${name}.scene.json`;
}

/**
 * Switches scenes while the game runs. Available as a resource: `world.resource(Scenes)`.
 * The switch happens at the start of the next frame, once the scene is loaded.
 *
 * ```ts
 * this.loadScene("level2"); // scenes/level2.scene.json
 * ```
 */
export class Scenes {
  /** Path of the scene that is loaded now. */
  current: string | null = null;
  /** How many scene switches have happened (also reloads of the same scene). */
  swaps = 0;
  private ready: { path: string; data: SceneData } | null = null;
  private loading: string | null = null;
  private pending: Promise<void> = Promise.resolve();
  /** Called after a scene was swapped in (e.g. to reset systems). */
  onSwap: ((path: string) => void) | null = null;

  constructor(private readonly source: (path: string) => SceneData | Promise<SceneData>) {}

  load(name: string): void {
    const path = scenePath(name);
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

  /** @internal Swaps in a loaded scene. Runs first thing in a frame. */
  swap(world: World): void {
    const next = this.ready;
    if (!next) return;
    this.ready = null;
    this.loading = null;
    this.onSwap?.(next.path);
    loadScene(world, next.data);
    this.current = next.path;
    this.swaps++;
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
