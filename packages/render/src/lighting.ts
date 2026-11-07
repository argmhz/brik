import { type Entity, GlobalTransform2D, type World } from "@brik/core";
import { Light2D, Lighting2D } from "./components";

/*
 * 2D lighting. For a camera with a Lighting2D, the world it drew is multiplied by a light map: the ambient color,
 * plus every Light2D added on top. The light map is drawn into a small offscreen texture with additive blending,
 * then multiplied over the camera's viewport. UI is drawn afterwards, so it is not darkened.
 */

/** A light, ready to draw: world position, how far it reaches, and its color already times its intensity. */
export interface LightInfo {
  x: number;
  y: number;
  radius: number;
  r: number;
  g: number;
  b: number;
  /** 0 sharp edge .. 1 soft. */
  softness: number;
  /** Spot lights: the direction (unit vector) and the cosine of half the opening. Point lights: cosHalf is -2. */
  dirX: number;
  dirY: number;
  cosHalf: number;
}

/** The lights that reach the view rectangle, in world units. `bounds` skips the rest. */
export function collectLights(world: World, bounds?: { minX: number; minY: number; maxX: number; maxY: number }): LightInfo[] {
  const L = world.store(Light2D);
  const G = world.store(GlobalTransform2D);
  const out: LightInfo[] = [];
  for (const e of world.query([Light2D, GlobalTransform2D])) {
    if (!G.active[e]) continue;
    const m = G.matrix;
    // the entity's scale scales the reach; its rotation points a spot light
    const scale = Math.max(Math.hypot(m.a[e], m.b[e]), Math.hypot(m.c[e], m.d[e]));
    const radius = L.radius[e] * scale;
    const intensity = L.intensity[e];
    if (radius <= 0 || intensity <= 0) continue;
    const x = m.tx[e];
    const y = m.ty[e];
    if (bounds && (x + radius < bounds.minX || x - radius > bounds.maxX || y + radius < bounds.minY || y - radius > bounds.maxY)) continue;
    const spot = L.kind[e] === "spot";
    const len = Math.hypot(m.a[e], m.b[e]) || 1;
    out.push({
      x,
      y,
      radius,
      r: L.color.r[e] * intensity * L.color.a[e],
      g: L.color.g[e] * intensity * L.color.a[e],
      b: L.color.b[e] * intensity * L.color.a[e],
      softness: Math.min(1, Math.max(0, L.softness[e])),
      dirX: m.a[e] / len,
      dirY: m.b[e] / len,
      cosHalf: spot ? Math.cos((Math.min(360, Math.max(1, L.angle[e])) * Math.PI) / 360) : -2,
    });
  }
  return out;
}

/** Whether a camera has lighting turned on, and its ambient color. */
export function lightingOf(world: World, camera: Entity): { r: number; g: number; b: number } | null {
  if (!world.has(camera, Lighting2D)) return null;
  const T = world.store(Lighting2D);
  if (!T.enabled[camera]) return null;
  return { r: T.ambient.r[camera], g: T.ambient.g[camera], b: T.ambient.b[camera] };
}

/** The light a single light gives at a distance `d` from it (0 at the center, 1 at the edge) and a direction cosine. For tests and tools. */
export function lightAt(light: Pick<LightInfo, "softness" | "cosHalf">, d: number, cosine = 1): number {
  if (d >= 1) return 0;
  const edge0 = 1 - light.softness;
  const t = Math.min(1, Math.max(0, (d - edge0) / Math.max(1e-6, 1 - edge0)));
  let a = 1 - t * t * (3 - 2 * t);
  if (light.cosHalf > -1) {
    const lo = light.cosHalf;
    const hi = lo + (1 - lo) * light.softness;
    const c = Math.min(1, Math.max(0, (cosine - lo) / Math.max(1e-6, hi - lo)));
    a *= c * c * (3 - 2 * c);
  }
  return a;
}

const LIGHT_VS = `#version 300 es
uniform mat3 u_viewProj;
uniform vec2 u_pos;
uniform float u_radius;
in vec2 a_corner;
out vec2 v_local;
void main() {
  v_local = a_corner;
  vec3 p = u_viewProj * vec3(u_pos + a_corner * u_radius, 1.0);
  gl_Position = vec4(p.xy, 0.0, 1.0);
}`;

const LIGHT_FS = `#version 300 es
precision mediump float;
uniform vec3 u_color;
uniform float u_softness;
uniform vec2 u_dir;
uniform float u_cosHalf;
in vec2 v_local;
out vec4 o;
void main() {
  float d = length(v_local);
  if (d >= 1.0) discard;
  float a = 1.0 - smoothstep(1.0 - u_softness, 1.0, d);
  if (u_cosHalf > -1.0) {
    float c = d > 0.0001 ? dot(v_local / d, u_dir) : 1.0;
    a *= smoothstep(u_cosHalf, mix(u_cosHalf, 1.0, u_softness), c);
  }
  o = vec4(u_color * a, 1.0);
}`;

