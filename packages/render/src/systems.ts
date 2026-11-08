import { type AnimationClip, Assets, frameAt } from "@brik/assets";
import { type App, type Entity, GlobalTransform2D, Parent, Time, childrenOf, Transform2D, type World, defineEvent } from "@brik/core";
import { Camera2D, CameraFollow2D, Parallax2D, Sprite, SpriteAnimator } from "./components";
import { CameraFX, ScreenFade } from "./camera-fx";
import { UILayout } from "./ui";
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

function emitFrameEvents(world: World, e: Entity, clip: AnimationClip, frame: number): void {
  for (const ev of clip.events) {
    if (ev.frame === frame) world.emit(AnimationEvent, { entity: e, name: ev.name, clip: clip.guid });
  }
}

/**
 * The frames shown while time went from `from` to `to`, in order, each time the frame changed, ending with the
 * frame at `to`. Samples at the shortest frame length, so no frame is missed, even if the clip looped right back
 * to where it was.
 */
function framesShown(clip: AnimationClip, from: number, to: number, last: number): number[] {
  const step = Math.min(...clip.frames.map((f) => f.duration).filter((d) => d > 0));
  const out: number[] = [];
  const see = (t: number) => {
    const f = frameAt(clip, t).frame;
    if (f !== last) out.push(f);
    last = f;
  };
  // a clip that has just started has shown nothing yet: its first frame counts too
  if (last < 0) see(from);
  if (Number.isFinite(step)) {
    // bounded work for absurdly long steps
    for (let t = Math.max(from, to - step * 2000) + step; t < to; t += step) see(t);
  }
  see(to);
  return out;
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
    const before = A.time[e];
    if (A.playing[e]) A.time[e] += dt * A.speed[e];
    const { frame, done } = frameAt(clip, A.time[e]);
    if (A.playing[e] && A.speed[e] > 0 && A.time[e] > before) {
      // a long step can skip frames, or loop right back to the same one: send the events of every frame passed
      const fresh = A.frame[e] < 0;
      for (const f of framesShown(clip, fresh ? 0 : before, A.time[e], A.frame[e])) emitFrameEvents(world, e, clip, f);
    } else if (frame !== A.frame[e]) {
      emitFrameEvents(world, e, clip, frame);
    }
    if (frame !== A.frame[e]) {
      A.frame[e] = frame;
      S.sprite[e] = clip.frames[frame].sprite;
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
      const half = F.boundsMode[e] === "view" ? viewHalfSize(world, e, T.rotation[e]) : { x: 0, y: 0 };
      x = clampInto(x, F.bounds.x[e], F.bounds.w[e], half.x);
      y = clampInto(y, F.bounds.y[e], F.bounds.h[e], half.y);
    }
    T.position.x[e] = x;
    T.position.y[e] = y;
    if (world.has(e, GlobalTransform2D)) {
      G.tx[e] = x;
      G.ty[e] = y;
    }
  }
}

/** The camera drawn first (lowest priority), or -1. */
function firstCamera(world: World): Entity {
  const C = world.store(Camera2D);
  let best = -1;
  for (const e of world.query([Camera2D, Transform2D])) {
    if (best < 0 || C.priority[e] < C.priority[best]) best = e;
  }
  return best;
}

/**
 * Moves Parallax2D layers by their share of the camera's position. Runs right after the camera
 * has followed its target, and shifts the layer's children's global transforms by the same
 * amount, so nothing lags a frame behind the camera.
 */
