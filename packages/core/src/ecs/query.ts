import { type Archetype, type Mask, maskContains, maskIntersects } from "./archetype";
import type { ComponentDef } from "./component";
import type { Entity } from "./entity";

export interface QueryDesc {
  /** Entities must have all of these. */
  all?: ComponentDef[];
  /** Entities must have none of these. */
  none?: ComponentDef[];
  /** Entities must have at least one of these (if given). */
  any?: ComponentDef[];
}

/**
 * A live set of entities matching a component filter. Queries are cached by the
 * world, so calling `world.query(...)` with the same filter returns the same object.
 *
 * Iteration runs backwards inside each archetype, which makes it safe to remove
 * components from, or destroy, the *current* entity while iterating. For other
 * structural changes, use `world.commands`.
 */
export class Query implements Iterable<Entity> {
  readonly archetypes: Archetype[] = [];
  private readonly archetypeSet = new Set<Archetype>();
  private tracking = false;
  private addedBuf: Entity[] = [];
  private removedBuf: Entity[] = [];

  constructor(
    readonly all: Mask,
    readonly none: Mask,
    readonly any: Mask,
  ) {}

  /** @internal */
  _matches(arch: Archetype): boolean {
    if (!maskContains(arch.mask, this.all)) return false;
    if (maskIntersects(arch.mask, this.none)) return false;
    if (this.any.length > 0 && !maskIntersects(arch.mask, this.any)) return false;
    return true;
  }

  /** @internal */
  _tryAdd(arch: Archetype): void {
    if (this._matches(arch)) {
      this.archetypes.push(arch);
      this.archetypeSet.add(arch);
    }
  }

  /** @internal */
  _hasArchetype(arch: Archetype | undefined): boolean {
    return arch !== undefined && this.archetypeSet.has(arch);
  }

  get isTracking(): boolean {
    return this.tracking;
  }

  /** @internal Called by the world when an entity enters or leaves this query. */
  _record(e: Entity, entered: boolean): void {
    (entered ? this.addedBuf : this.removedBuf).push(e);
  }

  /**
   * Entities that started matching since the last call. The first call turns
   * tracking on and returns the current matches.
   */
  added(): Entity[] {
    if (!this.tracking) {
      this.tracking = true;
      return this.toArray();
    }
    const out = this.addedBuf;
    this.addedBuf = [];
    return out;
  }

  /** Entities that stopped matching (or were destroyed) since the last call. */
  removed(): Entity[] {
    this.tracking = true;
    const out = this.removedBuf;
    this.removedBuf = [];
    return out;
  }

  count(): number {
    let n = 0;
    for (const a of this.archetypes) n += a.entities.length;
    return n;
  }

  isEmpty(): boolean {
    return this.count() === 0;
  }

  /** The first matching entity, or -1. Handy for singletons like the player. */
  first(): Entity {
    for (const a of this.archetypes) if (a.entities.length > 0) return a.entities[0];
    return -1;
  }

  toArray(): Entity[] {
    const out: Entity[] = [];
    for (const a of this.archetypes) out.push(...a.entities);
    return out;
  }

  forEach(fn: (e: Entity) => void): void {
    const archs = this.archetypes;
    for (let ai = 0; ai < archs.length; ai++) {
      const ents = archs[ai].entities;
      for (let row = ents.length - 1; row >= 0; row--) {
        if (row >= ents.length) continue;
        fn(ents[row]);
      }
    }
  }

  [Symbol.iterator](): Iterator<Entity> {
    const archs = this.archetypes;
    let ai = 0;
    let row = Number.POSITIVE_INFINITY;
    const result = { value: 0, done: false } as IteratorResult<Entity>;
    return {
      next(): IteratorResult<Entity> {
        while (ai < archs.length) {
          const ents = archs[ai].entities;
          if (row >= ents.length) row = ents.length - 1;
          if (row >= 0) {
            result.value = ents[row--];
            return result;
          }
          ai++;
          row = Number.POSITIVE_INFINITY;
        }
        return { value: undefined, done: true };
      },
    };
  }
}
