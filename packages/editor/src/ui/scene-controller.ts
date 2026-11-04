import {
  Camera2D,
  Collider2D,
  type Entity,
  GlobalTransform2D,
  type Mat3,
  Renderer,
  SortingOrder,
  Sprite,
  type SpriteRef,
  Transform2D,
  type Vec2,
  mat3,
  parentOf,
  propagateTransforms,
  spriteQuad,
} from "@brik/runtime";
import { type FieldChange, setValues, topLevel, worldMatrix } from "../core/commands";
import type { Editor } from "../core/editor";
import { placePrefab } from "../core/prefabs";
import { assetKindOf, clipThumb } from "./asset-fields";
import { spriteLabel } from "./fields";
import { DND, typingInField } from "./hooks";

const GIZMO_LEN = 70;
const ROTATE_RADIUS = 62;
const HANDLE = 7;
/** Reference resolution used to draw camera frames in the scene view. */
export const GAME_REFERENCE = { w: 960, h: 540 };

type Axis = "x" | "y" | "xy";
type Handle = { tool: "move" | "scale"; axis: Axis } | { tool: "rotate" };

interface DragItem {
  id: string;
  e: Entity;
  start: { position: Vec2; rotation: number; scale: Vec2 };
  /** World position at drag start. */
  startWorld: Vec2;
  parentInv: Mat3;
  parentSign: number;
}

type Drag =
  | { kind: "pan"; lastX: number; lastY: number }
  | {
      kind: "transform";
      handle: Handle;
      startScreen: Vec2;
      startWorld: Vec2;
      origin: Vec2;
      items: DragItem[];
      moved: boolean;
    };

/**
 * Runs the scene view: rendering through the engine renderer, plus a 2D overlay
 * for the grid, selection outlines and gizmos, and all mouse interaction.
 */
export class SceneController {
  readonly renderer: Renderer;
  private overlayCtx: CanvasRenderingContext2D;
  private raf = 0;
  private drag: Drag | null = null;
  private spaceDown = false;
  private disposers: (() => void)[] = [];
  /** World position under the mouse, for the status display. */
  cursor: Vec2 = { x: 0, y: 0 };
  onInfo?: () => void;

