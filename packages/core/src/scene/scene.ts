import { type ComponentDef, componentByName, defineComponent } from "../ecs/component";
import type { Entity } from "../ecs/entity";
import { type Schema, readEntity, t } from "../ecs/schema";
import type { World } from "../ecs/world";
import { Parent, childrenOf, parentOf, setParent } from "../transform/components";

/**
 * A stable id for an entity, saved in scene files. Entity indices change between
 * runs; scene ids do not, so references and undo history can rely on them.
 */
export const SceneId = defineComponent("SceneId", { id: t.string("") }, { hidden: true, serialize: false });

/** Data for components whose definition was not found when a scene was loaded. Kept so it is not lost on save. */
export const MissingComponents = defineComponent(
  "MissingComponents",
  { data: t.ref<Record<string, unknown>>(() => ({})) },
  { hidden: true, serialize: false },
);

export interface SceneEntityData {
  id: string;
  components: Record<string, Record<string, unknown>>;
}

export interface SceneData {
  version: 1;
  entities: SceneEntityData[];
}

export function newSceneId(): string {
  const bytes = new Uint8Array(8);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Returns the entity's scene id, assigning a new one if it has none. */
export function ensureSceneId(world: World, e: Entity): string {
  if (!world.has(e, SceneId)) world.add(e, SceneId, { id: newSceneId() });
  const s = world.store(SceneId);
  if (!s.id[e]) s.id[e] = newSceneId();
  return s.id[e];
}

/** Finds an entity by scene id, or -1. Linear scan; build `sceneIdIndex` for many lookups. */
export function findBySceneId(world: World, id: string): Entity {
  const ids = world.store(SceneId).id;
  for (const e of world.query([SceneId])) if (ids[e] === id) return e;
  return -1;
}

export function sceneIdIndex(world: World): Map<string, Entity> {
  const map = new Map<string, Entity>();
  const ids = world.store(SceneId).id;
  for (const e of world.query([SceneId])) map.set(ids[e], e);
  return map;
}

/** Root entities (no parent), ordered by entity index. */
export function rootEntities(world: World): Entity[] {
  const roots: Entity[] = [];
  for (const e of world.entities()) if (parentOf(world, e) < 0) roots.push(e);
  return roots;
}

/** Entities and all their descendants, depth first, parents before children. */
export function withDescendants(world: World, entities: Iterable<Entity>): Entity[] {
  const out: Entity[] = [];
  const seen = new Set<Entity>();
  const visit = (e: Entity) => {
    if (seen.has(e)) return;
    seen.add(e);
    out.push(e);
    for (const c of childrenOf(world, e)) visit(c);
  };
  for (const e of entities) visit(e);
  return out;
}

const F32_KINDS = new Set(["f32", "vec2", "color", "rect", "mat3"]);

/** Shortest float that round-trips through Float32, so files stay readable (0.3 instead of 0.30000001192092896). */
function cleanF32(v: number): number {
  for (let p = 6; p <= 9; p++) {
    const r = Number(v.toPrecision(p));
    if (Math.fround(r) === Math.fround(v)) return r;
  }
  return v;
}

function serializeComponent(world: World, def: ComponentDef, e: Entity): Record<string, unknown> {
  const raw = readEntity(def.schema, world.store(def), e);
  const out: Record<string, unknown> = {};
  for (const key in def.schema) {
    const kind = def.schema[key].kind;
    const v = raw[key];
    if (kind === "entity") {
      const target = world.deref(v as number);
      out[key] = target >= 0 ? ensureSceneId(world, target) : null;
    } else if (F32_KINDS.has(kind)) {
      if (typeof v === "number") out[key] = cleanF32(v);
      else {
        const o: Record<string, number> = {};
        for (const [k, n] of Object.entries(v as Record<string, number>)) o[k] = cleanF32(n);
        out[key] = o;
      }
    } else if (kind === "ref") {
      out[key] = v === undefined ? null : JSON.parse(JSON.stringify(v));
    } else {
      out[key] = v;
    }
  }
  return out;
}

/** Serializes the given entities and their descendants. */
export function serializeEntities(world: World, entities: Iterable<Entity>): SceneEntityData[] {
  const out: SceneEntityData[] = [];
  for (const e of withDescendants(world, entities)) {
    const components: SceneEntityData["components"] = {};
    for (const def of world.componentsOf(e)) {
      if (def.options.serialize === false) continue;
      components[def.name] = serializeComponent(world, def, e);
    }
    if (world.has(e, MissingComponents)) Object.assign(components, world.store(MissingComponents).data[e]);
    out.push({ id: ensureSceneId(world, e), components });
  }
  return out;
}

export function serializeScene(world: World): SceneData {
  return { version: 1, entities: serializeEntities(world, rootEntities(world)) };
}

export interface InstantiateOptions {
  /** Give the new entities fresh scene ids (for duplicate and paste). */
  newIds?: boolean;
  /** Parent for entities whose parent is not part of `data` and not found in the world. */
  parent?: Entity;
}

/**
 * Creates entities from serialized data. References between them are restored,
 * and references to entities outside `data` are looked up in the world by scene id.
 * Returns the created entities in the same order as `data`.
 */
export function instantiate(world: World, data: SceneEntityData[], opts: InstantiateOptions = {}): Entity[] {
  const existing = sceneIdIndex(world);
  const created = new Map<string, Entity>();
  const entities: Entity[] = [];

  // pass 1: entities, ids and plain data (entity fields are filled in pass 2)
  for (const item of data) {
    const e = world.spawn();
    const id = opts.newIds ? newSceneId() : item.id;
    world.add(e, SceneId, { id });
    created.set(item.id, e);
    entities.push(e);
    const missing: Record<string, unknown> = {};
    for (const [name, values] of Object.entries(item.components)) {
      if (name === Parent.name) continue;
      const def = componentByName(name);
      if (!def) {
        missing[name] = values;
        continue;
      }
      world.add(e, def, plainFields(def.schema, values));
    }
    if (Object.keys(missing).length > 0) {
      console.warn(`[brik] unknown components on entity ${item.id}: ${Object.keys(missing).join(", ")}`);
      world.add(e, MissingComponents, { data: missing });
    }
  }

  const resolve = (id: unknown): Entity => {
    if (typeof id !== "string") return -1;
    return created.get(id) ?? existing.get(id) ?? -1;
  };

  // pass 2: entity references and hierarchy (in data order, so sibling order is kept)
  data.forEach((item, i) => {
    const e = entities[i];
    for (const [name, values] of Object.entries(item.components)) {
      const def = componentByName(name);
      if (!def || def === Parent) continue;
      const store = world.store(def) as Record<string, Uint32Array>;
      for (const key in def.schema) {
        const kind = def.schema[key].kind;
        if (kind === "entity") {
          store[key][e] = world.ref(resolve(values[key]));
        } else if (kind === "ref" && opts.newIds && hasEntityLinks(values[key])) {
          // links to entities created here follow them to their new ids
          (store as unknown as Record<string, unknown[]>)[key][e] = remapEntityLinks(values[key], (old) => {
            const target = created.get(old);
            return target !== undefined ? world.store(SceneId).id[target] : undefined;
          });
        }
      }
    }
    const parentId = item.components[Parent.name]?.entity;
    const parent = resolve(parentId);
    if (parent >= 0) setParent(world, e, parent);
    else if (opts.parent !== undefined && opts.parent >= 0) setParent(world, e, opts.parent);
  });

  return entities;
}

/**
 * A link to an entity inside free-form data (a `ref` field), saved as its scene
 * id. Used for entity fields exposed by scripts: `{ $entity: "a1b2" }`.
 */
export interface EntityLink {
  $entity: string | null;
}

export function isEntityLink(v: unknown): v is EntityLink {
  return typeof v === "object" && v !== null && "$entity" in v;
}

/** A copy of `value` with every EntityLink id passed through `map` (ids it returns undefined for are kept). */
export function remapEntityLinks<T>(value: T, map: (id: string) => string | undefined): T {
  if (isEntityLink(value)) {
    const id = value.$entity;
    return { ...value, $entity: id === null ? null : (map(id) ?? id) } as T;
  }
  if (Array.isArray(value)) return value.map((v) => remapEntityLinks(v, map)) as T;
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = remapEntityLinks(v, map);
    return out as T;
  }
  return value;
}

