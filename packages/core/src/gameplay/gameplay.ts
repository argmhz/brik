import type { App } from "../app/app";
import { Time } from "../app/time";
import { type ComponentDef, componentByName, defineComponent } from "../ecs/component";
import type { Entity } from "../ecs/entity";
import { defineEvent } from "../ecs/events";
import { t, withMeta } from "../ecs/schema";
import type { World } from "../ecs/world";
import { destroyRecursive } from "../transform/components";
import { EASINGS, type Easing, easings } from "./easing";

// ------------------------------------------------------------------ Lifetime

/** Destroys the entity (and its children) after `seconds`. */
export const Lifetime = defineComponent("Lifetime", {
  seconds: withMeta(t.f32(1), { min: 0, step: 0.1 }),
});

// ------------------------------------------------------------------ Tags

/** Free-form tags like "enemy" or "pickup". */
export const Tags = defineComponent("Tags", {
  list: withMeta(
    t.ref<string[]>(() => []),
    { editor: "tags" },
  ),
});

export function hasTag(world: World, e: Entity, tag: string): boolean {
  return world.has(e, Tags) && world.store(Tags).list[e].includes(tag);
}

/** All live entities with a tag. */
export function findByTag(world: World, tag: string): Entity[] {
  const list = world.store(Tags).list;
  return world.query([Tags]).toArray().filter((e) => list[e].includes(tag));
}

// ------------------------------------------------------------------ Timer

export interface TimerFinishedEvent {
  entity: Entity;
}

/** Sent when a Timer component runs out (every time, if it repeats). */
export const TimerFinished = defineEvent<TimerFinishedEvent>("TimerFinished");

/** Counts down and sends a `TimerFinished` event. */
export const Timer = defineComponent("Timer", {
  duration: withMeta(t.f32(1), { min: 0, step: 0.1 }),
  repeat: t.bool(false),
  running: t.bool(true),
  /** Seconds since the timer (re)started. */
  elapsed: withMeta(t.f32(0), { label: "elapsed (read-only)" }),
});

// ------------------------------------------------------------------ Tween

const LOOP_MODES = ["once", "loop", "yoyo"] as const;
export type LoopMode = (typeof LOOP_MODES)[number];

/**
 * Animates one number on a component, e.g. `Transform2D` / `position.x`.
 * Removes itself when done unless it loops.
 */
export const Tween = defineComponent("Tween", {
  component: t.string("Transform2D"),
  /** Field path, e.g. "position.x", "rotation" or "color.a". */
  property: t.string("position.x"),
  /** Start from the current value instead of `from`. */
  fromCurrent: t.bool(true),
  from: t.f32(0),
  to: t.f32(100),
  duration: withMeta(t.f32(1), { min: 0, step: 0.1 }),
  delay: withMeta(t.f32(0), { min: 0, step: 0.1 }),
  easing: t.enum(EASINGS, "quadInOut"),
  loop: t.enum(LOOP_MODES, "once"),
  elapsed: withMeta(t.f32(0), { hidden: true }),
  start: withMeta(t.f32(Number.NaN), { hidden: true }),
});

/** Reads/writes a numeric component field by path. Null if the path isn't a number. */
export function propertyAccessor(
  world: World,
  def: ComponentDef,
  path: string,
): { get(e: Entity): number; set(e: Entity, v: number): void } | null {
  const [field, part] = path.split(".");
  const kind = def.schema[field]?.kind;
  if (!kind || kind === "ref" || kind === "entity") return null;
  const store = world.store(def) as Record<string, any>;
  if (part) {
    if (typeof store[field]?.[part] !== "object") return null;
    return { get: (e) => store[field][part][e], set: (e, v) => (store[field][part][e] = v) };
  }
  if (typeof store[field] !== "object" || !("length" in store[field])) return null;
  return { get: (e) => store[field][e], set: (e, v) => (store[field][e] = v) };
}

export interface TweenOptions {
  easing?: Easing;
  delay?: number;
  loop?: LoopMode;
  from?: number;
  onDone?: () => void;
}

interface ActiveTween {
  e: Entity;
  gen: number;
  get(e: Entity): number;
  set(e: Entity, v: number): void;
  from: number | undefined;
  to: number;
  duration: number;
  elapsed: number;
  opts: TweenOptions;
  cancelled: boolean;
}

interface Scheduled {
  e: Entity | -1;
  gen: number;
  at: number;
  every: number;
  fn: () => void;
  cancelled: boolean;
}

/** A handle for a running tween or timer. */
export interface Cancelable {
  cancel(): void;
}

/**
 * Code-driven tweens and timers. Available as a resource: `world.resource(Tweens)`.
 * Tweens and timers bound to an entity stop when it is destroyed.
 *
 * ```ts
 * tweens.to(e, Transform2D, "position.y", 200, 0.5, { easing: "backOut" });
 * tweens.after(2, () => console.log("two seconds later"));
 * ```
 */
export class Tweens {
  private tweens: ActiveTween[] = [];
  private timers: Scheduled[] = [];
  private now = 0;

  constructor(private readonly world: World) {}

  to(e: Entity, def: ComponentDef, property: string, to: number, duration: number, opts: TweenOptions = {}): Cancelable {
    const acc = propertyAccessor(this.world, def, property);
    if (!acc) throw new Error(`Brik: ${def.name}.${property} is not a number field`);
    const tw: ActiveTween = {
      e,
      gen: this.world.ref(e),
      ...acc,
      from: opts.from,
      to,
      duration: Math.max(0, duration),
      elapsed: -(opts.delay ?? 0),
      opts,
      cancelled: false,
    };
    this.tweens.push(tw);
    return { cancel: () => (tw.cancelled = true) };
  }

