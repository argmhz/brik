import {
  type ComponentDef,
  type Entity,
  type Field,
  BehaviourRuntime,
  Camera2D,
  GlobalTransform2D,
  Input,
  UIClick,
  UITextEntry,
  UILayout,
  Name,
  PrefabInstance,
  SceneId,
  Scenes,
  Scripts,
  Tags,
  TileMap,
  type TileData,
  newGuid,
  textureMetaToJson,
  tileBounds,
  terrainBrush,
  tileKey,
  allComponents,
  childrenOf,
  componentByName,
  exposedFields,
  findBySceneId,
  mat3,
  parentOf,
  propagateTransforms,
  rootEntities,
  scriptDisplayName,
  serializeEntities,
} from "@brik/runtime";
import { SCENE_EXTENSION, isScene, metaPath } from "./asset-db";
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
import { encodePng, parseHexColor } from "./png";
import { isScriptFile } from "./scripts";
import { autotileChanges, setTilesCommand } from "./tiles";

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
  "ui-slider",
  "ui-toggle",
  "ui-input",
  "ui-stack",
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

const KEY_CODE = /^(Key[A-Z]|Digit[0-9]|Arrow(Left|Right|Up|Down)|Numpad\w+|F\d{1,2}|Space|Enter|Escape|Tab|Backspace|(Shift|Control|Alt|Meta)(Left|Right)|Mouse[0-4])$/;

/** Validates key codes for step's hold/press. */
function keyList(value: unknown, what: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new BridgeError(`\`${what}\` is a list of key codes, e.g. ["ArrowRight", "Space"]`);
  for (const k of value) {
    if (typeof k !== "string" || !KEY_CODE.test(k)) {
      throw new BridgeError(`"${k}" is not a key code. Use KeyboardEvent.code names like "ArrowRight", "KeyA", "Space", or "Mouse0".`);
    }
  }
  return value as string[];
}

/** Screen size the UI is laid out for when the Game view hasn't drawn yet (matches the editor's game view). */
const FALLBACK_SCREEN = { w: 960, h: 540 };

/**
 * Where to put the mouse, in CSS pixels with y down (what Input.pointer uses).
 * `{ entity }` aims at the middle of a UI element, or at an entity's position
 * in the world; `{ x, y }` is a point in world units (y up).
 */
function pointerTarget(editor: Editor, target: unknown): { x: number; y: number; ui: Entity } {
  const world = editor.world;
  const t = target as { entity?: unknown; x?: unknown; y?: unknown } | null;
  if (!t || typeof t !== "object") {
    throw new BridgeError('`mouse` is { "entity": "<id>" } (a UI element or an entity) or { "x": 0, "y": 0 } in world units');
  }
  const layout = world.tryResource(UILayout) ?? world.insertResource(new UILayout());
  // lay the UI out now: the Game view may not have drawn (hidden tab, background window)
  layout.update(world, layout.screenW || FALLBACK_SCREEN.w, layout.screenH || FALLBACK_SCREEN.h);
  const W = layout.screenW;
  const H = layout.screenH;
  let wx: number;
  let wy: number;
  if (t.entity !== undefined) {
    const e = need(editor, t.entity);
    const el = layout.byEntity.get(e);
    if (el) return { x: el.rect.x + el.rect.w / 2, y: H - (el.rect.y + el.rect.h / 2), ui: e };
    if (!world.has(e, GlobalTransform2D)) throw new BridgeError("That entity is neither a visible UI element nor placed in the world");
    const g = world.store(GlobalTransform2D).matrix;
    wx = g.tx[e];
    wy = g.ty[e];
  } else if (typeof t.x === "number" && typeof t.y === "number") {
    wx = t.x;
    wy = t.y;
  } else {
    throw new BridgeError('`mouse` needs "entity", or both "x" and "y"');
  }
  // world -> screen through the main camera (the lowest priority, like Behaviour.pointerWorld)
  const C = world.store(Camera2D);
  const cam = world
    .query([Camera2D, GlobalTransform2D])
    .toArray()
    .sort((a, b) => C.priority[a] - C.priority[b])[0];
  if (cam === undefined) return { x: wx, y: wy, ui: -1 };
  const g = world.store(GlobalTransform2D).matrix;
  const inv = mat3.invert({ a: g.a[cam], b: g.b[cam], c: g.c[cam], d: g.d[cam], tx: g.tx[cam], ty: g.ty[cam] });
  const local = inv ? mat3.transformPoint(inv, { x: wx, y: wy }) : { x: wx, y: wy };
  const zoom = C.zoom[cam] || 1;
  return { x: W / 2 + local.x * zoom, y: H / 2 - local.y * zoom, ui: -1 };
}

