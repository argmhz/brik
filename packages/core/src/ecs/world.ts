import { Archetype, type Mask, maskFromIds, maskHas, maskKey } from "./archetype";
import { Commands, type SpawnEntry, splitEntry } from "./commands";
import type { ComponentDef } from "./component";
import {
  type Entity,
  type EntityRef,
  GENERATION_MASK,
  MAX_ENTITIES,
  NULL_REF,
  packRef,
  refGeneration,
  refIndex,
} from "./entity";
import { EventChannel, type EventType } from "./events";
import { Query, type QueryDesc } from "./query";
import {
  type Init,
  type Schema,
  type Store,
  type Value,
  allocStore,
  initEntity,
  readEntity,
  writeEntity,
} from "./schema";

export type ResourceKey<T> = abstract new (...args: any[]) => T;

export interface WorldOptions {
  /** Initial entity capacity. Grows automatically. */
  initialCapacity?: number;
}

export class World {
  private capacity: number;
  private generations: Uint16Array;
  private aliveFlags: Uint8Array;
  private entityRow: Int32Array;
  private entityArch: (Archetype | undefined)[] = [];
  private freeList: Entity[] = [];
  private freeHead = 0;
  private nextIndex = 0;
  private aliveCount = 0;

  private stores: any[] = [];
  private componentDefs: (ComponentDef | undefined)[] = [];
  private archetypes: Archetype[] = [];
  private archetypeByKey = new Map<string, Archetype>();
  private readonly emptyArchetype: Archetype;
  private queries = new Map<string, Query>();
  private queryList: Query[] = [];
  private resources = new Map<unknown, unknown>();
  private channels = new Map<EventType<any>, EventChannel<any>>();
  /** Per component id: the change tick of each entity. Allocated when a query first asks for changes. */
  private changeTicks: (Uint32Array | undefined)[] = [];
  private changeTick = 1;

  /** Deferred structural changes. Flushed after every system. */
  readonly commands: Commands;

  constructor(options: WorldOptions = {}) {
    this.capacity = Math.max(16, options.initialCapacity ?? 1024);
    this.generations = new Uint16Array(this.capacity);
    this.aliveFlags = new Uint8Array(this.capacity);
    this.entityRow = new Int32Array(this.capacity);
    this.emptyArchetype = this.getArchetype([]);
    this.commands = new Commands(this);
  }

  // ---------------------------------------------------------------- entities

  /**
   * Creates an entity. Optionally adds components right away:
   * `world.spawn(Transform2D, [Sprite, { sprite }])`.
   */
  spawn(...entries: SpawnEntry[]): Entity {
    let e: Entity;
    if (this.freeHead < this.freeList.length) {
      e = this.freeList[this.freeHead++];
      if (this.freeHead > 1024 && this.freeHead * 2 > this.freeList.length) {
        this.freeList = this.freeList.slice(this.freeHead);
        this.freeHead = 0;
      }
    } else {
      if (this.nextIndex >= MAX_ENTITIES) throw new Error("Brik: entity limit reached");
      e = this.nextIndex++;
      if (e >= this.capacity) this.grow(this.capacity * 2);
    }
    this.aliveFlags[e] = 1;
    this.aliveCount++;
    this.emptyArchetype.entities.push(e);
    this.entityArch[e] = this.emptyArchetype;
    this.entityRow[e] = this.emptyArchetype.entities.length - 1;
    for (const entry of entries) {
      const [def, init] = splitEntry(entry);
      this.add(e, def, init);
    }
    return e;
  }

  /** Destroys an entity and all its components. Does nothing if it is already dead. */
  destroy(e: Entity): void {
    if (!this.isAlive(e)) return;
    const arch = this.entityArch[e]!;
    for (const id of arch.componentIds) {
      this.componentDefs[id]!.options.onRemove?.(this, e);
    }
    // onRemove hooks may have changed the archetype
    this.moveEntity(e, this.entityArch[e]!, undefined);
    this.aliveFlags[e] = 0;
    this.generations[e] = (this.generations[e] + 1) & GENERATION_MASK;
    this.aliveCount--;
    this.freeList.push(e);
  }

  isAlive(e: Entity): boolean {
    return e >= 0 && e < this.nextIndex && this.aliveFlags[e] === 1;
  }

  get entityCount(): number {
    return this.aliveCount;
  }

  /** A reference that can be stored safely and checked later with `deref`. */
  ref(e: Entity): EntityRef {
    return this.isAlive(e) ? packRef(e, this.generations[e]) : NULL_REF;
  }

