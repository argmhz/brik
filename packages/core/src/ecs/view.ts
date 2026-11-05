import type { ComponentDef } from "./component";
import type { Entity } from "./entity";
import { PARTS, type Schema, type Value } from "./schema";
import type { World } from "./world";

/**
 * A live object for one entity's component. Reading and writing its properties
 * goes straight to the component stores, so this works as expected:
 *
 * ```ts
 * const t = componentView(world, Transform2D, e);
 * t.position.x += 10;
 * t.rotation = 0;
 * ```
 *
 * Views are meant for scripts and convenience code. Hot loops over many
 * entities should use `world.store()` directly.
 */
export function componentView<S extends Schema>(world: World, def: ComponentDef<S>, e: Entity): Value<S> {
  const view = {} as Record<string, unknown>;
  // the store object is stable; its arrays may be replaced when the world grows,
  // so always look them up through it
  const store = world.store(def) as Record<string, any>;
  for (const key in def.schema) {
    const kind = def.schema[key].kind;
    const parts = PARTS[kind];
    if (parts) {
      const sub = {} as Record<string, number>;
      for (const p of parts) {
        Object.defineProperty(sub, p, {
          enumerable: true,
          get: () => store[key][p][e],
          set: (v: number) => {
            store[key][p][e] = v;
            world.markChanged(e, def);
          },
        });
      }
      Object.defineProperty(view, key, {
        enumerable: true,
        get: () => sub,
        set: (v: Record<string, number>) => {
          for (const p of parts) if (v[p] !== undefined) store[key][p][e] = v[p];
          world.markChanged(e, def);
        },
      });
    } else if (kind === "bool") {
      Object.defineProperty(view, key, {
        enumerable: true,
        get: () => store[key][e] !== 0,
        set: (v: boolean) => {
          store[key][e] = v ? 1 : 0;
          world.markChanged(e, def);
        },
      });
    } else {
      Object.defineProperty(view, key, {
        enumerable: true,
        get: () => store[key][e],
        set: (v: unknown) => {
          store[key][e] = v;
          world.markChanged(e, def);
        },
      });
    }
  }
  return view as Value<S>;
}
