/**
 * An entity is an index into the component stores. It is what queries yield and
 * what you use to index store arrays: `store.position.x[e]`.
 *
 * Indices are recycled after an entity is destroyed. To keep a reference that
 * survives that safely, store an `EntityRef` (index + generation), e.g. in a
 * `t.entity()` field, and resolve it with `world.deref(ref)`.
 */
export type Entity = number;

/** A packed (index, generation) pair. */
export type EntityRef = number;

export const INDEX_BITS = 20;
export const INDEX_MASK = (1 << INDEX_BITS) - 1;
export const MAX_ENTITIES = INDEX_MASK; // index INDEX_MASK is reserved for NULL_REF
export const GENERATION_MASK = 0xfff;

/** A reference that never resolves to a live entity. */
export const NULL_REF: EntityRef = 0xffffffff;

export function packRef(index: Entity, generation: number): EntityRef {
  return (generation & GENERATION_MASK) * (INDEX_MASK + 1) + index;
}

export function refIndex(ref: EntityRef): Entity {
  return ref & INDEX_MASK;
}

export function refGeneration(ref: EntityRef): number {
  return Math.floor(ref / (INDEX_MASK + 1)) & GENERATION_MASK;
}
