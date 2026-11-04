import {
  type Entity,
  PREFAB_EXTENSION,
  Parent,
  PrefabInstance,
  type SceneData,
  type SceneEntityData,
  type World,
  childrenOf,
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
  root: { transform?: Record<string, unknown>; parent?: string | null },
): SceneEntityData[] {
  const first = prefab.entities[0]?.id;
  const data = remapIds(prefab.entities, (old) => (old === first ? rootId : `${rootId}/${old}`));
  if (data.length === 0) return data;
  const top = { ...data[0].components };
  top[PrefabInstance.name] = { prefab: guid };
  if (root.transform) top.Transform2D = { ...top.Transform2D, ...root.transform };
  if (root.parent) top[Parent.name] = { entity: root.parent };
  data[0] = { ...data[0], components: top };
  return data;
}

/** Replaces an entity subtree with other data, keeping its place among its siblings. */
function replaceSubtree(world: World, rootId: string, before: SceneEntityData[], after: SceneEntityData[], label: string): EditCommand {
  const e0 = findBySceneId(world, rootId);
  const p0 = parentOf(world, e0);
  const index = p0 >= 0 ? childrenOf(world, p0).indexOf(e0) : -1;
  const parentId = p0 >= 0 ? sceneIdOf(world, p0) : null;
  const put = (data: SceneEntityData[]) => {
    const e = findBySceneId(world, rootId);
    if (e >= 0) destroyRecursive(world, e);
    instantiate(world, data);
    if (parentId) {
      const p = findBySceneId(world, parentId);
      const root = findBySceneId(world, rootId);
      if (p >= 0 && root >= 0) setParent(world, root, p, index);
    }
  };
  return { label, do: () => put(after), undo: () => put(before) };
}

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
    parent: (before[0].components[Parent.name]?.entity as string | undefined) ?? null,
  });
  editor.execute(replaceSubtree(world, id, before, after, "Lav prefab"));
  editor.emit("assets");
  return path;
}

/** Places a prefab instance in the scene and selects it. */
export function placePrefab(editor: Editor, guid: string, at: { x: number; y: number }, parentId?: string | null): string | null {
  const prefab = editor.assets.prefabs.get(guid);
  if (!prefab || prefab.data.entities.length === 0) return null;
  const id = newSceneId();
  const data = instanceData(prefab.data, guid, id, { transform: { position: at }, parent: parentId ?? null });
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

/** The prefab guid of an instance root, or null. */
export function prefabOf(world: World, e: Entity): string | null {
  return world.has(e, PrefabInstance) ? world.store(PrefabInstance).prefab[e] || null : null;
}

/** Commands that rebuild every instance of a prefab (except `skipId`) from its current data. */
function syncCommands(editor: Editor, guid: string, skipId?: string): EditCommand[] {
  const world = editor.world;
  const prefab = editor.assets.prefabs.get(guid);
  if (!prefab) return [];
  const cmds: EditCommand[] = [];
  for (const e of world.query([PrefabInstance]).toArray()) {
    if (world.store(PrefabInstance).prefab[e] !== guid) continue;
    if (sceneIdOf(world, e) === skipId) continue;
    cmds.push(rebuildInstance(editor, e, guid, "Opdatér prefab-instans"));
  }
  return cmds;
}

/** Writes an instance's current state back to its prefab and updates the other instances. */
export async function applyToPrefab(editor: Editor, id: string): Promise<number> {
  const world = editor.world;
  const e = findBySceneId(world, id);
  const guid = e >= 0 ? prefabOf(world, e) : null;
  const path = guid ? editor.db.pathOf(guid) : undefined;
  if (!guid || !path) throw new Error("Prefab-filen findes ikke længere");
  await editor.db.savePrefab(path, prefabDataFrom(world, e), guid);
  // the edited instance itself is rebuilt too, so its child ids become the stable ones
  const cmds = syncCommands(editor, guid);
  if (cmds.length > 0) editor.execute({ label: "Anvend på prefab", do: () => cmds.forEach((c) => c.do()), undo: () => [...cmds].reverse().forEach((c) => c.undo()) });
  editor.emit("assets");
  return cmds.length;
}

/** Throws away an instance's changes (except where it is placed). */
export function revertToPrefab(editor: Editor, id: string): void {
  const world = editor.world;
  const e = findBySceneId(world, id);
  const guid = e >= 0 ? prefabOf(world, e) : null;
  if (!guid || !editor.assets.prefabs.has(guid)) return;
  editor.execute(rebuildInstance(editor, e, guid, "Gendan fra prefab"));
}

/** A command that rebuilds one instance from its prefab, keeping its placement. */
function rebuildInstance(editor: Editor, e: Entity, guid: string, label: string): EditCommand {
  const world = editor.world;
  const id = sceneIdOf(world, e);
  const before = serializeEntities(world, [e]);
  const prefab = editor.assets.prefabs.get(guid)!;
  const T = before[0].components.Transform2D;
  const after = instanceData(prefab.data, guid, id, {
    transform: T ? { position: T.position, rotation: T.rotation, scale: T.scale } : undefined,
    parent: (before[0].components[Parent.name]?.entity as string | undefined) ?? null,
  });
  return replaceSubtree(world, id, before, after, label);
}

/** Rebuilds all instances after a prefab file changed outside the editor. Not undoable. */
export function syncAllInstances(editor: Editor, guid: string): number {
  const cmds = syncCommands(editor, guid);
  for (const c of cmds) c.do();
  if (cmds.length > 0) editor.afterExternalChange();
  return cmds.length;
}
