import { defineComponent } from "../ecs/component";
import type { Entity } from "../ecs/entity";
import { t, withMeta } from "../ecs/schema";
import type { World } from "../ecs/world";

/** Display name, shown in the editor hierarchy. */
export const Name = defineComponent("Name", { value: t.string("") });

/**
 * World-space result of the transform hierarchy. Written by the engine in
 * `postUpdate`; don't set it yourself.
 */
export const GlobalTransform2D = defineComponent(
  "GlobalTransform2D",
  {
    matrix: t.mat3(),
    /** False if this entity or any ancestor has `Active.self = false`. */
    active: t.bool(true),
  },
  { hidden: true, serialize: false },
);

/** Local position (world units), rotation (radians, counter-clockwise) and scale. */
export const Transform2D = defineComponent(
  "Transform2D",
  {
    position: t.vec2(0, 0),
    rotation: withMeta(t.f32(0), { editor: "angle" }),
    scale: t.vec2(1, 1),
  },
  { requires: [GlobalTransform2D] },
);

/** Turns an entity and its children on or off. Entities without it are active. */
export const Active = defineComponent("Active", { self: t.bool(true) });

/** Turns an entity (and its children) on or off, adding Active when it doesn't have it. */
export function setActive(world: World, e: Entity, on: boolean): void {
  if (world.has(e, Active)) world.write(e, Active, { self: on });
  else if (!on) world.add(e, Active, { self: false });
}

/**
 * Whether the entity is on: its own Active flag, and none of its parents
 * switched off. Changes made this frame show after the transform pass.
 */
export function isActive(world: World, e: Entity): boolean {
  if (world.has(e, Active) && !world.store(Active).self[e]) return false;
  return !world.has(e, GlobalTransform2D) || world.store(GlobalTransform2D).active[e] === 1;
}

/** Kept in sync automatically. Use `setParent` to change the hierarchy. */
export const Children = defineComponent(
  "Children",
  { list: t.ref<Entity[]>(() => []) },
  {
    hidden: true,
    serialize: false,
    onRemove(world, e) {
      // orphan the children; use destroyRecursive() to destroy them instead
      const list = [...world.store(Children).list[e]];
      for (const child of list) world.remove(child, Parent);
    },
  },
);

export const Parent = defineComponent(
  "Parent",
  { entity: t.entity() },
  {
    // edited through the hierarchy (setParent), never directly
    hidden: true,
    onRemove(world, e) {
      const p = world.deref(world.store(Parent).entity[e]);
      if (p >= 0 && world.has(p, Children)) {
        const list = world.store(Children).list[p];
        const i = list.indexOf(e);
        if (i >= 0) list.splice(i, 1);
        if (list.length === 0) world.remove(p, Children);
      }
    },
  },
);

/**
 * Moves `child` under `parent`, or makes it a root when `parent` is -1.
 * `index` places it among its siblings (default: last).
 */
export function setParent(world: World, child: Entity, parent: Entity, index?: number): void {
  if (parent === child) throw new Error("Brik: an entity cannot be its own parent");
  for (let p = parent; p >= 0; p = parentOf(world, p)) {
    if (p === child) throw new Error("Brik: setParent would create a cycle");
  }
  world.remove(child, Parent);
  if (parent < 0) return;
  world.add(child, Parent, { entity: world.ref(parent) });
  world.add(parent, Children);
  const list = world.store(Children).list[parent];
  if (index === undefined || index < 0 || index >= list.length) list.push(child);
  else list.splice(index, 0, child);
}

export function parentOf(world: World, e: Entity): Entity {
  return world.has(e, Parent) ? world.deref(world.store(Parent).entity[e]) : -1;
}

export function childrenOf(world: World, e: Entity): readonly Entity[] {
  return world.has(e, Children) ? world.store(Children).list[e] : [];
}

/** Destroys an entity together with all its descendants. */
export function destroyRecursive(world: World, e: Entity): void {
  for (const child of [...childrenOf(world, e)]) destroyRecursive(world, child);
  world.destroy(e);
}