export function applyParallax(world: World): void {
  const P = world.store(Parallax2D);
  const T = world.store(Transform2D);
  const G = world.store(GlobalTransform2D).matrix;
  let fallback = -2;
  for (const e of world.query([Parallax2D, Transform2D])) {
    if (world.has(e, Parent)) continue;
    let cam = world.deref(P.camera[e]);
    if (cam < 0) cam = fallback === -2 ? (fallback = firstCamera(world)) : fallback;
    if (cam < 0) continue;
    if (!P.ready[e]) {
      P.baseX[e] = T.position.x[e];
      P.baseY[e] = T.position.y[e];
      P.ready[e] = 1;
    }
    const x = P.baseX[e] + T.position.x[cam] * (1 - P.factor.x[e]);
    const y = P.baseY[e] + T.position.y[cam] * (1 - P.factor.y[e]);
    const dx = x - T.position.x[e];
    const dy = y - T.position.y[e];
    if (dx === 0 && dy === 0) continue;
    T.position.x[e] = x;
    T.position.y[e] = y;
    // global transforms were made from last frame's position: move the layer and everything under it
    shiftTree(world, e, dx, dy, G);
  }
}

/** Moves the global transforms of an entity and everything under it. */
function shiftTree(world: World, e: Entity, dx: number, dy: number, G = world.store(GlobalTransform2D).matrix): void {
  const stack = [e];
  while (stack.length) {
    const n = stack.pop()!;
    if (world.has(n, GlobalTransform2D)) {
      G.tx[n] += dx;
      G.ty[n] += dy;
    }
    for (const c of childrenOf(world, n)) stack.push(c);
  }
}

/**
 * For an editor: shows the Parallax2D layers as they will look in the game with the camera
 * at (`cameraX`, `cameraY`). Only the global transforms change (call it after transforms are
 * propagated); the layers' own positions, which are what is saved, stay as they are.
 */
export function previewParallax(world: World, cameraX: number, cameraY: number): void {
  const P = world.store(Parallax2D);
  const G = world.store(GlobalTransform2D).matrix;
  for (const e of world.query([Parallax2D, Transform2D])) {
    if (world.has(e, Parent)) continue;
    const dx = cameraX * (1 - P.factor.x[e]);
    const dy = cameraY * (1 - P.factor.y[e]);
    if (dx !== 0 || dy !== 0) shiftTree(world, e, dx, dy, G);
  }
}

/**
 * Half the world area a camera shows, from the screen size of the last
 * rendered frame: the box around the view in the world's axes, so a rotated
 * camera (`rotation`, radians) needs more room than an upright one. Zero
 * before anything has been drawn, or without a Camera2D.
 */
export function viewHalfSize(world: World, camera: Entity, rotation = 0): { x: number; y: number } {
  const layout = world.tryResource(UILayout);
  if (!layout?.screenW || !world.has(camera, Camera2D)) return { x: 0, y: 0 };
  const C = world.store(Camera2D);
  const zoom = C.zoom[camera] || 1;
  const w = (layout.screenW * C.viewport.w[camera]) / zoom / 2;
  const h = (layout.screenH * C.viewport.h[camera]) / zoom / 2;
  const c = Math.abs(Math.cos(rotation));
  const s = Math.abs(Math.sin(rotation));
  return { x: c * w + s * h, y: s * w + c * h };
}

/** Keeps a center `v` with half-size `half` inside [min, min + size]; centered when it doesn't fit. */
function clampInto(v: number, min: number, size: number, half: number): number {
  if (size <= half * 2) return min + size / 2;
  return Math.min(Math.max(v, min + half), min + size - half);
}

/** SpriteAnimator, CameraFollow2D and particles. Works without a renderer (e.g. in the editor's play mode). */
export const SpriteLogicPlugin = {
  name: "brik:sprite-logic",
  build(app: App) {
    app.addSystem("update", { name: "sprite.animate", run: animateSprites });
    app.addSystem("postUpdate", { name: "camera.follow", run: followCameras });
    app.addSystem("postUpdate", { name: "camera.parallax", run: applyParallax });
    const fx = app.world.insertResource(new CameraFX());
    app.world.insertResource(new ScreenFade());
    app.addSystem("postUpdate", { name: "camera.fx", run: (w: World) => fx.update(w) });
    app.addPlugin(ParticlesPlugin);
  },
};
