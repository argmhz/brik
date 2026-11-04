import type { Color, Mat3, Rect, Vec2 } from "../math";
import { NULL_REF } from "./entity";

/**
 * Field kinds a component schema can use.
 *
 * Numeric kinds are stored as typed arrays (Structure of Arrays). Composite kinds
 * (`vec2`, `color`, `rect`, `mat3`) are stored as one typed array per part, e.g.
 * `store.position.x[e]`. `ref` fields hold arbitrary JS values in a plain array.
 */
export type FieldKind =
  | "f32"
  | "f64"
  | "i32"
  | "u32"
  | "u8"
  | "bool"
  | "entity"
  | "vec2"
  | "color"
  | "rect"
  | "mat3"
  | "ref";

export interface Field<K extends FieldKind = FieldKind, V = unknown> {
  readonly kind: K;
  /** Creates the default value for a newly added component. */
  readonly make: () => V;
  /** Hints for the editor inspector. */
  readonly meta?: FieldMeta;
}

export interface FieldMeta {
  /** Which inspector widget to use, e.g. "angle" (radians shown as degrees) or "sprite". */
  editor?: string;
  label?: string;
  min?: number;
  max?: number;
  step?: number;
  /** Allowed values for enum fields. */
  options?: readonly string[];
  /** Not shown in the inspector. */
  hidden?: boolean;
}

/** Returns a copy of `field` with extra editor hints. */
export function withMeta<F extends Field>(field: F, meta: FieldMeta): F {
  return { ...field, meta: { ...field.meta, ...meta } };
}

export type Schema = Record<string, Field>;

type Parts<K extends string> = { [P in K]: Float32Array };

export type FieldStore<F> =
  F extends Field<"f32", any> ? Float32Array
  : F extends Field<"f64", any> ? Float64Array
  : F extends Field<"i32", any> ? Int32Array
  : F extends Field<"u32" | "entity", any> ? Uint32Array
  : F extends Field<"u8" | "bool", any> ? Uint8Array
  : F extends Field<"vec2", any> ? Parts<"x" | "y">
  : F extends Field<"color", any> ? Parts<"r" | "g" | "b" | "a">
  : F extends Field<"rect", any> ? Parts<"x" | "y" | "w" | "h">
  : F extends Field<"mat3", any> ? Parts<"a" | "b" | "c" | "d" | "tx" | "ty">
  : F extends Field<"ref", infer V> ? V[]
  : never;

export type FieldValue<F> = F extends Field<any, infer V> ? V : never;

/** The per-world storage for a component: one array (or group of arrays) per field. */
export type Store<S extends Schema> = { [K in keyof S]: FieldStore<S[K]> };

/** A component's data for a single entity, as a plain object. */
export type Value<S extends Schema> = { [K in keyof S]: FieldValue<S[K]> };

/** Nested-partial initializer used when adding or writing components. */
export type Init<S extends Schema> = {
  [K in keyof S]?: FieldValue<S[K]> extends object
    ? FieldValue<S[K]> extends unknown[]
      ? FieldValue<S[K]>
      : Partial<FieldValue<S[K]>>
    : FieldValue<S[K]>;
};

const f = <K extends FieldKind, V>(kind: K, make: () => V): Field<K, V> => ({ kind, make });

/** Field constructors for component schemas. */
export const t = {
  f32: (d = 0) => f("f32", () => d),
  f64: (d = 0) => f("f64", () => d),
  i32: (d = 0) => f("i32", () => d),
  u32: (d = 0) => f("u32", () => d),
  u8: (d = 0) => f("u8", () => d),
  bool: (d = false) => f("bool", () => d),
  /** A generation-checked reference to another entity. Use `world.deref()` to read it. */
  entity: () => f("entity", () => NULL_REF),
  vec2: (x = 0, y = 0) => f("vec2", (): Vec2 => ({ x, y })),
  color: (r = 1, g = 1, b = 1, a = 1) => f("color", (): Color => ({ r, g, b, a })),
  rect: (x = 0, y = 0, w = 0, h = 0) => f("rect", (): Rect => ({ x, y, w, h })),
  mat3: () => f("mat3", (): Mat3 => ({ a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 })),
  string: (d = "") => f("ref", () => d),
  /** Any JS value. `make` is called per entity so objects and arrays are never shared. */
  ref: <T>(make: () => T) => f("ref", make),
  /** One of a fixed set of strings. */
  enum: <T extends string>(options: readonly T[], d: T = options[0]) =>
    withMeta(f("ref", () => d), { editor: "enum", options }),
};

