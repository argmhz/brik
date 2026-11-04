import type { SpriteRef } from "./index";

export type AnimationMode = "loop" | "once" | "pingpong";

export interface AnimationFrame {
  sprite: SpriteRef;
  /** Seconds this frame is shown. */
  duration: number;
}

export interface AnimationEventDef {
  /** Frame index the event fires on (when that frame starts). */
  frame: number;
  name: string;
}

/** A sprite animation, stored as `<name>.anim.json`. */
export interface AnimationClip {
  guid: string;
  name: string;
  mode: AnimationMode;
  frames: AnimationFrame[];
  events: AnimationEventDef[];
}

interface ClipJson {
  guid: string;
  importer: "animation";
  mode?: AnimationMode;
  frames?: { sprite: [string, string]; duration?: number }[];
  events?: AnimationEventDef[];
}

export const ANIMATION_EXTENSION = ".anim.json";

export function clipToJson(clip: AnimationClip): string {
  const json: ClipJson = {
    guid: clip.guid,
    importer: "animation",
    mode: clip.mode,
    frames: clip.frames.map((f) => ({ sprite: [f.sprite.texture, f.sprite.id], duration: round(f.duration) })),
    events: clip.events,
  };
  return `${JSON.stringify(json, null, 2)}\n`;
}

export function parseClip(text: string, name: string): AnimationClip {
  const j = JSON.parse(text) as Partial<ClipJson>;
  if (typeof j.guid !== "string") throw new Error("Brik: animation file has no guid");
  return {
    guid: j.guid,
    name,
    mode: j.mode === "once" || j.mode === "pingpong" ? j.mode : "loop",
    frames: (j.frames ?? []).map((f) => ({
      sprite: { texture: f.sprite[0], id: f.sprite[1] },
      duration: f.duration && f.duration > 0 ? f.duration : 0.1,
    })),
    events: (j.events ?? []).filter((e) => typeof e.name === "string" && Number.isInteger(e.frame)),
  };
}

/** Total length of one pass through the clip, in seconds. */
export function clipLength(clip: AnimationClip): number {
  let t = 0;
  for (const f of clip.frames) t += f.duration;
  return t;
}

/**
 * Which frame is shown at `time` seconds, and whether a "once" clip has ended.
 * Ping-pong plays 0..n-1..1 so the end frames aren't shown twice.
 */
export function frameAt(clip: AnimationClip, time: number): { frame: number; done: boolean } {
  const n = clip.frames.length;
  if (n === 0) return { frame: -1, done: true };
  const len = clipLength(clip);
  if (len <= 0) return { frame: 0, done: clip.mode === "once" };
  if (clip.mode === "once" && time >= len) return { frame: n - 1, done: true };
  if (clip.mode === "pingpong" && n > 2) {
    // forward pass covers all frames, backward pass frames n-2..1
    const back = len - clip.frames[0].duration - clip.frames[n - 1].duration;
    const cycle = len + back;
    let t = ((time % cycle) + cycle) % cycle;
    if (t < len) return { frame: indexAt(clip, t), done: false };
    t -= len;
    for (let i = n - 2; i >= 1; i--) {
      if (t < clip.frames[i].duration) return { frame: i, done: false };
      t -= clip.frames[i].duration;
    }
    return { frame: 1, done: false };
  }
  const t = clip.mode === "once" ? time : ((time % len) + len) % len;
  return { frame: indexAt(clip, t), done: false };
}

function indexAt(clip: AnimationClip, t: number): number {
  for (let i = 0; i < clip.frames.length; i++) {
    if (t < clip.frames[i].duration) return i;
    t -= clip.frames[i].duration;
  }
  return clip.frames.length - 1;
}

const round = (n: number) => Math.round(n * 1e4) / 1e4;
