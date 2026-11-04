import {
  type ComponentDef,
  type Entity,
  type Mat3,
  SceneId,
  type SceneEntityData,
  type ScriptEntry,
  Scripts,
  Transform2D,
  type World,
  childrenOf,
  componentByName,
  destroyRecursive,
  findBySceneId,
  instantiate,
  mat3,
  newSceneId,
  parentOf,
  scriptDisplayName,
  serializeEntities,
  setParent,
} from "@brik/runtime";
import type { EditCommand } from "./history";

type Values = Record<string, unknown>;

/** Looks up an entity by scene id and throws if it is gone (a bug in the undo history). */
function need(world: World, id: string): Entity {
  const e = findBySceneId(world, id);
  if (e < 0) throw new Error(`Brik editor: entity ${id} not found`);
  return e;
}

export function sceneIdOf(world: World, e: Entity): string {
  return world.store(SceneId).id[e];
}

export function composite(label: string, cmds: EditCommand[]): EditCommand {
  return {
    label,
    do: () => cmds.forEach((c) => c.do()),
    undo: () => [...cmds].reverse().forEach((c) => c.undo()),
  };
}

// ------------------------------------------------------------------ fields

export interface FieldChange {
  id: string;
  component: string;
  before: Values;
  after: Values;
}

/** Sets component values. Values are partial, e.g. `{ position: { x: 3 } }`. */
export function setValues(world: World, label: string, changes: FieldChange[], mergeKey?: string): EditCommand {
  const apply = (which: "before" | "after") => {
    for (const c of changes) {
      const e = need(world, c.id);
      const def = componentByName(c.component);
      if (def && world.has(e, def)) world.write(e, def, c[which] as never);
    }
  };
  return { label, mergeKey, do: () => apply("after"), undo: () => apply("before") };
}

/**
 * Points an entity field at another entity (by scene id, or null for none).
 * Stores scene ids rather than entity refs, so undo works after entities are re-created.
 */
export function setEntityRef(world: World, id: string, component: string, field: string, target: string | null): EditCommand {
  const def = componentByName(component);
  const e0 = need(world, id);
  const cur = def ? world.deref((world.store(def) as Record<string, Uint32Array>)[field][e0]) : -1;
  const before = cur >= 0 ? sceneIdOf(world, cur) : null;
  const apply = (value: string | null) => {
    const e = need(world, id);
    if (!def || !world.has(e, def)) return;
    const t = value ? findBySceneId(world, value) : -1;
    (world.store(def) as Record<string, Uint32Array>)[field][e] = world.ref(t);
  };
  return { label: `Ændr ${component}.${field}`, do: () => apply(target), undo: () => apply(before) };
}

// ------------------------------------------------------------------ components

export function addComponent(world: World, id: string, def: ComponentDef, init?: Values): EditCommand {
  let added: ComponentDef[] = [];
  return {
    label: `Tilføj ${def.name}`,
    do() {
      const e = need(world, id);
      const before = new Set(world.componentsOf(e));
      world.add(e, def, init as never);
      added = world.componentsOf(e).filter((c) => !before.has(c));
    },
    undo() {
      const e = need(world, id);
      for (const c of [...added].reverse()) world.remove(e, c);
    },
  };
}

export function removeComponent(world: World, id: string, def: ComponentDef): EditCommand {
  let saved: Values = {};
  return {
    label: `Fjern ${def.name}`,
    do() {
      const e = need(world, id);
      saved = world.read(e, def);
      world.remove(e, def);
    },
    undo() {
      world.add(need(world, id), def, saved as never);
    },
  };
}

// ------------------------------------------------------------------ entities

/** Entities in `ids` whose ancestors are not also in `ids`. */
export function topLevel(world: World, ids: string[]): Entity[] {
  const set = new Set(ids.map((id) => findBySceneId(world, id)).filter((e) => e >= 0));
  return [...set].filter((e) => {
    for (let p = parentOf(world, e); p >= 0; p = parentOf(world, p)) if (set.has(p)) return false;
    return true;
  });
}

