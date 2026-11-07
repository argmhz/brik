import { Assets, type ResolvedSprite, type TextureAsset } from "@brik/assets";
import { type Entity, GlobalTransform2D, type Mat3, TileMap, type Vec2, type World, mat3, parseTileKey } from "@brik/core";
import { Camera2D, Shape2D, SortingOrder, Sprite, Text2D } from "./components";
import { ParticleEmitter2D, Particles } from "./particles";
import { UIImage, UILayout, UIText } from "./ui";
import { UISlider, UIToggle } from "./ui-widgets";
import { SpriteBatcher, packColor } from "./sprite-batcher";
import { TextCache, type TextImage, type TextStyle, textResolution } from "./text";

const KIND_SPRITE = 0;
const KIND_SHAPE = 1;
const KIND_TEXT = 2;
const KIND_TILEMAP = 3;
const KIND_PARTICLES = 4;

const renderers = new Set<Renderer>();

/** Rasterized Text2D, shared by all renderers (and by picking). */
export const textCache = new TextCache((tex) => {
  for (const r of renderers) r.releaseTexture(tex);
});

const style: TextStyle = { text: "", size: 16, font: "", align: "center", bold: false, maxWidth: 0, lineHeight: 1.2 };

/**
 * The rasterized text for an entity's Text2D, or null if empty / unavailable.
 * `pixelsPerUnit`: how many screen pixels one world unit of the text covers,
 * so it is rasterized sharp enough (rounded to steps; see textResolution).
 */
export function textImage(world: World, e: Entity, pixelsPerUnit = 2): TextImage | null {
  const T = world.store(Text2D);
  if (!T.text[e]) return null;
  style.text = T.text[e];
  style.size = T.size[e];
  style.font = T.font[e];
  style.align = T.align[e];
  style.bold = T.bold[e] !== 0;
  style.maxWidth = T.maxWidth[e];
  style.lineHeight = T.lineHeight[e];
  style.resolution = textResolution(pixelsPerUnit);
  const img = textCache.get(style);
  style.resolution = undefined;
  return img;
}

interface GpuTexture {
  tex: WebGLTexture;
  version: number;
  id: number;
}

export interface RendererOptions {
  /** Max device pixel ratio to render at. Default 2. */
  maxPixelRatio?: number;
  antialias?: boolean;
}

/** A free camera, e.g. the editor's scene view. */
export interface EditorView {
  x: number;
  y: number;
  zoom: number;
  clearColor?: { r: number; g: number; b: number; a: number };
}

export interface RenderStats {
  sprites: number;
  drawCalls: number;
  cameras: number;
}

/**
 * Draws the world with WebGL2. Available as a resource: `world.resource(Renderer)`.
 */
export class Renderer {
  readonly gl: WebGL2RenderingContext;
  readonly stats: RenderStats = { sprites: 0, drawCalls: 0, cameras: 0 };
  private batcher!: SpriteBatcher;
  /** Keyed by the image, so textures packed onto one atlas page share one GPU texture. */
  private textures = new Map<object, GpuTexture>();
  private nextTextureId = 1;
  private contextLost = false;
  private warnedNoCamera = false;
  private readonly maxPixelRatio: number;

  // per-frame scratch, reused to avoid garbage
  private items: Entity[] = [];
  private itemKind: number[] = [];
  private itemTex: (GpuTexture | null)[] = [];
  private keyLayer = new Int32Array(0);
  private keyOrder = new Int32Array(0);
  private keyY = new Float32Array(0);
  private keyTex = new Int32Array(0);
  private order: number[] = [];
  private resolved: ResolvedSprite[] = [];
  /** The sprite's own size for sliced sprites (their `resolved` size is the stretched one); 0 otherwise. */
  private naturalW: number[] = [];
  private naturalH: number[] = [];
  private viewProj = new Float32Array(9);

