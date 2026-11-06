import {
  type ComponentDef,
  type Entity,
  type Field,
  BehaviourRuntime,
  Name,
  PrefabInstance,
  SceneId,
  Scripts,
  Tags,
  allComponents,
  childrenOf,
  componentByName,
  exposedFields,
  findBySceneId,
  parentOf,
  rootEntities,
  scriptDisplayName,
  serializeEntities,
} from "@brik/runtime";
import { SCENE_EXTENSION, isScene } from "./asset-db";
import {
  addComponent,
  addScript,
  composite,
  createEntities,
  deleteEntities,
  reparent,
  removeComponent,
  removeScript,
  sceneIdOf,
  setEntityRef,
  setScriptProp,
  setValues,
} from "./commands";
import type { Editor, EntityKind } from "./editor";
import type { EditCommand } from "./history";
import { joinPath, walk } from "./fs";
import { applyToPrefab, createPrefab, placePrefab, prefabOf } from "./prefabs";
import { isScriptFile } from "./scripts";

/*
 * The editor side of the AI bridge: one handler per tool the MCP server offers.
 * Handlers take plain JSON and return plain JSON. Changes go through editor
 * commands, so the user sees them live and can undo each one.
 */

export type BridgeHandler = (params: Record<string, any>) => unknown | Promise<unknown>;

/** Things only the browser UI can do. */
export interface BridgeUi {
  /** A PNG data URL of the scene or game view, or null when it can't be drawn. */
  screenshot?: (view: "scene" | "game") => Promise<string | null>;
}

const ENTITY_KINDS: EntityKind[] = [
  "empty",
  "sprite",
  "animated",
  "camera",
  "rect",
  "circle",
  "text",
  "sound",
  "tilemap",
  "particles",
  "ui-canvas",
  "ui-image",
  "ui-text",
  "ui-button",
];

class BridgeError extends Error {}

function need(editor: Editor, id: unknown): Entity {
  if (typeof id !== "string") throw new BridgeError("`id` must be an entity id (a string from get_hierarchy)");
  const e = findBySceneId(editor.world, id);
  if (e < 0) throw new BridgeError(`No entity with id "${id}". Use get_hierarchy or find_entities to look ids up.`);
  return e;
}

function component(name: unknown): ComponentDef {
  const def = typeof name === "string" ? componentByName(name) : undefined;
  if (!def || def.options.hidden) {
    throw new BridgeError(`Unknown component "${String(name)}". Use list_components to see what exists.`);
  }
  return def;
}

function noEdits(editor: Editor): void {
  if (editor.play.active) throw new BridgeError("The game is running. Call stop before editing the scene.");
}

/** Describes a field for the AI: its kind, default and allowed values. */
function describeField(f: Field): Record<string, unknown> {
  const out: Record<string, unknown> = { kind: f.kind };
  if (f.kind === "entity") out.default = null;
  else {
    try {
      const d = f.make();
      if (d !== undefined && typeof d !== "function") out.default = d;
    } catch {
      // some defaults need a world
    }
  }
  const m = f.meta;
  if (m?.options) out.options = [...m.options];
  if (m?.editor) out.editor = m.editor;
  if (m?.min !== undefined) out.min = m.min;
  if (m?.max !== undefined) out.max = m.max;
  if (m?.editor === "angle") out.note = "radians";
  return out;
}

/** Checks values for a component and splits off entity fields, which are set by scene id. */
function splitValues(def: ComponentDef, values: unknown): { plain: Record<string, unknown>; refs: Record<string, string | null> } {
  if (values === undefined || values === null) return { plain: {}, refs: {} };
  if (typeof values !== "object" || Array.isArray(values)) throw new BridgeError(`Values for ${def.name} must be an object`);
  const plain: Record<string, unknown> = {};
  const refs: Record<string, string | null> = {};
  for (const [key, v] of Object.entries(values as Record<string, unknown>)) {
    const f = def.schema[key];
    if (!f || f.meta?.hidden) {
      const known = Object.keys(def.schema).filter((k) => !def.schema[k].meta?.hidden);
      throw new BridgeError(`${def.name} has no field "${key}". Fields: ${known.join(", ")}`);
    }
    if (f.kind === "entity") {
      if (v !== null && typeof v !== "string") throw new BridgeError(`${def.name}.${key} takes an entity id or null`);
      refs[key] = v as string | null;
      continue;
    }
    if (f.meta?.options && !f.meta.options.includes(v as string)) {
      throw new BridgeError(`${def.name}.${key} must be one of: ${f.meta.options.join(", ")}`);
    }
    const numeric = ["f32", "f64", "i32", "u32", "u8"].includes(f.kind);
    if (numeric && typeof v !== "number") throw new BridgeError(`${def.name}.${key} must be a number`);
    if (f.kind === "bool" && typeof v !== "boolean") throw new BridgeError(`${def.name}.${key} must be true or false`);
    plain[key] = v;
  }
  return { plain, refs };
}

