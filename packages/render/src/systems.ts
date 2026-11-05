import { Assets, frameAt } from "@brik/assets";
import { type App, type Entity, GlobalTransform2D, Parent, Time, Transform2D, type World, defineEvent } from "@brik/core";
import { CameraFollow2D, Sprite, SpriteAnimator } from "./components";
import { ParticlesPlugin } from "./particles";

export interface AnimationEventData {
  entity: Entity;
  /** The event name set on the frame, e.g. "footstep". */
  name: string;
  clip: string;
}

/** Sent when an animation reaches a frame that has an event. */
export const AnimationEvent = defineEvent<AnimationEventData>("AnimationEvent");

/** Sent when a clip with mode "once" reaches its end. */
export const AnimationFinished = defineEvent<{ entity: Entity; clip: string }>("AnimationFinished");

/**
 * Switches an entity's animation. Nothing happens if the clip is already
 * playing, unless `restart` is set. Adds a SpriteAnimator if needed.
 */
export function playAnimation(
  world: World,
  e: Entity,
  clip: string,
  opts: { restart?: boolean; speed?: number } = {},
): void {
  const found = world.resource(Assets).clip(clip);
  if (!found) throw new Error(`Brik: unknown animation "${clip}"`);
  if (!world.has(e, SpriteAnimator)) world.add(e, SpriteAnimator);
  const A = world.store(SpriteAnimator);
  if (A.clip[e] !== found.guid || opts.restart) {
    A.clip[e] = found.guid;
    A.time[e] = 0;
    A.frame[e] = -1;
  }
  A.playing[e] = 1;
  if (opts.speed !== undefined) A.speed[e] = opts.speed;
}

export function animateSprites(world: World): void {
  const assets = world.resource(Assets);
  const dt = world.resource(Time).dt;
  const A = world.store(SpriteAnimator);
  const S = world.store(Sprite);
  for (const e of world.query([SpriteAnimator, Sprite])) {
    const guid = A.clip[e];
    if (!guid) continue;
    const clip = assets.clip(guid);
    if (!clip || clip.frames.length === 0) continue;
    if (A.playing[e]) A.time[e] += dt * A.speed[e];
    const { frame, done } = frameAt(clip, A.time[e]);
    if (frame !== A.frame[e]) {
      A.frame[e] = frame;
      S.sprite[e] = clip.frames[frame].sprite;
      for (const ev of clip.events) {
        if (ev.frame === frame) world.emit(AnimationEvent, { entity: e, name: ev.name, clip: clip.guid });
      }
    }
    if (done && A.playing[e]) {
      A.playing[e] = 0;
      world.emit(AnimationFinished, { entity: e, clip: clip.guid });
    }
  }
}

/** Runs after transforms are propagated, and patches the follower's global transform too. */
export function followCameras(world: World): void {
  const dt = world.resource(Time).dt;
  const F = world.store(CameraFollow2D);
  const T = world.store(Transform2D);
  const G = world.store(GlobalTransform2D).matrix;
  for (const e of world.query([CameraFollow2D, Transform2D])) {
    if (world.has(e, Parent)) continue;
    const target = world.deref(F.target[e]);
    if (target < 0 || !world.has(target, GlobalTransform2D)) continue;
    const tx = G.tx[target] + F.offset.x[e];
    const ty = G.ty[target] + F.offset.y[e];
    let x = T.position.x[e];
    let y = T.position.y[e];
    // only chase the part of the target's offset that is outside the deadzone
    const dx = tx - x;
    const dy = ty - y;
    const zx = F.deadzone.x[e];
    const zy = F.deadzone.y[e];
    const wantX = Math.abs(dx) > zx ? tx - Math.sign(dx) * zx : x;
    const wantY = Math.abs(dy) > zy ? ty - Math.sign(dy) * zy : y;
    const s = Math.min(0.99, Math.max(0, F.smoothing[e]));
    const k = s === 0 ? 1 : 1 - s ** (dt * 10);
    x += (wantX - x) * k;
    y += (wantY - y) * k;
    if (F.useBounds[e]) {
      x = Math.min(Math.max(x, F.bounds.x[e]), F.bounds.x[e] + F.bounds.w[e]);
      y = Math.min(Math.max(y, F.bounds.y[e]), F.bounds.y[e] + F.bounds.h[e]);
    }
    T.position.x[e] = x;
    T.position.y[e] = y;
    if (world.has(e, GlobalTransform2D)) {
      G.tx[e] = x;
      G.ty[e] = y;
    }
  }
}

/** SpriteAnimator, CameraFollow2D and particles. Works without a renderer (e.g. in the editor's play mode). */
export const SpriteLogicPlugin = {
  name: "brik:sprite-logic",
  build(app: App) {
    app.addSystem("update", { name: "sprite.animate", run: animateSprites });
    app.addSystem("postUpdate", { name: "camera.follow", run: followCameras });
    app.addPlugin(ParticlesPlugin);
  },
};
