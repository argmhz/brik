import {
  type App,
  type ComponentDef,
  type Entity,
  type Init,
  Name,
  type Phase,
  type Schema,
  type SpawnEntry,
  type System,
  Time,
  Transform2D,
  type Value,
  type World,
  componentView,
  defineComponent,
  destroyRecursive,
  isSystem,
  t,
} from "@brik/core";
import { Assets } from "@brik/assets";
import { Audio, type PlayOptions, type Sound } from "@brik/audio";
import {
  type Cancelable,
  type EventReader,
  type EventType,
  TimerFinished,
  type TweenOptions,
  Tweens,
  type Vec2,
} from "@brik/core";
import { Input } from "@brik/input";
import { CollisionEnter, CollisionExit, Physics, TriggerEnter, TriggerExit } from "@brik/physics";
import { AnimationEvent, AnimationFinished, Camera2D, CameraFX, Particles, UIClick, UILayout, UISubmit, UIValueChanged, playAnimation } from "@brik/render";
import { GlobalTransform2D, isActive, mat3, setActive } from "@brik/core";
import { findBySceneId, isEntityLink } from "@brik/core";
import { type SpawnPrefabOptions, spawnPrefab } from "./prefab";
import { SaveData } from "./save";
import { type LoadSceneOptions, Scenes } from "./scenes";

// ------------------------------------------------------------------ exposed fields

export type ExposeType =
  | "number"
  | "int"
  | "bool"
  | "string"
  | "vec2"
  | "color"
  | "sprite"
  | "entity"
  | "prefab"
  | "audio"
  | "clip";

export interface ExposeOptions {
  /** Inferred from the default value when left out. Needed for sprites and entities. */
  type?: ExposeType;
  label?: string;
  min?: number;
  max?: number;
  step?: number;
}

export interface ExposedField extends ExposeOptions {
  key: string;
  type: ExposeType;
  default: unknown;
}

const EXPOSED = Symbol("brik.exposed");

type Exposable = { [EXPOSED]?: Map<string, ExposeOptions> };

function markExposed(proto: object, key: string, opts: ExposeOptions): void {
  const ctor = proto.constructor as Exposable;
  // each class gets its own map, so subclasses don't add fields to their parent
  if (!Object.prototype.hasOwnProperty.call(ctor, EXPOSED)) {
    Object.defineProperty(ctor, EXPOSED, { value: new Map(), enumerable: false });
  }
  ctor[EXPOSED]!.set(key, opts);
}

// Works both as a legacy TypeScript decorator (proto, key) and a standard one (value, context).
type FieldContext = { kind: string; name: string | symbol; addInitializer(fn: (this: object) => void): void };
type Decorator = (target: unknown, key: string | FieldContext) => void;

function decorate(target: unknown, key: string | FieldContext, opts: ExposeOptions): void {
  if (typeof key === "string") {
    markExposed(target as object, key, opts);
  } else if (key && key.kind === "field") {
    const name = String(key.name);
    key.addInitializer(function (this: object) {
      markExposed(Object.getPrototypeOf(this), name, opts);
    });
  }
}

/**
 * Shows a Behaviour field in the editor inspector, where it can be edited per entity.
 *
 * ```ts
 * class Player extends Behaviour {
 *   @expose speed = 120;
 *   @expose({ type: "sprite" }) hurtSprite: SpriteRef | null = null;
 *   @expose({ type: "entity" }) target: Entity = -1; // -1 when nothing is picked
 * }
 * ```
 */
export function expose(opts: ExposeOptions): Decorator;
export function expose(target: unknown, key: string | FieldContext): void;
export function expose(a: unknown, key?: string | FieldContext): Decorator | void {
  if (key !== undefined) return decorate(a, key, {});
  const opts = a as ExposeOptions;
  return (target, k) => decorate(target, k, opts);
}

function inferType(value: unknown): ExposeType {
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "bool";
  if (typeof value === "string") return "string";
  if (value && typeof value === "object") {
    if ("r" in value && "g" in value && "b" in value) return "color";
    if ("x" in value && "y" in value) return "vec2";
    if ("texture" in value && "id" in value) return "sprite";
  }
  return "string";
}

