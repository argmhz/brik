import { compileProgram } from "./gl";

const VS = `#version 300 es
layout(location = 0) in vec2 a_corner;   // unit quad, 0..1
layout(location = 1) in vec4 i_abcd;     // 2x2 part of the quad's world matrix
layout(location = 2) in vec2 i_t;        // translation
layout(location = 3) in vec4 i_uv;       // u0 v0 u1 v1
layout(location = 4) in vec4 i_color;    // premultiplied rgba (fill for shapes)
layout(location = 5) in vec4 i_stroke;   // premultiplied rgba (shapes only)
layout(location = 6) in vec4 i_shape;    // mode (0 sprite, 1 rect, 2 ellipse), stroke width, corner radius, unused

uniform mat3 u_viewProj;

out vec2 v_uv;
out vec4 v_color;
out vec4 v_stroke;
out vec4 v_shape;
out vec2 v_local;
out vec2 v_size;

void main() {
  vec2 world = vec2(
    i_abcd.x * a_corner.x + i_abcd.z * a_corner.y + i_t.x,
    i_abcd.y * a_corner.x + i_abcd.w * a_corner.y + i_t.y);
  vec3 clip = u_viewProj * vec3(world, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
  v_uv = mix(i_uv.xy, i_uv.zw, a_corner);
  v_color = i_color;
  v_stroke = i_stroke;
  v_shape = i_shape;
  v_local = a_corner;
  v_size = vec2(length(i_abcd.xy), length(i_abcd.zw));
}`;

