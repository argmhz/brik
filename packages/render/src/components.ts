import type { SpriteRef } from "@brik/assets";
import { Transform2D, type Vec2, defineComponent, t, withMeta } from "@brik/core";


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
    /**
     * simple: the sprite at its own size. sliced: stretched to `size`, with a
     * 9-slice sprite's corners kept at their size (platforms, signs, panels).
     */
    drawMode: t.enum(["simple", "sliced"] as const, "simple"),
    /** World size in "sliced" mode. */
    size: t.vec2(32, 32),
  },
  { requires: [Transform2D] },
);

/**
 * Turns on lighting for a camera: everything that camera draws in the world is multiplied by the light there.
 * `ambient` is the light that is everywhere, so a dark color makes a dark scene, and `Light2D` entities add light.
 * Put it on the same entity as the Camera2D. A camera without it draws everything fully lit. UI is never darkened.
 */
export const Lighting2D = defineComponent("Lighting2D", {
  /** The light everywhere: black is pitch dark, white is no darkening at all. */
  ambient: t.color(0.12, 0.12, 0.18, 1),
  /** Switch lighting off without removing it. */
  enabled: t.bool(true),
});

/**
 * A light that brightens the world around it (needs a Lighting2D on a camera to show).
 * A spot light points along the entity's rotation: 0 is to the right (+x), and it turns counter-clockwise.
 * The entity's scale scales the radius.
 */
export const Light2D = defineComponent(
  "Light2D",
  {
    kind: t.enum(["point", "spot"] as const, "point"),
    color: t.color(1, 0.94, 0.78, 1),
    /** How strong the light is. 1 lights the world fully at the center. */
    intensity: withMeta(t.f32(1), { min: 0, step: 0.1 }),
    /** How far the light reaches (world units). */
    radius: withMeta(t.f32(160), { min: 1, step: 5 }),
    /** 0: a sharp edge. 1: fades out smoothly from the center. */
    softness: withMeta(t.f32(0.6), { min: 0, max: 1, step: 0.05 }),
    /** A spot light's opening in degrees. */
    angle: withMeta(t.f32(60), { min: 1, max: 360, step: 1 }),
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
    /** rect / circle fill `size`; polygon fills `points`; line draws `points` with the stroke. */
    kind: t.enum(["rect", "circle", "polygon", "line"] as const, "rect"),
    size: t.vec2(32, 32),
    /** Outline of a polygon, or the points of a line, in local units (y up). */
    points: withMeta(
      t.ref<Vec2[]>(() => [
        { x: -16, y: -14 },
        { x: 16, y: -14 },
        { x: 0, y: 16 },
      ]),
      { editor: "points" },
    ),
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
 * Makes an entity (and its children) move at a fraction of the camera's speed, for
 * layers of background that give depth: far hills slowly, nearer houses faster.
 * `factor` 1 moves with the world as usual, 0 stays fixed on the screen, and 0.5 moves
 * at half speed. The entity should be a root; put the layer's sprites under it as
 * children. Its own position is where the layer sits while the camera is at (0, 0).
 */
export const Parallax2D = defineComponent(
  "Parallax2D",
  {
    /** How much of the camera's movement the layer follows, in x and y. */
    factor: t.vec2(0.5, 1),
    /** The camera to follow. Empty: the camera that is drawn first. */
    camera: t.entity(),
    /** Where the layer was placed (read-only, set when the game starts). */
    baseX: withMeta(t.f32(0), { hidden: true }),
    baseY: withMeta(t.f32(0), { hidden: true }),
    ready: withMeta(t.bool(false), { hidden: true }),
  },
  { requires: [Transform2D] },
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