/** The exposed fields of a Behaviour class, with their defaults, parent classes first. */
export function exposedFields(cls: BehaviourClass): ExposedField[] {
  const chain: Exposable[] = [];
  for (let c: unknown = cls; c && c !== Behaviour; c = Object.getPrototypeOf(c)) chain.unshift(c as Exposable);
  let sample: Record<string, unknown> = {};
  try {
    sample = new cls() as unknown as Record<string, unknown>;
  } catch {
    // a constructor that needs the world can't be sampled; defaults are then unknown
  }
  const out = new Map<string, ExposedField>();
  for (const c of chain) {
    const own = Object.prototype.hasOwnProperty.call(c, EXPOSED) ? c[EXPOSED]! : undefined;
    for (const [key, opts] of own ?? []) {
      const def = sample[key];
      out.set(key, { ...opts, key, type: opts.type ?? inferType(def), default: clone(def) });
    }
  }
  return [...out.values()];
}

function clone<T>(v: T): T {
  return v === undefined || v === null || typeof v !== "object" ? v : (JSON.parse(JSON.stringify(v)) as T);
}

// ------------------------------------------------------------------ Behaviour

/**
 * Base class for scripts attached to entities, in the style of Unity's MonoBehaviour.
 *
 * ```ts
 * import { Behaviour, expose } from "brik";
 *
 * export class Spinner extends Behaviour {
 *   @expose speed = 90; // degrees per second
 *   onUpdate(dt: number) {
 *     this.transform.rotation += (this.speed * Math.PI / 180) * dt;
 *   }
 * }
 * ```
 */
export abstract class Behaviour {
  /** Set by the engine before `onStart`. */
  world!: World;
  /** The entity this script is attached to. */
  entity!: Entity;
  private _views?: Map<ComponentDef, unknown>;

  /** Called once, before the first update (after the first onEnable). */
  onStart?(): void;
  /** Called when the entity is switched on: before onStart, and again after every setActive(true). */
  onEnable?(): void;
  /** Called when the entity is switched off (setActive(false), or a parent), and before onDestroy. */
  onDisable?(): void;
  /** Called every frame. */
  onUpdate?(dt: number): void;
  /** Called at a fixed rate (default 60 Hz). Use it for physics-like movement. */
  onFixedUpdate?(dt: number): void;
  /** Called when the script or its entity is removed, or play mode stops. */
  onDestroy?(): void;
  /** This entity's collider started touching `other`. */
  onCollisionEnter?(other: Entity): void;
  onCollisionExit?(other: Entity): void;
  /** `other` entered this trigger, or this collider entered the trigger `other`. */
  onTriggerEnter?(other: Entity): void;
  onTriggerExit?(other: Entity): void;
  /** The entity's animation reached a frame with an event, e.g. "footstep". */
  onAnimationEvent?(name: string): void;
  /** A "once" animation ended. */
  onAnimationFinished?(clip: string): void;
  /** The entity's Timer component ran out. */
  onTimer?(): void;
  /** This entity's UIButton was clicked. */
  onClick?(): void;
  /** This entity's UISlider (number), UIToggle (boolean) or UITextInput (string) changed. */
  onValueChanged?(value: number | boolean | string): void;
  /** Enter was pressed in this entity's UITextInput. */
  onSubmit?(text: string): void;

  get time(): Time {
    return this.world.resource(Time);
  }

  get input(): Input {
    return this.world.resource(Input);
  }

  get assets(): Assets {
    return this.world.resource(Assets);
  }

  get physics(): Physics {
    return this.world.resource(Physics);
  }

  get audio(): Audio {
    return this.world.resource(Audio);
  }

  /** Plays a sound by name or guid. */
  playSound(name: string, opts?: PlayOptions): Sound {
    return this.audio.play(name, opts);
  }

  /** Switches this entity's animation (adds a SpriteAnimator if needed). */
  playAnimation(clip: string, opts?: { restart?: boolean; speed?: number }): void {
    playAnimation(this.world, this.entity, clip, opts);
  }

  /** Animates a number on one of this entity's components, e.g. `tween(Transform2D, "position.y", 100, 0.5)`. */
  tween(def: ComponentDef, property: string, to: number, duration: number, opts?: TweenOptions): Cancelable {
    return this.world.resource(Tweens).to(this.entity, def, property, to, duration, opts);
  }

  /** Calls `fn` after `seconds`, unless this entity is destroyed first. */
  after(seconds: number, fn: () => void): Cancelable {
    return this.world.resource(Tweens).after(seconds, fn, this.entity);
  }

