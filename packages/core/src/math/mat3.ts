import type { Vec2 } from "./vec2";

/**
 * A 2D affine transform, laid out like Canvas2D's `setTransform(a, b, c, d, tx, ty)`:
 *
 * ```
 * | a  c  tx |       x' = a*x + c*y + tx
 * | b  d  ty |       y' = b*x + d*y + ty
 * | 0  0  1  |
 * ```
 */
export interface Mat3 {
  a: number;
  b: number;
  c: number;
  d: number;
  tx: number;
  ty: number;
}

export const mat3 = {
  identity(out: Mat3 = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }): Mat3 {
    out.a = 1;
    out.b = 0;
    out.c = 0;
    out.d = 1;
    out.tx = 0;
    out.ty = 0;
    return out;
  },

  /** Builds translation * rotation * scale. */
  fromTRS(
    x: number,
    y: number,
    rotation: number,
    sx: number,
    sy: number,
    out: Mat3 = mat3.identity(),
  ): Mat3 {
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    out.a = cos * sx;
    out.b = sin * sx;
    out.c = -sin * sy;
    out.d = cos * sy;
    out.tx = x;
    out.ty = y;
    return out;
  },

  /** out = m * n (apply n first, then m). Safe when out aliases m or n. */
  multiply(m: Mat3, n: Mat3, out: Mat3 = mat3.identity()): Mat3 {
    const a = m.a * n.a + m.c * n.b;
    const b = m.b * n.a + m.d * n.b;
    const c = m.a * n.c + m.c * n.d;
    const d = m.b * n.c + m.d * n.d;
    const tx = m.a * n.tx + m.c * n.ty + m.tx;
    const ty = m.b * n.tx + m.d * n.ty + m.ty;
    out.a = a;
    out.b = b;
    out.c = c;
    out.d = d;
    out.tx = tx;
    out.ty = ty;
    return out;
  },

  /** Returns null when the matrix is not invertible. */
  invert(m: Mat3, out: Mat3 = mat3.identity()): Mat3 | null {
    const det = m.a * m.d - m.b * m.c;
    if (det === 0) return null;
    const inv = 1 / det;
    const a = m.d * inv;
    const b = -m.b * inv;
    const c = -m.c * inv;
    const d = m.a * inv;
    const tx = -(a * m.tx + c * m.ty);
    const ty = -(b * m.tx + d * m.ty);
    out.a = a;
    out.b = b;
    out.c = c;
    out.d = d;
    out.tx = tx;
    out.ty = ty;
    return out;
  },

  transformPoint(m: Mat3, p: Vec2, out: Vec2 = { x: 0, y: 0 }): Vec2 {
    const x = m.a * p.x + m.c * p.y + m.tx;
    const y = m.b * p.x + m.d * p.y + m.ty;
    out.x = x;
    out.y = y;
    return out;
  },

  /** Transforms a direction (ignores translation). */
  transformVector(m: Mat3, v: Vec2, out: Vec2 = { x: 0, y: 0 }): Vec2 {
    const x = m.a * v.x + m.c * v.y;
    const y = m.b * v.x + m.d * v.y;
    out.x = x;
    out.y = y;
    return out;
  },

  /** Splits a matrix back into translation, rotation and scale (no skew). */
  decompose(m: Mat3): { x: number; y: number; rotation: number; sx: number; sy: number } {
    const sx = Math.hypot(m.a, m.b);
    const det = m.a * m.d - m.b * m.c;
    const sy = sx === 0 ? 0 : det / sx;
    return { x: m.tx, y: m.ty, rotation: Math.atan2(m.b, m.a), sx, sy };
  },
};
