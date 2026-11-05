import {
  type Entity,
  PREFAB_EXTENSION,
  Parent,
  PrefabInstance,
  type SceneData,
  type SceneEntityData,
  type World,
  childrenOf,
  componentByName,
  destroyRecursive,
  findBySceneId,
  instantiate,
  newSceneId,
  parentOf,
  serializeEntities,
  setParent,
} from "@brik/runtime";
import { remapIds, sceneIdOf } from "./commands";
import type { Editor } from "./editor";
import { joinPath } from "./fs";
import type { EditCommand } from "./history";

/*
 * Prefab instances keep a full copy of their entities in the scene, plus a list
 * of overrides: the places where the instance differs from its prefab. When the
 * prefab changes, an instance is rebuilt from the new prefab data with its
 * overrides put back on top, so everything else follows the prefab.
 *
 * Override keys use the entity ids of the prefab file ("rel" ids):
 *   "<rel>:<Component>.<field>"  a field with its own value
 *   "<rel>:<Component>"          a component the prefab doesn't have
 *   "-<rel>:<Component>"         a prefab component removed from the instance
 *   "-<rel>"                     a prefab entity removed from the instance
 *   "+<scene id>"                an entity added to the instance
 * The root's placement (position, rotation, scale, parent) is never an override.
 *
 * Instances can contain instances of other prefabs (nested prefabs). They have
 * their own PrefabInstance and overrides, and are rebuilt from their prefab
 * whenever the outer data is refreshed.
 */

type Data = SceneEntityData[];
type Components = SceneEntityData["components"];

const PLACEMENT = ["position", "rotation", "scale"];

/** JSON with sorted object keys, so equal data compares equal. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

/** A field's default value as it is saved in files (undefined for unknown fields). */
function fieldDefault(component: string, field: string): unknown {
  const f = componentByName(component)?.schema[field];
  if (!f) return undefined;
  if (f.kind === "entity") return null;
  const v = f.make();
  if (typeof v === "number") return cleanFloat(v);
  if (v && typeof v === "object" && !Array.isArray(v) && Object.values(v).every((x) => typeof x === "number")) {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, cleanFloat(x as number)]));
  }
  return v === undefined ? null : v;
}

/** Like the scene writer: the shortest number that survives a round trip through float32. */
function cleanFloat(v: number): number {
  for (let p = 6; p <= 9; p++) {
    const r = Number(v.toPrecision(p));
    if (Math.fround(r) === Math.fround(v)) return r;
  }
  return v;
}

const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));

const parentId = (d: SceneEntityData): string | null => {
  const p = d.components[Parent.name]?.entity;
  return typeof p === "string" ? p : null;
};

/** An entity and everything below it, in data order. */
function subtreeIds(data: Data, rootId: string): Set<string> {
  const ids = new Set([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const d of data) {
      const p = parentId(d);
      if (!ids.has(d.id) && p !== null && ids.has(p)) {
        ids.add(d.id);
        grew = true;
      }
    }
  }
  return ids;
}

/** Instance-root ids in `data` that are not inside another instance. */
function outermostInstances(data: Data, filter?: (guid: string) => boolean): string[] {
  const byId = new Map(data.map((d) => [d.id, d]));
  const guidOf = (d: SceneEntityData) => d.components[PrefabInstance.name]?.prefab as string | undefined;
  const out: string[] = [];
  for (const d of data) {
    const guid = guidOf(d);
    if (!guid || (filter && !filter(guid))) continue;
    let inside = false;
    for (let p = parentId(d); p !== null; ) {
      const pd = byId.get(p);
      if (!pd) break;
      const pg = guidOf(pd);
      if (pg && (!filter || filter(pg))) {
        inside = true;
        break;
      }
      p = parentId(pd);
    }
    if (!inside) out.push(d.id);
  }
  return out;
}

// ------------------------------------------------------------------ data

/**
 * Prefab data from an entity subtree: the root loses its parent, position and
 * PrefabInstance link, so the prefab is placed wherever it is spawned.
 */
