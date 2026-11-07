import {
  App,
  Audio,
  AudioSystem,
  BehaviourRuntime,
  GamePlugins,
  Input,
  Particles,
  UITextEntry,
  type Phase,
  Physics,
  type SceneData,
  ScenesPlugin,
  ScriptsPlugin,
  type System,
  Tweens,
  initPhysics,
  loadScene,
  serializeScene,
} from "@brik/runtime";
import type { Editor } from "./editor";
import { refreshSceneData } from "./prefabs";

export type PlayMode = "edit" | "play" | "paused";

/**
 * Play mode: runs the game on the editor's world and restores the scene when
 * stopped, like Unity. Changes made while playing are thrown away on stop.
 */
export class PlayController {
  mode: PlayMode = "edit";
  /** Element that receives pointer input while playing (the game view). */
  element: HTMLElement | null = null;
  /** The running game app (null in edit mode). */
  app: App | null = null;
  private snapshot: SceneData | null = null;
  private raf = 0;
  private last = -1;
  private lastEmit = 0;
  private scriptSystems: { phase: Phase; system: System }[] = [];

  constructor(private readonly editor: Editor) {}

  get active(): boolean {
    return this.mode !== "edit";
  }

  /** Starts playing. Returns false (and logs why) if scripts have errors. */
  async start(): Promise<boolean> {
    if (this.mode === "paused") {
      this.resume();
      return true;
    }
    if (this.mode === "play") return true;
    const editor = this.editor;
    if (!(await editor.scripts.poll())) {
      editor.log("error", "Ret fejlene i dine scripts, før du trykker Play.");
      return false;
    }
    await editor.scripts.freshForPlay();
    try {
      await initPhysics();
    } catch (err) {
      editor.log("warn", `Fysik kunne ikke indlæses: ${err instanceof Error ? err.message : String(err)}`);
    }
    // "clear on play", like Unity; compile errors above are kept since we return before this
    editor.console.clear();
    editor.emit("console");
    this.snapshot = serializeScene(editor.world);
    const registry = editor.scripts.registry;
    this.app = new App({
      world: editor.world,
      onError: (err, s, phase) =>
        editor.log("error", `System "${s.name}" (${phase}): ${err instanceof Error ? err.message : String(err)}`),
    })
      .addPlugin(
        GamePlugins({
          input: this.element ?? (typeof document !== "undefined" ? document.body : undefined),
          physics: editor.settings.physics,
        }),
      )
      .addPlugin(ScriptsPlugin(registry))
      .addPlugin(ScenesPlugin(async (path) => refreshSceneData(editor, JSON.parse(await editor.fs.readText(path)) as SceneData), editor.scenePath));
    // keys typed elsewhere in the editor (hierarchy, assets, inspector buttons) are not game input
    const input = editor.world.tryResource(Input);
    const view = this.element;
    if (input && view && typeof document !== "undefined") {
      input.keyFilter = (ev) => ev.target === document.body || ev.target === document.documentElement || (ev.target instanceof Node && view.contains(ev.target));
    }
    this.scriptSystems = registry.systems.map((s) => ({ phase: s.phase, system: s.system }));
    this.mode = "play";
    this.last = -1;
    if (typeof requestAnimationFrame === "function") this.raf = requestAnimationFrame(this.tick);
    editor.emit("play");
    return true;
  }

  pause(): void {
    if (this.mode !== "play") return;
    this.mode = "paused";
    this.editor.emit("play");
  }

  resume(): void {
    if (this.mode !== "paused") return;
    this.mode = "play";
    this.last = -1;
    this.editor.emit("play");
  }

  /** Advances one frame (1/60 s). Pauses first if playing. */
  step(dt = 1 / 60): void {
    if (!this.app) return;
    if (this.mode === "play") this.pause();
    this.app.update(dt);
    this.editor.emit("world");
  }

  stop(): void {
    if (!this.app || !this.snapshot) return;
    if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(this.raf);
    const world = this.editor.world;
    // each cleanup is guarded, so the scene is always restored
    const cleanups: [string, () => void][] = [
      ["scripts", () => world.tryResource(BehaviourRuntime)?.destroyAll()],
      ["input", () => world.tryResource(Input)?.detach()],
      ["audio", () => (world.tryResource(AudioSystem)?.stopAll(), world.tryResource(Audio)?.stopAll())],
      ["physics", () => world.tryResource(Physics)?.reset()],
      ["tweens", () => world.tryResource(Tweens)?.clear()],
      ["particles", () => world.tryResource(Particles)?.clear()],
      ["text fields", () => world.tryResource(UITextEntry)?.dispose()],
      ["commands", () => world.commands.flush()],
    ];
    for (const [what, fn] of cleanups) {
      try {
        fn();
      } catch (err) {
        this.editor.log("warn", `Oprydning (${what}) fejlede: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    loadScene(world, this.snapshot);
    this.app = null;
    this.snapshot = null;
    this.mode = "edit";
    this.editor.afterExternalChange();
    this.editor.emit("play");
  }

  /** Swaps script systems after a hot reload. Behaviours swap themselves. */
  onScriptsReloaded(): void {
    if (!this.app) return;
    for (const s of this.scriptSystems) this.app.removeSystem(s.phase, s.system);
    this.scriptSystems = this.editor.scripts.registry.systems.map((s) => ({ phase: s.phase, system: s.system }));
    for (const s of this.scriptSystems) this.app.addSystem(s.phase, s.system);
    this.editor.log("info", "Scripts genindlæst mens spillet kører");
  }

  private tick = (ts: number) => {
    if (!this.app) return;
    const dt = this.last < 0 ? 0 : (ts - this.last) / 1000;
    this.last = ts;
    if (this.mode === "play") {
      this.app.update(dt);
      // keep the inspector roughly live without re-rendering it every frame
      if (ts - this.lastEmit > 100) {
        this.lastEmit = ts;
        this.editor.emit("world");
      }
    }
    this.raf = requestAnimationFrame(this.tick);
  };
}