  constructor(
    readonly canvas: HTMLCanvasElement,
    options: RendererOptions = {},
  ) {
    this.maxPixelRatio = options.maxPixelRatio ?? 2;
    const gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: options.antialias ?? false,
      premultipliedAlpha: true,
    });
    if (!gl) throw new Error("Brik: WebGL2 is not supported in this browser");
    this.gl = gl;
    this.initGl();
    renderers.add(this);
    canvas.addEventListener("webglcontextlost", (ev) => {
      ev.preventDefault();
      this.contextLost = true;
    });
    canvas.addEventListener("webglcontextrestored", () => {
      this.textures.clear();
      this.initGl();
      this.contextLost = false;
    });
  }

  /** Canvas size in CSS pixels. */
  get width(): number {
    return this.canvas.clientWidth || this.canvas.width;
  }

  get height(): number {
    return this.canvas.clientHeight || this.canvas.height;
  }

  render(world: World): void {
    if (this.contextLost) return;
    this.resize();
    const gl = this.gl;
    this.stats.sprites = 0;
    this.stats.drawCalls = 0;

    const cameras = world.query([Camera2D, GlobalTransform2D]).toArray();
    const C = world.store(Camera2D);
    const G = world.store(GlobalTransform2D);
    cameras.sort((a, b) => C.priority[a] - C.priority[b]);
    this.stats.cameras = cameras.length;

    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    if (cameras.length === 0) {
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (!this.warnedNoCamera) {
        this.warnedNoCamera = true;
        console.warn("[brik] no Camera2D in the world, nothing to draw");
      }
      return;
    }

    // text is rasterized for the most zoomed-in camera
    const dpr = Math.min(globalThis.devicePixelRatio || 1, this.maxPixelRatio);
    const zoom = Math.max(...cameras.map((c) => (G.active[c] ? C.zoom[c] : 0)), 0.01);
    const count = this.collect(world, zoom * dpr);
    this.batcher.drawCalls = 0;
    this.batcher.instances = 0;

    gl.enable(gl.SCISSOR_TEST);
    for (const cam of cameras) {
      if (!G.active[cam]) continue;
      const vx = Math.round(C.viewport.x[cam] * gl.drawingBufferWidth);
      const vy = Math.round(C.viewport.y[cam] * gl.drawingBufferHeight);
      const vw = Math.round(C.viewport.w[cam] * gl.drawingBufferWidth);
      const vh = Math.round(C.viewport.h[cam] * gl.drawingBufferHeight);
      gl.viewport(vx, vy, vw, vh);
      gl.scissor(vx, vy, vw, vh);
      if (C.clear[cam]) {
        gl.clearColor(C.clearColor.r[cam], C.clearColor.g[cam], C.clearColor.b[cam], C.clearColor.a[cam]);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
      const bounds = this.setView(
        globalOf(world, cam),
        C.zoom[cam],
        this.width * C.viewport.w[cam],
        this.height * C.viewport.h[cam],
      );
      this.drawSprites(world, count, bounds);
    }
    gl.disable(gl.SCISSOR_TEST);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    this.drawUI(world);
    this.stats.drawCalls = this.batcher.drawCalls;
  }

  /** Lays out and draws every UICanvas in screen space, on top of the world. */
  drawUI(world: World): void {
    const layout = world.tryResource(UILayout) ?? world.insertResource(new UILayout());
    layout.update(world, this.width, this.height);
    if (layout.elements.length === 0) return;
    const p = this.viewProj;
    p.fill(0);
    p[0] = 2 / this.width;
    p[4] = 2 / this.height;
    p[6] = -1;
    p[7] = -1;
    p[8] = 1;
    this.batcher.begin(p);
    const assets = world.resource(Assets);
    const I = world.store(UIImage);
    const X = world.store(UIText);
    const r = {} as ResolvedSprite;
    for (const el of layout.elements) {
      const e = el.e;
      const { x, y, w, h } = el.rect;
      if (world.has(e, UIImage)) {
        const rgba = packColor(I.color.r[e], I.color.g[e], I.color.b[e], I.color.a[e]);
        const ref = I.sprite[e];
        const res = ref ? assets.resolve(ref, r) : null;
        const gpu = res ? this.gpuTexture(res.texture) : null;
        if (res && gpu) {
          if (res.border) this.nineSlice(gpu.tex, res, x, y, w, h, el.scale, rgba);
          else this.batcher.push(gpu.tex, w, 0, 0, h, x, y, res.u0, res.v0, res.u1, res.v1, rgba);
        } else if (!ref) {
          this.batcher.pushShape(w, 0, 0, h, x, y, 1, rgba, 0, 0, 0);
        }
        this.stats.sprites++;
      }
      if (world.has(e, UISlider)) this.drawSlider(world, e, x, y, w, h);
      if (world.has(e, UIToggle)) this.drawToggle(world, e, x, y, w, h);
      if (world.has(e, UIText) && X.text[e]) {
        style.text = X.text[e];
        style.size = X.size[e] * el.scale;
        style.font = X.font[e];
        style.align = X.align[e];
        style.bold = X.bold[e] !== 0;
        style.maxWidth = X.wrap[e] ? w : 0;
        style.lineHeight = 1.2;
        const img = textCache.get(style);
        const gpu = img && this.gpuTexture(img.texture);
        if (img && gpu) {
          const anchorX = style.align === "left" ? x : style.align === "right" ? x + w : x + w / 2;
          const tx = anchorX - img.width * img.pivotX;
          const ty = y + h / 2 - img.height / 2;
          const rgba = packColor(X.color.r[e], X.color.g[e], X.color.b[e], X.color.a[e]);
          this.batcher.push(gpu.tex, img.width, 0, 0, img.height, tx, ty, 0, 1, 1, 0, rgba);
          this.stats.sprites++;
        }
      }
    }
    this.batcher.end();
  }

  /** Track, filled part and handle of a UISlider, inside its rect. */
  private drawSlider(world: World, e: Entity, x: number, y: number, w: number, h: number): void {
    const S = world.store(UISlider);
    const handle = h * 0.8;
    const span = S.max[e] - S.min[e];
    const f = span === 0 ? 0 : Math.min(1, Math.max(0, (S.value[e] - S.min[e]) / span));
    const th = Math.max(2, h * 0.3);
    const ty = y + (h - th) / 2;
    const hx = x + f * Math.max(0, w - handle);
    const color = (c: typeof S.trackColor) => packColor(c.r[e], c.g[e], c.b[e], c.a[e]);
    const dim = S.interactable[e] ? 1 : 0.5;
    // (a, b, c, d, x, y, mode, fill, stroke, strokeWidth, corner radius)
    this.batcher.pushShape(w, 0, 0, th, x, ty, 1, color(S.trackColor), 0, 0, th / 2);
    this.batcher.pushShape(hx + handle / 2 - x, 0, 0, th, x, ty, 1, color(S.fillColor), 0, 0, th / 2);
    const handleColor = packColor(S.handleColor.r[e], S.handleColor.g[e], S.handleColor.b[e], S.handleColor.a[e] * dim);
    this.batcher.pushShape(handle, 0, 0, handle, hx, y + (h - handle) / 2, 2, handleColor, 0, 0, 0);
    this.stats.sprites += 3;
  }

  /** The box (and check when on) of a UIToggle, at the left of its rect. */
  private drawToggle(world: World, e: Entity, x: number, y: number, w: number, h: number): void {
    const G = world.store(UIToggle);
    const size = Math.min(w, h);
    const by = y + (h - size) / 2;
    this.batcher.pushShape(size, 0, 0, size, x, by, 1, packColor(G.boxColor.r[e], G.boxColor.g[e], G.boxColor.b[e], G.boxColor.a[e]), 0, 0, size * 0.2);
    if (G.on[e]) {
      const c = size * 0.6;
      const o = (size - c) / 2;
      this.batcher.pushShape(c, 0, 0, c, x + o, by + o, 1, packColor(G.checkColor.r[e], G.checkColor.g[e], G.checkColor.b[e], G.checkColor.a[e]), 0, 0, c * 0.2);
    }
    this.stats.sprites++;
  }

  /** Draws a sprite stretched to a rect with fixed-size corners (borders are in source pixels times `scale`). */
  private nineSlice(tex: WebGLTexture, r: ResolvedSprite, x: number, y: number, w: number, h: number, scale: number, rgba: number): void {
    const b = r.border!;
    const ppu = r.ppu;
    // border sizes on screen, shrunk if the rect is too small
    let l = b.l * ppu * scale;
    let rr = b.r * ppu * scale;
    let bt = b.b * ppu * scale;
    let tp = b.t * ppu * scale;
    const fx = Math.min(1, w / Math.max(1e-6, l + rr));
    const fy = Math.min(1, h / Math.max(1e-6, bt + tp));
    l *= fx;
    rr *= fx;
    bt *= fy;
    tp *= fy;
    const sw = r.width;
    const sh = r.height;
    // uv columns/rows (v0 is the bottom edge)
    const us = [r.u0, r.u0 + ((r.u1 - r.u0) * b.l) / sw, r.u1 - ((r.u1 - r.u0) * b.r) / sw, r.u1];
    const vs = [r.v0, r.v0 + ((r.v1 - r.v0) * b.b) / sh, r.v1 - ((r.v1 - r.v0) * b.t) / sh, r.v1];
    const xs = [x, x + l, x + w - rr, x + w];
    const ys = [y, y + bt, y + h - tp, y + h];
    for (let j = 0; j < 3; j++) {
      for (let i = 0; i < 3; i++) {
        const qw = xs[i + 1] - xs[i];
        const qh = ys[j + 1] - ys[j];
        if (qw <= 0 || qh <= 0) continue;
        this.batcher.push(tex, qw, 0, 0, qh, xs[i], ys[j], us[i], vs[j], us[i + 1], vs[j + 1], rgba);
      }
    }
  }

  /**
   * Draws the world from an explicit view instead of its cameras, filling the
   * whole canvas. Used by the editor's scene view.
   */
  renderView(world: World, view: EditorView): void {
    if (this.contextLost) return;
    this.resize();
    const gl = this.gl;
    this.stats.sprites = 0;
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    const c = view.clearColor ?? { r: 0.12, g: 0.12, b: 0.14, a: 1 };
    gl.clearColor(c.r, c.g, c.b, c.a);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const count = this.collect(world, view.zoom * Math.min(globalThis.devicePixelRatio || 1, this.maxPixelRatio));
    this.batcher.drawCalls = 0;
    const camM = mat3.fromTRS(view.x, view.y, 0, 1, 1);
    this.drawSprites(world, count, this.setView(camM, view.zoom, this.width, this.height));
    this.stats.drawCalls = this.batcher.drawCalls;
    this.stats.cameras = 0;
  }

  /** Converts a CSS-pixel position on the canvas (y down) to world coordinates. */
  screenToWorld(world: World, camera: Entity, screen: Vec2, out: Vec2 = { x: 0, y: 0 }): Vec2 {
    const C = world.store(Camera2D);
    const vw = this.width * C.viewport.w[camera];
    const vh = this.height * C.viewport.h[camera];
    const vx = this.width * C.viewport.x[camera];
    const vyTop = this.height * (1 - C.viewport.y[camera] - C.viewport.h[camera]);
    const zoom = C.zoom[camera];
    // view space: centered, y up, in world units
    const local = { x: (screen.x - vx - vw / 2) / zoom, y: -(screen.y - vyTop - vh / 2) / zoom };
    return mat3.transformPoint(globalOf(world, camera), local, out);
  }

  /** Converts world coordinates to CSS pixels on the canvas (y down). */
  worldToScreen(world: World, camera: Entity, p: Vec2, out: Vec2 = { x: 0, y: 0 }): Vec2 {
    const C = world.store(Camera2D);
    const inv = mat3.invert(globalOf(world, camera)) ?? mat3.identity();
    const v = mat3.transformPoint(inv, p);
    const vw = this.width * C.viewport.w[camera];
    const vh = this.height * C.viewport.h[camera];
    const vx = this.width * C.viewport.x[camera];
    const vyTop = this.height * (1 - C.viewport.y[camera] - C.viewport.h[camera]);
    const zoom = C.zoom[camera];
    out.x = vx + vw / 2 + v.x * zoom;
    out.y = vyTop + vh / 2 - v.y * zoom;
    return out;
  }

  // ---------------------------------------------------------------- internals

  private initGl(): void {
    const gl = this.gl;
    this.batcher = new SpriteBatcher(gl);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  }

  private resize(): void {
    const dpr = Math.min(globalThis.devicePixelRatio || 1, this.maxPixelRatio);
    const w = Math.max(1, Math.round(this.width * dpr));
    const h = Math.max(1, Math.round(this.height * dpr));
    if (this.canvas.clientWidth && (this.canvas.width !== w || this.canvas.height !== h)) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  /** Gathers visible sprites, shapes and text and sorts them. Returns how many there are. */
  /** `pixelsPerUnit`: screen pixels per world unit in the views drawn this frame (zoom x pixel ratio). */
  private collect(world: World, pixelsPerUnit: number): number {
    const assets = world.resource(Assets);
    const S = world.store(Sprite);
    const H = world.store(Shape2D);
    const G = world.store(GlobalTransform2D);
    const O = world.store(SortingOrder);
    const items = this.items;
    items.length = 0;
    this.itemKind.length = 0;
    this.itemTex.length = 0;
    textCache.sweep();

    const slot = (i: number) => (this.resolved[i] ??= {} as ResolvedSprite);

    for (const e of world.query([Sprite, GlobalTransform2D])) {
      if (!G.active[e]) continue;
      const ref = S.sprite[e];
      if (!ref) continue;
      const r = assets.resolve(ref, slot(items.length));
      if (!r) continue;
      const gpu = this.gpuTexture(r.texture);
      if (!gpu) continue;
      const i = items.length;
      if (S.drawMode[e] === "sliced") {
        this.naturalW[i] = r.width;
        this.naturalH[i] = r.height;
        r.width = S.size.x[e];
        r.height = S.size.y[e];
      } else this.naturalW[i] = 0;
      items.push(e);
      this.itemKind.push(KIND_SPRITE);
      this.itemTex.push(gpu);
    }

    for (const e of world.query([Shape2D, GlobalTransform2D])) {
      if (!G.active[e]) continue;
      const r = slot(items.length);
      r.width = H.size.x[e];
      r.height = H.size.y[e];
      r.pivotX = 0.5;
      r.pivotY = 0.5;
      items.push(e);
      this.itemKind.push(KIND_SHAPE);
      this.itemTex.push(null);
    }

    const gm = G.matrix;
    for (const e of world.query([Text2D, GlobalTransform2D])) {
      if (!G.active[e]) continue;
      // screen pixels per world unit of this text: view zoom x its own scale
      const scale = Math.max(Math.hypot(gm.a[e], gm.b[e]), Math.hypot(gm.c[e], gm.d[e]));
      const img = textImage(world, e, pixelsPerUnit * scale);
      if (!img) continue;
      const gpu = this.gpuTexture(img.texture);
      if (!gpu) continue;
      const r = slot(items.length);
      r.texture = img.texture;
      r.u0 = 0;
      r.u1 = 1;
      r.v0 = 1;
      r.v1 = 0;
      r.width = img.width;
      r.height = img.height;
      r.pivotX = img.pivotX;
      r.pivotY = 0.5;
      items.push(e);
      this.itemKind.push(KIND_TEXT);
      this.itemTex.push(gpu);
    }

    const M = world.store(TileMap);
    for (const e of world.query([TileMap, GlobalTransform2D])) {
      if (!G.active[e]) continue;
      const guid = M.tileset[e];
      const tex = guid ? assets.textures.get(guid) : undefined;
      if (!tex) continue;
      const gpu = this.gpuTexture(tex);
      if (!gpu) continue;
      const r = slot(items.length);
      r.texture = tex;
      items.push(e);
      this.itemKind.push(KIND_TILEMAP);
      this.itemTex.push(gpu);
    }

    const particles = world.tryResource(Particles);
    if (particles) {
      const PE = world.store(ParticleEmitter2D);
      for (const [e, pool] of particles.pools) {
        if (pool.count === 0 || !world.isAlive(e) || !world.has(e, ParticleEmitter2D)) continue;
        if (world.has(e, GlobalTransform2D) && !G.active[e]) continue;
        const r = slot(items.length);
        let gpu: GpuTexture | null = null;
        const ref = PE.sprite[e];
        if (ref) {
          if (!assets.resolve(ref, r)) continue;
          gpu = this.gpuTexture(r.texture);
          if (!gpu) continue;
        }
        items.push(e);
        this.itemKind.push(KIND_PARTICLES);
        this.itemTex.push(gpu);
      }
    }

    const n = items.length;
    if (this.keyLayer.length < n) {
      const cap = Math.max(n, this.keyLayer.length * 2, 256);
      this.keyLayer = new Int32Array(cap);
      this.keyOrder = new Int32Array(cap);
      this.keyY = new Float32Array(cap);
      this.keyTex = new Int32Array(cap);
    }
    const order = this.order;
    order.length = n;
    for (let i = 0; i < n; i++) {
      const e = items[i];
      order[i] = i;
      const sorted = world.has(e, SortingOrder);
      this.keyLayer[i] = sorted ? O.layer[e] : 0;
      this.keyOrder[i] = sorted ? O.order[e] : 0;
      this.keyY[i] = sorted && O.ySort[e] ? -G.matrix.ty[e] : 0;
      this.keyTex[i] = this.itemTex[i]?.id ?? 0;
    }
    const { keyLayer, keyOrder, keyY, keyTex } = this;
    order.sort(
      (a, b) =>
        keyLayer[a] - keyLayer[b] ||
        keyOrder[a] - keyOrder[b] ||
        keyY[a] - keyY[b] ||
        keyTex[a] - keyTex[b] ||
        items[a] - items[b],
    );
    return n;
  }

  /** Sets up viewProj for a view and returns its visible world-space AABB. */
  private setView(camM: Mat3, zoom: number, vw: number, vh: number): { minX: number; minY: number; maxX: number; maxY: number } {
    const view = mat3.invert(camM) ?? mat3.identity();
    const sx = (2 * zoom) / vw;
    const sy = (2 * zoom) / vh;
    const p = this.viewProj;
    // column-major: scale(sx, sy) * view
    p[0] = sx * view.a;
    p[1] = sy * view.b;
    p[2] = 0;
    p[3] = sx * view.c;
    p[4] = sy * view.d;
    p[5] = 0;
    p[6] = sx * view.tx;
    p[7] = sy * view.ty;
    p[8] = 1;

    // world-space bounds of the view rectangle (handles camera rotation)
    const hw = vw / (2 * zoom);
    const hh = vh / (2 * zoom);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [x, y] of [[-hw, -hh], [hw, -hh], [-hw, hh], [hw, hh]]) {
      const wx = camM.a * x + camM.c * y + camM.tx;
      const wy = camM.b * x + camM.d * y + camM.ty;
      minX = Math.min(minX, wx);
      maxX = Math.max(maxX, wx);
      minY = Math.min(minY, wy);
      maxY = Math.max(maxY, wy);
    }
    this.batcher.begin(p);
    return { minX, minY, maxX, maxY };
  }

  private drawSprites(
    world: World,
    count: number,
    view: { minX: number; minY: number; maxX: number; maxY: number },
  ): void {
    const S = world.store(Sprite);
    const H = world.store(Shape2D);
    const X = world.store(Text2D);
    const g = world.store(GlobalTransform2D).matrix;
    const items = this.items;
    const batcher = this.batcher;
    let drawn = 0;

    for (let k = 0; k < count; k++) {
      const i = this.order[k];
      const e = items[i];
      const r = this.resolved[i];
      const kind = this.itemKind[i];
      if (kind === KIND_TILEMAP) {
        drawn += this.drawTileMap(world, e, r.texture, this.itemTex[i]!.tex, view);
        continue;
      }
      if (kind === KIND_PARTICLES) {
        drawn += this.drawParticles(world, e, r, this.itemTex[i]?.tex ?? null);
        continue;
      }
      // quad matrix: global * translate(-pivot * size) * scale(±size)
      const sprite = kind === KIND_SPRITE;
      const w = sprite && S.flipX[e] ? -r.width : r.width;
      const h = sprite && S.flipY[e] ? -r.height : r.height;
      const ga = g.a[e];
      const gb = g.b[e];
      const gc = g.c[e];
      const gd = g.d[e];
      const a = ga * w;
      const b = gb * w;
      const c = gc * h;
      const d = gd * h;
      const tx = g.tx[e] - a * r.pivotX - c * r.pivotY;
      const ty = g.ty[e] - b * r.pivotX - d * r.pivotY;

      // cull against the camera's view
      const x0 = tx;
      const x1 = tx + a;
      const x2 = tx + c;
      const x3 = tx + a + c;
      const y0 = ty;
      const y1 = ty + b;
      const y2 = ty + d;
      const y3 = ty + b + d;
      if (
        Math.max(x0, x1, x2, x3) < view.minX ||
        Math.min(x0, x1, x2, x3) > view.maxX ||
        Math.max(y0, y1, y2, y3) < view.minY ||
        Math.min(y0, y1, y2, y3) > view.maxY
      ) {
        continue;
      }

      if (sprite && this.naturalW[i] > 0 && r.border) {
        this.slicedSprite(this.itemTex[i]!.tex, r, this.naturalW[i], this.naturalH[i], ga, gb, gc, gd, g.tx[e], g.ty[e], S.flipX[e] !== 0, S.flipY[e] !== 0, packColor(S.color.r[e], S.color.g[e], S.color.b[e], S.color.a[e]));
        drawn++;
        continue;
      }
      if (kind === KIND_SHAPE) {
        const fill = packColor(H.fill.r[e], H.fill.g[e], H.fill.b[e], H.fill.a[e]);
        const stroke = packColor(H.stroke.r[e], H.stroke.g[e], H.stroke.b[e], H.stroke.a[e]);
        const mode = H.kind[e] === "circle" ? 2 : 1;
        batcher.pushShape(a, b, c, d, tx, ty, mode, fill, stroke, H.strokeWidth[e], H.radius[e]);
      } else {
        const C = kind === KIND_TEXT ? X.color : S.color;
        const rgba = packColor(C.r[e], C.g[e], C.b[e], C.a[e]);
        batcher.push(this.itemTex[i]!.tex, a, b, c, d, tx, ty, r.u0, r.v0, r.u1, r.v1, rgba);
      }
      drawn++;
    }
    batcher.end();
    this.stats.sprites += drawn;
  }

  /**
   * A 9-slice sprite stretched to `r.width` x `r.height` world units in the
   * entity's frame (ga..gd, tx, ty): corners keep their size, edges and middle
   * stretch. `natW`/`natH` is the sprite's own size, for the border UVs.
   */
  private slicedSprite(
    tex: WebGLTexture,
    r: ResolvedSprite,
    natW: number,
    natH: number,
    ga: number,
    gb: number,
    gc: number,
    gd: number,
    gx: number,
    gy: number,
    flipX: boolean,
    flipY: boolean,
    rgba: number,
  ): void {
    const b = r.border!;
    const W = r.width;
    const H = r.height;
    // borders shrink when the size is smaller than both borders together
    const fx = Math.min(1, W / Math.max(1e-6, b.l + b.r));
    const fy = Math.min(1, H / Math.max(1e-6, b.b + b.t));
    const xs = [0, b.l * fx, W - b.r * fx, W];
    const ys = [0, b.b * fy, H - b.t * fy, H];
    const us = [r.u0, r.u0 + ((r.u1 - r.u0) * b.l) / natW, r.u1 - ((r.u1 - r.u0) * b.r) / natW, r.u1];
    const vs = [r.v0, r.v0 + ((r.v1 - r.v0) * b.b) / natH, r.v1 - ((r.v1 - r.v0) * b.t) / natH, r.v1];
    const sx = flipX ? -1 : 1;
    const sy = flipY ? -1 : 1;
    for (let j = 0; j < 3; j++) {
      for (let i = 0; i < 3; i++) {
        const qw = (xs[i + 1] - xs[i]) * sx;
        const qh = (ys[j + 1] - ys[j]) * sy;
        if (qw === 0 || qh === 0) continue;
        // corner of this piece, relative to the pivot (mirrored when flipped)
        const lx = (xs[i] - r.pivotX * W) * sx;
        const ly = (ys[j] - r.pivotY * H) * sy;
        this.batcher.push(tex, ga * qw, gb * qw, gc * qh, gd * qh, gx + ga * lx + gc * ly, gy + gb * lx + gd * ly, us[i], vs[j], us[i + 1], vs[j + 1], rgba);
      }
    }
  }

  /** Pushes every visible tile of a TileMap. Returns how many were drawn. */
  private drawTileMap(
    world: World,
    e: Entity,
    tex: TextureAsset,
    gl: WebGLTexture,
    view: { minX: number; minY: number; maxX: number; maxY: number },
  ): number {
    const M = world.store(TileMap);
    const g = world.store(GlobalTransform2D).matrix;
    const tw = M.tileSize.x[e];
    const th = M.tileSize.y[e];
    const a = g.a[e] * tw;
    const b = g.b[e] * tw;
    const c = g.c[e] * th;
    const d = g.d[e] * th;
    const ox = g.tx[e];
    const oy = g.ty[e];
    // a tile's world AABB is its origin plus this extent (handles rotation)
    const exMinX = Math.min(0, a, c, a + c);
    const exMaxX = Math.max(0, a, c, a + c);
    const exMinY = Math.min(0, b, d, b + d);
    const exMaxY = Math.max(0, b, d, b + d);
    const rgba = packColor(M.color.r[e], M.color.g[e], M.color.b[e], M.color.a[e]);
    const tiles = M.tiles[e];
    const iw = 1 / tex.width;
    const ih = 1 / tex.height;
    let drawn = 0;
    for (const key in tiles) {
      const def = tex.sprites.get(tiles[key]);
      if (!def) continue;
      const [x, y] = parseTileKey(key);
      const tx = ox + a * x + c * y;
      const ty = oy + b * x + d * y;
      if (tx + exMaxX < view.minX || tx + exMinX > view.maxX || ty + exMaxY < view.minY || ty + exMinY > view.maxY) continue;
      const rc = def.rect;
      // inset by a hair so neighbouring sprites in the sheet don't bleed in at odd zoom levels
      const u0 = (rc.x + 0.01) * iw;
      const u1 = (rc.x + rc.w - 0.01) * iw;
      const v0 = (rc.y + rc.h - 0.01) * ih;
      const v1 = (rc.y + 0.01) * ih;
      this.batcher.push(gl, a, b, c, d, tx, ty, u0, v0, u1, v1, rgba);
      drawn++;
    }
    return drawn;
  }

  private drawParticles(world: World, e: Entity, r: ResolvedSprite, tex: WebGLTexture | null): number {
    const pool = world.resource(Particles).pools.get(e);
    if (!pool) return 0;
    const P = world.store(ParticleEmitter2D);
    const s0 = P.startSize[e];
    const s1 = P.endSize[e];
    const c0 = P.startColor;
    const c1 = P.endColor;
    // sprites keep their aspect ratio; size is the larger side
    const aspect = tex ? r.width / Math.max(1e-6, r.height) : 1;
    for (let i = 0; i < pool.count; i++) {
      const k = pool.age[i] / pool.life[i];
      const size = s0 + (s1 - s0) * k;
      const w = aspect >= 1 ? size : size * aspect;
      const h = aspect >= 1 ? size / aspect : size;
      const rgba = packColor(
        c0.r[e] + (c1.r[e] - c0.r[e]) * k,
        c0.g[e] + (c1.g[e] - c0.g[e]) * k,
        c0.b[e] + (c1.b[e] - c0.b[e]) * k,
        c0.a[e] + (c1.a[e] - c0.a[e]) * k,
      );
      const tx = pool.x[i] - w / 2;
      const ty = pool.y[i] - h / 2;
      if (tex) this.batcher.push(tex, w, 0, 0, h, tx, ty, r.u0, r.v0, r.u1, r.v1, rgba);
      else this.batcher.pushShape(w, 0, 0, h, tx, ty, 2, rgba, 0, 0, 0);
    }
    return pool.count;
  }

  /** Frees the GPU copy of a texture (e.g. evicted text). */
  releaseTexture(asset: TextureAsset): void {
    const key = asset.source;
    const gpu = key ? this.textures.get(key) : undefined;
    if (!gpu || !key) return;
    this.textures.delete(key);
    if (!this.contextLost) this.batcher.releaseTexture(gpu.tex);
  }

  /** Stops using this renderer. */
  dispose(): void {
    renderers.delete(this);
    for (const gpu of this.textures.values()) this.batcher.releaseTexture(gpu.tex);
    this.textures.clear();
    this.batcher.dispose();
  }

  private gpuTexture(asset: TextureAsset): GpuTexture | null {
    if (asset.status !== "ready" || !asset.source) return null;
    let gpu = this.textures.get(asset.source);
    if (gpu && gpu.version === asset.version) return gpu;
    const gl = this.gl;
    if (!gpu) {
      gpu = { tex: gl.createTexture()!, version: -1, id: this.nextTextureId++ };
      this.textures.set(asset.source, gpu);
    }
    gl.bindTexture(gl.TEXTURE_2D, gpu.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, asset.source as TexImageSource);
    const filter = asset.settings.filter === "nearest" ? gl.NEAREST : gl.LINEAR;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    const wrap = asset.settings.wrap === "repeat" ? gl.REPEAT : gl.CLAMP_TO_EDGE;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    gpu.version = asset.version;
    return gpu;
  }
}

