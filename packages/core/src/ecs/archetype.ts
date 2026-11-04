import type { Entity } from "./entity";

/** A bitset over component ids, stored as 32-bit words. */
export type Mask = number[];

export function maskHas(mask: Mask, id: number): boolean {
  return ((mask[id >>> 5] ?? 0) & (1 << (id & 31))) !== 0;
}

export function maskWith(mask: Mask, id: number): Mask {
  const out = mask.slice();
  const w = id >>> 5;
  while (out.length <= w) out.push(0);
  out[w] |= 1 << (id & 31);
  return out;
}

export function maskWithout(mask: Mask, id: number): Mask {
  const out = mask.slice();
  const w = id >>> 5;
  if (w < out.length) out[w] &= ~(1 << (id & 31));
  return out;
}

export function maskFromIds(ids: number[]): Mask {
  let m: Mask = [];
  for (const id of ids) m = maskWith(m, id);
  return m;
}

/** True if every bit in `sub` is set in `mask`. */
export function maskContains(mask: Mask, sub: Mask): boolean {
  for (let i = 0; i < sub.length; i++) {
    if ((sub[i] & (mask[i] ?? 0)) !== sub[i]) return false;
  }
  return true;
}

export function maskIntersects(a: Mask, b: Mask): boolean {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if ((a[i] & b[i]) !== 0) return true;
  return false;
}

export function maskKey(mask: Mask): string {
  let end = mask.length;
  while (end > 0 && mask[end - 1] === 0) end--;
  return mask.slice(0, end).join(",");
}

/** All entities that have exactly the same set of components. */
export class Archetype {
  readonly entities: Entity[] = [];
  readonly addEdges = new Map<number, Archetype>();
  readonly removeEdges = new Map<number, Archetype>();

  constructor(
    readonly id: number,
    readonly mask: Mask,
    /** Component ids, sorted. */
    readonly componentIds: number[],
  ) {}
}
