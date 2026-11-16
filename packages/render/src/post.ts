import type { Entity, World } from "@brik/core";
import { PostProcess2D } from "./components";
import { compileProgram } from "./gl";

/*
 * Post-processing. A camera with an enabled PostProcess2D draws its world (and its lighting) into an offscreen
 * texture instead of the screen. That texture is then drawn into the camera's viewport through one shader that
 * does every effect: pixelate, CRT curvature, chromatic aberration, bloom, color correction, scanlines and vignette.
 * Bloom first blurs the bright parts into a half-size texture. The UI is drawn after this, so it is not affected.
 */

/** A camera's effects, ready for the shader. */
export interface PostSettings {
  bloom: number;
  bloomThreshold: number;
  bloomRadius: number;
  brightness: number;
  contrast: number;
  saturation: number;
  tint: { r: number; g: number; b: number };
  vignette: number;
  scanlines: number;
  scanlineSpacing: number;
  curvature: number;
  chromaticAberration: number;
  pixelate: number;
}

/** The camera's PostProcess2D settings, or null when it has none, it is switched off, or every effect is at its neutral value. */
export function postProcessOf(world: World, camera: Entity): PostSettings | null {
  if (!world.has(camera, PostProcess2D)) return null;
  const P = world.store(PostProcess2D);
  if (!P.enabled[camera]) return null;
  const s: PostSettings = {
    bloom: Math.max(0, P.bloom[camera]),
    bloomThreshold: Math.min(1, Math.max(0, P.bloomThreshold[camera])),
    bloomRadius: Math.max(1, P.bloomRadius[camera]),
    brightness: P.brightness[camera],
    contrast: Math.max(0, P.contrast[camera]),
    saturation: Math.max(0, P.saturation[camera]),
    tint: { r: P.tint.r[camera], g: P.tint.g[camera], b: P.tint.b[camera] },
    vignette: Math.min(1, Math.max(0, P.vignette[camera])),
    scanlines: Math.min(1, Math.max(0, P.scanlines[camera])),
    scanlineSpacing: Math.max(2, P.scanlineSpacing[camera]),
    curvature: Math.min(1, Math.max(0, P.curvature[camera])),
    chromaticAberration: Math.max(0, P.chromaticAberration[camera]),
    pixelate: Math.max(1, Math.round(P.pixelate[camera])),
  };
  const neutral =
    s.bloom === 0 &&
    s.brightness === 0 &&
    s.contrast === 1 &&
    s.saturation === 1 &&
    s.tint.r === 1 &&
    s.tint.g === 1 &&
    s.tint.b === 1 &&
    s.vignette === 0 &&
    s.scanlines === 0 &&
    s.curvature === 0 &&
    s.chromaticAberration === 0 &&
    s.pixelate === 1;
  return neutral ? null : s;
}

const QUAD_VS = `#version 300 es
layout(location = 0) in vec2 a_corner;
out vec2 v_uv;
void main() {
  v_uv = a_corner * 0.5 + 0.5;
  gl_Position = vec4(a_corner, 0.0, 1.0);
}`;

/** Keeps what is brighter than the threshold, with a soft knee. */
const BRIGHT_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_src;
uniform float u_threshold;
out vec4 o;
void main() {
  vec3 c = texture(u_src, v_uv).rgb;
  float b = max(c.r, max(c.g, c.b));
  float knee = 0.1;
  float k = clamp((b - u_threshold + knee) / (2.0 * knee), 0.0, 1.0);
  float w = max(b - u_threshold, 0.0) + k * k * knee * 0.5;
  o = vec4(c * (w / max(b, 1e-4)), 1.0);
}`;

/** One direction of a 9-tap gaussian blur. */
const BLUR_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_src;
uniform vec2 u_step;
out vec4 o;
void main() {
  vec3 c = texture(u_src, v_uv).rgb * 0.2270270;
  c += texture(u_src, v_uv + u_step * 1.3846154).rgb * 0.3162162;
  c += texture(u_src, v_uv - u_step * 1.3846154).rgb * 0.3162162;
  c += texture(u_src, v_uv + u_step * 3.2307692).rgb * 0.0702703;
  c += texture(u_src, v_uv - u_step * 3.2307692).rgb * 0.0702703;
  o = vec4(c, 1.0);
}`;