const scratch = {} as ResolvedSprite;

/**
 * The matrix that maps the unit square onto an entity's drawn quad (sprite,
 * shape or text) in world space, or null if it draws nothing. Used for picking and gizmos.
 */
export function spriteQuad(world: World, e: Entity): Mat3 | null {
  if (!world.has(e, GlobalTransform2D)) return null;
  let w: number;
  let h: number;
  let px = 0.5;
  let py = 0.5;
  if (world.has(e, Sprite) && world.store(Sprite).sprite[e]) {
    const S = world.store(Sprite);
    const r = world.resource(Assets).resolve(S.sprite[e]!, scratch);
    if (!r) return null;
    const sliced = S.drawMode[e] === "sliced";
    w = sliced ? S.size.x[e] : r.width;
    h = sliced ? S.size.y[e] : r.height;
    if (S.flipX[e]) w = -w;
    if (S.flipY[e]) h = -h;
    px = r.pivotX;
    py = r.pivotY;
  } else if (world.has(e, Shape2D)) {
    const H = world.store(Shape2D);
    w = H.size.x[e];
    h = H.size.y[e];
  } else if (world.has(e, Text2D)) {
    const img = textImage(world, e);
    if (!img) return null;
    w = img.width;
    h = img.height;
    px = img.pivotX;
  } else return null;
  const g = globalOf(world, e);
  const a = g.a * w;
  const b = g.b * w;
  const c = g.c * h;
  const d = g.d * h;
  return { a, b, c, d, tx: g.tx - a * px - c * py, ty: g.ty - b * px - d * py };
}

export function globalOf(world: World, e: Entity): Mat3 {
  const g = world.store(GlobalTransform2D).matrix;
  return { a: g.a[e], b: g.b[e], c: g.c[e], d: g.d[e], tx: g.tx[e], ty: g.ty[e] };
}
