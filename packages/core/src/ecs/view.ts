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
    } else if (kind === "ref") {
      // lists and plain objects are watched, so changing them in place counts as a change
      const watch = watcher(() => world.markChanged(e, def));
      Object.defineProperty(view, key, {
        enumerable: true,
        get: () => watch(store[key][e]),
        set: (v: unknown) => {
          store[key][e] = unwrap(v);
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

/** Arrays and plain objects (not Maps, class instances and the like, which proxies would break). */
function watchable(v: unknown): v is object {
  if (v === null || typeof v !== "object") return false;
  if (Array.isArray(v)) return true;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/** The real values behind watcher proxies, so a proxy is never stored. */
const targets = new WeakMap<object, object>();
const unwrap = <T>(v: T): T => ((v !== null && typeof v === "object" && (targets.get(v) as T)) || v);

/**
 * Wraps values in proxies that call `changed` when they (or anything inside
 * them) are set or deleted. The same value always gets the same proxy.
 */
function watcher(changed: () => void): <T>(v: T) => T {
  const proxies = new WeakMap<object, object>();
  const wrap = <T>(v: T): T => {
    if (!watchable(v)) return v;
    let p = proxies.get(v);
    if (!p) {
      p = new Proxy(v, {
        get: (target, prop, receiver) => wrap(Reflect.get(target, prop, receiver)),
        set: (target, prop, value, receiver) => {
          const ok = Reflect.set(target, prop, unwrap(value), receiver);
          changed();
          return ok;
        },
        deleteProperty: (target, prop) => {
          const ok = Reflect.deleteProperty(target, prop);
          changed();
          return ok;
        },
      });
      proxies.set(v, p);
      targets.set(p, v);
    }
    return p as T;
  };
  return wrap;
}