type TypedArrayCtor =
  | Float32ArrayConstructor
  | Float64ArrayConstructor
  | Int32ArrayConstructor
  | Uint32ArrayConstructor
  | Uint8ArrayConstructor;

export const ARRAY_CTOR: Record<Exclude<FieldKind, "ref">, TypedArrayCtor> = {
  f32: Float32Array,
  f64: Float64Array,
  i32: Int32Array,
  u32: Uint32Array,
  u8: Uint8Array,
  bool: Uint8Array,
  entity: Uint32Array,
  vec2: Float32Array,
  color: Float32Array,
  rect: Float32Array,
  mat3: Float32Array,
};

export const PARTS: Partial<Record<FieldKind, readonly string[]>> = {
  vec2: ["x", "y"],
  color: ["r", "g", "b", "a"],
  rect: ["x", "y", "w", "h"],
  mat3: ["a", "b", "c", "d", "tx", "ty"],
};

type AnyArray = { [i: number]: any; length: number };

function grow<T extends AnyArray>(old: T | undefined, ctor: TypedArrayCtor, capacity: number): T {
  const next = new ctor(capacity) as unknown as T;
  if (old) (next as unknown as Float32Array).set(old as unknown as Float32Array);
  return next;
}

/** Creates a store, or resizes an existing one in place (field arrays are replaced). */
export function allocStore(schema: Schema, capacity: number, existing?: any): any {
  const store = existing ?? {};
  for (const key in schema) {
    const kind = schema[key].kind;
    if (kind === "ref") {
      store[key] ??= [];
      continue;
    }
    const ctor = ARRAY_CTOR[kind];
    const parts = PARTS[kind];
    if (parts) {
      const group = (store[key] ??= {});
      for (const p of parts) group[p] = grow(group[p], ctor, capacity);
    } else {
      store[key] = grow(store[key], ctor, capacity);
    }
  }
  return store;
}

function writeField(kind: FieldKind, slot: any, i: number, value: any): void {
  if (value === undefined) return;
  if (kind === "ref") {
    slot[i] = value;
  } else if (kind === "bool") {
    slot[i] = value ? 1 : 0;
  } else {
    const parts = PARTS[kind];
    if (parts) {
      for (const p of parts) if (value[p] !== undefined) slot[p][i] = value[p];
    } else {
      slot[i] = value;
    }
  }
}

/** Resets every field of entity `i` to its default, then applies `init`. */
export function initEntity(schema: Schema, store: any, i: number, init?: Record<string, any>): void {
  for (const key in schema) {
    const field = schema[key];
    writeField(field.kind, store[key], i, field.make());
    if (init && init[key] !== undefined) writeField(field.kind, store[key], i, init[key]);
  }
}

/** Applies a partial value to entity `i`. */
export function writeEntity(schema: Schema, store: any, i: number, values: Record<string, any>): void {
  for (const key in values) {
    const field = schema[key];
    if (field) writeField(field.kind, store[key], i, values[key]);
  }
}

/** Reads entity `i` into a plain object (a copy). */
export function readEntity(schema: Schema, store: any, i: number): Record<string, any> {
  const out: Record<string, any> = {};
  for (const key in schema) {
    const kind = schema[key].kind;
    const slot = store[key];
    if (kind === "ref") out[key] = slot[i];
    else if (kind === "bool") out[key] = slot[i] !== 0;
    else {
      const parts = PARTS[kind];
      if (parts) {
        const v: Record<string, number> = {};
        for (const p of parts) v[p] = slot[p][i];
        out[key] = v;
      } else out[key] = slot[i];
    }
  }
  return out;
}