export function prefabDataFrom(world: World, root: Entity): SceneData {
  const entities = serializeEntities(world, [root]);
  const top = entities[0];
  const components = { ...top.components };
  delete components[Parent.name];
  delete components[PrefabInstance.name];
  if (components.Transform2D) {
    components.Transform2D = { ...components.Transform2D, position: { x: 0, y: 0 } };
  }
  entities[0] = { ...top, components };
  return { version: 1, entities };
}

/**
 * Scene data for an instance of a prefab. The root gets `rootId`; children get
 * ids derived from it, so they keep the same ids every time the instance is
 * rebuilt and references to them survive.
 */
export function instanceData(
  prefab: SceneData,
  guid: string,
  rootId: string,
  root: { transform?: Record<string, unknown>; parent?: string | null; overrides?: string[] },
): Data {
  const first = prefab.entities[0]?.id;
  const data = remapIds(prefab.entities, (old) => (old === first ? rootId : `${rootId}/${old}`));
  if (data.length === 0) return data;
  const top = { ...data[0].components };
  top[PrefabInstance.name] = { prefab: guid, overrides: root.overrides ?? [] };
  if (root.transform) top.Transform2D = { ...top.Transform2D, ...root.transform };
  if (root.parent) top[Parent.name] = { entity: root.parent };
  else delete top[Parent.name];
  data[0] = { ...data[0], components: top };
  return data;
}

/** Maps the scene ids of an instance to the ids in its prefab (null: not from the prefab). */
function relIds(rootId: string, prefab: SceneData): (id: string) => string | null {
  const first = prefab.entities[0]?.id;
  const known = new Set(prefab.entities.map((d) => d.id));
  return (id) => {
    const rel = id === rootId ? first : id.startsWith(`${rootId}/`) ? id.slice(rootId.length + 1) : null;
    return rel !== null && rel !== undefined && known.has(rel) ? rel : null;
  };
}

/** Where an instance (root `rootId`, entities `instance`) differs from its prefab. */
export function computeOverrides(instance: Data, rootId: string, prefab: SceneData): string[] {
  const first = prefab.entities[0]?.id;
  if (first === undefined) return [];
  const rel = relIds(rootId, prefab);
  // in the prefab's id space, so entity references compare equal
  const norm = remapIds(instance, (id) => rel(id) ?? `+${id}`);
  const base = new Map(prefab.entities.map((d) => [d.id, d]));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const d of norm) {
    const p = base.get(d.id);
    if (!p) {
      out.push(d.id); // "+<scene id>"
      continue;
    }
    seen.add(d.id);
    const isRoot = d.id === first;
    const names = new Set([...Object.keys(d.components), ...Object.keys(p.components)]);
    for (const c of names) {
      if (isRoot && (c === PrefabInstance.name || c === Parent.name)) continue;
      const mine = d.components[c];
      const theirs = p.components[c];
      if (!theirs) out.push(`${d.id}:${c}`);
      else if (!mine) out.push(`-${d.id}:${c}`);
      else {
        for (const f of new Set([...Object.keys(mine), ...Object.keys(theirs)])) {
          if (isRoot && c === "Transform2D" && PLACEMENT.includes(f)) continue;
          // files may leave out fields that have their default value
          const a = f in mine ? mine[f] : fieldDefault(c, f);
          const b = f in theirs ? theirs[f] : fieldDefault(c, f);
          if (stable(a) !== stable(b)) out.push(`${d.id}:${c}.${f}`);
        }
      }
    }
  }
  for (const p of prefab.entities) if (!seen.has(p.id)) out.push(`-${p.id}`);
  return out;
}