/** The saved form of one entity's components (entity fields as ids). */
function componentsOf(editor: Editor, e: Entity): Record<string, Record<string, unknown>> {
  const id = sceneIdOf(editor.world, e);
  return serializeEntities(editor.world, [e]).find((d) => d.id === id)?.components ?? {};
}

function summary(editor: Editor, e: Entity) {
  const world = editor.world;
  return {
    id: sceneIdOf(world, e),
    name: editor.entityName(e),
    components: world
      .componentsOf(e)
      .filter((c) => !c.options.hidden && c !== Name)
      .map((c) => c.name),
  };
}

type TreeNode = ReturnType<typeof summary> & { children?: TreeNode[]; more?: number };

function tree(editor: Editor, e: Entity, depth: number): TreeNode {
  const node: TreeNode = summary(editor, e);
  const kids = childrenOf(editor.world, e);
  if (kids.length > 0) {
    if (depth > 0) node.children = kids.map((c) => tree(editor, c, depth - 1));
    else node.more = kids.length;
  }
  return node;
}

/** Resolves a script given as "Player" or "scripts/player.ts#Player". */
function scriptId(editor: Editor, name: unknown): string {
  if (typeof name !== "string") throw new BridgeError("`script` must be a class name or a script id");
  const all = [...editor.scripts.registry.behaviours.keys()];
  if (all.includes(name)) return name;
  const hits = all.filter((id) => scriptDisplayName(id) === name);
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) throw new BridgeError(`Several scripts are called ${name}: ${hits.join(", ")}. Use the full id.`);
  throw new BridgeError(
    `No Behaviour "${name}". Known: ${all.map(scriptDisplayName).join(", ") || "none"}. Did the script compile (get_console)?`,
  );
}

function projectPath(path: unknown): string {
  if (typeof path !== "string" || !path.trim()) throw new BridgeError("`path` must be a project-relative file path");
  const clean = joinPath(path);
  if (!clean || path.includes("..")) throw new BridgeError("Paths must stay inside the project");
  return clean;
}