  /** Resolves a reference to an entity, or -1 if it has been destroyed. */
  deref(ref: EntityRef): Entity {
    if (ref === NULL_REF) return -1;
    const e = refIndex(ref);
    return this.isAlive(e) && this.generations[e] === refGeneration(ref) ? e : -1;
  }

  /** Every live entity. */
  *entities(): IterableIterator<Entity> {
    for (let e = 0; e < this.nextIndex; e++) if (this.aliveFlags[e]) yield e;
  }

  // -------------------------------------------------------------- components

  /** Adds a component (and its required components). If present, `init` is applied to it. */
  add<S extends Schema>(e: Entity, def: ComponentDef<S>, init?: Init<S>): this {
    this.assertAlive(e);
    if (this.has(e, def)) {
      if (init) {
        writeEntity(def.schema, this.store(def), e, init);
        this.markChanged(e, def);
      }
      return this;
    }
    for (const req of def.options.requires ?? []) {
      if (!this.has(e, req)) this.add(e, req);
    }
    const store = this.store(def);
    initEntity(def.schema, store, e, init as Record<string, unknown> | undefined);
    const from = this.entityArch[e]!;
    let to = from.addEdges.get(def.id);
    if (!to) {
      to = this.getArchetype([...from.componentIds, def.id]);
      from.addEdges.set(def.id, to);
      to.removeEdges.set(def.id, from);
    }
    this.markChanged(e, def);
    this.moveEntity(e, from, to);
    def.options.onAdd?.(this, e);
    return this;
  }

  remove(e: Entity, def: ComponentDef): this {
    if (!this.has(e, def)) return this;
    def.options.onRemove?.(this, e);
    if (!this.has(e, def)) return this;
    const from = this.entityArch[e]!;
    let to = from.removeEdges.get(def.id);
    if (!to) {
      to = this.getArchetype(from.componentIds.filter((id) => id !== def.id));
      from.removeEdges.set(def.id, to);
      to.addEdges.set(def.id, from);
    }
    this.moveEntity(e, from, to);
    return this;
  }

  has(e: Entity, def: ComponentDef): boolean {
    const arch = this.entityArch[e];
    return arch !== undefined && this.aliveFlags[e] === 1 && maskHas(arch.mask, def.id);
  }

  /**
   * The storage for a component: `world.store(Transform2D).position.x[e]`.
   *
   * Store objects are stable, but the arrays inside are replaced when the world
   * grows. Don't keep references to the inner arrays across frames.
   */
  store<S extends Schema>(def: ComponentDef<S>): Store<S> {
    let s = this.stores[def.id];
    if (!s) {
      s = allocStore(def.schema, this.capacity);
      this.stores[def.id] = s;
      this.componentDefs[def.id] = def;
    }
    return s;
  }

  /** Reads a component as a plain object (a copy). */
  read<S extends Schema>(e: Entity, def: ComponentDef<S>): Value<S> {
    if (!this.has(e, def)) throw new Error(`Brik: entity ${e} has no ${def.name}`);
    return readEntity(def.schema, this.store(def), e) as Value<S>;
  }

  /** Writes some fields of a component. */
  write<S extends Schema>(e: Entity, def: ComponentDef<S>, values: Init<S>): void {
    if (!this.has(e, def)) throw new Error(`Brik: entity ${e} has no ${def.name}`);
    writeEntity(def.schema, this.store(def), e, values as Record<string, unknown>);
    this.markChanged(e, def);
  }

  // ----------------------------------------------------------------- changes

  /**
   * Marks a component as changed, so `query.changed(def)` reports the entity.
   * `world.write`, `world.add` and component views (`this.get(C)` in scripts)
   * do this for you. Call it yourself after writing to `world.store(def)` directly.
   */
  markChanged(e: Entity, def: ComponentDef): void {
    const ticks = this.changeTicks[def.id];
    if (ticks !== undefined) ticks[e] = this.changeTick;
  }

  /** @internal Change ticks for a component; `fresh` is true when tracking just started. */
  _changeTicks(def: ComponentDef): { ticks: Uint32Array; fresh: boolean } {
    let ticks = this.changeTicks[def.id];
    const fresh = ticks === undefined;
    if (!ticks) ticks = this.changeTicks[def.id] = new Uint32Array(this.capacity);
    return { ticks, fresh };
  }

  /** @internal Ends a change-reading pass: returns the tick read up to and starts a new one. */
  _nextChangeTick(): number {
    return this.changeTick++;
  }