  /** Calls `fn` once after `seconds`. Pass an entity to cancel it when the entity dies. */
  after(seconds: number, fn: () => void, e?: Entity): Cancelable {
    return this.schedule(seconds, 0, fn, e);
  }

  /** Calls `fn` every `seconds`. */
  every(seconds: number, fn: () => void, e?: Entity): Cancelable {
    return this.schedule(seconds, Math.max(1e-3, seconds), fn, e);
  }

  /** Stops every tween and timer bound to an entity. */
  cancelAll(e: Entity): void {
    for (const tw of this.tweens) if (tw.e === e) tw.cancelled = true;
    for (const s of this.timers) if (s.e === e) s.cancelled = true;
  }

  clear(): void {
    this.tweens.length = 0;
    this.timers.length = 0;
  }

  get active(): number {
    return this.tweens.length + this.timers.length;
  }

  private schedule(seconds: number, every: number, fn: () => void, e?: Entity): Cancelable {
    const s: Scheduled = {
      e: e ?? -1,
      gen: e === undefined ? 0 : this.world.ref(e),
      at: this.now + seconds,
      every,
      fn,
      cancelled: false,
    };
    this.timers.push(s);
    return { cancel: () => (s.cancelled = true) };
  }

  private alive(e: Entity | -1, gen: number): boolean {
    return e === -1 || this.world.deref(gen) === e;
  }

  /** @internal Advances everything by `dt`. */
  update(dt: number): void {
    this.now += dt;
    const tweens = this.tweens;
    let w = 0;
    for (let i = 0; i < tweens.length; i++) {
      const tw = tweens[i];
      if (tw.cancelled || !this.alive(tw.e, tw.gen)) continue;
      tw.elapsed += dt;
      if (tw.elapsed < 0) {
        tweens[w++] = tw;
        continue;
      }
      tw.from ??= tw.get(tw.e);
      const done = stepValue(tw, tw.elapsed, tw.duration, tw.from, tw.to, tw.opts.easing ?? "quadInOut", tw.opts.loop ?? "once");
      if (done) tw.opts.onDone?.();
      else tweens[w++] = tw;
    }
    tweens.length = w;

    const timers = this.timers;
    // callbacks may schedule more timers; only look at the ones that exist now
    const n = timers.length;
    w = 0;
    for (let i = 0; i < n; i++) {
      const s = timers[i];
      if (s.cancelled || !this.alive(s.e, s.gen)) continue;
      if (this.now >= s.at) {
        s.fn();
        if (s.every > 0 && !s.cancelled) {
          s.at += s.every;
          timers[w++] = s;
        }
      } else timers[w++] = s;
    }
    for (let i = n; i < timers.length; i++) timers[w++] = timers[i];
    timers.length = w;
  }
}

/** Writes the tweened value. Returns true when a non-looping tween is done. */
function stepValue(
  tw: { e: Entity; set(e: Entity, v: number): void },
  elapsed: number,
  duration: number,
  from: number,
  to: number,
  easing: Easing,
  loop: LoopMode,
): boolean {
  let p = duration > 0 ? elapsed / duration : 1;
  let done = false;
  if (loop === "once") {
    if (p >= 1) {
      p = 1;
      done = true;
    }
  } else if (loop === "loop") {
    p = p % 1;
  } else {
    const cycle = p % 2;
    p = cycle > 1 ? 2 - cycle : cycle;
  }
  const ease = easings[easing] ?? easings.linear;
  tw.set(tw.e, from + (to - from) * ease(p));
  return done;
}

// ------------------------------------------------------------------ systems

function gameplaySystem(world: World): void {
  const time = world.resource(Time);
  const dt = time.dt;

  const L = world.store(Lifetime);
  for (const e of world.query([Lifetime])) {
    L.seconds[e] -= dt;
    if (L.seconds[e] <= 0) world.commands.run((w) => w.isAlive(e) && destroyRecursive(w, e));
  }

  const T = world.store(Timer);
  for (const e of world.query([Timer])) {
    if (!T.running[e]) continue;
    T.elapsed[e] += dt;
    if (T.elapsed[e] >= T.duration[e]) {
      world.emit(TimerFinished, { entity: e });
      if (T.repeat[e] && T.duration[e] > 0) T.elapsed[e] -= T.duration[e];
      else {
        T.elapsed[e] = T.duration[e];
        T.running[e] = 0;
      }
    }
  }

  const W = world.store(Tween);
  for (const e of world.query([Tween])) {
    const def = componentByName(W.component[e]);
    const acc = def && world.has(e, def) ? propertyAccessor(world, def, W.property[e]) : null;
    if (!acc) continue;
    W.elapsed[e] += dt;
    const local = W.elapsed[e] - W.delay[e];
    if (local < 0) continue;
    if (Number.isNaN(W.start[e])) W.start[e] = W.fromCurrent[e] ? acc.get(e) : W.from[e];
    const done = stepValue(
      { e, set: acc.set },
      local,
      W.duration[e],
      W.start[e],
      W.to[e],
      W.easing[e] as Easing,
      W.loop[e] as LoopMode,
    );
    if (done) world.commands.remove(e, Tween);
  }

  world.resource(Tweens).update(dt);
}

/** Lifetime, Timer, Tween and the `Tweens` resource. */
export const GameplayPlugin = {
  name: "brik:gameplay",
  build(app: App) {
    if (!app.world.hasResource(Tweens)) app.world.insertResource(new Tweens(app.world));
    app.addSystem("update", { name: "gameplay", run: gameplaySystem });
  },
};