/** Rebuilds an instance from (new) prefab data, keeping its placement and putting its overrides back. */
export function rebuildInstanceData(instance: Data, rootId: string, prefab: SceneData, guid: string, overrides: string[]): Data {
  const first = prefab.entities[0]?.id;
  const top = instance.find((d) => d.id === rootId) ?? instance[0];
  const T = top?.components.Transform2D;
  const placement: Record<string, unknown> = {};
  if (T) for (const k of PLACEMENT) if (k in T) placement[k] = T[k];
  const base = instanceData(prefab, guid, rootId, {
    transform: T ? placement : undefined,
    parent: top ? parentId(top) : null,
    overrides,
  });
  const toScene = (rel: string) => (rel === first ? rootId : `${rootId}/${rel}`);
  const byId = new Map(base.map((d) => [d.id, d]));
  const mine = new Map(instance.map((d) => [d.id, d]));
  const removed = new Set<string>();
  const added: SceneEntityData[] = [];

  for (const key of overrides) {
    if (key.startsWith("+")) {
      const d = mine.get(key.slice(1));
      if (d) added.push(clone(d));
      continue;
    }
    const remove = key.startsWith("-");
    const k = remove ? key.slice(1) : key;
    const colon = k.indexOf(":");
    const id = toScene(colon < 0 ? k : k.slice(0, colon));
    if (colon < 0) {
      if (remove) removed.add(id);
      continue;
    }
    const target = byId.get(id);
    if (!target) continue;
    const rest = k.slice(colon + 1);
    const dot = rest.indexOf(".");
    const comps: Components = { ...target.components };
    if (remove) delete comps[rest];
    else if (dot < 0) {
      const src = mine.get(id)?.components[rest];
      if (src) comps[rest] = clone(src);
    } else {
      const c = rest.slice(0, dot);
      const f = rest.slice(dot + 1);
      const src = mine.get(id)?.components[c];
      if (comps[c] && src && f in src) comps[c] = { ...comps[c], [f]: clone(src[f]) };
    }
    byId.set(id, { ...target, components: comps });
  }

  // removed prefab entities take their children with them
  const gone = new Set<string>();
  for (const id of removed) for (const x of subtreeIds(base, id)) gone.add(x);
  const out = base.filter((d) => !gone.has(d.id)).map((d) => byId.get(d.id)!);
  const present = new Set([...out.map((d) => d.id), ...added.map((d) => d.id)]);
  for (const d of added) {
    const p = parentId(d);
    if (p === null || !present.has(p)) d.components[Parent.name] = { entity: rootId };
    out.push(d);
  }
  return out;
}

/** Prefab data by guid, for the refresh functions. */
export type PrefabLookup = (guid: string) => SceneData | undefined;

/**
 * Rebuilds the prefab instances in some scene or prefab data from their
 * prefabs. Only the outermost instances are rebuilt; nested ones come along
 * with their outer prefab's data. `filter` limits which prefabs count.
 */
export function refreshInstances(data: Data, prefabOf: PrefabLookup, filter?: (guid: string) => boolean): Data {
  let out = data;
  for (const rootId of outermostInstances(data, filter)) {
    const root = out.find((d) => d.id === rootId);
    const link = root?.components[PrefabInstance.name] as { prefab: string; overrides?: string[] | null } | undefined;
    const prefab = link ? prefabOf(link.prefab) : undefined;
    if (!root || !link || !prefab || prefab.entities.length === 0) continue;
    const ids = subtreeIds(out, rootId);
    const instance = out.filter((d) => ids.has(d.id));
    const overrides = link.overrides ?? computeOverrides(instance, rootId, prefab);
    const rebuilt = rebuildInstanceData(instance, rootId, prefab, link.prefab, overrides);
    const at = out.findIndex((d) => d.id === rootId);
    const rest = out.filter((d) => !ids.has(d.id));
    const before = rest.filter((d) => out.indexOf(d) < at);
    out = [...before, ...rebuilt, ...rest.slice(before.length)];
  }
  return out;
}

/**
 * Every prefab with its nested instances brought up to date, recursively.
 * A prefab that (wrongly) contains itself is returned as it is.
 */
export function resolvePrefabs(raw: Map<string, SceneData>): Map<string, SceneData> {
  const done = new Map<string, SceneData>();
  const busy = new Set<string>();
  const resolve = (guid: string): SceneData | undefined => {
    const hit = done.get(guid);
    if (hit) return hit;
    const data = raw.get(guid);
    if (!data || busy.has(guid)) return data;
    busy.add(guid);
    const entities = refreshInstances(data.entities, resolve);
    busy.delete(guid);
    const out = { version: 1 as const, entities };
    done.set(guid, out);
    return out;
  };
  for (const guid of raw.keys()) resolve(guid);
  return done;
}

