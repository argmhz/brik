import {
  type AnimationClip,
  App,
  Assets,
  AssetsPlugin,
  Audio,
  Camera2D,
  CorePlugin,
  type Entity,
  Name,
  type SceneData,
  type SceneEntityData,
  SceneId,
  Transform2D,
  type SpriteRef,
  UICanvas,
  type World,
  parentOf,
  clearWorld,
  findBySceneId,
  loadScene,
  newGuid,
  newSceneId,
  serializeScene,
} from "@brik/runtime";
import { refreshOverrides, refreshSceneData, syncAllInstances } from "./prefabs";
import { joinPath } from "./fs";
import { AssetDatabase, type Decoder, SCENE_EXTENSION } from "./asset-db";
import { createEntities, deleteEntities, duplicateEntities } from "./commands";
import { type LogLevel, LogStore, formatArgs } from "./console-log";
import { mapStack } from "./source-map";
import type { ProjectFS } from "./fs";
import { type EditCommand, History } from "./history";
import { PlayController } from "./play";
import { ScriptHost } from "./script-host";
import type { EsbuildLike } from "./scripts";
import { type ProjectSettings, defaultScene, ensureAiGuide, readProject, sceneToJson, writeProject } from "./project";
import { Autosave, type RecoveryData, readRecovery, removeRecovery } from "./recovery";

export type Tool = "move" | "rotate" | "scale";
/** Tile painting tools. Active while a TileMap is selected and a tool is chosen. */
export type TileTool = "paint" | "erase" | "fill" | "rect" | "pick";

export type EntityKind =
  | "empty"
  | "sprite"
  | "camera"
  | "rect"
  | "circle"
  | "polygon"
  | "line"
  | "text"
  | "animated"
  | "sound"
  | "tilemap"
  | "particles"
  | "light"
  | "ui-canvas"
  | "ui-image"
  | "ui-text"
  | "ui-button"
  | "ui-slider"
  | "ui-toggle"
  | "ui-input"
  | "ui-stack";

const UI_KINDS = new Set<EntityKind>(["ui-image", "ui-text", "ui-button", "ui-slider", "ui-toggle", "ui-input", "ui-stack"]);
export type EditorEvent = "world" | "selection" | "assets" | "scene" | "settings" | "scripts" | "console" | "play" | "recovery";

export interface EditorOptions {
  decode?: Decoder;
  makeUrl?: (bytes: Uint8Array, mime: string) => string;
  /** Enables scripts. Returns a ready esbuild (esbuild-wasm in the browser). */
  esbuild?: () => Promise<EsbuildLike>;
  /** Loads compiled script code as a module. Default: blob URL import. */
  importCode?: (code: string) => Promise<Record<string, unknown>>;
}

/**
 * The editor's state and actions, independent of the UI. The UI listens with
 * `editor.on(...)` and calls methods; every change to the scene goes through
 * `execute` so it can be undone.
 */
export class Editor {
  readonly app: App;
  readonly world: World;
  readonly assets: Assets;
  readonly history = new History();
  readonly db: AssetDatabase;
  readonly console = new LogStore();
  readonly scripts: ScriptHost;
  readonly play: PlayController;
  settings: ProjectSettings;

  scenePath: string | null = null;
  /** Selected entities, by scene id. The last one is the "active" selection. */
  selection: string[] = [];
  /** Selected asset path (shown in the inspector when no entity is selected). */
  selectedAsset: string | null = null;

  tool: Tool = "move";
  snap = false;
  gridSize = 16;
  showGrid = true;
  /** Tile painting: the active tool (null = normal selection) and the sprite id to paint. */
  tileTool: TileTool | null = null;
  tileSprite: string | null = null;
  /** The scene view camera. */
  view = { x: 0, y: 0, zoom: 2 };

  private listeners = new Map<EditorEvent, Set<() => void>>();
  /** Keeps unsaved scene changes in `.brik/recovery.json`. */
  readonly autosave: Autosave;
  /**
   * Unsaved changes found when the project was opened (the editor closed or
   * the page reloaded before saving). Autosave waits until it is restored or
   * discarded.
   */
  recovery: RecoveryData | null = null;