export function createBridgeHandlers(editor: Editor, ui: BridgeUi = {}): Record<string, BridgeHandler> {
  const world = editor.world;
  const exec = (cmd: EditCommand) => editor.execute(cmd);

  return {
    // ------------------------------------------------------------ looking

    project_info: () => ({
      name: editor.settings.name,
      scene: editor.scenePath,
      startScene: editor.settings.startScene,
      unsavedChanges: editor.dirty,
      mode: editor.play.mode,
      scripts: { status: editor.scripts.status, errors: editor.scripts.errors.length },
      entities: world.entityCount,
      undo: editor.history.undoLabel ?? null,
    }),

    get_hierarchy: ({ depth = 6 }) => rootEntities(world).map((e) => tree(editor, e, Number(depth))),

    find_entities: ({ name, component: comp, tag }) => {
      const def = comp ? component(comp) : undefined;
      const out = [];
      for (const e of world.query([SceneId])) {
        if (name && !editor.entityName(e).toLowerCase().includes(String(name).toLowerCase())) continue;
        if (def && !world.has(e, def)) continue;
        if (tag && !(world.has(e, Tags) && world.store(Tags).list[e]?.includes(tag))) continue;
        out.push(summary(editor, e));
      }
      return out;
    },

    inspect_entity: ({ id }) => {
      const e = need(editor, id);
      const p = parentOf(world, e);
      const guid = prefabOf(world, e);
      const scripts = world.has(e, Scripts)
        ? world.store(Scripts).list[e].map((s, index) => {
            const cls = editor.scripts.registry.behaviours.get(s.script);
            const live = editor.play.active ? world.tryResource(BehaviourRuntime)?.instance(e, index) : undefined;
            return {
              index,
              script: s.script,
              props: s.props,
              fields: cls ? exposedFields(cls).map((f) => ({ key: f.key, type: f.type, default: f.default })) : "script not compiled",
              ...(live ? { live: Object.fromEntries(exposedFields(cls!).map((f) => [f.key, (live as any)[f.key]])) } : {}),
            };
          })
        : [];
      const components = componentsOf(editor, e);
      delete components.Scripts;
      delete components.Name;
      delete components.Parent;
      return {
        id,
        name: editor.entityName(e),
        parent: p >= 0 ? sceneIdOf(world, p) : null,
        children: childrenOf(world, e).map((c) => sceneIdOf(world, c)),
        components,
        scripts,
        ...(guid
          ? { prefab: { guid, path: editor.db.pathOf(guid) ?? null, overrides: world.store(PrefabInstance).overrides[e] ?? [] } }
          : {}),
      };
    },

    list_components: ({ name }) => {
      const defs = name ? [component(name)] : allComponents().filter((c) => !c.options.hidden);
      return defs
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((c) => ({
          name: c.name,
          requires: c.options.requires?.map((r) => r.name) ?? [],
          fields: Object.fromEntries(
            Object.entries(c.schema)
              .filter(([, f]) => !f.meta?.hidden)
              .map(([k, f]) => [k, describeField(f)]),
          ),
        }));
    },

    list_assets: async ({ kind }) => {
      const db = editor.db;
      const out: Record<string, unknown> = {};
      if (!kind || kind === "textures") {
        out.textures = [...db.textures.values()].map((t) => ({
          path: t.path,
          guid: t.meta.guid,
          size: [t.asset.width, t.asset.height],
          sprites: t.meta.sprites.map((s) => ({ id: s.id, name: s.name, rect: [s.rect.x, s.rect.y, s.rect.w, s.rect.h] })),
        }));
      }
      if (!kind || kind === "clips") out.clips = [...db.clips.values()].map((c) => ({ name: c.name, guid: c.guid, path: c.path }));
      if (!kind || kind === "prefabs") out.prefabs = [...db.prefabs.values()].map((p) => ({ name: p.name, guid: p.guid, path: p.path }));
      if (!kind || kind === "sounds") out.sounds = [...db.sounds.values()].map((s) => ({ name: s.name, guid: s.guid, path: s.path }));
      if (!kind || kind === "scenes") out.scenes = (await walk(editor.fs)).filter(isScene);
      if (!kind || kind === "scripts") out.scripts = (await walk(editor.fs)).filter(isScriptFile);
      return out;
    },

    list_scripts: () =>
      [...editor.scripts.registry.behaviours.entries()].map(([id, cls]) => ({
        id,
        name: scriptDisplayName(id),
        fields: exposedFields(cls).map((f) => ({ key: f.key, type: f.type, default: f.default })),
      })),

    read_file: async ({ path }) => {
      const p = projectPath(path);
      if (!(await editor.fs.exists(p))) throw new BridgeError(`No file ${p}`);
      return { path: p, text: await editor.fs.readText(p) };
    },

    get_console: ({ limit = 50, level }) => {
      const entries = editor.console.entries.filter((e) => !level || e.level === level).slice(-Number(limit));
      return entries.map((e) => ({
        level: e.level,
        text: e.text,
        ...(e.count > 1 ? { count: e.count } : {}),
        ...(e.file ? { at: `${e.file}:${e.line}` } : {}),
      }));
    },

    screenshot: async ({ view = "game" }) => {
      if (view !== "scene" && view !== "game") throw new BridgeError('`view` must be "scene" or "game"');
      if (!ui.screenshot) throw new BridgeError("Screenshots need the editor UI");
      const url = await ui.screenshot(view);
      if (!url) throw new BridgeError(`The ${view} view could not be drawn`);
      return { mimeType: "image/png", data: url.slice(url.indexOf(",") + 1) };
    },

    // ------------------------------------------------------------ editing

    create_entity: ({ kind = "empty", name, x, y, parent, components }) => {
      noEdits(editor);
      if (!ENTITY_KINDS.includes(kind)) throw new BridgeError(`kind must be one of: ${ENTITY_KINDS.join(", ")}`);
      if (parent) need(editor, parent);
      const extra: Record<string, Record<string, unknown>> = {};
      for (const [c, v] of Object.entries((components ?? {}) as Record<string, unknown>)) {
        const def = component(c);
        const { plain, refs } = splitValues(def, v);
        extra[def.name] = { ...plain, ...refs };
      }
      const id = editor.createEntity(kind, { name, x, y, parentId: parent ?? null, extra });
      return { id, name: editor.entityName(findBySceneId(world, id)) };
    },

    set_fields: ({ id, component: comp, values }) => {
      noEdits(editor);
      const e = need(editor, id);
      const def = component(comp);
      if (!world.has(e, def)) throw new BridgeError(`${editor.entityName(e)} has no ${def.name}. Use add_component first.`);
      const { plain, refs } = splitValues(def, values);
      const current = world.read(e, def) as Record<string, unknown>;
      const before = Object.fromEntries(Object.keys(plain).map((k) => [k, current[k]]));
      const cmds: EditCommand[] = [];
      if (Object.keys(plain).length > 0) {
        cmds.push(setValues(world, `AI: ${def.name}`, [{ id, component: def.name, before, after: plain }]));
      }
      for (const [k, target] of Object.entries(refs)) {
        if (target) need(editor, target);
        cmds.push(setEntityRef(world, id, def.name, k, target));
      }
      if (cmds.length > 0) exec(composite(`AI: ${def.name}`, cmds));
      return componentsOf(editor, e)[def.name];
    },

    add_component: ({ id, component: comp, values }) => {
      noEdits(editor);
      const e = need(editor, id);
      const def = component(comp);
      if (world.has(e, def)) throw new BridgeError(`${editor.entityName(e)} already has ${def.name}. Use set_fields.`);
      const { plain, refs } = splitValues(def, values);
      const cmds: EditCommand[] = [addComponent(world, id, def, plain)];
      for (const [k, target] of Object.entries(refs)) {
        if (target) need(editor, target);
        cmds.push(setEntityRef(world, id, def.name, k, target));
      }
      exec(composite(`AI: tilføj ${def.name}`, cmds));
      return componentsOf(editor, findBySceneId(world, id))[def.name];
    },

    remove_component: ({ id, component: comp }) => {
      noEdits(editor);
      const e = need(editor, id);
      const def = component(comp);
      if (!world.has(e, def)) throw new BridgeError(`${editor.entityName(e)} has no ${def.name}`);
      const users = world.componentsOf(e).filter((c) => c.options.requires?.includes(def));
      if (users.length > 0) throw new BridgeError(`${def.name} is needed by ${users.map((u) => u.name).join(", ")}`);
      exec(removeComponent(world, id, def));
      return { removed: def.name };
    },

    delete_entities: ({ ids }) => {
      noEdits(editor);
      if (!Array.isArray(ids) || ids.length === 0) throw new BridgeError("`ids` must be a non-empty list");
      for (const id of ids) need(editor, id);
      exec(deleteEntities(world, ids));
      return { deleted: ids.length };
    },

    reparent: ({ ids, parent = null, index }) => {
      noEdits(editor);
      for (const id of ids ?? []) need(editor, id);
      if (parent) need(editor, parent);
      const cmd = reparent(world, ids, parent, index);
      if (!cmd) throw new BridgeError("Nothing to move (an entity can't be moved into itself)");
      exec(cmd);
      return { moved: ids.length };
    },

    select: ({ ids }) => {
      for (const id of ids ?? []) need(editor, id);
      editor.select(ids ?? []);
      return { selected: ids?.length ?? 0 };
    },

    undo: () => {
      noEdits(editor);
      const label = editor.history.undoLabel;
      if (!label) throw new BridgeError("Nothing to undo");
      editor.undo();
      return { undone: label };
    },

    // ------------------------------------------------------------ scripts

    write_script: async ({ path, content }) => {
      const p = projectPath(path);
      if (!isScriptFile(p) || !p.startsWith("scripts/")) throw new BridgeError("Scripts are .ts files in scripts/, e.g. scripts/Mover.ts");
      if (typeof content !== "string") throw new BridgeError("`content` must be the whole file as text");
      await editor.fs.writeFile(p, content);
      await editor.scripts.rebuild();
      const s = editor.scripts;
      return {
        path: p,
        status: s.status,
        errors: s.errors.map((e) => `${e.file}:${e.line}:${e.column + 1} ${e.message}`),
        behaviours: [...s.registry.behaviours.keys()].filter((id) => id.startsWith(`${p}#`)),
      };
    },

    attach_script: ({ id, script }) => {
      noEdits(editor);
      need(editor, id);
      const sid = scriptId(editor, script);
      exec(addScript(world, id, sid));
      return { id, script: sid };
    },

    detach_script: ({ id, script }) => {
      noEdits(editor);
      const e = need(editor, id);
      const sid = scriptId(editor, script);
      const index = world.has(e, Scripts) ? world.store(Scripts).list[e].findIndex((s) => s.script === sid) : -1;
      if (index < 0) throw new BridgeError(`${editor.entityName(e)} has no ${scriptDisplayName(sid)}`);
      exec(removeScript(world, id, index));
      return { id, removed: sid };
    },

    set_script_field: ({ id, script, key, value }) => {
      noEdits(editor);
      const e = need(editor, id);
      const sid = scriptId(editor, script);
      const list = world.has(e, Scripts) ? world.store(Scripts).list[e] : [];
      const index = list.findIndex((s) => s.script === sid);
      if (index < 0) throw new BridgeError(`${editor.entityName(e)} has no ${scriptDisplayName(sid)}. Use attach_script first.`);
      const field = exposedFields(editor.scripts.registry.behaviours.get(sid)!).find((f) => f.key === key);
      if (!field) throw new BridgeError(`${scriptDisplayName(sid)} has no @expose field "${key}"`);
      let v = value;
      if (field.type === "entity") {
        if (v !== null && typeof v !== "string") throw new BridgeError(`${key} takes an entity id or null`);
        if (v) need(editor, v);
        v = { $entity: v };
      }
      exec(setScriptProp(world, id, index, key, v === undefined ? undefined : v));
      return { id, script: sid, key, value };
    },

    // ------------------------------------------------------------ prefabs and scenes

    place_prefab: ({ prefab, x = 0, y = 0, parent }) => {
      noEdits(editor);
      const p = editor.assets.prefab(String(prefab));
      if (!p) throw new BridgeError(`No prefab "${prefab}". Use list_assets with kind "prefabs".`);
      if (parent) need(editor, parent);
      const id = placePrefab(editor, p.guid, { x, y }, parent ?? null);
      if (!id) throw new BridgeError(`Prefab ${p.name} is empty`);
      return { id, prefab: p.name };
    },

    create_prefab: async ({ id }) => {
      noEdits(editor);
      need(editor, id);
      const path = await createPrefab(editor, id);
      return { path };
    },

    apply_prefab: async ({ id }) => {
      noEdits(editor);
      need(editor, id);
      const updated = await applyToPrefab(editor, id);
      return { updatedInstances: updated };
    },

    save_scene: async ({ path }) => {
      noEdits(editor);
      let target = path ? projectPath(path) : (editor.scenePath ?? "scenes/main.scene.json");
      if (!target.endsWith(SCENE_EXTENSION)) target += SCENE_EXTENSION;
      return { saved: await editor.saveScene(target) };
    },

    open_scene: async ({ path, discardChanges = false }) => {
      noEdits(editor);
      const p = projectPath(path);
      if (editor.dirty && !discardChanges) {
        throw new BridgeError("The open scene has unsaved changes. Call save_scene first, or pass discardChanges: true.");
      }
      await editor.openScene(p);
      return { opened: p };
    },

    // ------------------------------------------------------------ play

    play: async () => {
      const ok = await editor.play.start();
      if (!ok) throw new BridgeError("The game could not start. See get_console for script errors.");
      return { mode: editor.play.mode };
    },

    pause: () => {
      editor.play.pause();
      return { mode: editor.play.mode };
    },

    step: ({ frames = 1 }) => {
      if (!editor.play.active) throw new BridgeError("The game is not running. Call play first.");
      editor.play.pause();
      for (let i = 0; i < Math.min(600, Number(frames)); i++) editor.play.step();
      return { mode: editor.play.mode };
    },

    stop: () => {
      editor.play.stop();
      return { mode: editor.play.mode };
    },
  };
}

/** Handlers that change the project; the editor logs these in its console. */
export const MUTATING = new Set([
  "create_entity",
  "set_fields",
  "add_component",
  "remove_component",
  "delete_entities",
  "reparent",
  "undo",
  "write_script",
  "attach_script",
  "detach_script",
  "set_script_field",
  "place_prefab",
  "create_prefab",
  "apply_prefab",
  "save_scene",
  "open_scene",
]);

export { BridgeError };