/** Creates entities from serialized data. Ids in `data` are kept, so redo recreates the same entities. */
export function createEntities(world: World, label: string, data: SceneEntityData[], parentId?: string | null): EditCommand {
  const ids = new Set(data.map((d) => d.id));
  const tops = data.filter((d) => {
    const p = d.components.Parent?.entity;
    return typeof p !== "string" || !ids.has(p);
  });
  return {
    label,
    do() {
      const parent = parentId ? need(world, parentId) : undefined;
      instantiate(world, data, { parent });
    },
    undo() {
      for (const d of tops) {
        const e = findBySceneId(world, d.id);
        if (e >= 0) destroyRecursive(world, e);
      }
    },
  };
}

export function deleteEntities(world: World, ids: string[]): EditCommand {
  const tops = topLevel(world, ids);
  const snapshot = serializeEntities(world, tops);
  const places = tops.map((e) => {
    const p = parentOf(world, e);
    return {
      id: sceneIdOf(world, e),
      parent: p >= 0 ? sceneIdOf(world, p) : null,
      index: p >= 0 ? childrenOf(world, p).indexOf(e) : -1,
    };
  });
  return {
    label: tops.length === 1 ? "Slet entity" : `Slet ${tops.length} entities`,
    do() {
      for (const p of places) {
        const e = findBySceneId(world, p.id);
        if (e >= 0) destroyRecursive(world, e);
      }
    },
    undo() {
      instantiate(world, snapshot);
      // put each entity back at its old place among its siblings
      for (const p of places) {
        if (!p.parent) continue;
        setParent(world, need(world, p.id), need(world, p.parent), p.index);
      }
    },
  };
}

/** Gives every entity in `data` a new id (default: random) and updates references between them. */
export function remapIds(data: SceneEntityData[], idFor: (old: string) => string = () => newSceneId()): SceneEntityData[] {
  const map = new Map(data.map((d) => [d.id, idFor(d.id)]));
  return data.map((d) => {
    const components: SceneEntityData["components"] = {};
    for (const [name, values] of Object.entries(d.components)) {
      const def = componentByName(name);
      const copy: Values = { ...values };
      if (def) {
        for (const key in def.schema) {
          const v = copy[key];
          if (def.schema[key].kind === "entity" && typeof v === "string" && map.has(v)) copy[key] = map.get(v);
        }
      }
      components[name] = copy as Record<string, unknown>;
    }
    return { id: map.get(d.id)!, components };
  });
}

export function duplicateEntities(world: World, ids: string[]): { cmd: EditCommand; newIds: string[] } {
  const tops = topLevel(world, ids);
  const original = serializeEntities(world, tops);
  const data = remapIds(original);
  // the copies of the top-level entities are the ones to select afterwards
  const topIds = new Set(tops.map((e) => sceneIdOf(world, e)));
  const newIds = data.filter((_, i) => topIds.has(original[i].id)).map((d) => d.id);
  return { cmd: createEntities(world, newIds.length === 1 ? "Dupliker entity" : "Dupliker entities", data), newIds };
}

// ------------------------------------------------------------------ hierarchy

/** World matrix computed from the Transform2D chain (doesn't need GlobalTransform2D to be fresh). */
export function worldMatrix(world: World, e: Entity): Mat3 {
  const T = world.store(Transform2D);
  const local = world.has(e, Transform2D)
    ? mat3.fromTRS(T.position.x[e], T.position.y[e], T.rotation[e], T.scale.x[e], T.scale.y[e])
    : mat3.identity();
  const p = parentOf(world, e);
  return p >= 0 ? mat3.multiply(worldMatrix(world, p), local) : local;
}