const COMPOSITE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_scene;
uniform sampler2D u_bloom;
uniform vec2 u_size;          // the viewport in device pixels
uniform float u_bloomAmount;
uniform float u_brightness;
uniform float u_contrast;
uniform float u_saturation;
uniform vec3 u_tint;
uniform float u_vignette;
uniform float u_scanlines;
uniform float u_scanlineSpacing;
uniform float u_curvature;
uniform float u_aberration;   // device pixels
uniform float u_pixelate;     // device pixels
out vec4 o;

void main() {
  vec2 uv = v_uv;
  // CRT: bend the picture outward from the center
  if (u_curvature > 0.0) {
    vec2 c = uv * 2.0 - 1.0;
    c *= 1.0 + u_curvature * 0.25 * (c.yx * c.yx);
    uv = c * 0.5 + 0.5;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { o = vec4(0.0, 0.0, 0.0, 1.0); return; }
  }
  if (u_pixelate > 1.0) {
    vec2 block = u_pixelate / u_size;
    uv = (floor(uv / block) + 0.5) * block;
  }
  vec4 col = texture(u_scene, uv);
  if (u_aberration > 0.0) {
    // red and blue pulled apart, more toward the edges
    vec2 off = (uv - 0.5) * 2.0 * (u_aberration / u_size);
    col.r = texture(u_scene, uv + off).r;
    col.b = texture(u_scene, uv - off).b;
  }
  vec3 rgb = col.rgb;
  if (u_bloomAmount > 0.0) rgb += texture(u_bloom, uv).rgb * u_bloomAmount;
  // color correction (the scene is premultiplied, so it is done on straight color and multiplied back)
  float a = max(col.a, 1e-4);
  rgb /= a;
  rgb = rgb * u_tint + u_brightness;
  rgb = (rgb - 0.5) * u_contrast + 0.5;
  float grey = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
  rgb = mix(vec3(grey), rgb, u_saturation);
  if (u_scanlines > 0.0) {
    float line = 0.5 + 0.5 * cos(6.2831853 * gl_FragCoord.y / u_scanlineSpacing);
    rgb *= 1.0 - u_scanlines * line;
  }
  if (u_vignette > 0.0) {
    vec2 d = uv - 0.5;
    rgb *= 1.0 - u_vignette * smoothstep(0.2, 0.75, dot(d, d) * 2.0);
  }
  o = vec4(clamp(rgb, 0.0, 1.0) * col.a, col.a);
}`;

interface Target {
  fbo: WebGLFramebuffer;
  tex: WebGLTexture;
  w: number;
  h: number;
}

/** Draws cameras with a PostProcess2D. Created by the Renderer the first time one is needed. */
export class PostRenderer {
  private bright: WebGLProgram;
  private blur: WebGLProgram;
  private composite: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private buffer: WebGLBuffer;
  private scene: Target;
  private bloomA: Target;
  private bloomB: Target;
  private uBright: Record<string, WebGLUniformLocation | null>;
  private uBlur: Record<string, WebGLUniformLocation | null>;
  private uComp: Record<string, WebGLUniformLocation | null>;

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.bright = compileProgram(gl, QUAD_VS, BRIGHT_FS);
    this.blur = compileProgram(gl, QUAD_VS, BLUR_FS);
    this.composite = compileProgram(gl, QUAD_VS, COMPOSITE_FS);
    const u = (p: WebGLProgram, names: string[]) => Object.fromEntries(names.map((n) => [n, gl.getUniformLocation(p, n)]));
    this.uBright = u(this.bright, ["u_src", "u_threshold"]);
    this.uBlur = u(this.blur, ["u_src", "u_step"]);
    this.uComp = u(this.composite, [
      "u_scene",
      "u_bloom",
      "u_size",
      "u_bloomAmount",
      "u_brightness",
      "u_contrast",
      "u_saturation",
      "u_tint",
      "u_vignette",
      "u_scanlines",
      "u_scanlineSpacing",
      "u_curvature",
      "u_aberration",
      "u_pixelate",
    ]);
    this.vao = gl.createVertexArray()!;
    this.buffer = gl.createBuffer()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.scene = this.target();
    this.bloomA = this.target();
    this.bloomB = this.target();
  }

  private target(): Target {
    return { fbo: this.gl.createFramebuffer()!, tex: this.gl.createTexture()!, w: 0, h: 0 };
  }

  private ensure(t: Target, w: number, h: number): void {
    if (t.w === w && t.h === h) return;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.tex, 0);
    t.w = w;
    t.h = h;
  }

  /**
   * Starts drawing a camera offscreen: binds a `w` x `h` texture as the target, with the viewport and scissor
   * covering it. Returns the framebuffer, for the lighting to draw into.
   */
  begin(w: number, h: number): WebGLFramebuffer {
    const gl = this.gl;
    this.ensure(this.scene, w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.scene.fbo);
    gl.viewport(0, 0, w, h);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(0, 0, w, h);
    return this.scene.fbo;
  }

  /** Draws the offscreen picture into the camera's viewport on the screen, through the effects. `dpr` is device pixels per CSS pixel. */
  end(s: PostSettings, vx: number, vy: number, vw: number, vh: number, dpr: number): void {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);
    gl.activeTexture(gl.TEXTURE0);

    // bloom: bright parts into a half-size texture, then blurred across and down, twice
    if (s.bloom > 0) {
      const bw = Math.max(1, vw >> 1);
      const bh = Math.max(1, vh >> 1);
      this.ensure(this.bloomA, bw, bh);
      this.ensure(this.bloomB, bw, bh);
      gl.viewport(0, 0, bw, bh);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloomA.fbo);
      gl.useProgram(this.bright);
      gl.bindTexture(gl.TEXTURE_2D, this.scene.tex);
      gl.uniform1i(this.uBright.u_src, 0);
      gl.uniform1f(this.uBright.u_threshold, s.bloomThreshold);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.useProgram(this.blur);
      gl.uniform1i(this.uBlur.u_src, 0);
      // the radius is in CSS pixels; the bloom texture is half the device size
      const spread = (s.bloomRadius * dpr) / 2 / 4;
      for (let pass = 0; pass < 2; pass++) {
        const k = spread * (pass === 0 ? 1 : 0.5);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloomB.fbo);
        gl.bindTexture(gl.TEXTURE_2D, this.bloomA.tex);
        gl.uniform2f(this.uBlur.u_step, k / bw, 0);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloomA.fbo);
        gl.bindTexture(gl.TEXTURE_2D, this.bloomB.tex);
        gl.uniform2f(this.uBlur.u_step, 0, k / bh);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
    }

    // the picture, through every effect, over what is already on the screen
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(vx, vy, vw, vh);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(vx, vy, vw, vh);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.composite);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, s.bloom > 0 ? this.bloomA.tex : this.scene.tex);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.scene.tex);
    const U = this.uComp;
    gl.uniform1i(U.u_scene, 0);
    gl.uniform1i(U.u_bloom, 1);
    gl.uniform2f(U.u_size, vw, vh);
    gl.uniform1f(U.u_bloomAmount, s.bloom);
    gl.uniform1f(U.u_brightness, s.brightness);
    gl.uniform1f(U.u_contrast, s.contrast);
    gl.uniform1f(U.u_saturation, s.saturation);
    gl.uniform3f(U.u_tint, s.tint.r, s.tint.g, s.tint.b);
    gl.uniform1f(U.u_vignette, s.vignette);
    gl.uniform1f(U.u_scanlines, s.scanlines);
    gl.uniform1f(U.u_scanlineSpacing, s.scanlineSpacing * dpr);
    gl.uniform1f(U.u_curvature, s.curvature);
    gl.uniform1f(U.u_aberration, s.chromaticAberration * dpr);
    gl.uniform1f(U.u_pixelate, s.pixelate * dpr);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.bright);
    gl.deleteProgram(this.blur);
    gl.deleteProgram(this.composite);
    for (const t of [this.scene, this.bloomA, this.bloomB]) {
      gl.deleteFramebuffer(t.fbo);
      gl.deleteTexture(t.tex);
    }
    gl.deleteBuffer(this.buffer);
    gl.deleteVertexArray(this.vao);
  }
}