  /** Calls `fn` every `seconds` while this entity lives. */
  every(seconds: number, fn: () => void): Cancelable {
    return this.world.resource(Tweens).every(seconds, fn, this.entity);
  }

  /** Creates a copy of a prefab (by name or guid) right away. Returns its root. */
  spawnPrefab(prefab: string, opts?: SpawnPrefabOptions): Entity {
    return spawnPrefab(this.world, prefab, opts);
  }

  /** Emits particles from an entity's ParticleEmitter2D right away (default: this entity). */
  emitParticles(count: number, e: Entity = this.entity): void {
    this.world.resource(Particles).emit(e, count);
  }

  /**
   * The mouse position in the world, seen through the main (lowest priority)
   * camera. Useful for aiming. Uses the screen size from the last rendered frame.
   */
  pointerWorld(): Vec2 {
    const world = this.world;
    const p = this.input.pointer;
    const layout = world.tryResource(UILayout);
    const C = world.store(Camera2D);
    const cam = world
      .query([Camera2D, GlobalTransform2D])
      .toArray()
      .sort((a, b) => C.priority[a] - C.priority[b])[0];
    if (cam === undefined || !layout?.screenW) return { x: p.x, y: p.y };
    const g = world.store(GlobalTransform2D).matrix;
    const zoom = C.zoom[cam];
    const local = { x: (p.x - layout.screenW / 2) / zoom, y: -(p.y - layout.screenH / 2) / zoom };
    return mat3.transformPoint({ a: g.a[cam], b: g.b[cam], c: g.c[cam], d: g.d[cam], tx: g.tx[cam], ty: g.ty[cam] }, local);
  }

  /**
   * Switches to another scene at the start of the next frame, e.g. `this.loadScene("level2")`.
   * `fade` fades the screen out and in around the switch, and `data` is carried into the next
   * scene (read it there with `this.sceneData`): `this.loadScene("level2", { fade: 0.4, data: { score } })`.
   */
  loadScene(name: string, options?: LoadSceneOptions): void {
    const scenes = this.world.tryResource(Scenes);
    if (!scenes) throw new Error("Brik: scene switching is not available here");
    scenes.load(name, options);
  }

  /**
   * Saved game data that survives closing the game: `this.save.set("level", 3)`,
   * `this.save.get("level", 1)`. See SaveData.
   */
  get save(): SaveData {
    return this.world.tryResource(SaveData) ?? this.world.insertResource(new SaveData("brik-save:game"));
  }

  /** Values carried between scenes with `loadScene(name, { data })`. Also writable: `this.sceneData.lives = 3`. */
  get sceneData(): Record<string, unknown> {
    const scenes = this.world.tryResource(Scenes);
    if (!scenes) throw new Error("Brik: scene switching is not available here");
    return scenes.data;
  }

  /** Shakes the screen: `strength` in pixels at most, fading out over `duration` seconds. */
  shakeCamera(strength = 8, duration = 0.3): void {
    this.world.resource(CameraFX).shake(strength, duration);
  }

  /** A quick zoom-in that settles back, e.g. `this.punchCamera(0.08, 0.2)`. */
  punchCamera(amount = 0.1, duration = 0.2): void {
    this.world.resource(CameraFX).punch(amount, duration);
  }

  /** Freezes the game for a moment (real seconds) to give a hit weight, e.g. `this.hitStop(0.06)`. */
  hitStop(duration = 0.06): void {
    this.world.resource(CameraFX).hitStop(duration, this.world);
  }

  /** Slow motion at `scale` (0.3 is slow) for `duration` real seconds, then back to normal speed. */
  slowMotion(scale: number, duration: number): void {
    this.world.resource(CameraFX).slowMotion(scale, duration, this.world);
  }

  /** Lets this character fall through the one-way platform it stands on (for `seconds`, default 0.25). */
  dropThrough(seconds?: number): void {
    this.physics.dropThrough(this.entity, seconds);
  }

  /** Moves this entity's CharacterController2D, sliding along walls. Returns the actual movement. */
  moveCharacter(dx: number, dy: number): Vec2 {
    return this.physics.moveCharacter(this.entity, dx, dy);
  }

  /** The entity's Transform2D, as a live object. */
  get transform(): Value<(typeof Transform2D)["schema"]> {
    return this.get(Transform2D);
  }

