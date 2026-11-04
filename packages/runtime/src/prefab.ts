import { Assets, type PrefabAsset } from "@brik/assets";
import {
  type App,
  type Entity,
  type SceneData,
  type SceneEntityData,
  Time,
  Transform2D,
  type Vec2,
  type World,
  defineComponent,
  instantiate,
  t,
  withMeta,
} from "@brik/core";

export const PREFAB_EXTENSION = ".prefab.json";

/** Marks the root of a prefab instance. The editor uses it to update instances when the prefab changes. */
export const PrefabInstance = defineComponent("PrefabInstance", {
  prefab: withMeta(t.string(""), { hidden: true }),
});

/** Spawns a prefab every `interval` seconds, keeping at most `maxAlive` alive. */
export const Spawner = defineComponent(
  "Spawner",
  {
    prefab: withMeta(t.ref<string | null>(() => null), { editor: "prefab" }),
    interval: withMeta(t.f32(1), { min: 0.01, step: 0.1 }),
    /** 0 means no limit. */
    maxAlive: withMeta(t.i32(10), { min: 0, step: 1 }),
    /** Spawn as children of the spawner instead of at its position in the world. */
    asChildren: t.bool(false),
    spawnOnStart: t.bool(true),
    timer: withMeta(t.f32(0), { hidden: true }),
    alive: withMeta(
      t.ref<number[]>(() => []),
      { hidden: true },
    ),
  },
  { requires: [Transform2D] },
);

interface PrefabJson {
  guid: string;
  importer: "prefab";
  entities: SceneEntityData[];
}

export function prefabToJson(guid: string, data: SceneData): string {
  const json: PrefabJson = { guid, importer: "prefab", entities: data.entities };
  return `${JSON.stringify(json, null, 2)}\n`;
}

export function parsePrefab(text: string, name: string): PrefabAsset {
  const j = JSON.parse(text) as Partial<PrefabJson>;
  if (typeof j.guid !== "string") throw new Error("Brik: prefab file has no guid");
  return { guid: j.guid, name, data: { version: 1, entities: j.entities ?? [] } };
}

export interface SpawnPrefabOptions {
  /** World position (or local, with `parent`). */
  position?: Vec2;
  rotation?: number;
  parent?: Entity;
}

/**
 * Creates a copy of a prefab. Returns its root entity.
 *
 * ```ts
 * const coin = spawnPrefab(world, "Coin", { position: { x: 100, y: 40 } });
 * ```
 */
export function spawnPrefab(world: World, prefab: string | PrefabAsset, opts: SpawnPrefabOptions = {}): Entity {
  const p = typeof prefab === "string" ? world.resource(Assets).prefab(prefab) : prefab;
  if (!p) throw new Error(`Brik: unknown prefab "${String(prefab)}"`);
  if (p.data.entities.length === 0) throw new Error(`Brik: prefab "${p.name}" is empty`);
  const entities = instantiate(world, p.data.entities, { newIds: true, parent: opts.parent });
  const root = entities[0];
  world.add(root, PrefabInstance, { prefab: p.guid });
  if (opts.position || opts.rotation !== undefined) {
    const T = world.store(Transform2D);
    if (opts.position) {
      T.position.x[root] = opts.position.x;
      T.position.y[root] = opts.position.y;
    }
    if (opts.rotation !== undefined) T.rotation[root] = opts.rotation;
  }
  return root;
}

function spawners(world: World): void {
  const dt = world.resource(Time).dt;
  const S = world.store(Spawner);
  const T = world.store(Transform2D);
  const assets = world.resource(Assets);
  for (const e of world.query([Spawner])) {
    const guid = S.prefab[e];
    const prefab = guid ? assets.prefab(guid) : undefined;
    if (!prefab) continue;
    const alive = S.alive[e].filter((ref) => world.deref(ref) >= 0);
    S.alive[e] = alive;
    const first = S.timer[e] === 0 && S.spawnOnStart[e];
    S.timer[e] += dt;
    if (!first && S.timer[e] < S.interval[e]) continue;
    if (!first) S.timer[e] -= S.interval[e];
    else S.timer[e] = Number.EPSILON;
    if (S.maxAlive[e] > 0 && alive.length >= S.maxAlive[e]) continue;
    world.commands.run((w) => {
      if (!w.isAlive(e)) return;
      const child = S.asChildren[e] !== 0;
      const root = spawnPrefab(w, prefab, {
        parent: child ? e : undefined,
        position: child ? { x: 0, y: 0 } : { x: T.position.x[e], y: T.position.y[e] },
      });
      S.alive[e].push(w.ref(root));
    });
  }
}

/** The Spawner component. */
export const PrefabPlugin = {
  name: "brik:prefabs",
  build(app: App) {
    app.addSystem("update", { name: "prefab.spawners", run: spawners });
  },
};