const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
in vec4 v_color;
in vec4 v_stroke;
in vec4 v_shape;
in vec2 v_local;
in vec2 v_size;
uniform sampler2D u_tex;
out vec4 outColor;
void main() {
  if (v_shape.x < 0.5) {
    outColor = texture(u_tex, v_uv) * v_color;
    return;
  }
  // signed distance (world units) to the shape's edge, negative inside
  vec2 h = v_size * 0.5;
  vec2 p = (v_local - 0.5) * v_size;
  float d;
  if (v_shape.x < 1.5) {
    float r = min(v_shape.z, min(h.x, h.y));
    vec2 q = abs(p) - h + r;
    d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
  } else {
    d = (length(p / max(h, vec2(1e-4))) - 1.0) * min(h.x, h.y);
  }
  float aa = max(fwidth(d), 1e-4);
  float outer = clamp(0.5 - d / aa, 0.0, 1.0);
  float sw = v_shape.y;
  if (sw > 0.0) {
    float inner = clamp(0.5 - (d + sw) / aa, 0.0, 1.0);
    outColor = v_color * inner + v_stroke * (outer - inner);
  } else {
    outColor = v_color * outer;
  }
}`;

/** Words per instance: abcd (4) + t (2) + uv (4) + color (1 packed u32) + stroke (1 packed u32) + shape (4). */
const STRIDE_WORDS = 16;
const STRIDE_BYTES = STRIDE_WORDS * 4;

/**
 * Draws many textured quads with instancing. Call `begin`, `push` for each
 * sprite in draw order, then `end`. A draw call is issued whenever the texture
 * changes or the buffer is full.
 */
export class SpriteBatcher {
  readonly maxInstances: number;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private instanceBuffer: WebGLBuffer;
  private quadBuffer: WebGLBuffer;
  private uViewProj: WebGLUniformLocation;
  private data: ArrayBuffer;
  private f32: Float32Array;
  private u32: Uint32Array;
  private count = 0;
  private texture: WebGLTexture | null = null;
  private white: WebGLTexture;
  drawCalls = 0;
  instances = 0;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    maxInstances = 8192,
  ) {
    this.maxInstances = maxInstances;
    this.program = compileProgram(gl, VS, FS);
    this.uViewProj = gl.getUniformLocation(this.program, "u_viewProj")!;
    gl.useProgram(this.program);
    gl.uniform1i(gl.getUniformLocation(this.program, "u_tex"), 0);

    this.data = new ArrayBuffer(maxInstances * STRIDE_BYTES);
    this.f32 = new Float32Array(this.data);
    this.u32 = new Uint32Array(this.data);

    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);

    this.quadBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    this.instanceBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
    const attr = (loc: number, size: number, offsetWords: number, type: number = gl.FLOAT, normalized = false) => {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, type, normalized, STRIDE_BYTES, offsetWords * 4);
      gl.vertexAttribDivisor(loc, 1);
    };
    attr(1, 4, 0);
    attr(2, 2, 4);
    attr(3, 4, 6);
    attr(4, 4, 10, gl.UNSIGNED_BYTE, true);
    attr(5, 4, 11, gl.UNSIGNED_BYTE, true);
    attr(6, 4, 12);
    gl.bindVertexArray(null);

    // shapes don't sample a texture, but something must be bound
    this.white = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.white);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
  }

  /** `viewProj` is a column-major 3x3 matrix. */
  begin(viewProj: Float32Array): void {
    const gl = this.gl;
    gl.useProgram(this.program);
    gl.uniformMatrix3fv(this.uViewProj, false, viewProj);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    this.count = 0;
    this.texture = null;
  }

  /**
   * Adds one quad. The matrix maps the unit square to world space.
   * `rgba` is a packed, premultiplied color (little-endian ABGR).
   */
  push(
    texture: WebGLTexture,
    a: number,
    b: number,
    c: number,
    d: number,
    tx: number,
    ty: number,
    u0: number,
    v0: number,
    u1: number,
    v1: number,
    rgba: number,
  ): void {
    if (texture !== this.texture || this.count === this.maxInstances) {
      this.flush();
      this.texture = texture;
    }
    const o = this.count * STRIDE_WORDS;
    const f = this.f32;
    f[o] = a;
    f[o + 1] = b;
    f[o + 2] = c;
    f[o + 3] = d;
    f[o + 4] = tx;
    f[o + 5] = ty;
    f[o + 6] = u0;
    f[o + 7] = v0;
    f[o + 8] = u1;
    f[o + 9] = v1;
    this.u32[o + 10] = rgba;
    this.u32[o + 11] = 0;
    f[o + 12] = 0;
    f[o + 13] = 0;
    f[o + 14] = 0;
    f[o + 15] = 0;
    this.count++;
  }

  /**
   * Adds a vector shape (mode 1 = rect, 2 = ellipse) filling the quad. It keeps
   * the current texture, so shapes batch together with sprites.
   */
  pushShape(
    a: number,
    b: number,
    c: number,
    d: number,
    tx: number,
    ty: number,
    mode: 1 | 2,
    fill: number,
    stroke: number,
    strokeWidth: number,
    radius: number,
  ): void {
    if (this.count === this.maxInstances) this.flush();
    if (!this.texture) this.texture = this.white;
    const o = this.count * STRIDE_WORDS;
    const f = this.f32;
    f[o] = a;
    f[o + 1] = b;
    f[o + 2] = c;
    f[o + 3] = d;
    f[o + 4] = tx;
    f[o + 5] = ty;
    f[o + 6] = 0;
    f[o + 7] = 0;
    f[o + 8] = 1;
    f[o + 9] = 1;
    this.u32[o + 10] = fill;
    this.u32[o + 11] = stroke;
    f[o + 12] = mode;
    f[o + 13] = strokeWidth;
    f[o + 14] = radius;
    f[o + 15] = 0;
    this.count++;
  }

  /** Frees a texture created elsewhere; flushes first if it is the batch's current one. */
  releaseTexture(tex: WebGLTexture): void {
    if (this.texture === tex) this.flush();
    if (this.texture === tex) this.texture = null;
    this.gl.deleteTexture(tex);
  }

  end(): void {
    this.flush();
    this.gl.bindVertexArray(null);
  }

  private flush(): void {
    if (this.count === 0 || !this.texture) return;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.f32, 0, this.count * STRIDE_WORDS);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.count);
    this.drawCalls++;
    this.instances += this.count;
    this.count = 0;
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    gl.deleteBuffer(this.instanceBuffer);
    gl.deleteBuffer(this.quadBuffer);
    gl.deleteVertexArray(this.vao);
    gl.deleteTexture(this.white);
  }
}

/** Packs a 0..1 color into premultiplied RGBA8 (as a little-endian u32). */
export function packColor(r: number, g: number, b: number, a: number): number {
  const A = Math.max(0, Math.min(1, a));
  const R = Math.round(Math.max(0, Math.min(1, r)) * A * 255);
  const G = Math.round(Math.max(0, Math.min(1, g)) * A * 255);
  const B = Math.round(Math.max(0, Math.min(1, b)) * A * 255);
  return ((Math.round(A * 255) << 24) | (B << 16) | (G << 8) | R) >>> 0;
}