  constructor(
    readonly editor: Editor,
    readonly container: HTMLElement,
    readonly canvas: HTMLCanvasElement,
    readonly overlay: HTMLCanvasElement,
  ) {
    this.renderer = new Renderer(canvas);
    this.overlayCtx = overlay.getContext("2d")!;
    this.attach();
    const tick = () => {
      this.frame();
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    for (const d of this.disposers) d();
  }

  // ---------------------------------------------------------------- coordinates

  get width(): number {
    return this.container.clientWidth;
  }

  get height(): number {
    return this.container.clientHeight;
  }

  screenToWorld(sx: number, sy: number): Vec2 {
    const v = this.editor.view;
    return { x: v.x + (sx - this.width / 2) / v.zoom, y: v.y - (sy - this.height / 2) / v.zoom };
  }

  worldToScreen(wx: number, wy: number): Vec2 {
    const v = this.editor.view;
    return { x: (wx - v.x) * v.zoom + this.width / 2, y: -(wy - v.y) * v.zoom + this.height / 2 };
  }

  // ---------------------------------------------------------------- frame

  private frame(): void {
    if (this.container.clientWidth === 0) return; // tab hidden
    const world = this.editor.world;
    if (!this.editor.play.active) propagateTransforms.run(world);
    this.renderer.renderView(world, this.editor.view);
    this.drawOverlay();
  }

  private drawOverlay(): void {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = this.width;
    const h = this.height;
    if (this.overlay.width !== Math.round(w * dpr) || this.overlay.height !== Math.round(h * dpr)) {
      this.overlay.width = Math.round(w * dpr);
      this.overlay.height = Math.round(h * dpr);
    }
    const ctx = this.overlayCtx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (this.editor.showGrid) this.drawGrid(ctx);
    this.drawCameras(ctx);
    this.drawColliders(ctx);
    this.drawIcons(ctx);
    this.drawSelection(ctx);
    this.drawGizmo(ctx);
  }

  private drawGrid(ctx: CanvasRenderingContext2D): void {
    const { zoom } = this.editor.view;
    let step = this.editor.gridSize;
    while (step * zoom < 10) step *= 2;
    while (step * zoom > 160) step /= 2;
    const tl = this.screenToWorld(0, 0);
    const br = this.screenToWorld(this.width, this.height);
    ctx.lineWidth = 1;
    const line = (x0: number, y0: number, x1: number, y1: number) => {
      ctx.beginPath();
      ctx.moveTo(Math.round(x0) + 0.5, Math.round(y0) + 0.5);
      ctx.lineTo(Math.round(x1) + 0.5, Math.round(y1) + 0.5);
      ctx.stroke();
    };
    for (let x = Math.floor(tl.x / step) * step; x <= br.x; x += step) {
      const major = Math.round(x / step) % 8 === 0;
      ctx.strokeStyle = x === 0 ? "rgba(95,208,104,0.55)" : major ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.045)";
      const s = this.worldToScreen(x, 0).x;
      line(s, 0, s, this.height);
    }
    for (let y = Math.floor(br.y / step) * step; y <= tl.y; y += step) {
      const major = Math.round(y / step) % 8 === 0;
      ctx.strokeStyle = y === 0 ? "rgba(255,92,108,0.55)" : major ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.045)";
      const s = this.worldToScreen(0, y).y;
      line(0, s, this.width, s);
    }
  }

  private polygon(ctx: CanvasRenderingContext2D, m: Mat3, x0: number, y0: number, x1: number, y1: number): void {
    const pts = [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ].map(([x, y]) => {
      const p = mat3.transformPoint(m, { x, y });
      return this.worldToScreen(p.x, p.y);
    });
    ctx.beginPath();
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.closePath();
  }

  private drawCameras(ctx: CanvasRenderingContext2D): void {
    const world = this.editor.world;
    const C = world.store(Camera2D);
    ctx.save();
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = "rgba(255,255,255,0.45)";
    ctx.lineWidth = 1;
    for (const e of world.query([Camera2D, GlobalTransform2D])) {
      const hw = GAME_REFERENCE.w / 2 / C.zoom[e];
      const hh = GAME_REFERENCE.h / 2 / C.zoom[e];
      this.polygon(ctx, this.globalOf(e), -hw, -hh, hw, hh);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Collider outlines: green for solid, dashed yellow for triggers. */
  private drawColliders(ctx: CanvasRenderingContext2D): void {
    const world = this.editor.world;
    const C = world.store(Collider2D);
    ctx.save();
    ctx.lineWidth = 1.25;
    for (const e of world.query([Collider2D, GlobalTransform2D])) {
      const trigger = C.isTrigger[e] !== 0;
      ctx.strokeStyle = trigger ? "rgba(255,210,80,0.9)" : "rgba(110,230,120,0.9)";
      ctx.setLineDash(trigger ? [4, 3] : []);
      const g = this.globalOf(e);
      // scale is applied to the shape, rotation and position by the matrix
      const sx = Math.hypot(g.a, g.b) || 1;
      const sy = Math.hypot(g.c, g.d) || 1;
      const m: Mat3 = { a: g.a / sx, b: g.b / sx, c: g.c / sy, d: g.d / sy, tx: g.tx, ty: g.ty };
      const w = Math.abs(C.size.x[e] * sx);
      const h = Math.abs(C.size.y[e] * sy);
      const ox = C.offset.x[e] * sx;
      const oy = C.offset.y[e] * sy;
      const shape = C.shape[e];
      ctx.beginPath();
      if (shape === "box") {
        this.polygon(ctx, m, ox - w / 2, oy - h / 2, ox + w / 2, oy + h / 2);
      } else {
        // circle: radius w/2; capsule: two half circles joined by straight sides
        const r = shape === "circle" ? w / 2 : Math.min(w, h) / 2;
        const half = shape === "circle" ? 0 : Math.max(0, h / 2 - r);
        const pts: Vec2[] = [];
        for (let i = 0; i <= 16; i++) {
          const a = (i / 16) * Math.PI;
          pts.push({ x: ox + Math.cos(a) * r, y: oy + half + Math.sin(a) * r });
        }
        for (let i = 0; i <= 16; i++) {
          const a = Math.PI + (i / 16) * Math.PI;
          pts.push({ x: ox + Math.cos(a) * r, y: oy - half + Math.sin(a) * r });
        }
        pts.forEach((p, i) => {
          const wp = mat3.transformPoint(m, p);
          const sp = this.worldToScreen(wp.x, wp.y);
          if (i === 0) ctx.moveTo(sp.x, sp.y);
          else ctx.lineTo(sp.x, sp.y);
        });
        ctx.closePath();
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Entities without a visible sprite get a small icon so they can be seen and clicked. */
  private drawIcons(ctx: CanvasRenderingContext2D): void {
    const world = this.editor.world;
    for (const e of world.query([Transform2D, GlobalTransform2D])) {
      if (spriteQuad(world, e)) continue;
      const g = this.globalOf(e);
      const p = this.worldToScreen(g.tx, g.ty);
      ctx.fillStyle = world.has(e, Camera2D) ? "rgba(255,255,255,0.8)" : "rgba(200,205,220,0.6)";
      ctx.strokeStyle = "rgba(0,0,0,0.6)";
      ctx.beginPath();
      if (world.has(e, Camera2D)) {
        ctx.rect(p.x - 7, p.y - 5, 11, 10);
        ctx.moveTo(p.x + 4, p.y);
        ctx.lineTo(p.x + 8, p.y - 4);
        ctx.lineTo(p.x + 8, p.y + 4);
        ctx.closePath();
      } else {
        ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
      }
      ctx.fill();
      ctx.stroke();
    }
  }

  private drawSelection(ctx: CanvasRenderingContext2D): void {
    const world = this.editor.world;
    ctx.lineWidth = 1.5;
    for (const e of this.editor.selectedEntities()) {
      const q = spriteQuad(world, e);
      ctx.strokeStyle = "#4c8dff";
      if (q) {
        this.polygon(ctx, q, 0, 0, 1, 1);
        ctx.stroke();
      } else if (world.has(e, GlobalTransform2D)) {
        const g = this.globalOf(e);
        const p = this.worldToScreen(g.tx, g.ty);
        ctx.beginPath();
        ctx.arc(p.x, p.y, 9, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  // ---------------------------------------------------------------- gizmo

  /** Screen position and axis directions of the gizmo, or null if nothing is selected. */
  private gizmo(): { o: Vec2; ax: Vec2; ay: Vec2 } | null {
    const e = this.editor.selectedEntities().at(-1);
    if (e === undefined || !this.editor.world.has(e, Transform2D)) return null;
    const m = worldMatrix(this.editor.world, e);
    const o = this.worldToScreen(m.tx, m.ty);
    if (this.editor.tool !== "scale") return { o, ax: { x: 1, y: 0 }, ay: { x: 0, y: -1 } };
    // scale handles follow the entity's own axes
    const norm = (x: number, y: number) => {
      const l = Math.hypot(x, y) || 1;
      return { x: x / l, y: -y / l };
    };
    return { o, ax: norm(m.a, m.b), ay: norm(m.c, m.d) };
  }

  private drawGizmo(ctx: CanvasRenderingContext2D): void {
    const g = this.gizmo();
    if (!g) return;
    const { o, ax, ay } = g;
    const active = this.drag?.kind === "transform" ? this.drag.handle : null;
    const hl = (axis: Axis) => active && "axis" in active && active.axis === axis;
    ctx.save();
    ctx.lineWidth = 2;
    const tool = this.editor.tool;
    if (tool === "rotate") {
      ctx.strokeStyle = active ? "#ffcc00" : "#4c8dff";
      ctx.beginPath();
      ctx.arc(o.x, o.y, ROTATE_RADIUS, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "#4c8dff";
      ctx.beginPath();
      ctx.arc(o.x, o.y, 3, 0, Math.PI * 2);
      ctx.fill();
    } else {
      const axisLine = (d: Vec2, color: string, axis: Axis) => {
        const end = { x: o.x + d.x * GIZMO_LEN, y: o.y + d.y * GIZMO_LEN };
        ctx.strokeStyle = ctx.fillStyle = hl(axis) ? "#ffcc00" : color;
        ctx.beginPath();
        ctx.moveTo(o.x, o.y);
        ctx.lineTo(end.x, end.y);
        ctx.stroke();
        ctx.beginPath();
        if (tool === "move") {
          const n = { x: -d.y, y: d.x };
          ctx.moveTo(end.x + d.x * 12, end.y + d.y * 12);
          ctx.lineTo(end.x + n.x * 5, end.y + n.y * 5);
          ctx.lineTo(end.x - n.x * 5, end.y - n.y * 5);
        } else {
          ctx.rect(end.x - 5, end.y - 5, 10, 10);
        }
        ctx.fill();
      };
      axisLine(ax, "#ff5c6c", "x");
      axisLine(ay, "#5fd068", "y");
      ctx.fillStyle = hl("xy") ? "rgba(255,204,0,0.7)" : "rgba(76,141,255,0.55)";
      if (tool === "move") ctx.fillRect(o.x + 10, o.y - 24, 14, 14);
      else ctx.fillRect(o.x - HANDLE, o.y - HANDLE, HANDLE * 2, HANDLE * 2);
    }
    ctx.restore();
  }

  private hitGizmo(sx: number, sy: number): Handle | null {
    const g = this.gizmo();
    if (!g) return null;
    const { o, ax, ay } = g;
    const tool = this.editor.tool;
    if (tool === "rotate") {
      const d = Math.hypot(sx - o.x, sy - o.y);
      return Math.abs(d - ROTATE_RADIUS) < 8 ? { tool: "rotate" } : null;
    }
    if (tool === "move" && sx >= o.x + 8 && sx <= o.x + 26 && sy >= o.y - 26 && sy <= o.y - 8) return { tool, axis: "xy" };
    if (tool === "scale" && Math.abs(sx - o.x) <= HANDLE + 2 && Math.abs(sy - o.y) <= HANDLE + 2) return { tool, axis: "xy" };
    const nearAxis = (d: Vec2) => {
      const rx = sx - o.x;
      const ry = sy - o.y;
      const along = rx * d.x + ry * d.y;
      const across = Math.abs(rx * -d.y + ry * d.x);
      return along > 10 && along < GIZMO_LEN + 16 && across < 7;
    };
    if (nearAxis(ax)) return { tool, axis: "x" };
    if (nearAxis(ay)) return { tool, axis: "y" };
    return null;
  }

  // ---------------------------------------------------------------- picking

  private globalOf(e: Entity): Mat3 {
    const g = this.editor.world.store(GlobalTransform2D).matrix;
    return { a: g.a[e], b: g.b[e], c: g.c[e], d: g.d[e], tx: g.tx[e], ty: g.ty[e] };
  }

  /** The top-most entity under a screen point, or -1. */
  pick(sx: number, sy: number): Entity {
    const world = this.editor.world;
    const G = world.store(GlobalTransform2D);
    // icons (entities without sprites) are drawn on top, so test them first
    for (const e of world.query([Transform2D, GlobalTransform2D])) {
      if (spriteQuad(world, e)) continue;
      const p = this.worldToScreen(G.matrix.tx[e], G.matrix.ty[e]);
      if (Math.hypot(sx - p.x, sy - p.y) <= 9) return e;
    }
    const wp = this.screenToWorld(sx, sy);
    const O = world.store(SortingOrder);
    const hits: { e: Entity; key: number[] }[] = [];
    for (const e of world.query([GlobalTransform2D])) {
      if (!G.active[e]) continue;
      const q = spriteQuad(world, e);
      const inv = q && mat3.invert(q);
      if (!inv) continue;
      const l = mat3.transformPoint(inv, wp);
      if (l.x < 0 || l.x > 1 || l.y < 0 || l.y > 1) continue;
      const s = world.has(e, SortingOrder);
      hits.push({
        e,
        key: [s ? O.layer[e] : 0, s ? O.order[e] : 0, s && O.ySort[e] ? -G.matrix.ty[e] : 0, e],
      });
    }
    hits.sort((a, b) => {
      for (let i = 0; i < 4; i++) if (a.key[i] !== b.key[i]) return b.key[i] - a.key[i];
      return 0;
    });
    return hits[0]?.e ?? -1;
  }

  // ---------------------------------------------------------------- input

  private attach(): void {
    const el = this.container;
    const on = <K extends keyof HTMLElementEventMap>(
      target: HTMLElement | Window,
      type: K,
      fn: (ev: HTMLElementEventMap[K]) => void,
      opts?: AddEventListenerOptions,
    ) => {
      target.addEventListener(type, fn as EventListener, opts);
      this.disposers.push(() => target.removeEventListener(type, fn as EventListener, opts));
    };
    on(el, "pointerdown", (ev) => this.onDown(ev));
    on(el, "pointermove", (ev) => this.onMove(ev));
    on(el, "pointerup", (ev) => this.onUp(ev));
    on(el, "pointercancel", (ev) => this.onUp(ev));
    on(el, "contextmenu", (ev) => ev.preventDefault());
    on(el, "wheel", (ev) => this.onWheel(ev), { passive: false });
    on(window, "keydown", (ev) => {
      if (ev.code === "Space" && !typingInField()) this.spaceDown = true;
    });
    on(window, "keyup", (ev) => {
      if (ev.code === "Space") this.spaceDown = false;
    });
    on(el, "dragover", (ev) => {
      if (ev.dataTransfer?.types.includes(DND.sprite) || ev.dataTransfer?.types.includes(DND.asset)) {
        ev.preventDefault();
        el.classList.add("drop-target");
      }
    });
    on(el, "dragleave", () => el.classList.remove("drop-target"));
    on(el, "drop", (ev) => this.onDrop(ev));
  }

  private local(ev: MouseEvent): Vec2 {
    const r = this.container.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  }

  private onDown(ev: PointerEvent): void {
    this.container.setPointerCapture(ev.pointerId);
    (document.activeElement as HTMLElement | null)?.blur?.();
    const p = this.local(ev);
    if (ev.button === 1 || ev.button === 2 || (ev.button === 0 && this.spaceDown)) {
      this.drag = { kind: "pan", lastX: ev.clientX, lastY: ev.clientY };
      this.container.style.cursor = "grabbing";
      return;
    }
    if (ev.button !== 0) return;
    const editor = this.editor;
    const handle = this.hitGizmo(p.x, p.y);
    if (handle) {
      this.beginTransform(handle, p);
      return;
    }
    const e = this.pick(p.x, p.y);
    if (e < 0) {
      if (!ev.ctrlKey && !ev.metaKey) editor.select([]);
      return;
    }
    const id = editor.idOf(e);
    if (ev.ctrlKey || ev.metaKey) {
      editor.toggleSelect(id);
      return;
    }
    if (!editor.selection.includes(id)) editor.select([id]);
    else editor.select([...editor.selection.filter((s) => s !== id), id]); // make it the active one
    this.beginTransform({ tool: "move", axis: "xy" }, p);
  }

  private beginTransform(handle: Handle, p: Vec2): void {
    const world = this.editor.world;
    const items: DragItem[] = topLevel(world, this.editor.selection)
      .filter((e) => world.has(e, Transform2D))
      .map((e) => {
        const parent = parentOf(world, e);
        const pm = parent >= 0 ? worldMatrix(world, parent) : mat3.identity();
        const t = world.read(e, Transform2D);
        const wm = worldMatrix(world, e);
        return {
          id: this.editor.idOf(e),
          e,
          startWorld: { x: wm.tx, y: wm.ty },
          start: { position: { ...t.position }, rotation: t.rotation, scale: { ...t.scale } },
          parentInv: mat3.invert(pm) ?? mat3.identity(),
          parentSign: Math.sign(pm.a * pm.d - pm.b * pm.c) || 1,
        };
      });
    if (items.length === 0) return;
    const g = this.gizmo();
    this.drag = {
      kind: "transform",
      handle,
      startScreen: p,
      startWorld: this.screenToWorld(p.x, p.y),
      origin: g?.o ?? p,
      items,
      moved: false,
    };
  }

  private onMove(ev: PointerEvent): void {
    const p = this.local(ev);
    this.cursor = this.screenToWorld(p.x, p.y);
    this.onInfo?.();
    const drag = this.drag;
    if (!drag) {
      const hover = this.hitGizmo(p.x, p.y);
      this.container.style.cursor = this.spaceDown ? "grab" : hover ? "pointer" : "";
      return;
    }
    if (drag.kind === "pan") {
      const v = this.editor.view;
      v.x -= (ev.clientX - drag.lastX) / v.zoom;
      v.y += (ev.clientY - drag.lastY) / v.zoom;
      drag.lastX = ev.clientX;
      drag.lastY = ev.clientY;
      return;
    }
    if (!drag.moved && Math.hypot(p.x - drag.startScreen.x, p.y - drag.startScreen.y) < 3) return;
    drag.moved = true;
    this.applyTransform(drag, p, ev.ctrlKey || ev.metaKey);
    this.editor.emit("world");
  }

  private applyTransform(drag: Extract<Drag, { kind: "transform" }>, p: Vec2, invertSnap: boolean): void {
    const world = this.editor.world;
    const T = world.store(Transform2D);
    const snap = this.editor.snap !== invertSnap;
    const h = drag.handle;

    if (h.tool === "move") {
      const cur = this.screenToWorld(p.x, p.y);
      let dx = h.axis === "y" ? 0 : cur.x - drag.startWorld.x;
      let dy = h.axis === "x" ? 0 : cur.y - drag.startWorld.y;
      if (snap) {
        // snap the active entity's world position to the grid, move the rest by the same amount
        const { startWorld } = drag.items.at(-1)!;
        const g = this.editor.gridSize;
        if (h.axis !== "y") dx = Math.round((startWorld.x + dx) / g) * g - startWorld.x;
        if (h.axis !== "x") dy = Math.round((startWorld.y + dy) / g) * g - startWorld.y;
      }
      for (const it of drag.items) {
        const local = mat3.transformVector(it.parentInv, { x: dx, y: dy });
        T.position.x[it.e] = it.start.position.x + local.x;
        T.position.y[it.e] = it.start.position.y + local.y;
      }
    } else if (h.tool === "rotate") {
      const o = drag.origin;
      const a0 = Math.atan2(-(drag.startScreen.y - o.y), drag.startScreen.x - o.x);
      const a1 = Math.atan2(-(p.y - o.y), p.x - o.x);
      let delta = a1 - a0;
      if (snap) delta = Math.round(delta / (Math.PI / 12)) * (Math.PI / 12);
      for (const it of drag.items) T.rotation[it.e] = it.start.rotation + delta * it.parentSign;
    } else {
      const o = drag.origin;
      const g = this.gizmo();
      let fx = 1;
      let fy = 1;
      if (h.axis === "xy") {
        fx = fy = Math.max(0.01, 1 + (p.x - drag.startScreen.x) / 100);
      } else if (g) {
        const d = h.axis === "x" ? g.ax : g.ay;
        const along = (q: Vec2) => (q.x - o.x) * d.x + (q.y - o.y) * d.y;
        const start = along(drag.startScreen) || 1;
        const f = along(p) / start;
        if (h.axis === "x") fx = f;
        else fy = f;
      }
      for (const it of drag.items) {
        let sx = it.start.scale.x * fx;
        let sy = it.start.scale.y * fy;
        if (snap) {
          sx = Math.round(sx * 10) / 10;
          sy = Math.round(sy * 10) / 10;
        }
        T.scale.x[it.e] = sx;
        T.scale.y[it.e] = sy;
      }
    }
  }

  private onUp(ev: PointerEvent): void {
    const drag = this.drag;
    this.drag = null;
    this.container.style.cursor = "";
    if (this.container.hasPointerCapture(ev.pointerId)) this.container.releasePointerCapture(ev.pointerId);
    if (!drag || drag.kind !== "transform" || !drag.moved) return;
    const world = this.editor.world;
    const changes: FieldChange[] = drag.items
      .filter((it) => world.isAlive(it.e))
      .map((it) => ({ id: it.id, component: "Transform2D", before: { ...it.start }, after: world.read(it.e, Transform2D) }));
    const label = { move: "Flyt", rotate: "Rotér", scale: "Skalér" }[drag.handle.tool];
    this.editor.push(setValues(world, label, changes));
  }

  private onWheel(ev: WheelEvent): void {
    ev.preventDefault();
    const p = this.local(ev);
    const before = this.screenToWorld(p.x, p.y);
    const v = this.editor.view;
    v.zoom = Math.min(64, Math.max(0.05, v.zoom * Math.exp(-ev.deltaY * 0.0015)));
    const after = this.screenToWorld(p.x, p.y);
    v.x += before.x - after.x;
    v.y += before.y - after.y;
    this.onInfo?.();
  }

  private onDrop(ev: DragEvent): void {
    this.container.classList.remove("drop-target");
    const raw = ev.dataTransfer?.getData(DND.sprite);
    const assetPath = ev.dataTransfer?.getData(DND.asset);
    if (!raw && !assetPath) return;
    ev.preventDefault();
    const p = this.local(ev);
    let { x, y } = this.screenToWorld(p.x, p.y);
    if (this.editor.snap) {
      const g = this.editor.gridSize;
      x = Math.round(x / g) * g;
      y = Math.round(y / g) * g;
    }
    const editor = this.editor;
    if (raw) {
      const sprite = JSON.parse(raw) as SpriteRef;
      editor.createEntity("sprite", { sprite, x, y, name: spriteLabel(editor, sprite) });
      return;
    }
    const kind = assetKindOf(assetPath!);
    if (kind === "prefab") {
      const guid = editor.db.prefabs.get(assetPath!)?.guid;
      if (guid) placePrefab(editor, guid, { x, y });
    } else if (kind === "clip") {
      const entry = editor.db.clips.get(assetPath!);
      if (entry) editor.createEntity("animated", { x, y, name: entry.name, clip: entry.guid, sprite: clipThumb(editor, entry.guid) ?? undefined });
    } else if (kind === "audio") {
      const entry = editor.db.sounds.get(assetPath!);
      if (entry) editor.createEntity("sound", { x, y, name: entry.name, extra: { AudioSource: { clip: entry.guid } } });
    }
  }

  /** Centers the view on the selection (or everything) and zooms to fit. */
  frameSelection(): void {
    const world = this.editor.world;
    propagateTransforms.run(world);
    let ents = this.editor.selectedEntities();
    if (ents.length === 0) ents = [...world.query([Transform2D])];
    if (ents.length === 0) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const add = (x: number, y: number) => {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    };
    for (const e of ents) {
      const q = spriteQuad(world, e);
      if (q) {
        for (const [x, y] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
          const p = mat3.transformPoint(q, { x, y });
          add(p.x, p.y);
        }
      } else {
        const g = this.globalOf(e);
        add(g.tx, g.ty);
      }
    }
    const v = this.editor.view;
    v.x = (minX + maxX) / 2;
    v.y = (minY + maxY) / 2;
    const w = Math.max(maxX - minX, 32);
    const h = Math.max(maxY - minY, 32);
    v.zoom = Math.min(16, Math.max(0.05, Math.min(this.width / (w * 1.4), this.height / (h * 1.4))));
    this.onInfo?.();
  }
}
