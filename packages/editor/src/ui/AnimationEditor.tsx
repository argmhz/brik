import { type AnimationClip, type AnimationMode, type SpriteRef, clipLength, frameAt } from "@brik/runtime";
import { For, Show, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import type { Editor } from "../core/editor";
import { NumberBox, SpriteThumb, TextBox, allSprites, spriteLabel } from "./fields";
import { DND, reportError, toast, typingInField } from "./hooks";

const FRAME_DND = "application/x-brik-frame";
/** Timeline pixels per second of animation (before zoom). */
const PX_PER_SEC = 640;
const MIN_FRAME_PX = 44;

/**
 * Full-screen editor for an animation clip: a timeline where each frame's
 * width is its duration, a pivot-aligned preview with onion skin, and a
 * palette of sprites to drag in.
 */
export function AnimationEditor(props: { editor: Editor; path: string; onClose: () => void }) {
  const editor = props.editor;
  const saved = (): AnimationClip | undefined => {
    const guid = editor.db.clips.get(props.path)?.guid;
    return guid ? editor.assets.clips.get(guid) : undefined;
  };
  const [clip, setClipRaw] = createSignal<AnimationClip>(structuredClone(saved()!));
  const [selected, setSelected] = createSignal(0);
  const [time, setTime] = createSignal(0);
  const [playing, setPlaying] = createSignal(true);
  const [speed, setSpeed] = createSignal(1);
  const [onion, setOnion] = createSignal(true);
  const [zoom, setZoom] = createSignal(1);
  const [dropAt, setDropAt] = createSignal<number | null>(null);
  const past: AnimationClip[] = [];
  const future: AnimationClip[] = [];

  const setClip = (next: AnimationClip, record = true) => {
    if (record) {
      past.push(clip());
      future.length = 0;
    }
    setClipRaw(next);
  };
  const edit = (fn: (c: AnimationClip) => void, record = true) => {
    const c = structuredClone(clip());
    fn(c);
    setClip(c, record);
  };
  const undo = () => {
    const prev = past.pop();
    if (prev) {
      future.push(clip());
      setClipRaw(prev);
    }
  };
  const redo = () => {
    const next = future.pop();
    if (next) {
      past.push(clip());
      setClipRaw(next);
    }
  };

  const changed = () => JSON.stringify(clip()) !== JSON.stringify(saved());
  const length = () => clipLength(clip());
  const current = () => (clip().frames.length ? frameAt(clip(), time()).frame : -1);
  const frameStart = (i: number) => clip().frames.slice(0, i).reduce((t, f) => t + f.duration, 0);
  const framePx = (d: number) => Math.max(MIN_FRAME_PX, d * PX_PER_SEC * zoom());

  // ------------------------------------------------------------ frame operations

  const insertFrames = (sprites: SpriteRef[], at: number) => {
    const dur = clip().frames[Math.max(0, Math.min(at, clip().frames.length) - 1)]?.duration ?? 0.1;
    edit((c) => {
      c.frames.splice(at, 0, ...sprites.map((sprite) => ({ sprite, duration: dur })));
      c.events = c.events.map((e) => (e.frame >= at ? { ...e, frame: e.frame + sprites.length } : e));
    });
    setSelected(at);
  };

  const moveFrame = (from: number, to: number) => {
    if (from === to || from + 1 === to) return;
    const target = to > from ? to - 1 : to;
    edit((c) => {
      // old index of each frame, in the new order; events follow their frame
      const order = c.frames.map((_, i) => i);
      const [f] = c.frames.splice(from, 1);
      c.frames.splice(target, 0, f);
      order.splice(from, 1);
      order.splice(target, 0, from);
      c.events = c.events.map((e) => ({ ...e, frame: order.indexOf(e.frame) }));
    });
    setSelected(target);
  };

  const removeFrame = (i: number) => {
    edit((c) => {
      c.frames.splice(i, 1);
      c.events = c.events.filter((e) => e.frame !== i).map((e) => (e.frame > i ? { ...e, frame: e.frame - 1 } : e));
    });
    setSelected(Math.max(0, Math.min(i, clip().frames.length - 1)));
  };

  const duplicateFrame = (i: number) => {
    const f = clip().frames[i];
    if (f) insertFrames([f.sprite], i + 1);
  };

  const setEvent = (i: number, name: string) =>
    edit((c) => {
      c.events = c.events.filter((e) => e.frame !== i);
      if (name.trim()) c.events.push({ frame: i, name: name.trim() });
    });

  const save = async () => {
    try {
      await editor.db.saveClip(props.path, clip());
      editor.emit("assets");
      toast("Animation gemt");
    } catch (err) {
      reportError(err, "Kunne ikke gemme");
    }
  };

  const close = () => {
    if (changed() && !confirm("Der er ændringer, der ikke er gemt. Luk alligevel?")) return;
    props.onClose();
  };

  // ------------------------------------------------------------ playback + preview

  let raf = 0;
  let last = performance.now();
  const tick = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (playing() && clip().frames.length) {
      let t = time() + dt * speed();
      // "once" clips restart after a short pause so they can be watched again
      if (clip().mode === "once" && t > length() + 0.4) t = 0;
      setTime(t);
    }
    raf = requestAnimationFrame(tick);
  };

  let preview!: HTMLCanvasElement;
  let previewWrap!: HTMLDivElement;
  const drawFrame = (ctx: CanvasRenderingContext2D, i: number, alpha: number, scale: number, cx: number, cy: number) => {
    const f = clip().frames[i];
    if (!f) return;
    const entry = editor.db.byGuid(f.sprite.texture);
    const img = entry?.asset.source as CanvasImageSource | null;
    if (!entry || !img) return;
    const def = f.sprite.id ? entry.asset.sprites.get(f.sprite.id) : undefined;
    const r = def?.rect ?? { x: 0, y: 0, w: entry.asset.width, h: entry.asset.height };
    const pv = def?.pivot ?? { x: 0.5, y: 0.5 };
    ctx.globalAlpha = alpha;
    // the pivot sits on the cross in the middle, like in the game
    ctx.drawImage(img, r.x, r.y, r.w, r.h, cx - pv.x * r.w * scale, cy - (1 - pv.y) * r.h * scale, r.w * scale, r.h * scale);
    ctx.globalAlpha = 1;
  };
  createEffect(() => {
    const i = current();
    const W = previewWrap?.clientWidth ?? 0;
    const H = previewWrap?.clientHeight ?? 0;
    if (!preview || !W) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    preview.width = Math.round(W * dpr);
    preview.height = Math.round(H * dpr);
    const ctx = preview.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, W, H);
    // scale so the biggest frame fits
    let maxW = 1;
    let maxH = 1;
    for (const f of clip().frames) {
      const d = editor.assets.spriteDef(f.sprite);
      const tex = editor.db.byGuid(f.sprite.texture)?.asset;
      maxW = Math.max(maxW, d?.rect.w ?? tex?.width ?? 1);
      maxH = Math.max(maxH, d?.rect.h ?? tex?.height ?? 1);
    }
    const scale = Math.max(1, Math.floor(Math.min((W * 0.45) / maxW, (H * 0.45) / maxH)));
    const cx = Math.round(W / 2);
    const cy = Math.round(H / 2);
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.beginPath();
    ctx.moveTo(0, cy + 0.5);
    ctx.lineTo(W, cy + 0.5);
    ctx.moveTo(cx + 0.5, 0);
    ctx.lineTo(cx + 0.5, H);
    ctx.stroke();
    if (onion() && clip().frames.length > 1) {
      const n = clip().frames.length;
      drawFrame(ctx, (i - 1 + n) % n, 0.25, scale, cx, cy);
      drawFrame(ctx, (i + 1) % n, 0.12, scale, cx, cy);
    }
    drawFrame(ctx, i, 1, scale, cx, cy);
  });

  // ------------------------------------------------------------ timeline interactions

  /** Drag the right edge of a frame to change its duration (snaps to 10 ms). */
  const startResize = (ev: PointerEvent, i: number) => {
    ev.stopPropagation();
    ev.preventDefault();
    const el = ev.currentTarget as HTMLElement;
    el.setPointerCapture(ev.pointerId);
    const x0 = ev.clientX;
    const d0 = clip().frames[i].duration;
    past.push(clip());
    future.length = 0;
    const move = (e: PointerEvent) => {
      const d = Math.max(0.01, Math.round((d0 + (e.clientX - x0) / (PX_PER_SEC * zoom())) * 100) / 100);
      edit((c) => (c.frames[i].duration = d), false);
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      if (JSON.stringify(past.at(-1)) === JSON.stringify(clip())) past.pop();
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };

  /** Index to insert at for a drop over frame `i`: before it on its left half, after it on the right. */
  const dropIndex = (ev: DragEvent, i: number) => {
    const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    return ev.clientX < r.left + r.width / 2 ? i : i + 1;
  };

  const onDrop = (ev: DragEvent, at: number) => {
    ev.preventDefault();
    setDropAt(null);
    const from = ev.dataTransfer?.getData(FRAME_DND);
    if (from) return moveFrame(Number(from), at);
    const many = ev.dataTransfer?.getData("application/x-brik-sprites");
    if (many) return insertFrames(JSON.parse(many) as SpriteRef[], at);
    const one = ev.dataTransfer?.getData(DND.sprite);
    if (one) insertFrames([JSON.parse(one) as SpriteRef], at);
  };

  const accepts = (ev: DragEvent) => {
    const t = ev.dataTransfer?.types ?? [];
    return t.includes(FRAME_DND) || t.includes(DND.sprite) || t.includes("application/x-brik-sprites");
  };

  const seek = (ev: MouseEvent) => {
    const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    const x = ev.clientX - r.left + (ev.currentTarget as HTMLElement).scrollLeft;
    // walk frames by their pixel widths
    let acc = 0;
    for (let i = 0; i < clip().frames.length; i++) {
      const w = framePx(clip().frames[i].duration);
      if (x < acc + w) {
        const f = clip().frames[i];
        setTime(frameStart(i) + ((x - acc) / w) * f.duration);
        setSelected(i);
        setPlaying(false);
        return;
      }
      acc += w;
    }
  };

  const step = (dir: number) => {
    const n = clip().frames.length;
    if (!n) return;
    const i = (current() + dir + n) % n;
    setPlaying(false);
    setSelected(i);
    setTime(frameStart(i) + 1e-4);
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
    } else if (mod && ev.key.toLowerCase() === "d") {
      ev.preventDefault();
      duplicateFrame(selected());
    } else if (ev.key === " ") {
      ev.preventDefault();
      setPlaying(!playing());
    } else if (ev.key === "ArrowLeft") step(-1);
    else if (ev.key === "ArrowRight") step(1);
    else if (ev.key === "Delete" || ev.key === "Backspace") {
      if (clip().frames.length) removeFrame(selected());
    } else return;
    ev.stopPropagation();
  };

  onMount(() => {
    raf = requestAnimationFrame(tick);
    window.addEventListener("keydown", onKey, true);
    onCleanup(() => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKey, true);
    });
  });

  // sprites from the textures used by the clip come first in the palette
  const palette = () => {
    const used = new Set(clip().frames.map((f) => f.sprite.texture));
    return allSprites(editor).sort((a, b) => {
      const ua = a.sprites.some((s) => used.has(s.texture)) ? 0 : 1;
      const ub = b.sprites.some((s) => used.has(s.texture)) ? 0 : 1;
      return ua - ub;
    });
  };
  const sel = () => clip().frames[selected()];

  return (
    <div class="tool-window">
      <div class="tool-header">
        <strong>Animation</strong>
        <span class="readonly">{props.path}</span>
        <span class="spacer" />
        <button class="primary" disabled={!changed()} onClick={save} title="Ctrl+S">
          Gem
        </button>
        <button onClick={close} title="Esc">
          Luk
        </button>
      </div>
      <div class="tool-body">
        <div class="anim-main">
          <div class="anim-preview" ref={previewWrap}>
            <canvas ref={preview} />
          </div>
          <div class="anim-controls">
            <button onClick={() => step(-1)} title="Forrige frame (←)">
              ⏮
            </button>
            <button class="primary" onClick={() => setPlaying(!playing())} title="Afspil/pause (mellemrum)">
              {playing() ? "⏸" : "▶"}
            </button>
            <button onClick={() => step(1)} title="Næste frame (→)">
              ⏭
            </button>
            <span class="readonly">
              Frame {current() + 1}/{clip().frames.length} · {time().toFixed(2)}s / {length().toFixed(2)}s
            </span>
            <span class="spacer" />
            <label class="check">
              <input type="checkbox" checked={onion()} onChange={(e) => setOnion(e.currentTarget.checked)} /> Onion skin
            </label>
            <select value={speed()} onChange={(e) => setSpeed(Number(e.currentTarget.value))} title="Afspilningshastighed">
              <For each={[0.25, 0.5, 1, 2]}>{(s) => <option value={s}>{s}×</option>}</For>
            </select>
            <select
              value={clip().mode}
              onChange={(e) => edit((c) => (c.mode = e.currentTarget.value as AnimationMode))}
              title="Afspilning"
            >
              <option value="loop">Loop</option>
              <option value="once">Én gang</option>
              <option value="pingpong">Frem og tilbage</option>
            </select>
            <span class="readonly">Zoom</span>
            <input type="range" min="0.25" max="4" step="0.25" value={zoom()} onInput={(e) => setZoom(Number(e.currentTarget.value))} />
          </div>
          <div
            class="timeline"
            onClick={seek}
            onDragOver={(ev) => {
              if (!accepts(ev)) return;
              ev.preventDefault();
              if (ev.target === ev.currentTarget) setDropAt(clip().frames.length);
            }}
            onDragLeave={() => setDropAt(null)}
            onDrop={(ev) => ev.target === ev.currentTarget && onDrop(ev, clip().frames.length)}
          >
            <For each={clip().frames}>
              {(f, i) => {
                const event = () => clip().events.find((e) => e.frame === i())?.name;
                return (
                  <div
                    class="tl-frame"
                    classList={{
                      selected: selected() === i(),
                      current: current() === i(),
                      "drop-before": dropAt() === i(),
                      "drop-after": dropAt() === i() + 1 && i() === clip().frames.length - 1,
                    }}
                    style={{ width: `${framePx(f.duration)}px` }}
                    draggable={true}
                    title={`${spriteLabel(editor, f.sprite)} · ${Math.round(f.duration * 1000)} ms${event() ? ` · event: ${event()}` : ""}`}
                    onDragStart={(ev) => {
                      ev.dataTransfer!.setData(FRAME_DND, String(i()));
                      ev.dataTransfer!.effectAllowed = "move";
                    }}
                    onDragOver={(ev) => {
                      if (!accepts(ev)) return;
                      ev.preventDefault();
                      setDropAt(dropIndex(ev, i()));
                    }}
                    onDrop={(ev) => {
                      ev.stopPropagation();
                      onDrop(ev, dropIndex(ev, i()));
                    }}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      setSelected(i());
                      setPlaying(false);
                      setTime(frameStart(i()) + 1e-4);
                    }}
                    onDblClick={() => {
                      const name = prompt("Event på denne frame (tom for ingen):", event() ?? "");
                      if (name !== null) setEvent(i(), name);
                    }}
                  >
                    <Show when={event()}>
                      <span class="tl-event" title={`event: ${event()}`}>
                        ⚑ {event()}
                      </span>
                    </Show>
                    <SpriteThumb editor={editor} sprite={() => f.sprite} size={36} />
                    <span class="tl-ms">{Math.round(f.duration * 1000)}</span>
                    <div class="tl-resize" title="Træk for at ændre varighed" onPointerDown={(ev) => startResize(ev, i())} />
                  </div>
                );
              }}
            </For>
            <Show when={clip().frames.length === 0}>
              <div class="empty-note">Træk sprites hertil fra paletten</div>
            </Show>
          </div>
        </div>

        <div class="tool-side">
          <Show when={sel()}>
            {(f) => (
              <>
                <div class="section-title">Frame {selected() + 1}</div>
                <div class="component-body">
                  <span class="field-label">Sprite</span>
                  <span class="readonly">{spriteLabel(editor, f().sprite)}</span>
                  <span class="field-label">Varighed (ms)</span>
                  <NumberBox
                    value={() => Math.round(f().duration * 1000)}
                    integer
                    min={1}
                    onCommit={(v) => edit((c) => (c.frames[selected()].duration = v / 1000))}
                  />
                  <span class="field-label">Event</span>
                  <TextBox
                    placeholder="fx footstep"
                    value={() => clip().events.find((e) => e.frame === selected())?.name ?? ""}
                    onCommit={(name) => setEvent(selected(), name)}
                  />
                </div>
                <div class="button-row">
                  <button onClick={() => duplicateFrame(selected())} title="Ctrl+D">
                    Dupliker
                  </button>
                  <button class="danger" onClick={() => removeFrame(selected())} title="Delete">
                    Slet
                  </button>
                </div>
              </>
            )}
          </Show>
          <div class="section-title">Alle frames</div>
          <div class="component-body">
            <span class="field-label">FPS</span>
            <NumberBox
              value={() => (clip().frames.length ? Math.round(clip().frames.length / Math.max(1e-6, length())) : 10)}
              integer
              min={1}
              max={120}
              onCommit={(v) => edit((c) => c.frames.forEach((f) => (f.duration = 1 / v)))}
            />
          </div>
          <div class="section-title">Palette</div>
          <div class="readonly hint">Klik for at tilføje sidst, eller træk ind på tidslinjen. Træk et sprite sheet's navn for at tilføje alle.</div>
          <div class="palette">
            <For each={palette()}>
              {(g) => (
                <>
                  <div
                    class="palette-group"
                    draggable={true}
                    onDragStart={(ev) => ev.dataTransfer!.setData("application/x-brik-sprites", JSON.stringify(g.sprites))}
                    onClick={() => insertFrames(g.sprites, clip().frames.length)}
                    title="Klik eller træk for at tilføje alle"
                  >
                    {g.texture} <span class="readonly">+ alle {g.sprites.length}</span>
                  </div>
                  <div class="palette-grid">
                    <For each={g.sprites}>
                      {(s) => (
                        <div
                          class="palette-item"
                          draggable={true}
                          title={spriteLabel(editor, s)}
                          onDragStart={(ev) => ev.dataTransfer!.setData(DND.sprite, JSON.stringify(s))}
                          onClick={() => insertFrames([s], clip().frames.length)}
                        >
                          <SpriteThumb editor={editor} sprite={() => s} size={32} />
                        </div>
                      )}
                    </For>
                  </div>
                </>
              )}
            </For>
          </div>
        </div>
      </div>
    </div>
  );
}
