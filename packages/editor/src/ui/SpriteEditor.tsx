import { type Slicing, type SpriteDef, type TextureMeta, autoSliceRects, newGuid, sliceSprites } from "@brik/runtime";
import { For, Show, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { textureName } from "../core/asset-db";
import type { Editor } from "../core/editor";
import { PIVOTS } from "./AssetInspector";
import { NumberBox, TextBox } from "./fields";
import { reportError, toast, typingInField } from "./hooks";

type GridSlicing = Extract<Slicing, { mode: "grid" }>;
type Rect = { x: number; y: number; w: number; h: number };

type Drag =
  | { kind: "pan"; sx: number; sy: number; ox: number; oy: number }
  | { kind: "create"; x0: number; y0: number }
  | { kind: "move"; id: string; dx: number; dy: number; start: Rect }
  | { kind: "resize"; id: string; corner: number; start: Rect }
  | { kind: "pivot"; id: string }
  | { kind: "border"; id: string; side: "l" | "r" | "t" | "b" };

/**
 * Full-screen editor for a texture's sprites: grid, automatic and hand-drawn
 * slicing, names, pivots and 9-slice borders. Changes are saved to the
 * texture's `.meta.json` with "Gem".
 */
export function SpriteEditor(props: { editor: Editor; path: string; onClose: () => void }) {
  const editor = props.editor;
  const entry = () => editor.db.textures.get(props.path);
  const tex = () => entry()?.asset;
  const [draft, setDraftRaw] = createSignal<TextureMeta>(structuredClone(entry()!.meta));
  const [selected, setSelected] = createSignal<string | null>(draft().sprites[0]?.id ?? null);
  const [view, setView] = createSignal({ zoom: 4, ox: 20, oy: 20 });
  const [hoverCursor, setHoverCursor] = createSignal("default");
  const past: TextureMeta[] = [];
  const future: TextureMeta[] = [];

  /** Every change goes through here so it can be undone (Ctrl+Z). */
  const setDraft = (next: TextureMeta, record = true) => {
    if (record) {
      past.push(draft());
      if (past.length > 100) past.shift();
      future.length = 0;
    }
    setDraftRaw(next);
  };
  const undo = () => {
    const prev = past.pop();
    if (prev) {
      future.push(draft());
      setDraftRaw(prev);
    }
  };
  const redo = () => {
    const next = future.pop();
    if (next) {
      past.push(draft());
      setDraftRaw(next);
    }
  };

  const changed = () => JSON.stringify(draft()) !== JSON.stringify(entry()?.meta);
  const sel = (): SpriteDef | undefined => draft().sprites.find((s) => s.id === selected());
  const manual = () => draft().slicing.mode === "manual";
  const base = () => textureName(props.path);

  const updateSprite = (id: string, patch: Partial<SpriteDef>, record = true) => {
    setDraft({ ...draft(), sprites: draft().sprites.map((s) => (s.id === id ? { ...s, ...patch } : s)) }, record);
  };

  // ------------------------------------------------------------ slicing modes

  const setMode = (mode: Slicing["mode"]) => {
    const t = tex()!;
    const d = draft();
    if (mode === "single") setDraft({ ...d, slicing: { mode }, sprites: [] });
    else if (mode === "manual") setDraft({ ...d, slicing: { mode }, sprites: d.sprites.map((s) => ({ ...s })) });
    else {
      const slicing: GridSlicing = {
        mode: "grid",
        cell: [Math.min(16, t.width), Math.min(16, t.height)],
        offset: [0, 0],
        spacing: [0, 0],
        pivot: [0.5, 0.5],
      };
      setDraft({ ...d, slicing, sprites: sliceSprites(slicing, t.width, t.height, base(), d.sprites) });
    }
  };

  const setGrid = (patch: Partial<GridSlicing>) => {
    const d = draft();
    if (d.slicing.mode !== "grid") return;
    const slicing = { ...d.slicing, ...patch };
    const t = tex()!;
    setDraft({ ...d, slicing, sprites: sliceSprites(slicing, t.width, t.height, base(), d.sprites) });
  };

  /** Finds sprites by transparency and switches to manual mode. Existing sprites keep their id and name (see matchSprites). */
  const autoSlice = () => {
    const t = tex();
    const img = t?.source as CanvasImageSource | null;
    if (!t || !img) return;
    const c = document.createElement("canvas");
    c.width = t.width;
    c.height = t.height;
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0);
    const rects = autoSliceRects(ctx.getImageData(0, 0, t.width, t.height).data, t.width, t.height);
    const sprites = matchSprites(draft().sprites, rects, base());
    setDraft({ ...draft(), slicing: { mode: "manual" }, sprites });
    setSelected(sprites[0]?.id ?? null);
    toast(`${sprites.length} sprites fundet`);
  };

  const renameAll = () => {
    const prefix = prompt("Navn på alle sprites (de får _0, _1 …):", base());
    if (!prefix) return;
    setDraft({ ...draft(), sprites: draft().sprites.map((s, i) => ({ ...s, name: `${prefix}_${i}` })) });
  };

  const deleteSelected = () => {
    const id = selected();
    if (!id || !manual()) return;
    setDraft({ ...draft(), sprites: draft().sprites.filter((s) => s.id !== id) });
    setSelected(null);
  };

  /** Pivot for the selected sprite; in grid mode it applies to all sprites (the grid owns the pivot). */
  const setPivot = (x: number, y: number, record = true) => {
    const p = { x: clamp01(x), y: clamp01(y) };
    const d = draft();
    if (d.slicing.mode === "grid") {
      setDraft({ ...d, slicing: { ...d.slicing, pivot: [p.x, p.y] }, sprites: d.sprites.map((s) => ({ ...s, pivot: { ...p } })) }, record);
    } else if (selected()) updateSprite(selected()!, { pivot: p }, record);
  };

  const save = async () => {
    try {
      await editor.db.saveMeta(props.path, draft());
      editor.emit("assets");
      editor.emit("world");
      toast("Sprites gemt");
    } catch (err) {
      reportError(err, "Kunne ikke gemme");
    }
  };

  const close = () => {
    if (changed() && !confirm("Der er ændringer, der ikke er gemt. Luk alligevel?")) return;
    props.onClose();
  };

  // ------------------------------------------------------------ canvas

  let canvas!: HTMLCanvasElement;
  let wrap!: HTMLDivElement;
  let drag: Drag | null = null;
  let creating: Rect | null = null;
  const [redraw, setRedraw] = createSignal(0);

  const toImage = (sx: number, sy: number) => {
    const v = view();
    return { x: (sx - v.ox) / v.zoom, y: (sy - v.oy) / v.zoom };
  };
  const toScreen = (x: number, y: number) => {
    const v = view();
    return { x: v.ox + x * v.zoom, y: v.oy + y * v.zoom };
  };

  const fit = () => {
    const t = tex();
    if (!t || !wrap.clientWidth) return;
    const zoom = Math.max(1, Math.floor(Math.min((wrap.clientWidth - 40) / t.width, (wrap.clientHeight - 40) / t.height)));
    setView({ zoom, ox: Math.round((wrap.clientWidth - t.width * zoom) / 2), oy: Math.round((wrap.clientHeight - t.height * zoom) / 2) });
  };

  const draw = () => {
    redraw();
    const t = tex();
    const img = t?.source as CanvasImageSource | null;
    if (!t || !img || !canvas) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const W = wrap.clientWidth;
    const H = wrap.clientHeight;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
    }
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const v = view();
    // checkerboard behind the image
    const iw = t.width * v.zoom;
    const ih = t.height * v.zoom;
    const cs = Math.max(4, Math.min(16, v.zoom * 4));
    ctx.fillStyle = "#2a2b30";
    ctx.fillRect(v.ox, v.oy, iw, ih);
    ctx.fillStyle = "#33353b";
    for (let y = 0; y < ih; y += cs) for (let x = (Math.floor(y / cs) % 2) * cs; x < iw; x += cs * 2) ctx.fillRect(v.ox + x, v.oy + y, Math.min(cs, iw - x), Math.min(cs, ih - y));
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, v.ox, v.oy, iw, ih);
    // pixel grid when zoomed in
    if (v.zoom >= 8) {
      ctx.strokeStyle = "rgba(255,255,255,0.06)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x <= t.width; x++) {
        ctx.moveTo(v.ox + x * v.zoom + 0.5, v.oy);
        ctx.lineTo(v.ox + x * v.zoom + 0.5, v.oy + ih);
      }
      for (let y = 0; y <= t.height; y++) {
        ctx.moveTo(v.ox, v.oy + y * v.zoom + 0.5);
        ctx.lineTo(v.ox + iw, v.oy + y * v.zoom + 0.5);
      }
      ctx.stroke();
    }
    const d = draft();
    for (const s of d.sprites) {
      const isSel = s.id === selected();
      const p = toScreen(s.rect.x, s.rect.y);
      ctx.strokeStyle = isSel ? "#4c8dff" : "rgba(76,141,255,0.55)";
      ctx.lineWidth = isSel ? 2 : 1;
      ctx.strokeRect(p.x + 0.5, p.y + 0.5, s.rect.w * v.zoom - 1, s.rect.h * v.zoom - 1);
      if (!isSel) continue;
      // 9-slice borders
      if (s.border) {
        const b = s.border;
        ctx.save();
        ctx.setLineDash([4, 3]);
        ctx.strokeStyle = "#5fd068";
        ctx.lineWidth = 1;
        ctx.beginPath();
        const xl = p.x + b.l * v.zoom;
        const xr = p.x + (s.rect.w - b.r) * v.zoom;
        const yt = p.y + b.t * v.zoom;
        const yb = p.y + (s.rect.h - b.b) * v.zoom;
        ctx.moveTo(xl, p.y);
        ctx.lineTo(xl, p.y + s.rect.h * v.zoom);
        ctx.moveTo(xr, p.y);
        ctx.lineTo(xr, p.y + s.rect.h * v.zoom);
        ctx.moveTo(p.x, yt);
        ctx.lineTo(p.x + s.rect.w * v.zoom, yt);
        ctx.moveTo(p.x, yb);
        ctx.lineTo(p.x + s.rect.w * v.zoom, yb);
        ctx.stroke();
        ctx.restore();
      }
      // resize handles (manual only)
      if (d.slicing.mode === "manual") {
        ctx.fillStyle = "#4c8dff";
        for (const [cx, cy] of corners(s.rect)) {
          const q = toScreen(cx, cy);
          ctx.fillRect(q.x - 4, q.y - 4, 8, 8);
        }
      }
      // pivot (y up inside the sprite)
      const pv = pivotScreen(s);
      ctx.beginPath();
      ctx.arc(pv.x, pv.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = "#ffcc00";
      ctx.fill();
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    if (creating) {
      const p = toScreen(creating.x, creating.y);
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = "#fff";
      ctx.strokeRect(p.x + 0.5, p.y + 0.5, creating.w * v.zoom, creating.h * v.zoom);
      ctx.setLineDash([]);
    }
  };

  const pivotScreen = (s: SpriteDef) => toScreen(s.rect.x + s.pivot.x * s.rect.w, s.rect.y + (1 - s.pivot.y) * s.rect.h);

  /** What is under a screen point, for the cursor and for starting drags. */
  const hit = (sx: number, sy: number): Drag | { kind: "select"; id: string } | null => {
    const s = sel();
    const v = view();
    if (s) {
      const pv = pivotScreen(s);
      if (Math.hypot(sx - pv.x, sy - pv.y) <= 7) return { kind: "pivot", id: s.id };
      if (manual()) {
        const cs = corners(s.rect);
        for (let i = 0; i < 4; i++) {
          const q = toScreen(cs[i][0], cs[i][1]);
          if (Math.abs(sx - q.x) <= 6 && Math.abs(sy - q.y) <= 6) return { kind: "resize", id: s.id, corner: i, start: { ...s.rect } };
        }
      }
      if (s.border) {
        const p = toScreen(s.rect.x, s.rect.y);
        const inY = sy >= p.y && sy <= p.y + s.rect.h * v.zoom;
        const inX = sx >= p.x && sx <= p.x + s.rect.w * v.zoom;
        if (inY && Math.abs(sx - (p.x + s.border.l * v.zoom)) <= 4) return { kind: "border", id: s.id, side: "l" };
        if (inY && Math.abs(sx - (p.x + (s.rect.w - s.border.r) * v.zoom)) <= 4) return { kind: "border", id: s.id, side: "r" };
        if (inX && Math.abs(sy - (p.y + s.border.t * v.zoom)) <= 4) return { kind: "border", id: s.id, side: "t" };
        if (inX && Math.abs(sy - (p.y + (s.rect.h - s.border.b) * v.zoom)) <= 4) return { kind: "border", id: s.id, side: "b" };
      }
    }
    const ip = toImage(sx, sy);
    // smallest sprite under the point wins, so nested ones can be picked
    const under = draft()
      .sprites.filter((r) => ip.x >= r.rect.x && ip.x < r.rect.x + r.rect.w && ip.y >= r.rect.y && ip.y < r.rect.y + r.rect.h)
      .sort((a, b) => a.rect.w * a.rect.h - b.rect.w * b.rect.h)[0];
    if (under) return { kind: "select", id: under.id };
    return null;
  };

  const local = (ev: MouseEvent) => {
    const r = canvas.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  };

  const onDown = (ev: PointerEvent) => {
    canvas.setPointerCapture(ev.pointerId);
    const p = local(ev);
    if (ev.button === 1 || ev.button === 2) {
      const v = view();
      drag = { kind: "pan", sx: p.x, sy: p.y, ox: v.ox, oy: v.oy };
      return;
    }
    const h = hit(p.x, p.y);
    const ip = toImage(p.x, p.y);
    if (h?.kind === "select") {
      setSelected(h.id);
      const s = sel()!;
      if (manual()) {
        past.push(draft());
        drag = { kind: "move", id: s.id, dx: ip.x - s.rect.x, dy: ip.y - s.rect.y, start: { ...s.rect } };
      }
    } else if (h) {
      past.push(draft());
      drag = h;
    } else if (manual()) {
      drag = { kind: "create", x0: Math.round(ip.x), y0: Math.round(ip.y) };
    } else {
      setSelected(null);
    }
    setRedraw((n) => n + 1);
  };

  const onMove = (ev: PointerEvent) => {
    const p = local(ev);
    if (!drag) {
      const h = hit(p.x, p.y);
      setHoverCursor(
        !h ? (manual() ? "crosshair" : "default")
          : h.kind === "select" ? (manual() ? "move" : "pointer")
            : h.kind === "border" ? (h.side === "l" || h.side === "r" ? "ew-resize" : "ns-resize")
              : h.kind === "resize" ? "nwse-resize"
                : "grab",
      );
      return;
    }
    const t = tex()!;
    const ip = toImage(p.x, p.y);
    const px = Math.round(ip.x);
    const py = Math.round(ip.y);
    switch (drag.kind) {
      case "pan":
        setView({ ...view(), ox: drag.ox + p.x - drag.sx, oy: drag.oy + p.y - drag.sy });
        break;
      case "create": {
        const x = clamp(Math.min(drag.x0, px), 0, t.width);
        const y = clamp(Math.min(drag.y0, py), 0, t.height);
        creating = { x, y, w: clamp(Math.max(drag.x0, px), 0, t.width) - x, h: clamp(Math.max(drag.y0, py), 0, t.height) - y };
        break;
      }
      case "move": {
        const r = drag.start;
        const x = clamp(Math.round(ip.x - drag.dx), 0, t.width - r.w);
        const y = clamp(Math.round(ip.y - drag.dy), 0, t.height - r.h);
        updateSprite(drag.id, { rect: { ...r, x, y } }, false);
        break;
      }
      case "resize": {
        const r = drag.start;
        // corners: 0 top-left, 1 top-right, 2 bottom-right, 3 bottom-left
        let x0 = r.x;
        let y0 = r.y;
        let x1 = r.x + r.w;
        let y1 = r.y + r.h;
        if (drag.corner === 0 || drag.corner === 3) x0 = clamp(px, 0, x1 - 1);
        else x1 = clamp(px, x0 + 1, t.width);
        if (drag.corner === 0 || drag.corner === 1) y0 = clamp(py, 0, y1 - 1);
        else y1 = clamp(py, y0 + 1, t.height);
        updateSprite(drag.id, { rect: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } }, false);
        break;
      }
      case "pivot": {
        const s = sel()!;
        // snap to whole pixels and halves, which is what pixel art wants
        const fx = Math.round((ip.x - s.rect.x) * 2) / 2 / s.rect.w;
        const fy = 1 - Math.round((ip.y - s.rect.y) * 2) / 2 / s.rect.h;
        setPivot(fx, fy, false);
        break;
      }
      case "border": {
        const s = sel()!;
        const b = { ...(s.border ?? { l: 0, b: 0, r: 0, t: 0 }) };
        const lx = clamp(px - s.rect.x, 0, s.rect.w);
        const ly = clamp(py - s.rect.y, 0, s.rect.h);
        if (drag.side === "l") b.l = Math.min(lx, s.rect.w - b.r);
        if (drag.side === "r") b.r = Math.min(s.rect.w - lx, s.rect.w - b.l);
        if (drag.side === "t") b.t = Math.min(ly, s.rect.h - b.b);
        if (drag.side === "b") b.b = Math.min(s.rect.h - ly, s.rect.h - b.t);
        updateSprite(s.id, { border: b }, false);
        break;
      }
    }
    setRedraw((n) => n + 1);
  };

  const onUp = () => {
    if (drag?.kind === "create" && creating && creating.w > 0 && creating.h > 0) {
      const sprite: SpriteDef = {
        id: newGuid(),
        name: `${base()}_${draft().sprites.length}`,
        rect: creating,
        pivot: { x: 0.5, y: 0.5 },
      };
      setDraft({ ...draft(), sprites: [...draft().sprites, sprite] });
      setSelected(sprite.id);
    }
    // drags recorded their starting state in `past` already; drop it if nothing changed
    if (drag && drag.kind !== "pan" && drag.kind !== "create" && JSON.stringify(past.at(-1)) === JSON.stringify(draft())) past.pop();
    else if (drag && drag.kind !== "pan" && drag.kind !== "create") future.length = 0;
    drag = null;
    creating = null;
    setRedraw((n) => n + 1);
  };

  const onWheel = (ev: WheelEvent) => {
    ev.preventDefault();
    const p = local(ev);
    const v = view();
    const zoom = clamp(ev.deltaY < 0 ? v.zoom * 1.25 : v.zoom / 1.25, 0.25, 64);
    // keep the image point under the cursor in place
    const ix = (p.x - v.ox) / v.zoom;
    const iy = (p.y - v.oy) / v.zoom;
    setView({ zoom, ox: p.x - ix * zoom, oy: p.y - iy * zoom });
  };

  const onKey = (ev: KeyboardEvent) => {
    if (typingInField()) return;
    const mod = ev.ctrlKey || ev.metaKey;
    if (ev.key === "Escape") close();
    else if (mod && ev.key.toLowerCase() === "z") {
      ev.preventDefault();
      if (ev.shiftKey) redo();
      else undo();
    } else if (mod && ev.key.toLowerCase() === "s") {
      ev.preventDefault();
      void save();
    } else if (ev.key === "Delete" || ev.key === "Backspace") deleteSelected();
    else if (ev.key === "f") fit();
    else return;
    ev.stopPropagation();
  };

  onMount(() => {
    window.addEventListener("keydown", onKey, true);
    const ro = new ResizeObserver(() => setRedraw((n) => n + 1));
    ro.observe(wrap);
    requestAnimationFrame(fit);
    onCleanup(() => {
      window.removeEventListener("keydown", onKey, true);
      ro.disconnect();
    });
  });
  createEffect(draw);

  const grid = (): GridSlicing | null => (draft().slicing.mode === "grid" ? (draft().slicing as GridSlicing) : null);

  return (
    <div class="tool-window">
      <div class="tool-header">
        <strong>Sprite-editor</strong>
        <span class="readonly">{props.path}</span>
        <span class="spacer" />
        <span class="readonly">
          {tex()?.width} × {tex()?.height} px · {Math.round(view().zoom * 100)}%
        </span>
        <button onClick={fit} title="Tilpas (F)">
          Tilpas
        </button>
        <button class="primary" disabled={!changed()} onClick={save} title="Ctrl+S">
          Gem
        </button>
        <button onClick={close} title="Esc">
          Luk
        </button>
      </div>
      <div class="tool-body">
        <div
          class="tool-canvas"
          ref={wrap}
          style={{ cursor: hoverCursor() }}
          onContextMenu={(ev) => ev.preventDefault()}
        >
          <canvas ref={canvas} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onWheel={onWheel} />
          <div class="tool-hint">
            {manual()
              ? "Træk for at tegne en sprite · træk i hjørner for at ændre størrelse · Delete sletter"
              : "Vælg en sprite for at sætte pivot og 9-slice"}{" "}
            · højreklik-træk panorerer · hjul zoomer · Ctrl+Z fortryder
          </div>
        </div>
        <div class="tool-side">
          <div class="section-title">Opdeling</div>
          <div class="component-body">
            <span class="field-label">Tilstand</span>
            <select value={draft().slicing.mode} onChange={(ev) => setMode(ev.currentTarget.value as Slicing["mode"])}>
              <option value="single">Hele billedet</option>
              <option value="grid">Grid</option>
              <option value="manual">Manuel</option>
            </select>
            <Show when={grid()}>
              {(g) => (
                <>
                  <span class="field-label">Celle</span>
                  <Pair value={() => g().cell} min={1} onChange={(cell) => setGrid({ cell })} />
                  <span class="field-label">Offset</span>
                  <Pair value={() => g().offset} min={0} onChange={(offset) => setGrid({ offset })} />
                  <span class="field-label">Mellemrum</span>
                  <Pair value={() => g().spacing} min={0} onChange={(spacing) => setGrid({ spacing })} />
                </>
              )}
            </Show>
          </div>
          <div class="button-row">
            <button onClick={autoSlice} title="Find sprites ud fra gennemsigtighed">
              Find automatisk
            </button>
            <Show when={draft().slicing.mode === "grid"}>
              <button onClick={() => setMode("manual")} title="Behold cellerne, men gør dem frit redigerbare">
                Gør manuel
              </button>
            </Show>
            <button onClick={renameAll} disabled={draft().sprites.length === 0}>
              Omdøb alle
            </button>
          </div>

          <div class="section-title">Sprites ({draft().sprites.length})</div>
          <div class="sprite-list">
            <For each={draft().sprites} fallback={<div class="empty-note">Hele billedet er én sprite</div>}>
              {(s) => (
                <div class="sprite-row" classList={{ selected: s.id === selected() }} onClick={() => setSelected(s.id)}>
                  {s.name}
                  <span class="readonly">
                    {s.rect.w}×{s.rect.h}
                    {s.border ? " · 9" : ""}
                  </span>
                </div>
              )}
            </For>
          </div>

          <Show when={sel()}>
            {(s) => (
              <>
                <div class="section-title">Valgt sprite</div>
                <div class="component-body">
                  <span class="field-label">Navn</span>
                  <TextBox value={() => s().name} onCommit={(name) => updateSprite(s().id, { name })} />
                  <span class="field-label">Rektangel</span>
                  <div class="field-row">
                    <For each={["x", "y", "w", "h"] as const}>
                      {(k) => (
                        <div class="part">
                          <span>{k.toUpperCase()}</span>
                          <NumberBox
                            value={() => s().rect[k]}
                            integer
                            min={k === "w" || k === "h" ? 1 : 0}
                            onCommit={(v) => manual() && updateSprite(s().id, { rect: { ...s().rect, [k]: v } })}
                          />
                        </div>
                      )}
                    </For>
                  </div>
                  <span class="field-label">Pivot</span>
                  <select
                    value={JSON.stringify([s().pivot.x, s().pivot.y])}
                    onChange={(ev) => {
                      const [x, y] = JSON.parse(ev.currentTarget.value) as [number, number];
                      setPivot(x, y);
                    }}
                  >
                    <For each={PIVOTS}>{(p) => <option value={JSON.stringify(p.value)}>{p.label}</option>}</For>
                    <Show when={!PIVOTS.some((p) => p.value[0] === s().pivot.x && p.value[1] === s().pivot.y)}>
                      <option value={JSON.stringify([s().pivot.x, s().pivot.y])}>
                        Egen ({s().pivot.x.toFixed(2)}, {s().pivot.y.toFixed(2)})
                      </option>
                    </Show>
                  </select>
                  <span class="field-label" title="Kanter der ikke strækkes, når spriten skaleres (UI-paneler, knapper)">
                    9-slice
                  </span>
                  <Show
                    when={s().border}
                    fallback={
                      <button
                        onClick={() => {
                          const q = Math.max(1, Math.floor(Math.min(s().rect.w, s().rect.h) / 3));
                          updateSprite(s().id, { border: { l: q, b: q, r: q, t: q } });
                        }}
                      >
                        Tilføj kanter
                      </button>
                    }
                  >
                    {(b) => (
                      <div class="field-row">
                        <For each={["l", "b", "r", "t"] as const}>
                          {(k) => (
                            <div class="part" title={{ l: "venstre", b: "bund", r: "højre", t: "top" }[k]}>
                              <span>{k.toUpperCase()}</span>
                              <NumberBox
                                value={() => b()[k]}
                                integer
                                min={0}
                                onCommit={(v) => updateSprite(s().id, { border: { ...b(), [k]: v } })}
                              />
                            </div>
                          )}
                        </For>
                        <button class="ghost danger" title="Fjern 9-slice" onClick={() => updateSprite(s().id, { border: undefined })}>
                          ✕
                        </button>
                      </div>
                    )}
                  </Show>
                </div>
                <Show when={manual()}>
                  <div class="button-row">
                    <button class="danger" onClick={deleteSelected}>
                      Slet sprite
                    </button>
                  </div>
                </Show>
              </>
            )}
          </Show>
        </div>
      </div>
    </div>
  );
}

