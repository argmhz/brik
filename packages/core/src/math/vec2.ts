/** A mutable 2D vector. Most functions take an optional `out` to avoid allocations. */
export interface Vec2 {
  x: number;
  y: number;
}

export const vec2 = {
  create(x = 0, y = 0): Vec2 {
    return { x, y };
  },
  set(out: Vec2, x: number, y: number): Vec2 {
    out.x = x;
    out.y = y;
    return out;
  },
  copy(a: Vec2, out: Vec2 = { x: 0, y: 0 }): Vec2 {
    out.x = a.x;
    out.y = a.y;
    return out;
  },
  add(a: Vec2, b: Vec2, out: Vec2 = { x: 0, y: 0 }): Vec2 {
    out.x = a.x + b.x;
    out.y = a.y + b.y;
    return out;
  },
  sub(a: Vec2, b: Vec2, out: Vec2 = { x: 0, y: 0 }): Vec2 {
    out.x = a.x - b.x;
    out.y = a.y - b.y;
    return out;
  },
  scale(a: Vec2, s: number, out: Vec2 = { x: 0, y: 0 }): Vec2 {
    out.x = a.x * s;
    out.y = a.y * s;
    return out;
  },
  dot(a: Vec2, b: Vec2): number {
    return a.x * b.x + a.y * b.y;
  },
  /** The z-component of the 3D cross product. */
  cross(a: Vec2, b: Vec2): number {
    return a.x * b.y - a.y * b.x;
  },
  length(a: Vec2): number {
    return Math.hypot(a.x, a.y);
  },
  lengthSq(a: Vec2): number {
    return a.x * a.x + a.y * a.y;
  },
  distance(a: Vec2, b: Vec2): number {
    return Math.hypot(a.x - b.x, a.y - b.y);
  },
  normalize(a: Vec2, out: Vec2 = { x: 0, y: 0 }): Vec2 {
    const len = Math.hypot(a.x, a.y);
    if (len > 0) {
      out.x = a.x / len;
      out.y = a.y / len;
    } else {
      out.x = 0;
      out.y = 0;
    }
    return out;
  },
  lerp(a: Vec2, b: Vec2, t: number, out: Vec2 = { x: 0, y: 0 }): Vec2 {
    out.x = a.x + (b.x - a.x) * t;
    out.y = a.y + (b.y - a.y) * t;
    return out;
  },
  /** Rotates `a` by `angle` radians (counter-clockwise, y-up). */
  rotate(a: Vec2, angle: number, out: Vec2 = { x: 0, y: 0 }): Vec2 {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const x = a.x * c - a.y * s;
    const y = a.x * s + a.y * c;
    out.x = x;
    out.y = y;
    return out;
  },
  equals(a: Vec2, b: Vec2, epsilon = 1e-6): boolean {
    return Math.abs(a.x - b.x) <= epsilon && Math.abs(a.y - b.y) <= epsilon;
  },
};