/** Prefab guids used inside a prefab, at any depth. */
export function nestedPrefabs(raw: Map<string, SceneData>, guid: string, seen = new Set<string>()): Set<string> {
  for (const d of raw.get(guid)?.entities ?? []) {
    const g = d.components[PrefabInstance.name]?.prefab as string | undefined;
    if (g && !seen.has(g)) {
      seen.add(g);
      nestedPrefabs(raw, g, seen);
    }
  }
  return seen;
}

/** The prefab data the editor knows, by guid. */
function rawPrefabs(editor: Editor): Map<string, SceneData> {
  return new Map([...editor.assets.prefabs.values()].map((p) => [p.guid, p.data]));
}

// ------------------------------------------------------------------ world

/** The prefab guid of an instance root, or null. */
export function prefabOf(world: World, e: Entity): string | null {
  return world.has(e, PrefabInstance) ? world.store(PrefabInstance).prefab[e] || null : null;
}

/** The nearest instance root at or above `e`, or -1. */
export function instanceRootOf(world: World, e: Entity): Entity {
  for (let x = e; x >= 0; x = parentOf(world, x)) if (world.has(x, PrefabInstance)) return x;
  return -1;
}

/**
 * Overridden fields and components of one entity, relative to its nearest
 * prefab instance: "Component.field" and "Component" (added) entries.
 * Empty for entities that are not part of an instance.
 */
export function overridesFor(editor: Editor, e: Entity): Set<string> {
  const world = editor.world;
  const root = instanceRootOf(world, e);
  const out = new Set<string>();
  const guid = root >= 0 ? prefabOf(world, root) : null;
  const prefab = guid ? editor.assets.prefabs.get(guid)?.data : undefined;
  if (!prefab) return out;
  const rel = relIds(sceneIdOf(world, root), prefab)(sceneIdOf(world, e));
  if (rel === null) return out;
  for (const key of world.store(PrefabInstance).overrides[root] ?? []) {
    if (key.startsWith(`${rel}:`)) out.add(key.slice(rel.length + 1));
  }
  return out;
}

/**
 * Brings every instance's override list up to date with the world. Called after
 * each edit; the list is derived data, so it is not part of undo.
 */
export function refreshOverrides(editor: Editor): void {
  const world = editor.world;
  const P = world.store(PrefabInstance);
  for (const e of world.query([PrefabInstance]).toArray()) {
    const prefab = editor.assets.prefabs.get(P.prefab[e])?.data;
    if (!prefab) continue;
    const next = computeOverrides(serializeEntities(world, [e]), sceneIdOf(world, e), prefab);
    if (stable(next) !== stable(P.overrides[e])) P.overrides[e] = next;
  }
}

/** Replaces an entity subtree with other data, keeping its place among its siblings. */
function replaceSubtree(world: World, rootId: string, before: Data, after: Data, label: string): EditCommand {
  const e0 = findBySceneId(world, rootId);
  const p0 = parentOf(world, e0);
  const index = p0 >= 0 ? childrenOf(world, p0).indexOf(e0) : -1;
  const parent = p0 >= 0 ? sceneIdOf(world, p0) : null;
  const put = (data: Data) => {
    const e = findBySceneId(world, rootId);
    if (e >= 0) destroyRecursive(world, e);
    instantiate(world, data);
    if (parent) {
      const p = findBySceneId(world, parent);
      const root = findBySceneId(world, rootId);
      if (p >= 0 && root >= 0) setParent(world, root, p, index);
    }
  };
  return { label, do: () => put(after), undo: () => put(before) };
}

/** A command that rebuilds one instance from its prefab. `overrides` defaults to the instance's own. */
function rebuildInstance(editor: Editor, e: Entity, prefab: SceneData, guid: string, label: string, overrides?: string[]): EditCommand {
  const world = editor.world;
  const id = sceneIdOf(world, e);
  const before = serializeEntities(world, [e]);
  const own = overrides ?? world.store(PrefabInstance).overrides[e] ?? computeOverrides(before, id, prefab);
  const after = rebuildInstanceData(before, id, prefab, guid, own);
  return replaceSubtree(world, id, before, after, label);
}