function Pair(props: { value: () => [number, number]; onChange: (v: [number, number]) => void; min?: number }) {
  return (
    <div class="field-row">
      <div class="part">
        <span class="x">X</span>
        <NumberBox value={() => props.value()[0]} integer min={props.min} onCommit={(v) => props.onChange([v, props.value()[1]])} />
      </div>
      <div class="part">
        <span class="y">Y</span>
        <NumberBox value={() => props.value()[1]} integer min={props.min} onCommit={(v) => props.onChange([props.value()[0], v])} />
      </div>
    </div>
  );
}

/**
 * Gives new rects the id, name and pivot point of the old sprite they overlap
 * most, so animations and scenes that use the sprites keep working after a
 * re-slice. The pivot keeps its position in the image, so frames stay aligned.
 */
export function matchSprites(old: SpriteDef[], rects: Rect[], base: string): SpriteDef[] {
  const used = new Set<string>();
  return rects.map((rect, i) => {
    let best: SpriteDef | undefined;
    let bestScore = 0.2;
    for (const s of old) {
      if (used.has(s.id)) continue;
      const ix = Math.max(0, Math.min(s.rect.x + s.rect.w, rect.x + rect.w) - Math.max(s.rect.x, rect.x));
      const iy = Math.max(0, Math.min(s.rect.y + s.rect.h, rect.y + rect.h) - Math.max(s.rect.y, rect.y));
      const inter = ix * iy;
      // overlap relative to the smaller of the two, so a tight box inside a grid cell matches it
      const score = inter / Math.max(1, Math.min(s.rect.w * s.rect.h, rect.w * rect.h));
      if (score > bestScore) {
        bestScore = score;
        best = s;
      }
    }
    if (!best) return { id: newGuid(), name: `${base}_${i}`, rect, pivot: { x: 0.5, y: 0.5 } };
    used.add(best.id);
    const ax = best.rect.x + best.pivot.x * best.rect.w;
    const ay = best.rect.y + (1 - best.pivot.y) * best.rect.h;
    return {
      ...best,
      rect,
      pivot: { x: (ax - rect.x) / rect.w, y: 1 - (ay - rect.y) / rect.h },
    };
  });
}

const corners = (r: Rect): [number, number][] => [
  [r.x, r.y],
  [r.x + r.w, r.y],
  [r.x + r.w, r.y + r.h],
  [r.x, r.y + r.h],
];
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const clamp01 = (v: number) => clamp(v, 0, 1);