  private constructor(
    readonly fs: ProjectFS,
    settings: ProjectSettings,
    options: EditorOptions,
  ) {
    this.settings = settings;
    this.app = new App().addPlugin(CorePlugin).addPlugin(AssetsPlugin);
    this.world = this.app.world;
    this.assets = this.world.resource(Assets);
    this.db = new AssetDatabase(fs, this.assets, options.decode, options.makeUrl);
    this.db.audio = this.world.insertResource(new Audio());
    this.db.onPrefabChanged = (guid) => {
      if (!this.play.active) syncAllInstances(this, guid);
    };
    this.play = new PlayController(this);
    this.scripts = new ScriptHost(this, options.esbuild, options.importCode);
    const editor = this;
    this.autosave = new Autosave({
      fs,
      get dirty() {
        return editor.dirty;
      },
      get playing() {
        return editor.play.active;
      },
      get scenePath() {
        return editor.scenePath;
      },
      snapshot: () => serializeScene(this.world),
    });
    this.history.subscribe(() => {
      this.autosave.changed();
      this.emit("scene");
    });
  }

  static async open(fs: ProjectFS, options: EditorOptions = {}): Promise<Editor> {
    const editor = new Editor(fs, await readProject(fs), options);
    // projects made before CLAUDE.md existed get one
    await ensureAiGuide(fs);
    // unsaved changes from last time wait for restoreRecovery() or discardRecovery()
    editor.recovery = await readRecovery(fs);
    if (editor.recovery) {
      editor.autosave.paused = true;
      editor.autosave.markOnDisk();
    }
    await editor.db.refresh();
    // scripts may define components used by the scene, so compile them first
    await editor.scripts.rebuild();
    if (await fs.exists(editor.settings.startScene)) await editor.openScene(editor.settings.startScene);
    else editor.newScene();
    return editor;
  }

  // ---------------------------------------------------------------- events

  on(event: EditorEvent, fn: () => void): () => void {
    let set = this.listeners.get(event);
    if (!set) this.listeners.set(event, (set = new Set()));
    set.add(fn);
    return () => set.delete(fn);
  }

  emit(event: EditorEvent): void {
    for (const fn of this.listeners.get(event) ?? []) fn();
  }

  // ---------------------------------------------------------------- history

  /**
   * Applies a change. In play mode it is applied but not recorded, since the
   * scene is restored when play stops anyway.
   */
  execute(cmd: EditCommand): void {
    if (this.play.active) cmd.do();
    else this.history.execute(cmd);
    this.afterChange();
  }

  /** Records a change that was already applied, e.g. at the end of a gizmo drag. */
  push(cmd: EditCommand): void {
    if (!this.play.active) this.history.push(cmd);
    this.afterChange();
  }

  /** Call after the world was changed outside of commands (e.g. play mode stopped). */
  afterExternalChange(): void {
    this.afterChange();
    this.emit("selection");
  }

  log(level: LogLevel, text: string, loc?: { file?: string; line?: number; column?: number }): void {
    this.console.add(level, text, loc);
    this.emit("console");
  }

  /**
   * Logs console output (console.log/error ... while the editor runs). Errors
   * thrown by game scripts get their stack mapped back to the script files,
   * and the entry links to the line the error came from.
   */
  logConsole(level: LogLevel, args: unknown[]): void {
    let at: { file: string; line: number; column: number } | null = null;
    const parts = args.map((a) => {
      if (!(a instanceof Error) || !a.stack) return a;
      const mapped = mapStack(a.stack, this.scripts.sourceMap);
      at ??= mapped.at;
      // V8 stacks start with "Name: message"; others are only frames
      return mapped.text.includes(a.message) ? mapped.text : `${a.message}\n${mapped.text}`;
    });
    this.log(level, formatArgs(parts), at ?? undefined);
  }

  undo(): void {
    if (!this.play.active && this.history.undo()) this.afterChange();
  }

  redo(): void {
    if (!this.play.active && this.history.redo()) this.afterChange();
  }

  private afterChange(): void {
    if (!this.play.active) refreshOverrides(this);
    const alive = this.selection.filter((id) => findBySceneId(this.world, id) >= 0);
    if (alive.length !== this.selection.length) {
      this.selection = alive;
      this.emit("selection");
    }
    this.emit("world");
  }

  // ---------------------------------------------------------------- selection

  select(ids: string[]): void {
    this.selection = [...new Set(ids)];
    if (ids.length > 0) this.selectedAsset = null;
    this.emit("selection");
  }

  /** Ctrl/Cmd-click: add or remove one entity from the selection. */
  toggleSelect(id: string): void {
    this.select(this.selection.includes(id) ? this.selection.filter((s) => s !== id) : [...this.selection, id]);
  }