const APPLY_VS = `#version 300 es
in vec2 a_corner;
void main() { gl_Position = vec4(a_corner, 0.0, 1.0); }`;

const APPLY_FS = `#version 300 es
precision highp float;
uniform sampler2D u_map;
uniform ivec2 u_origin;
out vec4 o;
void main() { o = vec4(texelFetch(u_map, ivec2(gl_FragCoord.xy) - u_origin, 0).rgb, 1.0); }`;

function program(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const make = (type: number, src: string) => {
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(`Brik: lighting shader: ${gl.getShaderInfoLog(sh)}`);
    return sh;
  };
  const p = gl.createProgram()!;
  gl.attachShader(p, make(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, make(gl.FRAGMENT_SHADER, fs));
  gl.bindAttribLocation(p, 0, "a_corner");
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`Brik: lighting program: ${gl.getProgramInfoLog(p)}`);
  return p;
}

/** Draws the light map and multiplies it over a camera's viewport. Created by the Renderer. */
export class LightRenderer {
  private lightProgram: WebGLProgram;
  private applyProgram: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private buffer: WebGLBuffer;
  private fbo: WebGLFramebuffer;
  private texture: WebGLTexture;
  private size = { w: 0, h: 0 };
  private uni: Record<string, WebGLUniformLocation | null>;
  private applyUni: Record<string, WebGLUniformLocation | null>;

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.lightProgram = program(gl, LIGHT_VS, LIGHT_FS);
    this.applyProgram = program(gl, APPLY_VS, APPLY_FS);
    const u = (p: WebGLProgram, names: string[]) => Object.fromEntries(names.map((n) => [n, gl.getUniformLocation(p, n)]));
    this.uni = u(this.lightProgram, ["u_viewProj", "u_pos", "u_radius", "u_color", "u_softness", "u_dir", "u_cosHalf"]);
    this.applyUni = u(this.applyProgram, ["u_map", "u_origin"]);
    this.vao = gl.createVertexArray()!;
    this.buffer = gl.createBuffer()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.fbo = gl.createFramebuffer()!;
    this.texture = gl.createTexture()!;
  }

  private ensure(w: number, h: number): void {
    if (this.size.w === w && this.size.h === h) return;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texture, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.size = { w, h };
  }

  /**
   * `viewProj` is the camera's world-to-clip matrix (the one the sprites were just drawn with); `vx, vy, vw, vh` is its
   * viewport in pixels. Call after the camera's sprites are drawn and flushed.
   */
  apply(ambient: { r: number; g: number; b: number }, lights: LightInfo[], viewProj: Float32Array, vx: number, vy: number, vw: number, vh: number): void {
    const gl = this.gl;
    this.ensure(vw, vh);

    // 1. the light map: ambient, plus every light added on top
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.disable(gl.SCISSOR_TEST);
    gl.viewport(0, 0, vw, vh);
    gl.clearColor(ambient.r, ambient.g, ambient.b, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (lights.length > 0) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.useProgram(this.lightProgram);
      gl.uniformMatrix3fv(this.uni.u_viewProj, false, viewProj);
      gl.bindVertexArray(this.vao);
      for (const l of lights) {
        gl.uniform2f(this.uni.u_pos, l.x, l.y);
        gl.uniform1f(this.uni.u_radius, l.radius);
        gl.uniform3f(this.uni.u_color, l.r, l.g, l.b);
        gl.uniform1f(this.uni.u_softness, l.softness);
        gl.uniform2f(this.uni.u_dir, l.dirX, l.dirY);
        gl.uniform1f(this.uni.u_cosHalf, l.cosHalf);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
    }

    // 2. multiply the camera's picture by it
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.enable(gl.SCISSOR_TEST);
    gl.viewport(vx, vy, vw, vh);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.DST_COLOR, gl.ZERO, gl.ZERO, gl.ONE);
    gl.useProgram(this.applyProgram);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.uniform1i(this.applyUni.u_map, 0);
    gl.uniform2i(this.applyUni.u_origin, vx, vy);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    gl.bindVertexArray(null);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.lightProgram);
    gl.deleteProgram(this.applyProgram);
    gl.deleteFramebuffer(this.fbo);
    gl.deleteTexture(this.texture);
    gl.deleteBuffer(this.buffer);
    gl.deleteVertexArray(this.vao);
  }
}
