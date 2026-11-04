import type { Entity } from "./entity";
import type { Schema } from "./schema";
import type { World } from "./world";

export interface ComponentOptions {
  /** Components that are added automatically (with defaults) when this one is added. */
  requires?: ComponentDef[];
  /** Called after the component is added and initialized. */
  onAdd?: (world: World, e: Entity) => void;
  /** Called before the component is removed, also when the entity is destroyed. */
  onRemove?: (world: World, e: Entity) => void;
  /** Hidden from the editor inspector (e.g. computed components). */
  hidden?: boolean;
  /** Set to false for computed components that should not be saved in scenes. */
  serialize?: boolean;
}

export interface ComponentDef<S extends Schema = Schema> {
  readonly id: number;
  readonly name: string;
  readonly schema: S;
  readonly options: ComponentOptions;
}

let nextComponentId = 0;
const registry = new Map<string, ComponentDef>();

/**
 * Defines a component type.
 *
 * ```ts
 * const Velocity2D = defineComponent("Velocity2D", { linear: t.vec2(), angular: t.f32() });
 * ```
 *
 * The same schema drives storage, serialization and the editor inspector.
 *
 * Defining a component again with the same name and the same field layout
 * returns the existing definition (with updated defaults, hints and hooks).
 * That keeps existing data working when scripts are hot-reloaded.
 */
export function defineComponent<S extends Schema = {}>(
  name: string,
  schema: S = {} as S,
  options: ComponentOptions = {},
): ComponentDef<S> {
  const existing = registry.get(name);
  if (existing && sameLayout(existing.schema, schema)) {
    Object.assign(existing.schema, schema);
    Object.assign(existing.options, options);
    return existing as ComponentDef<S>;
  }
  if (existing) console.warn(`[brik] component "${name}" changed its fields; existing entities keep the old version`);
  const def: ComponentDef<S> = { id: nextComponentId++, name, schema, options };
  registry.set(name, def);
  return def;
}

function sameLayout(a: Schema, b: Schema): boolean {
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => b[k]?.kind === a[k].kind);
}

/** Looks up a component by name, e.g. when loading a scene. */
export function componentByName(name: string): ComponentDef | undefined {
  return registry.get(name);
}

export function allComponents(): ComponentDef[] {
  return [...registry.values()];
}