  selectAsset(path: string | null): void {
    this.selectedAsset = path;
    if (path) this.selection = [];
    this.emit("selection");
  }

  selectedEntities(): Entity[] {
    return this.selection.map((id) => findBySceneId(this.world, id)).filter((e) => e >= 0);
  }

  idOf(e: Entity): string {
    return this.world.store(SceneId).id[e];
  }

  entityName(e: Entity): string {
    const n = this.world.has(e, Name) ? this.world.store(Name).value[e] : "";
    return n || `Entity ${this.idOf(e)?.slice(0, 4) ?? e}`;
  }

  // ---------------------------------------------------------------- settings

  setTool(tool: Tool): void {
    this.tool = tool;
    this.emit("settings");
  }

  setTileTool(tool: TileTool | null, sprite?: string | null): void {
    this.tileTool = tool;
    if (sprite !== undefined) this.tileSprite = sprite;
    this.emit("settings");
  }

  setSnap(snap: boolean): void {
    this.snap = snap;
    this.emit("settings");
  }

  setShowGrid(show: boolean): void {
    this.showGrid = show;
    this.emit("settings");
  }

  // ---------------------------------------------------------------- scenes

  get dirty(): boolean {
    return this.history.dirty;
  }

  newScene(): void {
    this.play.stop();
    loadScene(this.world, defaultScene());
    this.scenePath = null;
    this.resetAfterLoad();
  }

  async openScene(path: string): Promise<void> {
    this.play.stop();
    const data = JSON.parse(await this.fs.readText(path)) as SceneData;
    // prefab instances pick up prefab changes made while the scene was closed
    loadScene(this.world, refreshSceneData(this, data));
    refreshOverrides(this);
    this.scenePath = path;
    this.resetAfterLoad();
  }

  /** Loads the unsaved changes found at startup. The scene is then dirty until saved. */
  restoreRecovery(): void {
    const rec = this.recovery;
    if (!rec) return;
    this.play.stop();
    loadScene(this.world, refreshSceneData(this, rec.scene));
    refreshOverrides(this);
    this.scenePath = rec.scenePath;
    this.recovery = null;
    this.autosave.paused = false;
    this.resetAfterLoad();
    this.history.markUnsaved();
    this.emit("recovery");
  }

  /** Throws away the unsaved changes found at startup. */
  async discardRecovery(): Promise<void> {
    if (!this.recovery) return;
    this.recovery = null;
    await removeRecovery(this.fs);
    this.autosave.paused = false;
    this.autosave.changed();
    this.emit("recovery");
  }

  /** What is waiting to be restored or discarded, or null. */
  get pendingRecovery(): { scene: string | null; savedAt: number; entities: number } | null {
    const r = this.recovery;
    return r ? { scene: r.scenePath, savedAt: r.savedAt, entities: r.scene.entities.length } : null;
  }

  /** Saves to the current path, or `path` if given (save as). */
  async saveScene(path?: string): Promise<string> {
    if (this.play.active) throw new Error("Stop spillet, før du gemmer scenen");
    let target = path ?? this.scenePath;
    if (!target) throw new Error("Brik editor: no scene path");
    if (!target.endsWith(SCENE_EXTENSION)) target += SCENE_EXTENSION;
    await this.fs.writeFile(target, sceneToJson(serializeScene(this.world)));
    this.scenePath = target;
    this.history.markSaved();
    if (!(await this.fs.exists(this.settings.startScene))) {
      this.settings = { ...this.settings, startScene: target };
      await writeProject(this.fs, this.settings);
    }
    this.emit("scene");
    this.emit("assets");
    return target;
  }

  /** Changes and saves project settings. */
  async updateSettings(patch: Partial<ProjectSettings>): Promise<void> {
    this.settings = { ...this.settings, ...patch };
    await writeProject(this.fs, this.settings);
    this.emit("settings");
  }

  async setStartScene(path: string): Promise<void> {
    this.settings = { ...this.settings, startScene: path };
    await writeProject(this.fs, this.settings);
    this.emit("assets");
  }

  private resetAfterLoad(): void {
    this.history.clear();
    this.history.markSaved();
    this.selection = [];
    // center the view on the first camera, if there is one
    const cam = this.world.query([Camera2D, Transform2D]).first();
    if (cam >= 0) {
      const T = this.world.store(Transform2D);
      this.view = { x: T.position.x[cam], y: T.position.y[cam], zoom: this.view.zoom };
    }
    this.emit("selection");
    this.emit("world");
    this.emit("scene");
  }