/** Sets an entity's local transform so that it ends up at `m` in world space. */
export function setWorldMatrix(world: World, e: Entity, m: Mat3): void {
  if (!world.has(e, Transform2D)) return;
  const p = parentOf(world, e);
  const local = p >= 0 ? mat3.multiply(mat3.invert(worldMatrix(world, p)) ?? mat3.identity(), m) : m;
  const d = mat3.decompose(local);
  world.write(e, Transform2D, { position: { x: d.x, y: d.y }, rotation: d.rotation, scale: { x: d.sx, y: d.sy } });
}

/**
 * Moves entities under a new parent (null = root), keeping their world position.
 * Entities that would end up inside themselves are skipped.
 */
export function reparent(world: World, ids: string[], parentId: string | null, index?: number): EditCommand | null {
  const parent = parentId ? need(world, parentId) : -1;
  const movable = topLevel(world, ids).filter((e) => {
    for (let p = parent; p >= 0; p = parentOf(world, p)) if (p === e) return false;
    return true;
  });
  if (movable.length === 0) return null;
  const before = movable.map((e) => {
    const p = parentOf(world, e);
    return {
      id: sceneIdOf(world, e),
      parent: p >= 0 ? sceneIdOf(world, p) : null,
      index: p >= 0 ? childrenOf(world, p).indexOf(e) : -1,
      transform: world.has(e, Transform2D) ? world.read(e, Transform2D) : null,
    };
  });
  return {
    label: "Flyt i hierarkiet",
    do() {
      const target = parentId ? need(world, parentId) : -1;
      let i = index;
      for (const b of before) {
        const e = need(world, b.id);
        const m = worldMatrix(world, e);
        setParent(world, e, target, i);
        if (i !== undefined) i++;
        setWorldMatrix(world, e, m);
      }
    },
    undo() {
      for (const b of [...before].reverse()) {
        const e = need(world, b.id);
        setParent(world, e, b.parent ? need(world, b.parent) : -1, b.index);
        if (b.transform) world.write(e, Transform2D, b.transform);
      }
    },
  };
}

// ------------------------------------------------------------------ scripts

function scriptList(world: World, e: Entity): ScriptEntry[] {
  return world.has(e, Scripts) ? world.store(Scripts).list[e] : [];
}

function cloneList(list: ScriptEntry[]): ScriptEntry[] {
  return list.map((s) => ({ script: s.script, props: JSON.parse(JSON.stringify(s.props)) }));
}

/** Replaces an entity's script list, adding or removing the Scripts component as needed. */
function setScriptList(world: World, id: string, label: string, next: (old: ScriptEntry[]) => ScriptEntry[], mergeKey?: string): EditCommand {
  const e = need(world, id);
  const hadComponent = world.has(e, Scripts);
  const before = cloneList(scriptList(world, e));
  const after = next(cloneList(before));
  const write = (list: ScriptEntry[], keepComponent: boolean) => {
    const ent = need(world, id);
    if (!keepComponent) {
      world.remove(ent, Scripts);
      return;
    }
    if (!world.has(ent, Scripts)) world.add(ent, Scripts);
    // always a fresh array, so the runtime notices the change
    world.store(Scripts).list[ent] = cloneList(list);
  };
  return {
    label,
    mergeKey,
    do: () => write(after, true),
    undo: () => write(before, hadComponent),
  };
}

export function addScript(world: World, id: string, script: string): EditCommand {
  return setScriptList(world, id, `Tilføj ${scriptDisplayName(script)}`, (list) => [...list, { script, props: {} }]);
}

export function removeScript(world: World, id: string, index: number): EditCommand {
  return setScriptList(world, id, "Fjern script", (list) => list.filter((_, i) => i !== index));
}

/** Sets an exposed field on one script. `undefined` resets it to the script's default. */
export function setScriptProp(world: World, id: string, index: number, key: string, value: unknown, live = false): EditCommand {
  return setScriptList(
    world,
    id,
    `Ændr ${key}`,
    (list) =>
      list.map((s, i) => {
        if (i !== index) return s;
        const props = { ...s.props };
        if (value === undefined) delete props[key];
        else props[key] = value;
        return { ...s, props };
      }),
    live ? `${id}/script/${index}/${key}` : undefined,
  );
}
