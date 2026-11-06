import type { SpriteRef } from "@brik/assets";
import { Transform2D, defineComponent, t, withMeta } from "@brik/core";


/**
 * An orthographic 2D camera. Its Transform2D position is the center of the view.
 * At zoom 1 one world unit is one CSS pixel.
 */
export const Camera2D = defineComponent(
  "Camera2D",
  {
    zoom: withMeta(t.f32(1), { min: 0.01, step: 0.1 }),
    /** Normalized screen rectangle (0..1, origin bottom-left). */
    viewport: t.rect(0, 0, 1, 1),
    clearColor: t.color(0.08, 0.08, 0.1, 1),
    clear: t.bool(true),
    /** Higher priority renders later (on top). */
    priority: t.i32(0),
  },
  { requires: [Transform2D] },
);

/** Draws a sprite at the entity's transform. */
export const Sprite = defineComponent(
  "Sprite",
  {
    sprite: withMeta(t.ref<SpriteRef | null>(() => null), { editor: "sprite" }),
    color: t.color(1, 1, 1, 1),
    flipX: t.bool(false),
    flipY: t.bool(false),
  },
  { requires: [Transform2D] },
);

/** Draw order. Lower layers first; within a layer lower order first. */
export const SortingOrder = defineComponent("SortingOrder", {
  layer: t.i32(0),
  order: t.i32(0),
  /** Sort by world y within the same layer/order (top-down games). */
  ySort: t.bool(false),
});

/** A filled and/or outlined vector shape. Good for prototypes, debug art and UI. */
export const Shape2D = defineComponent(
  "Shape2D",
  {
    kind: t.enum(["rect", "circle"] as const, "rect"),
    size: t.vec2(32, 32),
    fill: t.color(1, 1, 1, 1),
    stroke: t.color(0, 0, 0, 1),
    strokeWidth: withMeta(t.f32(0), { min: 0, step: 0.5 }),
    /** Corner radius for rects. */
    radius: withMeta(t.f32(0), { min: 0, step: 1 }),
  },
  { requires: [Transform2D] },
);

/** Text in the game world, centered on the entity according to `align`. */
export const Text2D = defineComponent(
  "Text2D",
  {
    text: withMeta(t.string("Tekst"), { editor: "multiline" }),
    /** Font size in world units. */
    size: withMeta(t.f32(16), { min: 1, step: 1 }),
    color: t.color(1, 1, 1, 1),
    font: t.string("sans-serif"),
    align: t.enum(["left", "center", "right"] as const, "center"),
    bold: t.bool(false),
    /** Wrap lines longer than this (world units). 0 means no wrapping. */
    maxWidth: withMeta(t.f32(0), { min: 0, step: 10 }),
    lineHeight: withMeta(t.f32(1.2), { min: 0.5, step: 0.1 }),
  },
  { requires: [Transform2D] },
);

/**
 * Plays an animation clip (`.anim.json`) by setting the entity's Sprite each frame.
 * Switch clips from a script with `playAnimation(world, e, "hero_run")`.
 */
export const SpriteAnimator = defineComponent(
  "SpriteAnimator",
  {
    /** Clip guid. */
    clip: withMeta(t.ref<string | null>(() => null), { editor: "clip" }),
    speed: withMeta(t.f32(1), { step: 0.1 }),
    playing: t.bool(true),
    /** Seconds into the clip. */
    time: withMeta(t.f32(0), { hidden: true }),
    /** Frame currently shown (read-only). */
    frame: withMeta(t.i32(-1), { hidden: true }),
  },
  { requires: [Sprite] },
);

/**
 * Moves the camera (or any entity) toward a target each frame. The entity
 * following should be a root entity (no parent).
 */
export const CameraFollow2D = defineComponent(
  "CameraFollow2D",
  {
    target: t.entity(),
    offset: t.vec2(0, 0),
    /** 0 snaps to the target. Higher values follow more loosely. */
    smoothing: withMeta(t.f32(0.15), { min: 0, max: 1, step: 0.01 }),
    /** The target can move this far (half-size) from the center before the camera moves. */
    deadzone: t.vec2(0, 0),
    /** Keep the camera inside `bounds` (see `boundsMode`). */
    useBounds: t.bool(false),
    /** World rectangle, e.g. the level's edges. */
    bounds: t.rect(-1000, -1000, 2000, 2000),
    /**
     * "view": everything the camera shows stays inside `bounds` (a view larger
     * than the bounds is centered on them). "center": only the camera's
     * center does, so how far past the edge you see depends on the screen size.
     */
    boundsMode: t.enum(["view", "center"] as const, "view"),
  },
  { requires: [Transform2D] },
);
