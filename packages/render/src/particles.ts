import type { SpriteRef } from "@brik/assets";
import {
  type App,
  type Entity,
  GlobalTransform2D,
  Time,
  Transform2D,
  type World,
  defineComponent,
  destroyRecursive,
  t,
  withMeta,
} from "@brik/core";

/**
 * Emits simple particles: sparks, dust, smoke, pickups. Particles live in world
 * space, so they stay behind when the emitter moves.
 */
export const ParticleEmitter2D = defineComponent(
  "ParticleEmitter2D",
  {
    emitting: t.bool(true),
    /** Particles per second. */
    rate: withMeta(t.f32(20), { min: 0, step: 1 }),
    /** Particles emitted at once when the emitter starts. */
    burst: withMeta(t.i32(0), { min: 0, step: 1 }),
    maxParticles: withMeta(t.i32(200), { min: 1, step: 10 }),
    /** Seconds, random between min (x) and max (y). */
    lifetime: t.vec2(0.6, 1.2),
    /** World units per second, random between min (x) and max (y). */
    speed: t.vec2(40, 90),
    direction: withMeta(t.f32(Math.PI / 2), { editor: "angle" }),
    spread: withMeta(t.f32(Math.PI / 6), { editor: "angle" }),
    gravity: t.vec2(0, -150),
    /** Slows particles down; 0 = none. */
    damping: withMeta(t.f32(0), { min: 0, step: 0.1 }),
    startSize: withMeta(t.f32(6), { min: 0, step: 0.5 }),
    endSize: withMeta(t.f32(1), { min: 0, step: 0.5 }),
    startColor: t.color(1, 0.85, 0.4, 1),
    endColor: t.color(1, 0.3, 0.1, 0),
    /** Leave empty for round particles. */
    sprite: withMeta(t.ref<SpriteRef | null>(() => null), { editor: "sprite" }),
    /** Destroy the entity once it stopped emitting and every particle is gone (one-shot effects). */
    autoDestroy: t.bool(false),
  },
  { requires: [Transform2D] },
);

/** Live particles of one emitter (structure of arrays). */
export class ParticlePool {
  count = 0;
  x: Float32Array;
  y: Float32Array;
  vx: Float32Array;
  vy: Float32Array;
  age: Float32Array;
  life: Float32Array;
  /** Fractional particles carried over between frames. */
  carry = 0;
  started = false;
  ref = 0;

  constructor(readonly capacity: number) {
    this.x = new Float32Array(capacity);
    this.y = new Float32Array(capacity);
    this.vx = new Float32Array(capacity);
    this.vy = new Float32Array(capacity);
    this.age = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
  }
}

/** All particle pools. Available as a resource: `world.resource(Particles)`. */
export class Particles {
  readonly pools = new Map<Entity, ParticlePool>();
  /** Random source; replace for deterministic tests. */
  random: () => number = Math.random;

  constructor(private readonly world: World) {}

  /** Emits `count` particles right away (e.g. an explosion). */
  emit(e: Entity, count: number): void {
    const pool = this.pool(e);
    if (pool) for (let i = 0; i < count; i++) this.spawn(e, pool);
  }

  /** Number of live particles of an emitter. */
  alive(e: Entity): number {
    return this.pools.get(e)?.count ?? 0;
  }

  clear(): void {
    this.pools.clear();
  }

