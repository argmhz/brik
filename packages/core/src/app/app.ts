import { World, type WorldOptions } from "../ecs/world";
import { Time } from "./time";

export const PHASES = ["startup", "preUpdate", "fixedUpdate", "update", "postUpdate", "render"] as const;
export type Phase = (typeof PHASES)[number];

export type SystemFn = (world: World) => void;

export interface System {
  readonly name: string;
  readonly run: SystemFn;
  /** Default phase, used when the system is added without one (e.g. from a script). */
  readonly phase?: Phase;
}

/**
 * Gives a system a name (shown in errors) and optionally a default phase.
 *
 * ```ts
 * export const gravity = system("gravity", (world) => { ... }, "fixedUpdate");
 * ```
 */
export function system(name: string, run: SystemFn, phase?: Phase): System {
  return { name, run, phase };
}

export function isSystem(value: unknown): value is System {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as System).run === "function" &&
    typeof (value as System).name === "string"
  );
}

export type Plugin = ((app: App) => void) | { name: string; build: (app: App) => void };

export interface AppOptions extends WorldOptions {
  /** Fixed steps per second for `fixedUpdate`. Default 60. */
  fixedHz?: number;
  /** Run on an existing world instead of creating one (the editor's play mode does this). */
  world?: World;
  /** Called when a system throws. Default: logged once per system with console.error. */
  onError?: (err: unknown, system: System, phase: Phase) => void;
}

/**
 * Owns the world and the system schedule, and drives the game loop.
 *
 * Phase order per frame:
 * `startup` (first frame only) → `preUpdate` → `fixedUpdate` (0..n times) →
 * `update` → `postUpdate` → `render`.
 *
 * Commands queued by a system are flushed right after it.
 */
export class App {
  readonly world: World;
  readonly time: Time;
  private readonly systems = new Map<Phase, System[]>(PHASES.map((p) => [p, []]));
  private readonly plugins = new Set<string>();
  private readonly failed = new Set<System>();
  private startedUp = false;
  private accumulator = 0;
  private rafId = 0;
  private lastTimestamp = -1;

  private readonly onError?: AppOptions["onError"];

  constructor(options: AppOptions = {}) {
    this.world = options.world ?? new World(options);
    this.time = this.world.insertResource(new Time());
    if (options.fixedHz) this.time.fixedDt = 1 / options.fixedHz;
    this.onError = options.onError;
  }

  /** Adds a plugin. Named plugins are only added once. */
  addPlugin(plugin: Plugin): this {
    if (typeof plugin === "function") {
      plugin(this);
    } else if (!this.plugins.has(plugin.name)) {
      this.plugins.add(plugin.name);
      plugin.build(this);
    }
    return this;
  }

  hasPlugin(name: string): boolean {
    return this.plugins.has(name);
  }

  addSystem(phase: Phase, sys: System | SystemFn): this {
    const s = typeof sys === "function" ? { name: sys.name || "anonymous", run: sys } : sys;
    this.systems.get(phase)!.push(s);
    return this;
  }

  removeSystem(phase: Phase, sys: System | SystemFn): this {
    const list = this.systems.get(phase)!;
    const i = list.findIndex((s) => s === sys || s.run === sys);
    if (i >= 0) list.splice(i, 1);
    return this;
  }

  /** Runs one frame. `dt` is in seconds. Useful for tests and editor stepping. */
  update(dt: number): void {
    const time = this.time;
    const w = this.world;
    const clamped = Math.min(Math.max(dt, 0), time.maxDt);
    time.unscaledDt = clamped;
    time.dt = clamped * time.timeScale;
    time.elapsed += time.dt;
    w.updateEvents();

    if (!this.startedUp) {
      this.startedUp = true;
      this.runPhase("startup");
    }
    this.runPhase("preUpdate");

    this.accumulator += time.dt;
    let steps = 0;
    const frameDt = time.dt;
    time.inFixedUpdate = true;
    time.dt = time.fixedDt;
    // small tolerance so float drift (0.25 - 0.1 - 0.1 = 0.0499…) doesn't skip a step
    const epsilon = time.fixedDt * 1e-6;
    while (this.accumulator >= time.fixedDt - epsilon && steps < time.maxFixedSteps) {
      this.runPhase("fixedUpdate");
      this.accumulator = Math.max(0, this.accumulator - time.fixedDt);
      steps++;
    }
    if (steps === time.maxFixedSteps) this.accumulator = Math.min(this.accumulator, time.fixedDt);
    time.inFixedUpdate = false;
    time.dt = frameDt;
    time.alpha = this.accumulator / time.fixedDt;

    this.runPhase("update");
    this.runPhase("postUpdate");
    this.runPhase("render");
    time.frame++;
  }

  /** Starts the requestAnimationFrame loop. */
  start(): this {
    if (this.rafId) return this;
    const tick = (ts: number) => {
      const dt = this.lastTimestamp < 0 ? 0 : (ts - this.lastTimestamp) / 1000;
      this.lastTimestamp = ts;
      this.update(dt);
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
    return this;
  }

  stop(): void {
    cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    this.lastTimestamp = -1;
  }

  get running(): boolean {
    return this.rafId !== 0;
  }

  private runPhase(phase: Phase): void {
    const w = this.world;
    for (const s of this.systems.get(phase)!) {
      try {
        s.run(w);
      } catch (err) {
        if (this.onError) this.onError(err, s, phase);
        // log each failing system once, keep the game running
        else if (!this.failed.has(s)) {
          this.failed.add(s);
          console.error(`[brik] system "${s.name}" (${phase}) threw:`, err);
        }
      }
      w.commands.flush();
    }
  }
}
