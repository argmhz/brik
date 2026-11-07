import { Time, type World } from "@brik/core";

/**
 * Camera and time effects for game feel: screen shake, a zoom punch, hit-stop
 * and slow motion. A resource: `world.resource(CameraFX)`, or from a script
 * `this.shakeCamera(8, 0.3)`. Every camera is affected; the UI is not.
 * Effects only move what is drawn: no entity is changed, so camera follow and
 * bounds keep working, and nothing is saved in the scene.
 */
export class CameraFX {
  /** Offset in world units added to every camera this frame (read by the renderer). */
  offsetX = 0;
  offsetY = 0;
  /** Factor multiplied onto every camera's zoom this frame (1 is no change). */
  zoomFactor = 1;

  private shakes: { strength: number; duration: number; left: number; frequency: number; seed: number }[] = [];
  private punches: { amount: number; duration: number; left: number }[] = [];
  private timeFx: { scale: number; left: number; restore: number } | null = null;
  private seeds = 1;

  /**
   * Shakes the screen. `strength` is the biggest offset in world units (pixels
   * at zoom 1) and fades out over `duration` seconds. Several shakes at once
   * add up. `frequency` is how many times per second the shake changes direction.
   */
  shake(strength = 8, duration = 0.3, frequency = 30): void {
    if (strength <= 0 || duration <= 0) return;
    this.shakes.push({ strength, duration, left: duration, frequency, seed: this.seeds++ * 17.31 });
  }

  /** A quick zoom-in that settles back: `amount` 0.1 is 10% closer, over `duration` seconds. Negative zooms out. */
  punch(amount = 0.1, duration = 0.2): void {
    if (amount === 0 || duration <= 0) return;
    this.punches.push({ amount, duration, left: duration });
  }

  /** Freezes the game for `duration` real seconds, e.g. 0.06 on a hit. Animation, physics and scripts stop. */
  hitStop(duration = 0.06, world?: World): void {
    this.slowMotion(0, duration, world);
  }

  /** Runs the game at `scale` (0.3 is slow motion) for `duration` real seconds, then back to what it was. */
  slowMotion(scale: number, duration: number, world?: World): void {
    if (duration <= 0) return;
    // a second effect while one runs keeps the original speed to go back to, and the lower scale
    this.timeFx = { scale: this.timeFx ? Math.min(this.timeFx.scale, scale) : scale, left: Math.max(duration, this.timeFx?.left ?? 0), restore: this.timeFx?.restore ?? NaN };
    if (world) this.applyTime(world.resource(Time));
  }

  /** Stops every effect at once. */
  stop(world?: World): void {
    this.shakes.length = 0;
    this.punches.length = 0;
    this.offsetX = this.offsetY = 0;
    this.zoomFactor = 1;
    if (this.timeFx && world) {
      const time = world.resource(Time);
      time.timeScale = this.timeFx.restore;
    }
    this.timeFx = null;
  }

  /** True while any effect is running. */
  get active(): boolean {
    return this.shakes.length > 0 || this.punches.length > 0 || this.timeFx !== null;
  }

  private applyTime(time: Time): void {
    const fx = this.timeFx;
    if (!fx) return;
    if (Number.isNaN(fx.restore)) fx.restore = time.timeScale;
    time.timeScale = fx.scale;
  }

  /** @internal Moves the effects on by one frame. Runs every frame, on real time. */
  update(world: World): void {
    const time = world.resource(Time);
    const dt = time.unscaledDt;
    this.applyTime(time);
    if (this.timeFx) {
      this.timeFx.left -= dt;
      if (this.timeFx.left <= 0) {
        time.timeScale = this.timeFx.restore;
        this.timeFx = null;
      }
    }
    let x = 0;
    let y = 0;
    for (const s of this.shakes) {
      s.left -= dt;
      if (s.left <= 0) continue;
      const fade = s.left / s.duration;
      const phase = (s.duration - s.left) * s.frequency;
      x += noise(phase, s.seed) * s.strength * fade;
      y += noise(phase, s.seed + 91.7) * s.strength * fade;
    }
    this.shakes = this.shakes.filter((s) => s.left > 0);
    let zoom = 1;
    for (const p of this.punches) {
      p.left -= dt;
      if (p.left <= 0) continue;
      // up fast, back down smoothly
      const u = 1 - p.left / p.duration;
      zoom *= 1 + p.amount * Math.sin(Math.PI * Math.sqrt(u)) ** 2;
    }
    this.punches = this.punches.filter((p) => p.left > 0);
    this.offsetX = x;
    this.offsetY = y;
    this.zoomFactor = zoom;
  }
}

/** Smooth noise in -1..1: random values at whole numbers, blended in between. Same input, same output. */
function noise(x: number, seed: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const a = hash(i, seed);
  const b = hash(i + 1, seed);
  const u = f * f * (3 - 2 * f);
  return a + (b - a) * u;
}

function hash(i: number, seed: number): number {
  const s = Math.sin(i * 127.1 + seed * 311.7) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
}

/**
 * A colour laid over the whole screen, on top of the UI: fades to black between
 * scenes, a red flash on damage. `alpha` 0 draws nothing. Scene switches with
 * `fade` drive it for you; scripts can also set it directly.
 */
export class ScreenFade {
  r = 0;
  g = 0;
  b = 0;
  alpha = 0;
}