/** Commands that rebuild the outermost instances of the given prefabs from their current data. */
function syncCommands(editor: Editor, guids: Set<string>, special?: { id: string; overrides: string[] }): EditCommand[] {
  const world = editor.world;
  const resolved = resolvePrefabs(rawPrefabs(editor));
  const P = world.store(PrefabInstance);
  const insideChanged = (e: Entity) => {
    for (let p = parentOf(world, e); p >= 0; p = parentOf(world, p)) if (world.has(p, PrefabInstance) && guids.has(P.prefab[p])) return true;
    return false;
  };
  const cmds: EditCommand[] = [];
  for (const e of world.query([PrefabInstance]).toArray()) {
    const guid = P.prefab[e];
    const prefab = guids.has(guid) ? resolved.get(guid) : undefined;
    if (!prefab || insideChanged(e)) continue;
    const id = sceneIdOf(world, e);
    const own = special?.id === id ? special.overrides : undefined;
    cmds.push(rebuildInstance(editor, e, prefab, guid, "Opdatér prefab-instans", own));
  }
  return cmds;
}

/**
 * After prefab `guid` changed: saves the other prefabs that contain it, so
 * their nested copies are up to date, and returns every prefab that changed.
 */
async function propagate(editor: Editor, guid: string): Promise<Set<string>> {
  const raw = rawPrefabs(editor);
  const resolved = resolvePrefabs(raw);
  const changed = new Set([guid]);
  for (const [g, data] of raw) {
    if (g === guid || !nestedPrefabs(raw, g).has(guid)) continue;
    const next = resolved.get(g)!;
    if (stable(next.entities) === stable(data.entities)) continue;
    const path = editor.db.pathOf(g);
    if (!path) continue;
    await editor.db.savePrefab(path, next, g);
    changed.add(g);
  }
  return changed;
}

function group(label: string, cmds: EditCommand[]): EditCommand {
  return { label, do: () => cmds.forEach((c) => c.do()), undo: () => [...cmds].reverse().forEach((c) => c.undo()) };
}

// ------------------------------------------------------------------ actions