/** True if the data contains an EntityLink anywhere. */
function hasEntityLinks(value: unknown): boolean {
  if (isEntityLink(value)) return true;
  if (Array.isArray(value)) return value.some(hasEntityLinks);
  if (typeof value === "object" && value !== null) return Object.values(value).some(hasEntityLinks);
  return false;
}

/** Strips entity fields (resolved separately) and leaves everything else as is. */
function plainFields(schema: Schema, values: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key in values) {
    const field = schema[key];
    if (!field || field.kind === "entity") continue;
    out[key] = values[key];
  }
  return out;
}

/**
 * Gives components that were unknown at load time a second chance, e.g. after
 * the scripts that define them have been compiled. Returns how many were restored.
 */
export function rehydrateMissing(world: World): number {
  let restored = 0;
  const store = world.store(MissingComponents);
  for (const e of world.query([MissingComponents]).toArray()) {
    const data = store.data[e];
    for (const [name, values] of Object.entries(data)) {
      const def = componentByName(name);
      if (!def) continue;
      world.add(e, def, plainFields(def.schema, values as Record<string, unknown>));
      delete data[name];
      restored++;
    }
    if (Object.keys(data).length === 0) world.remove(e, MissingComponents);
  }
  return restored;
}

/** Destroys every entity. */
export function clearWorld(world: World): void {
  for (const e of [...world.entities()]) world.destroy(e);
}

/** Replaces the world's contents with a scene. */
export function loadScene(world: World, scene: SceneData): Entity[] {
  if (scene.version !== 1) throw new Error(`Brik: unsupported scene version ${scene.version}`);
  clearWorld(world);
  return instantiate(world, scene.entities);
}