  /** A live view of one of the entity's components. Throws if it doesn't have it. */
  get<S extends Schema>(def: ComponentDef<S>): Value<S> {
    if (!this.world.has(this.entity, def)) throw new Error(`Brik: ${this.constructor.name}: entity has no ${def.name}`);
    this._views ??= new Map();
    let v = this._views.get(def) as Value<S> | undefined;
    if (!v) {
      v = componentView(this.world, def, this.entity);
      this._views.set(def, v);
    }
    return v;
  }

  has(def: ComponentDef): boolean {
    return this.world.has(this.entity, def);
  }

  add<S extends Schema>(def: ComponentDef<S>, init?: Init<S>): Value<S> {
    this.world.add(this.entity, def, init);
    return this.get(def);
  }

  remove(def: ComponentDef): void {
    this.world.remove(this.entity, def);
  }

  /** Spawns an entity at the end of the current system. */
  spawn(...entries: SpawnEntry[]): Entity {
    return this.world.commands.spawn(...entries);
  }

  /** Destroys an entity (default: this one) and its children at the end of the current system. */
  destroy(e: Entity = this.entity): void {
    this.world.commands.run((w) => {
      if (w.isAlive(e)) destroyRecursive(w, e);
    });
  }

  /** The running instance of a Behaviour class on an entity (default: this one), e.g. to call its methods. */
  behaviourOf<T extends Behaviour>(cls: abstract new () => T, e: Entity = this.entity): T | undefined {
    return this.world.resource(BehaviourRuntime).find(e, cls);
  }

  /** Turns an entity (default: this one) and its children on or off. Inactive entities are not drawn; their scripts and colliders keep running. */
  setActive(on: boolean, e: Entity = this.entity): void {
    setActive(this.world, e, on);
  }

  /** The first entity with this name, or -1. */
  find(name: string): Entity {
    const names = this.world.store(Name).value;
    for (const e of this.world.query([Name])) if (names[e] === name) return e;
    return -1;
  }

  log(...args: unknown[]): void {
    console.log(`[${this.constructor.name}]`, ...args);
  }
}

export type BehaviourClass = new () => Behaviour;

export function isBehaviourClass(value: unknown): value is BehaviourClass {
  return typeof value === "function" && value.prototype instanceof Behaviour;
}

// ------------------------------------------------------------------ Scripts component

export interface ScriptEntry {
  /** Script id: `"<file path>#<export name>"`, e.g. `"scripts/player.ts#Player"`. */
  script: string;
  /** Values for exposed fields that differ per entity. */
  props: Record<string, unknown>;
}

/** The scripts attached to an entity. */
export const Scripts = defineComponent("Scripts", { list: t.ref<ScriptEntry[]>(() => []) });

export function scriptDisplayName(id: string): string {
  return id.split("#").pop() ?? id;
}

// ------------------------------------------------------------------ registry

export interface ScriptSystem {
  id: string;
  phase: Phase;
  system: System;
}

/**
 * Everything that compiled scripts provide: Behaviour classes and systems.
 * Available as a resource. Loading a new set of modules replaces the old one
 * (hot reload), and running Behaviours switch to the new classes.
 */
export class ScriptRegistry {
  behaviours = new Map<string, BehaviourClass>();
  systems: ScriptSystem[] = [];
  /** Bumped on every load. */
  version = 0;

  /** `modules` maps a file path to that module's exports. */
  load(modules: Record<string, Record<string, unknown>>): void {
    const behaviours = new Map<string, BehaviourClass>();
    const systems: ScriptSystem[] = [];
    for (const [path, exports] of Object.entries(modules)) {
      for (const [name, value] of Object.entries(exports)) {
        const id = `${path}#${name === "default" && typeof value === "function" ? value.name || "default" : name}`;
        if (isBehaviourClass(value)) behaviours.set(id, value);
        else if (isSystem(value)) systems.push({ id, phase: value.phase ?? "update", system: value });
      }
    }
    this.behaviours = behaviours;
    this.systems = systems;
    this.version++;
  }
}

// ------------------------------------------------------------------ runtime

interface Slot {
  /** Entity ref when created, so a recycled entity index gets a fresh instance. */
  ref: number;
  id: string;
  cls: BehaviourClass;
  inst: Behaviour;
  applied: Record<string, unknown>;
  started: boolean;
  /** onEnable has run and onDisable hasn't since. */
  enabled: boolean;
}

/** Creates, updates and destroys Behaviour instances. Available as a resource. */
export class BehaviourRuntime {
  private slots = new Map<Entity, Slot[]>();
  private seenVersion = -1;