  /** The components an entity has. */
  componentsOf(e: Entity): ComponentDef[] {
    const arch = this.entityArch[e];
    if (!arch || !this.isAlive(e)) return [];
    return arch.componentIds.map((id) => this.componentDefs[id]!);
  }

  // ----------------------------------------------------------------- queries

  /** `world.query([A, B])` or `world.query({ all: [A], none: [B] })`. */
  query(desc: ComponentDef[] | QueryDesc): Query {
    const d: QueryDesc = Array.isArray(desc) ? { all: desc } : desc;
    for (const c of [...(d.all ?? []), ...(d.none ?? []), ...(d.any ?? [])]) this.store(c);
    const all = maskFromIds((d.all ?? []).map((c) => c.id));
    const none = maskFromIds((d.none ?? []).map((c) => c.id));
    const any = maskFromIds((d.any ?? []).map((c) => c.id));
    const key = `${maskKey(all)}|${maskKey(none)}|${maskKey(any)}`;
    let q = this.queries.get(key);
    if (!q) {
      q = new Query(this, all, none, any);
      for (const arch of this.archetypes) q._tryAdd(arch);
      this.queries.set(key, q);
      this.queryList.push(q);
    }
    return q;
  }

  // --------------------------------------------------------------- resources

  /** Stores a singleton, keyed by its class: `world.insertResource(new Time())`. */
  insertResource<T extends object>(value: T, key: ResourceKey<T> = value.constructor as ResourceKey<T>): T {
    this.resources.set(key, value);
    return value;
  }

  resource<T>(key: ResourceKey<T>): T {
    const r = this.resources.get(key);
    if (r === undefined) throw new Error(`Brik: missing resource ${key.name}`);
    return r as T;
  }

  tryResource<T>(key: ResourceKey<T>): T | undefined {
    return this.resources.get(key) as T | undefined;
  }

  hasResource(key: ResourceKey<unknown>): boolean {
    return this.resources.has(key);
  }

  // ------------------------------------------------------------------ events

  events<T>(type: EventType<T>): EventChannel<T> {
    let ch = this.channels.get(type);
    if (!ch) {
      ch = new EventChannel<T>();
      this.channels.set(type, ch);
    }
    return ch;
  }

  emit<T>(type: EventType<T>, data: T): void {
    this.events(type).send(data);
  }

  /** Swaps event buffers. Called once per frame by the app. */
  updateEvents(): void {
    for (const ch of this.channels.values()) ch.update();
  }

  // ---------------------------------------------------------------- internal

  private assertAlive(e: Entity): void {
    if (!this.isAlive(e)) throw new Error(`Brik: entity ${e} is not alive`);
  }

  private getArchetype(ids: number[]): Archetype {
    const sorted = [...new Set(ids)].sort((a, b) => a - b);
    const mask: Mask = maskFromIds(sorted);
    const key = maskKey(mask);
    let arch = this.archetypeByKey.get(key);
    if (!arch) {
      arch = new Archetype(this.archetypes.length, mask, sorted);
      this.archetypes.push(arch);
      this.archetypeByKey.set(key, arch);
      for (const q of this.queryList) q._tryAdd(arch);
    }
    return arch;
  }

  private moveEntity(e: Entity, from: Archetype, to: Archetype | undefined): void {
    const ents = from.entities;
    const row = this.entityRow[e];
    const last = ents.pop()!;
    if (last !== e) {
      ents[row] = last;
      this.entityRow[last] = row;
    }
    if (to) {
      to.entities.push(e);
      this.entityRow[e] = to.entities.length - 1;
    } else {
      this.entityRow[e] = -1;
    }
    this.entityArch[e] = to;

    for (const q of this.queryList) {
      if (!q.isTracking) continue;
      const was = q._hasArchetype(from);
      const now = q._hasArchetype(to);
      if (was !== now) q._record(e, now);
    }
  }

  private grow(capacity: number): void {
    const gen = new Uint16Array(capacity);
    gen.set(this.generations);
    this.generations = gen;
    const alive = new Uint8Array(capacity);
    alive.set(this.aliveFlags);
    this.aliveFlags = alive;
    const rows = new Int32Array(capacity);
    rows.set(this.entityRow);
    this.entityRow = rows;
    for (let id = 0; id < this.stores.length; id++) {
      const s = this.stores[id];
      if (s) allocStore(this.componentDefs[id]!.schema, capacity, s);
    }
    for (let id = 0; id < this.changeTicks.length; id++) {
      const old = this.changeTicks[id];
      if (!old) continue;
      const next = new Uint32Array(capacity);
      next.set(old);
      this.changeTicks[id] = next;
    }
    this.capacity = capacity;
  }
}