  // ---------------------------------------------------------------- entity actions

  /** Creates a new entity and selects it. */
  createEntity(
    kind: EntityKind,
    opts: {
      name?: string;
      sprite?: SpriteRef;
      clip?: string;
      x?: number;
      y?: number;
      parentId?: string | null;
      extra?: SceneEntityData["components"];
    } = {},
  ): string {
    const id = newSceneId();
    const names: Record<EntityKind, string> = {
      empty: "Entity",
      sprite: "Sprite",
      camera: "Camera",
      rect: "Rektangel",
      circle: "Cirkel",
      polygon: "Polygon",
      line: "Linje",
      text: "Tekst",
      animated: "Animation",
      sound: "Lyd",
      tilemap: "Tilemap",
      particles: "Partikler",
      light: "Lys",
      "ui-canvas": "UI Canvas",
      "ui-image": "Billede",
      "ui-text": "UI-tekst",
      "ui-button": "Knap",
      "ui-slider": "Slider",
      "ui-toggle": "Toggle",
      "ui-input": "Tekstfelt",
      "ui-stack": "Kolonne",
    };
    const components: SceneEntityData["components"] = {
      Name: { value: opts.name ?? names[kind] },
      Transform2D: { position: { x: opts.x ?? 0, y: opts.y ?? 0 } },
    };
    if (kind === "sprite" || kind === "animated") components.Sprite = { sprite: opts.sprite ?? null };
    if (kind === "animated") components.SpriteAnimator = { clip: opts.clip ?? null };
    if (kind === "camera") components.Camera2D = { zoom: 3 };
    if (kind === "rect") components.Shape2D = { kind: "rect", size: { x: 32, y: 32 }, fill: { r: 0.36, g: 0.62, b: 0.95, a: 1 } };
    if (kind === "polygon") components.Shape2D = { kind: "polygon", fill: { r: 0.45, g: 0.8, b: 0.45, a: 1 } };
    if (kind === "line") {
      components.Shape2D = {
        kind: "line",
        points: [
          { x: -32, y: 0 },
          { x: 0, y: 16 },
          { x: 32, y: 0 },
        ],
        stroke: { r: 1, g: 1, b: 1, a: 1 },
        strokeWidth: 3,
      };
    }
    if (kind === "circle") components.Shape2D = { kind: "circle", size: { x: 32, y: 32 }, fill: { r: 0.95, g: 0.55, b: 0.3, a: 1 } };
    if (kind === "text") components.Text2D = { text: "Tekst", size: 16 };
    if (kind === "tilemap") {
      // start with the first sliced texture as tileset, if there is one
      const sheet = [...this.db.textures.values()].find((t) => t.meta.sprites.length > 1);
      const cell = sheet?.meta.sprites[0]?.rect;
      components.TileMap = {
        tileset: sheet?.meta.guid ?? null,
        tileSize: { x: cell?.w ?? 16, y: cell?.h ?? 16 },
      };
      components.TileMapCollider = {};
    }
    if (kind === "particles") components.ParticleEmitter2D = {};
    if (kind === "light") components.Light2D = {};
    if (kind === "ui-canvas") components.UICanvas = {};
    if (kind === "ui-image") components.UIImage = { color: { r: 0.2, g: 0.22, b: 0.28, a: 0.9 } };
    if (kind === "ui-text") components.UIText = { text: "Tekst" };
    if (kind === "ui-button") {
      components.UIRect = { size: { x: 180, y: 48 } };
      components.UIImage = { color: { r: 0.3, g: 0.55, b: 1, a: 1 } };
      components.UIButton = {};
    }
    if (kind === "ui-slider") {
      components.UIRect = { size: { x: 220, y: 24 } };
      components.UISlider = {};
    }
    if (kind === "ui-toggle") {
      components.UIRect = { size: { x: 220, y: 28 } };
      components.UIToggle = {};
    }
    if (kind === "ui-input") {
      components.UIRect = { size: { x: 260, y: 40 } };
      components.UIImage = { color: { r: 0.12, g: 0.13, b: 0.17, a: 1 } };
      components.UIText = { text: "Skriv her…", size: 18, align: "left", wrap: false };
      components.UITextInput = {};
    }
    if (kind === "ui-stack") {
      components.UIRect = { size: { x: 280, y: 220 } };
      components.UIImage = { color: { r: 0.2, g: 0.22, b: 0.28, a: 0.9 } };
      components.UIStack = { padding: 12, spacing: 10 };
    }
    // extra values go on top of the defaults field by field, so { Transform2D: { scale } } keeps x and y
    for (const [name, values] of Object.entries(opts.extra ?? {})) {
      const base = components[name];
      if (name === "Transform2D" && base && values && typeof values === "object") {
        const v = values as Record<string, unknown>;
        const pos = { ...(base.position as object), ...(v.position as object | undefined) };
        components[name] = { ...base, ...v, position: pos };
      } else components[name] = base ? { ...base, ...(values as object) } : values;
    }
    const data: SceneEntityData[] = [{ id, components }];
    let parentId = opts.parentId ?? null;
    // UI elements must live under a UICanvas: use the nearest one, or make one
    if (UI_KINDS.has(kind) && !this.underCanvas(parentId)) {
      const canvas = this.world.query([UICanvas]).first();
      if (canvas >= 0) parentId = this.idOf(canvas);
      else {
        const canvasId = newSceneId();
        data.unshift({ id: canvasId, components: { Name: { value: "UI Canvas" }, Transform2D: {}, UICanvas: {} } });
        components.Parent = { entity: canvasId };
        parentId = null;
      }
    }
    if (kind === "ui-button") {
      // a button gets a label child
      data.push({
        id: newSceneId(),
        components: {
          Name: { value: "Tekst" },
          Transform2D: {},
          Parent: { entity: id },
          UIRect: { anchorMin: { x: 0, y: 0 }, anchorMax: { x: 1, y: 1 }, size: { x: 0, y: 0 } },
          UIText: { text: "Knap", size: 20 },
        },
      });
    }
    if (kind === "ui-toggle") {
      // the label sits to the right of the box
      data.push({
        id: newSceneId(),
        components: {
          Name: { value: "Tekst" },
          Transform2D: {},
          Parent: { entity: id },
          UIRect: { anchorMin: { x: 0, y: 0 }, anchorMax: { x: 1, y: 1 }, position: { x: 18, y: 0 }, size: { x: -36, y: 0 } },
          UIText: { text: "Valg", size: 18, align: "left" },
        },
      });
    }
    this.execute(createEntities(this.world, `Opret ${components.Name.value}`, data, parentId));
    this.select([id]);
    return id;
  }