  constructor(private readonly registry: ScriptRegistry) {}

  /** Number of live Behaviour instances. */
  get count(): number {
    let n = 0;
    for (const s of this.slots.values()) n += s.length;
    return n;
  }

  /** The running instance of a script on an entity (for the inspector and tests). */
  instance(e: Entity, index: number): Behaviour | undefined {
    return this.slots.get(e)?.[index]?.inst;
  }

  /** Matches instances to the Scripts components. Called before every update. */
  sync(world: World): void {
    const reloaded = this.seenVersion !== this.registry.version;
    this.seenVersion = this.registry.version;
    const S = world.store(Scripts);
    const alive = new Set<Entity>();

    for (const e of world.query([Scripts])) {
      alive.add(e);
      const list = S.list[e];
      const slots = this.slots.get(e) ?? [];
      for (let i = 0; i < list.length; i++) {
        const entry = list[i];
        const cls = this.registry.behaviours.get(entry.script);
        let slot = slots[i];
        if (slot && (slot.id !== entry.script || slot.ref !== world.ref(e))) {
          this.destroySlot(slot);
          slot = undefined as unknown as Slot;
        }
        if (!cls) {
          if (slot) this.destroySlot(slot);
          slots[i] = undefined as unknown as Slot;
          continue;
        }
        if (!slot) {
          slot = this.create(world, e, entry, cls);
        } else if (reloaded && slot.cls !== cls) {
          slot = this.swapClass(slot, cls);
        }
        if (slot.applied !== entry.props) this.applyProps(slot, entry.props);
        slots[i] = slot;
      }
      for (let i = list.length; i < slots.length; i++) if (slots[i]) this.destroySlot(slots[i]);
      slots.length = list.length;
      this.slots.set(e, slots);
    }

    for (const [e, slots] of this.slots) {
      if (alive.has(e)) continue;
      for (const s of slots) if (s) this.destroySlot(s);
      this.slots.delete(e);
    }
  }

  update(dt: number): void {
    this.each((s) => {
      // scripts on inactive entities sleep; onStart waits until the entity is first on
      if (!isActive(s.inst.world, s.inst.entity)) {
        if (s.enabled) {
          s.enabled = false;
          if (s.inst.onDisable) call(s, "onDisable");
        }
        return;
      }
      if (!s.enabled) {
        s.enabled = true;
        if (s.inst.onEnable) call(s, "onEnable");
      }
      if (!s.started) {
        s.started = true;
        if (s.inst.onStart) call(s, "onStart");
      }
      if (s.inst.onUpdate) call(s, "onUpdate", dt);
    });
  }

  fixedUpdate(dt: number): void {
    this.each((s) => {
      if (s.started && s.inst.onFixedUpdate && isActive(s.inst.world, s.inst.entity)) call(s, "onFixedUpdate", dt);
    });
  }

  /** The first instance of `cls` (or a subclass) on an entity. */
  find<T extends Behaviour>(e: Entity, cls: abstract new () => T): T | undefined {
    for (const s of this.slots.get(e) ?? []) if (s?.inst instanceof cls) return s.inst as T;
    return undefined;
  }

  /** Calls a hook on every started Behaviour of an entity. */
  dispatch(e: Entity, method: HookName, arg: unknown): void {
    const slots = this.slots.get(e);
    const world = slots?.find(Boolean)?.inst.world;
    if (!slots || !world || !isActive(world, e)) return;
    for (const s of slots) if (s?.started && s.inst[method]) call(s, method, arg);
  }

  /** Calls onDestroy on everything and forgets all instances. */
  destroyAll(): void {
    this.each((s) => this.destroySlot(s));
    this.slots.clear();
  }

  private each(fn: (s: Slot) => void): void {
    for (const slots of [...this.slots.values()]) for (const s of slots) if (s) fn(s);
  }

  private create(world: World, e: Entity, entry: ScriptEntry, cls: BehaviourClass): Slot {
    const inst = new cls();
    inst.world = world;
    inst.entity = e;
    const slot: Slot = { ref: world.ref(e), id: entry.script, cls, inst, applied: {}, started: false, enabled: false };
    this.applyProps(slot, entry.props);
    return slot;
  }