function uniquePath(editor: Editor, dir: string, base: string): string {
  const taken = new Set([...editor.db.prefabs.keys()]);
  const clean = base.replace(/[\\/:*?"<>|]/g, "_").trim() || "Prefab";
  let path = joinPath(dir, `${clean}${PREFAB_EXTENSION}`);
  for (let i = 2; taken.has(path); i++) path = joinPath(dir, `${clean} ${i}${PREFAB_EXTENSION}`);
  return path;
}

/** Saves an entity (and its children) as a new prefab and links the entity to it. */
export async function createPrefab(editor: Editor, id: string, dir = "prefabs"): Promise<string> {
  const world = editor.world;
  const e = findBySceneId(world, id);
  if (e < 0) throw new Error("Brik editor: entity not found");
  const path = uniquePath(editor, dir, editor.entityName(e));
  const guid = await editor.db.savePrefab(path, prefabDataFrom(world, e));
  // relink: the entity becomes an instance (with stable child ids)
  const before = serializeEntities(world, [e]);
  const after = instanceData(editor.assets.prefabs.get(guid)!.data, guid, id, {
    transform: before[0].components.Transform2D,
    parent: parentId(before[0]),
  });
  editor.execute(replaceSubtree(world, id, before, after, "Lav prefab"));
  editor.emit("assets");
  return path;
}

/** Places a prefab instance in the scene and selects it. */
export function placePrefab(editor: Editor, guid: string, at: { x: number; y: number }, parent?: string | null): string | null {
  const prefab = editor.assets.prefabs.get(guid);
  if (!prefab || prefab.data.entities.length === 0) return null;
  const id = newSceneId();
  const data = instanceData(prefab.data, guid, id, { transform: { position: at }, parent: parent ?? null });
  editor.execute({
    label: `Indsæt ${prefab.name}`,
    do: () => {
      instantiate(editor.world, data);
    },
    undo: () => {
      const e = findBySceneId(editor.world, id);
      if (e >= 0) destroyRecursive(editor.world, e);
    },
  });
  editor.select([id]);
  return id;
}

/** Writes an instance's current state back to its prefab and updates the other instances. */
export async function applyToPrefab(editor: Editor, id: string): Promise<number> {
  const world = editor.world;
  const e = findBySceneId(world, id);
  const guid = e >= 0 ? prefabOf(world, e) : null;
  const path = guid ? editor.db.pathOf(guid) : undefined;
  const old = guid ? editor.assets.prefabs.get(guid)?.data : undefined;
  if (!guid || !path || !old) throw new Error("Prefab-filen findes ikke længere");

  // a prefab may not contain itself, also not through other prefabs
  const raw = rawPrefabs(editor);
  const data = prefabDataFrom(world, e);
  for (const d of data.entities.slice(1)) {
    const g = d.components[PrefabInstance.name]?.prefab as string | undefined;
    if (g && (g === guid || nestedPrefabs(raw, g).has(guid))) {
      throw new Error("En prefab kan ikke indeholde en instans af sig selv");
    }
  }

  // save with the prefab's own entity ids, so they don't grow on every apply
  const rel = relIds(id, old);
  const first = old.entities[0]?.id;
  const saved = remapIds(data.entities, (x) => (x === id && first !== undefined ? first : (rel(x) ?? x)));
  await editor.db.savePrefab(path, { version: 1, entities: saved }, guid);
  const changed = await propagate(editor, guid);

  // the edited instance now matches the prefab: rebuild it without overrides
  const cmds = syncCommands(editor, changed, { id, overrides: [] });
  if (cmds.length > 0) editor.execute(group("Anvend på prefab", cmds));
  editor.emit("assets");
  return cmds.length;
}

/** Throws away an instance's changes (except where it is placed). */
export function revertToPrefab(editor: Editor, id: string): void {
  const world = editor.world;
  const e = findBySceneId(world, id);
  const guid = e >= 0 ? prefabOf(world, e) : null;
  const prefab = guid ? resolvePrefabs(rawPrefabs(editor)).get(guid) : undefined;
  if (!guid || !prefab) return;
  editor.execute(rebuildInstance(editor, e, prefab, guid, "Gendan fra prefab", []));
}

/** Throws away one override: a field ("Component.field") or an added component ("Component") of entity `id`. */
export function revertOverride(editor: Editor, id: string, what: string): void {
  const world = editor.world;
  const e = findBySceneId(world, id);
  const root = e >= 0 ? instanceRootOf(world, e) : -1;
  const guid = root >= 0 ? prefabOf(world, root) : null;
  const prefab = guid ? resolvePrefabs(rawPrefabs(editor)).get(guid) : undefined;
  if (!guid || !prefab) return;
  const rootId = sceneIdOf(world, root);
  const rel = relIds(rootId, prefab)(id);
  const key = `${rel}:${what}`;
  const own = world.store(PrefabInstance).overrides[root] ?? [];
  if (rel === null || !own.includes(key)) return;
  editor.execute(rebuildInstance(editor, root, prefab, guid, "Gendan felt fra prefab", own.filter((k) => k !== key)));
}

/** Rebuilds all instances after a prefab file changed outside the editor. Not undoable. */
export function syncAllInstances(editor: Editor, guid: string): number {
  const cmds = syncCommands(editor, new Set([guid, ...dependents(editor, guid)]));
  for (const c of cmds) c.do();
  if (cmds.length > 0) editor.afterExternalChange();
  // prefabs that contain this one get their nested copy updated on disk
  void propagate(editor, guid).catch((err) => editor.log("error", `Kunne ikke opdatere prefabs: ${err}`));
  return cmds.length;
}

/** Prefabs that contain `guid`, at any depth. */
function dependents(editor: Editor, guid: string): string[] {
  const raw = rawPrefabs(editor);
  return [...raw.keys()].filter((g) => g !== guid && nestedPrefabs(raw, g).has(guid));
}

/** Scene data with every prefab instance rebuilt from the current prefabs (used when a scene is opened or exported). */
export function refreshSceneData(editor: Editor, data: SceneData): SceneData {
  const resolved = resolvePrefabs(rawPrefabs(editor));
  return { ...data, entities: refreshInstances(data.entities, (g) => resolved.get(g)) };
}