  /**
   * Advances every emitter by `dt`. The editor previews selected emitters with
   * `only` (others are cleared) and `preview` (one-shot effects repeat instead
   * of destroying their entity).
   */
  update(dt: number, opts: { only?: (e: Entity) => boolean; preview?: boolean } = {}): void {
    const world = this.world;
    const P = world.store(ParticleEmitter2D);
    for (const [e, pool] of this.pools) {
      if (world.ref(e) !== pool.ref || !world.has(e, ParticleEmitter2D) || (opts.only && !opts.only(e))) this.pools.delete(e);
    }
    for (const e of world.query([ParticleEmitter2D])) {
      if (opts.only && !opts.only(e)) continue;
      const pool = this.pool(e)!;
      if (opts.preview && pool.started && pool.count === 0 && P.rate[e] === 0) pool.started = false;
      if (!pool.started) {
        pool.started = true;
        if (P.emitting[e]) for (let i = 0; i < P.burst[e]; i++) this.spawn(e, pool);
      }
      if (P.emitting[e] && P.rate[e] > 0) {
        pool.carry += P.rate[e] * dt;
        while (pool.carry >= 1) {
          pool.carry -= 1;
          this.spawn(e, pool);
        }
      }
      // simulate, removing dead particles by swapping in the last one
      const gx = P.gravity.x[e] * dt;
      const gy = P.gravity.y[e] * dt;
      const damp = Math.max(0, 1 - P.damping[e] * dt);
      let i = 0;
      while (i < pool.count) {
        pool.age[i] += dt;
        if (pool.age[i] >= pool.life[i]) {
          const last = --pool.count;
          pool.x[i] = pool.x[last];
          pool.y[i] = pool.y[last];
          pool.vx[i] = pool.vx[last];
          pool.vy[i] = pool.vy[last];
          pool.age[i] = pool.age[last];
          pool.life[i] = pool.life[last];
          continue;
        }
        pool.vx[i] = (pool.vx[i] + gx) * damp;
        pool.vy[i] = (pool.vy[i] + gy) * damp;
        pool.x[i] += pool.vx[i] * dt;
        pool.y[i] += pool.vy[i] * dt;
        i++;
      }
      if (!opts.preview && P.autoDestroy[e] && pool.count === 0 && (!P.emitting[e] || P.rate[e] === 0)) {
        world.commands.run((w) => w.isAlive(e) && destroyRecursive(w, e));
      }
    }
  }

  private pool(e: Entity): ParticlePool | null {
    const world = this.world;
    if (!world.has(e, ParticleEmitter2D)) return null;
    const max = Math.max(1, world.store(ParticleEmitter2D).maxParticles[e]);
    let pool = this.pools.get(e);
    if (!pool || pool.capacity !== max || pool.ref !== world.ref(e)) {
      pool = new ParticlePool(max);
      pool.ref = world.ref(e);
      this.pools.set(e, pool);
    }
    return pool;
  }

  private spawn(e: Entity, pool: ParticlePool): void {
    if (pool.count >= pool.capacity) return;
    const world = this.world;
    const P = world.store(ParticleEmitter2D);
    const rnd = this.random;
    const lerp = (a: number, b: number) => a + (b - a) * rnd();
    let px: number;
    let py: number;
    let rot = 0;
    if (world.has(e, GlobalTransform2D)) {
      const g = world.store(GlobalTransform2D).matrix;
      px = g.tx[e];
      py = g.ty[e];
      rot = Math.atan2(g.b[e], g.a[e]);
    } else {
      const T = world.store(Transform2D);
      px = T.position.x[e];
      py = T.position.y[e];
    }
    const angle = P.direction[e] + rot + (rnd() - 0.5) * P.spread[e];
    const speed = lerp(P.speed.x[e], P.speed.y[e]);
    const i = pool.count++;
    pool.x[i] = px;
    pool.y[i] = py;
    pool.vx[i] = Math.cos(angle) * speed;
    pool.vy[i] = Math.sin(angle) * speed;
    pool.age[i] = 0;
    pool.life[i] = Math.max(0.01, lerp(P.lifetime.x[e], P.lifetime.y[e]));
  }
}

/** ParticleEmitter2D simulation. */
export const ParticlesPlugin = {
  name: "brik:particles",
  build(app: App) {
    const particles = app.world.insertResource(new Particles(app.world));
    app.addSystem("update", { name: "particles", run: (w: World) => particles.update(w.resource(Time).dt) });
  },
};