  /** Hot reload: a new instance of the new class that keeps the old instance's field values. */
  private swapClass(old: Slot, cls: BehaviourClass): Slot {
    const inst = new cls();
    for (const [k, v] of Object.entries(old.inst)) {
      if (k !== "_views") (inst as unknown as Record<string, unknown>)[k] = v;
    }
    return { ...old, cls, inst };
  }

  private applyProps(slot: Slot, props: Record<string, unknown>): void {
    const target = slot.inst as unknown as Record<string, unknown>;
    for (const [k, v] of Object.entries(props)) {
      // only push values that changed since last time, so runtime state isn't reset every frame
      if (JSON.stringify(slot.applied[k]) === JSON.stringify(v)) continue;
      // entity fields are saved as scene ids and become entities here (-1 if not found)
      target[k] = isEntityLink(v) ? (v.$entity ? findBySceneId(slot.inst.world, v.$entity) : -1) : clone(v);
    }
    slot.applied = props;
  }

  private destroySlot(s: Slot): void {
    if (s.enabled && s.inst.onDisable) call(s, "onDisable");
    s.enabled = false;
    if (s.started && s.inst.onDestroy) call(s, "onDestroy");
    s.started = false;
  }
}

type HookName =
  | "onStart"
  | "onEnable"
  | "onDisable"
  | "onUpdate"
  | "onFixedUpdate"
  | "onDestroy"
  | "onCollisionEnter"
  | "onCollisionExit"
  | "onTriggerEnter"
  | "onTriggerExit"
  | "onAnimationEvent"
  | "onAnimationFinished"
  | "onTimer"
  | "onClick"
  | "onValueChanged"
  | "onSubmit";

function call(s: Slot, method: HookName, arg?: unknown): void {
  try {
    (s.inst[method] as (arg?: unknown) => void).call(s.inst, arg);
  } catch (err) {
    console.error(`${scriptDisplayName(s.id)}.${method}:`, err);
  }
}

/** Runs Behaviours and script systems. Used by the editor's play mode and by exported games. */
export function ScriptsPlugin(registry: ScriptRegistry) {
  return {
    name: "brik:scripts",
    build(app: App) {
      const world = app.world;
      if (!world.hasResource(ScriptRegistry)) world.insertResource(registry);
      const runtime = world.insertResource(new BehaviourRuntime(registry));
      const reader = <T>(type: EventType<T>): EventReader<T> => world.events(type).reader();
      const pairs: [EventReader<{ a: Entity; b: Entity }>, HookName][] = [
        [reader(CollisionEnter), "onCollisionEnter"],
        [reader(CollisionExit), "onCollisionExit"],
        [reader(TriggerEnter), "onTriggerEnter"],
        [reader(TriggerExit), "onTriggerExit"],
      ];
      const anim = reader(AnimationEvent);
      const animDone = reader(AnimationFinished);
      const timers = reader(TimerFinished);
      const clicks = reader(UIClick);
      const changes = reader(UIValueChanged);
      const submits = reader(UISubmit);
      const dispatchEvents = () => {
        for (const [r, hook] of pairs) {
          for (const { a, b } of r.read()) {
            runtime.dispatch(a, hook, b);
            runtime.dispatch(b, hook, a);
          }
        }
        for (const ev of anim.read()) runtime.dispatch(ev.entity, "onAnimationEvent", ev.name);
        for (const ev of animDone.read()) {
          const clip = world.resource(Assets).clips.get(ev.clip);
          runtime.dispatch(ev.entity, "onAnimationFinished", clip?.name ?? ev.clip);
        }
        for (const ev of timers.read()) runtime.dispatch(ev.entity, "onTimer", undefined);
        for (const ev of clicks.read()) runtime.dispatch(ev.entity, "onClick", undefined);
        for (const ev of changes.read()) runtime.dispatch(ev.entity, "onValueChanged", ev.value);
        for (const ev of submits.read()) runtime.dispatch(ev.entity, "onSubmit", ev.value);
      };
      app.addSystem("fixedUpdate", {
        name: "behaviours.fixedUpdate",
        run: (w) => {
          runtime.sync(w);
          runtime.fixedUpdate(w.resource(Time).dt);
        },
      });
      app.addSystem("update", {
        name: "behaviours.update",
        run: (w) => {
          runtime.sync(w);
          dispatchEvents();
          runtime.update(w.resource(Time).dt);
        },
      });
      for (const s of registry.systems) app.addSystem(s.phase, s.system);
    },
  };
}