/**
 * Advances the game one frame. Scene files load asynchronously, so a scene
 * requested with loadScene is waited for first: it then switches in this very
 * frame instead of some frames later, depending on disk speed.
 */
async function stepFrame(editor: Editor): Promise<void> {
  const scenes = editor.world.tryResource(Scenes);
  if (scenes?.busy) await scenes.loaded();
  editor.play.step();
}

/** After the last frame of a call: a scene that was requested in it is swapped in now, so the AI sees it. */
async function finishSceneSwitch(editor: Editor): Promise<boolean> {
  const scenes = editor.world.tryResource(Scenes);
  if (!scenes?.busy) return false;
  await scenes.loaded();
  scenes.swap(editor.world);
  propagateTransforms.run(editor.world);
  editor.emit("world");
  return true;
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
  /** Keys the AI holds down in the running game (see step). */
  let heldKeys = new Set<string>();

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

    // ------------------------------------------------------------ art and tiles

    draw_sprites: async ({ path, palette, sprites, pivot = [0.5, 0.5], scale = 1 }) => {
      let p = projectPath(path);
      if (!p.endsWith(".png")) p += ".png";
      if (!palette || typeof palette !== "object") throw new BridgeError("`palette` maps single characters to colours, e.g. { \"g\": \"#3fa34d\" }");
      const colors = new Map<string, [number, number, number, number]>();
      for (const [ch, c] of Object.entries(palette as Record<string, unknown>)) {
        if ([...ch].length !== 1) throw new BridgeError(`Palette keys are single characters, not "${ch}"`);
        const rgba = c === null ? [0, 0, 0, 0] as [number, number, number, number] : parseHexColor(String(c));
        if (!rgba) throw new BridgeError(`Palette colour for "${ch}" must be "#rrggbb", "#rrggbbaa" or null, not ${JSON.stringify(c)}`);
        colors.set(ch, rgba);
      }
      const entries = Object.entries((sprites ?? {}) as Record<string, unknown>);
      if (entries.length === 0) throw new BridgeError("`sprites` maps sprite names to pixel rows, e.g. { slime_0: [\"..gg..\", ...] }");
      const k = Math.max(1, Math.min(8, Math.floor(Number(scale))));
      let w = 0;
      let h = 0;
      for (const [name, rows] of entries) {
        if (!Array.isArray(rows) || rows.some((r) => typeof r !== "string")) throw new BridgeError(`Sprite ${name}: give a list of strings, one per pixel row`);
        if (h && rows.length !== h) throw new BridgeError(`All sprites must have the same size; ${name} has ${rows.length} rows, the first has ${h}`);
        h = rows.length;
        for (const r of rows as string[]) {
          const len = [...r].length;
          if (w && len !== w) throw new BridgeError(`All rows must have the same length; a row in ${name} has ${len} pixels, expected ${w}`);
          w = len;
        }
      }
      const cw = w * k;
      const ch = h * k;
      const width = cw * entries.length;
      const rgba = new Uint8Array(width * ch * 4);
      entries.forEach(([name, rows], i) => {
        (rows as string[]).forEach((row, y) => {
          [...row].forEach((c, x) => {
            if (c === "." || c === " ") return;
            const col = colors.get(c);
            if (!col) throw new BridgeError(`Sprite ${name} uses "${c}", which is not in the palette ("." and space are transparent)`);
            for (let dy = 0; dy < k; dy++)
              for (let dx = 0; dx < k; dx++) rgba.set(col, ((y * k + dy) * width + i * cw + x * k + dx) * 4);
          });
        });
      });
      const old = editor.db.textures.get(p);
      const meta = {
        guid: old?.meta.guid ?? newGuid(),
        importer: "texture" as const,
        settings: old?.meta.settings ?? { filter: "nearest" as const, wrap: "clamp" as const, pixelsPerUnit: 1 },
        slicing: { mode: "manual" as const },
        sprites: entries.map(([name], i) => ({
          id: name,
          name,
          rect: { x: i * cw, y: 0, w: cw, h: ch },
          pivot: { x: Number(pivot[0]), y: Number(pivot[1]) },
        })),
      };
      await editor.fs.writeFile(metaPath(p), textureMetaToJson(meta));
      await editor.fs.writeFile(p, encodePng(width, ch, rgba));
      const entry = await editor.db.load(p);
      if (!entry) throw new BridgeError(`${p} was written but could not be loaded`);
      editor.emit("assets");
      return {
        path: p,
        guid: meta.guid,
        sprites: entries.map(([name]) => name),
        size: [cw, ch],
        use: { Sprite: { sprite: { texture: meta.guid, id: entries[0][0] } } },
      };
    },

    create_animation: async ({ path, texture, frames, fps = 8, mode = "loop", events = [] }) => {
      let p = projectPath(path);
      if (!p.endsWith(".anim.json")) p += ".anim.json";
      const tex = [...editor.db.textures.values()].find((t) => t.path === texture || t.meta.guid === texture || t.asset.name === texture);
      if (!tex) throw new BridgeError(`No texture "${texture}". Use list_assets with kind "textures".`);
      if (!Array.isArray(frames) || frames.length === 0) throw new BridgeError("`frames` is a list of sprite names (or ids) from the texture");
      if (!["loop", "once", "pingpong"].includes(mode)) throw new BridgeError('mode must be "loop", "once" or "pingpong"');
      const duration = 1 / Math.max(0.1, Number(fps));
      const ids = frames.map((f: unknown) => {
        const s = tex.meta.sprites.find((x) => x.name === f || x.id === f);
        if (!s) throw new BridgeError(`${tex.path} has no sprite "${f}". It has: ${tex.meta.sprites.map((x) => x.name).join(", ")}`);
        return s.id;
      });
      const guid = editor.db.clips.get(p)?.guid ?? newGuid();
      const clip = {
        guid,
        name: "",
        mode,
        frames: ids.map((id: string) => ({ sprite: { texture: tex.meta.guid, id }, duration })),
        events: (events as { frame: number; name: string }[]).filter((e) => Number.isInteger(e.frame) && typeof e.name === "string"),
      };
      await editor.db.saveClip(p, clip);
      editor.emit("assets");
      return { path: p, guid, name: editor.db.clips.get(p)?.name, frames: ids.length, use: { SpriteAnimator: { clip: guid } } };
    },

    read_tiles: ({ id }) => {
      const e = need(editor, id);
      if (!world.has(e, TileMap)) throw new BridgeError(`${editor.entityName(e)} has no TileMap`);
      const tiles = world.store(TileMap).tiles[e] as TileData;
      const tex = editor.db.byGuid(world.store(TileMap).tileset[e] as string);
      const names = new Map((tex?.meta.sprites ?? []).map((s) => [s.id, s.name]));
      const legend: Record<string, string> = {};
      const charOf = new Map<string, string>();
      // each tile gets the first free letter of its name (g for grass), so the legend is easy to read
      const pool = "#=%@&*+o0X~^abcdefghijklmnpqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
      for (const sid of new Set(Object.values(tiles))) {
        const name = names.get(sid) ?? sid;
        const ch = [...name.toLowerCase(), ...name.toUpperCase(), ...pool].find((c) => /\S/.test(c) && c !== "." && !(c in legend))!;
        charOf.set(sid, ch);
        legend[ch] = name;
      }
      const b = tileBounds(tiles);
      // auto-tiling terrains: paint with "terrain:<name>" and the edges pick themselves
      const terrains = (tex?.meta.terrains ?? []).map((t) => `terrain:${t.name}`);
      const withTerrains = terrains.length ? { terrains } : {};
      if (!b) return { tileset: tex?.path ?? null, tiles: names.size ? [...names.values()] : [], ...withTerrains, empty: true };
      const rows: string[] = [];
      for (let y = b.maxY; y >= b.minY; y--) {
        let row = "";
        for (let x = b.minX; x <= b.maxX; x++) row += charOf.get(tiles[tileKey(x, y)]) ?? ".";
        rows.push(row);
      }
      return {
        tileset: tex?.path ?? null,
        tileNames: [...names.values()],
        ...withTerrains,
        tileSize: world.read(e, TileMap).tileSize,
        topLeft: { x: b.minX, y: b.maxY },
        note: "Rows go from the top (highest y) down. Cell (x, y) covers world x*tileSize..(x+1)*tileSize. '.' is empty.",
        legend,
        rows,
      };
    },

    paint_tiles: ({ id, rects, map }) => {
      noEdits(editor);
      const e = need(editor, id);
      if (!world.has(e, TileMap)) throw new BridgeError(`${editor.entityName(e)} has no TileMap`);
      const before = world.store(TileMap).tiles[e] as TileData;
      const tex = editor.db.byGuid(world.store(TileMap).tileset[e] as string);
      const sprites = tex?.meta.sprites ?? [];
      const terrains = tex?.meta.terrains ?? [];
      const resolve = (tile: unknown): string | null => {
        if (tile === null || tile === "" || tile === undefined) return null;
        const s = sprites.find((x) => x.name === tile || x.id === tile);
        if (s) return s.id;
        // a terrain: the edges are picked from the neighbours afterwards
        const name = typeof tile === "string" ? tile.replace(/^terrain:/, "") : "";
        const t = terrains.find((x) => x.name === name || x.id === name);
        if (t) return terrainBrush(t);
        const known = [...sprites.map((x) => x.name), ...terrains.map((x) => `terrain:${x.name}`)];
        throw new BridgeError(`The tileset has no tile or terrain "${tile}". Known: ${known.join(", ")}`);
      };
      const after: TileData = { ...before };
      let changed = 0;
      const set = (x: number, y: number, sid: string | null) => {
        const key = tileKey(x, y);
        if ((after[key] ?? null) === sid) return;
        if (sid === null) delete after[key];
        else after[key] = sid;
        changed++;
      };
      for (const r of (rects ?? []) as { x0: number; y0: number; x1: number; y1: number; tile: string | null }[]) {
        const sid = resolve(r.tile);
        const [x0, x1] = [Math.min(r.x0, r.x1), Math.max(r.x0, r.x1)];
        const [y0, y1] = [Math.min(r.y0, r.y1), Math.max(r.y0, r.y1)];
        if ((x1 - x0 + 1) * (y1 - y0 + 1) > 100000) throw new BridgeError("A rect may cover at most 100000 cells");
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, sid);
      }
      if (map) {
        const { x = 0, y = 0, rows, legend } = map as { x?: number; y?: number; rows: string[]; legend: Record<string, string | null> };
        if (!Array.isArray(rows) || !legend) throw new BridgeError("`map` needs rows (top row first) and a legend like { \"G\": \"grass\", \"_\": null }");
        const ids = new Map(Object.entries(legend).map(([ch, t]) => [ch, resolve(t)]));
        rows.forEach((row, dy) => {
          [...row].forEach((c, dx) => {
            if (ids.has(c)) set(x + dx, y - dy, ids.get(c)!);
          });
        });
      }
      autotileChanges(terrains, before, after);
      if (changed > 0) exec(setTilesCommand(world, id, before, after, "AI: mal tiles"));
      return { changed, tiles: Object.keys(after).length };
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
      heldKeys.clear();
      const ok = await editor.play.start();
      if (!ok) throw new BridgeError("The game could not start. See get_console for script errors.");
      return { mode: editor.play.mode };
    },

    pause: () => {
      editor.play.pause();
      return { mode: editor.play.mode };
    },

    step: async ({ frames = 1, hold = [], press = [], mouse, type }) => {
      if (!editor.play.active) throw new BridgeError("The game is not running. Call play first.");
      const held = keyList(hold, "hold");
      const tapped = keyList(press, "press");
      const input = world.tryResource(Input);
      if ((held.length || tapped.length || mouse !== undefined) && !input) throw new BridgeError("This game has no input");
      editor.play.pause();
      if (mouse !== undefined) {
        const p = pointerTarget(editor, mouse);
        input!.injectPointer(p.x, p.y);
      }
      if (type !== undefined) {
        const entry = world.tryResource(UITextEntry);
        if (typeof type !== "string") throw new BridgeError("`type` is the text to type");
        if (!entry || entry.focused < 0) throw new BridgeError("No text field has focus. Click one first (click with its entity id).");
        entry.type(type);
      }
      // keys stay down between calls while they are listed in `hold`, so holding isn't a new press
      if (input) {
        for (const k of heldKeys) if (!held.includes(k)) input.inject("up", k);
        for (const k of held) if (!heldKeys.has(k)) input.inject("down", k);
        for (const k of tapped) if (!held.includes(k)) input.inject("down", k);
      }
      heldKeys = new Set(held);
      const n = Math.max(1, Math.min(600, Number(frames)));
      const sceneBefore = world.tryResource(Scenes)?.current ?? null;
      for (let i = 0; i < n; i++) {
        await stepFrame(editor);
        if (i === 0) for (const k of tapped) if (!held.includes(k)) input!.inject("up", k);
      }
      await finishSceneSwitch(editor);
      const scene = world.tryResource(Scenes)?.current ?? null;
      return { mode: editor.play.mode, frames: n, ...(scene !== sceneBefore ? { sceneLoaded: scene } : {}) };
    },

    click: async ({ entity, x, y, button = 0 }) => {
      if (!editor.play.active) throw new BridgeError("The game is not running. Call play first.");
      const input = world.tryResource(Input);
      if (!input) throw new BridgeError("This game has no input");
      if (![0, 1, 2].includes(Number(button))) throw new BridgeError("`button` is 0 (left), 1 (middle) or 2 (right)");
      const code = `Mouse${Number(button)}`;
      editor.play.pause();
      const p = pointerTarget(editor, entity !== undefined ? { entity } : { x, y });
      const layout = world.resource(UILayout);
      const hitButton = layout.buttonAt(world, p.x, p.y);
      const clicks = world.events(UIClick).reader();
      input.injectPointer(p.x, p.y);
      // move there, press, release, and let the game react
      const sceneBefore = world.tryResource(Scenes)?.current ?? null;
      await stepFrame(editor);
      input.inject("down", code);
      await stepFrame(editor);
      input.inject("up", code);
      await stepFrame(editor);
      await stepFrame(editor);
      const clicked = clicks.read().map((ev) => world.store(SceneId).id[ev.entity] ?? null);
      return {
        screen: { x: Math.round(p.x), y: Math.round(p.y) },
        buttonUnderMouse: hitButton >= 0 ? (world.store(SceneId).id[hitButton] ?? null) : null,
        clickedButtons: clicked,
        frames: 4,
        ...((await finishSceneSwitch(editor)) || world.tryResource(Scenes)?.current !== sceneBefore
          ? { sceneLoaded: world.tryResource(Scenes)?.current ?? null }
          : {}),
      };
    },

    stop: () => {
      heldKeys.clear();
      editor.play.stop();
      return { mode: editor.play.mode };
    },
  };
}

/** Handlers that change the project; the editor logs these in its console. */
export const MUTATING = new Set([
  "draw_sprites",
  "create_animation",
  "paint_tiles",
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