  private underCanvas(id: string | null): boolean {
    for (let e = id ? findBySceneId(this.world, id) : -1; e >= 0; e = parentOf(this.world, e)) {
      if (this.world.has(e, UICanvas)) return true;
    }
    return false;
  }

  deleteSelection(): void {
    if (this.selection.length === 0) return;
    this.execute(deleteEntities(this.world, this.selection));
    this.select([]);
  }

  duplicateSelection(): void {
    if (this.selection.length === 0) return;
    const { cmd, newIds } = duplicateEntities(this.world, this.selection);
    this.execute(cmd);
    this.select(newIds);
  }

  /**
   * Makes an animation clip from sprites (in order) and saves it next to their
   * texture as `<name>.anim.json`. Returns the clip.
   */
  async createAnimation(sprites: SpriteRef[], name: string, fps = 10): Promise<{ path: string; clip: AnimationClip }> {
    if (sprites.length === 0) throw new Error("Vælg mindst én sprite");
    const tex = this.db.byGuid(sprites[0].texture);
    const dir = tex ? tex.path.split("/").slice(0, -1).join("/") : "animations";
    const clean = name.replace(/[\\/:*?"<>|]/g, "_").trim() || "animation";
    let path = joinPath(dir, `${clean}.anim.json`);
    for (let i = 2; await this.fs.exists(path); i++) path = joinPath(dir, `${clean} ${i}.anim.json`);
    const clip: AnimationClip = {
      guid: newGuid(),
      name: clean,
      mode: "loop",
      frames: sprites.map((sprite) => ({ sprite, duration: 1 / fps })),
      events: [],
    };
    await this.db.saveClip(path, clip);
    this.emit("assets");
    return { path, clip };
  }

  /** Discards everything (used when closing the project). */
  dispose(): void {
    this.autosave.dispose();
    this.play.stop();
    clearWorld(this.world);
    this.listeners.clear();
  }
}
