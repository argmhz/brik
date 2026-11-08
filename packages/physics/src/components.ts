import { type Entity, Transform2D, defineComponent, defineEvent, t, withMeta } from "@brik/core";

/** A physics body. Add a Collider2D to give it a shape. */
export const RigidBody2D = defineComponent(
  "RigidBody2D",
  {
    type: t.enum(["dynamic", "kinematic", "static"] as const, "dynamic"),
    /** 0 means "from the colliders' density". */
    mass: withMeta(t.f32(0), { min: 0, step: 0.1 }),
    gravityScale: withMeta(t.f32(1), { step: 0.1 }),
    linearDamping: withMeta(t.f32(0), { min: 0, step: 0.1 }),
    angularDamping: withMeta(t.f32(0), { min: 0, step: 0.1 }),
    fixedRotation: t.bool(false),
    /** Continuous collision detection, for fast objects like bullets. */
    ccd: t.bool(false),
  },
  { requires: [Transform2D] },
);

/** Velocity of a RigidBody2D in world units per second. Read and write it from scripts. */
export const Velocity2D = defineComponent("Velocity2D", {
  linear: t.vec2(0, 0),
  /** Radians per second, counter-clockwise. */
  angular: t.f32(0),
});

/**
 * A collision shape. On an entity without a RigidBody2D it becomes a static collider.
 * `size` is the full width/height (a circle uses `size.x` as its diameter).
 */
export const Collider2D = defineComponent(
  "Collider2D",
  {
    shape: t.enum(["box", "circle", "capsule"] as const, "box"),
    size: t.vec2(32, 32),
    offset: t.vec2(0, 0),
    friction: withMeta(t.f32(0.5), { min: 0, step: 0.05 }),
    restitution: withMeta(t.f32(0), { min: 0, max: 1, step: 0.05 }),
    density: withMeta(t.f32(1), { min: 0, step: 0.1 }),
    /** Detects overlaps (TriggerEnter/Exit) without pushing anything. */
    isTrigger: t.bool(false),
  },
  { requires: [Transform2D] },
);

/**
 * Which colliders can touch. Two colliders interact when each one's `group`
 * shares a bit with the other's `mask`.
 */
export const CollisionFilter = defineComponent("CollisionFilter", {
  group: withMeta(t.u32(1), { editor: "bits" }),
  mask: withMeta(t.u32(0xffff), { editor: "bits" }),
});

/**
 * Moves a kinematic body with collisions, slopes and steps, for platformers
 * and top-down games. Move it with `physics.moveCharacter(e, dx, dy)` (in a script:
 * `this.moveCharacter(dx, dy)`). The body is kinematic whatever RigidBody2D says, so
 * the physics' gravity doesn't pull it: the script adds gravity to its own speed.
 */
export const CharacterController2D = defineComponent(
  "CharacterController2D",
  {
    /** Steepest walkable slope. */
    slopeLimit: withMeta(t.f32(Math.PI / 4), { editor: "angle" }),
    /** Max step height to climb automatically (0 = off). */
    stepHeight: withMeta(t.f32(0), { min: 0, step: 1 }),
    /** Keeps the character on the ground when walking down slopes (0 = off). */
    snapToGround: withMeta(t.f32(4), { min: 0, step: 1 }),
    /** Gap kept between the character and walls. */
    skin: withMeta(t.f32(0.5), { min: 0.01, step: 0.1 }),
    /** True if the last move ended on the ground (read-only). */
    grounded: withMeta(t.bool(false), { label: "grounded (read-only)" }),
  },
  { requires: [Collider2D] },
);

export interface CollisionData {
  a: Entity;
  b: Entity;
}

/** Two solid colliders started touching. */
export const CollisionEnter = defineEvent<CollisionData>("CollisionEnter");
/** Two solid colliders stopped touching. */
export const CollisionExit = defineEvent<CollisionData>("CollisionExit");
/** A collider entered a trigger (one of `a`/`b` is the trigger). */
export const TriggerEnter = defineEvent<CollisionData>("TriggerEnter");
/** A collider left a trigger. */
export const TriggerExit = defineEvent<CollisionData>("TriggerExit");

/**
 * Connects this body to another one (`connected`), or to a point in the world
 * when `connected` is empty. Anchors are in each body's local units; without
 * a connected body, `connectedAnchor` is a world position.
 */
export const Joint2D = defineComponent(
  "Joint2D",
  {
    /**
     * hinge: turns around the anchors (pendulums, doors, wheels). fixed: welded
     * where the bodies are when it starts (connectedAnchor is ignored).
     * spring: pulled towards `length` apart. rope: at most `length` apart.
     * slider: moves only along `axis`.
     */
    type: t.enum(["hinge", "fixed", "spring", "rope", "slider"] as const, "hinge"),
    connected: t.entity(),
    anchor: t.vec2(0, 0),
    connectedAnchor: t.vec2(0, 0),
    /** Rest length of a spring, or the most a rope allows (world units). */
    length: withMeta(t.f32(32), { min: 0, step: 1 }),
    /** How hard a spring pulls. */
    stiffness: withMeta(t.f32(20), { min: 0, step: 1 }),
    /** How quickly a spring stops bouncing. */
    damping: withMeta(t.f32(1), { min: 0, step: 0.1 }),
    /** Direction a slider moves along, in this body's local space. */
    axis: t.vec2(1, 0),
    /** Let the two bodies collide with each other. */
    collideConnected: t.bool(false),
  },
  { requires: [RigidBody2D] },
);
