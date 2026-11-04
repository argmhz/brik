import { type AnimationClip, type AnimationMode, type Sound, type SpriteRef, PrefabInstance, clipLength, frameAt } from "@brik/runtime";
import { For, Show, createEffect, createSignal, on, onCleanup } from "solid-js";
import type { Editor } from "../core/editor";
import { placePrefab } from "../core/prefabs";
import { MenuItem, openPopup } from "./Popup";
import { NumberBox, SpriteThumb, TextBox, allSprites, spriteLabel } from "./fields";
import { reportError, toast, useVersion } from "./hooks";

// ------------------------------------------------------------------ animation clips

export function ClipInspector(props: { editor: Editor; path: string }) {
  const editor = props.editor;
  const version = useVersion(editor, "assets");
  const saved = () => {
    version();
    const guid = editor.db.clips.get(props.path)?.guid;
    return guid ? editor.assets.clips.get(guid) : undefined;
  };
  const [draft, setDraft] = createSignal<AnimationClip | null>(null);
  createEffect(on(saved, (c) => setDraft(c ? structuredClone(c) : null)));
  const changed = () => JSON.stringify(draft()) !== JSON.stringify(saved());

  const update = (fn: (c: AnimationClip) => void) => {
    const c = structuredClone(draft()!);
    fn(c);
    setDraft(c);
  };

  // preview playback
  const [time, setTime] = createSignal(0);
  const [playing, setPlaying] = createSignal(true);
  let raf = 0;
  let last = performance.now();
  const tick = (now: number) => {
    const dt = (now - last) / 1000;
    last = now;
    if (playing()) setTime((t) => t + dt);
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  onCleanup(() => cancelAnimationFrame(raf));
  const current = () => {
    const c = draft();
    if (!c || c.frames.length === 0) return -1;
    const t = c.mode === "once" ? time() % (clipLength(c) + 0.5) : time();
    return frameAt(c, t).frame;
  };

  const fps = () => {
    const c = draft();
    if (!c || c.frames.length === 0) return 10;
    return Math.round(c.frames.length / Math.max(1e-6, clipLength(c)));
  };

  const addFrames = (ev: MouseEvent) => {
    const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    const dur = draft()!.frames.at(-1)?.duration ?? 0.1;
    openPopup(r.left, r.bottom + 2, () => (
      <For each={allSprites(editor)}>
        {(group) => (
          <>
            <div class="group">
              {group.texture}
              <button
                class="ghost"
                style={{ "margin-left": "auto" }}
                onClick={() => update((c) => c.frames.push(...group.sprites.map((sprite) => ({ sprite, duration: dur }))))}
              >
                + alle
              </button>
            </div>
            <For each={group.sprites}>
              {(s) => (
                <MenuItem onClick={() => update((c) => c.frames.push({ sprite: s, duration: dur }))}>
                  <SpriteThumb editor={editor} sprite={() => s} />
                  {spriteLabel(editor, s)}
                </MenuItem>
              )}
            </For>
          </>
        )}
      </For>
    ));
  };

  const save = async () => {
    try {
      await editor.db.saveClip(props.path, draft()!);
      editor.emit("assets");
      toast("Animation gemt");
    } catch (err) {
      reportError(err, "Kunne ikke gemme");
    }
  };

  return (
    <Show when={draft()} fallback={<div class="empty-note">Filen kunne ikke læses</div>}>
      {(c) => (
        <>
          <div class="clip-preview">
            <SpriteThumb editor={editor} sprite={() => c().frames[current()]?.sprite ?? null} size={96} />
            <div class="button-row" style={{ padding: "4px 0 0" }}>
              <button onClick={() => setPlaying(!playing())}>{playing() ? "⏸" : "▶"}</button>
              <span class="readonly">
                Frame {current() + 1} / {c().frames.length}
              </span>
            </div>
          </div>
          <div class="component-body">
            <span class="field-label">Afspilning</span>
            <select value={c().mode} onChange={(ev) => update((d) => (d.mode = ev.currentTarget.value as AnimationMode))}>
              <option value="loop">Loop</option>
              <option value="once">Én gang</option>
              <option value="pingpong">Frem og tilbage</option>
            </select>
            <span class="field-label">FPS (alle frames)</span>
            <NumberBox
              value={fps}
              integer
              min={1}
              max={120}
              onCommit={(v) => update((d) => d.frames.forEach((f) => (f.duration = 1 / v)))}
            />
          </div>
          <div class="section-title">Frames</div>
          <div class="frame-list">
            <For each={c().frames}>
              {(f, i) => (
                <div class="frame-row" classList={{ current: current() === i() }}>
                  <span class="readonly">{i() + 1}</span>
                  <SpriteThumb editor={editor} sprite={() => f.sprite} size={28} />
                  <div class="part" title="Varighed i millisekunder">
                    <span>ms</span>
                    <NumberBox
                      value={() => Math.round(f.duration * 1000)}
                      integer
                      min={1}
                      onCommit={(v) => update((d) => (d.frames[i()].duration = v / 1000))}
                    />
                  </div>
                  <TextBox
                    placeholder="event"
                    value={() => c().events.find((e) => e.frame === i())?.name ?? ""}
                    onCommit={(name) =>
                      update((d) => {
                        d.events = d.events.filter((e) => e.frame !== i());
                        if (name.trim()) d.events.push({ frame: i(), name: name.trim() });
                      })
                    }
                  />
                  <button
                    class="ghost"
                    title="Flyt op"
                    disabled={i() === 0}
                    onClick={() => update((d) => d.frames.splice(i() - 1, 0, ...d.frames.splice(i(), 1)))}
                  >
                    ↑
                  </button>
                  <button
                    class="ghost danger"
                    title="Fjern frame"
                    onClick={() =>
                      update((d) => {
                        d.frames.splice(i(), 1);
                        d.events = d.events.filter((e) => e.frame !== i()).map((e) => (e.frame > i() ? { ...e, frame: e.frame - 1 } : e));
                      })
                    }
                  >
                    ✕
                  </button>
                </div>
              )}
            </For>
          </div>
          <div class="button-row">
            <button onClick={addFrames}>Tilføj frames</button>
            <span class="spacer" />
            <button class="primary" disabled={!changed()} onClick={save}>
              Gem
            </button>
            <button disabled={!changed()} onClick={() => setDraft(structuredClone(saved()!))}>
              Fortryd
            </button>
          </div>
          <div class="readonly hint">
            Brug den i et script: <code>this.playAnimation("{c().name}")</code>
          </div>
        </>
      )}
    </Show>
  );
}

/** "Lav animation" for a sliced texture: frames from a range of its sprites. */
export function MakeAnimation(props: { editor: Editor; path: string }) {
  const editor = props.editor;
  const version = useVersion(editor, "assets");
  const entry = () => (version(), editor.db.textures.get(props.path));
  const count = () => entry()?.meta.sprites.length ?? 0;
  const [from, setFrom] = createSignal(1);
  const [to, setTo] = createSignal(0);
  const [fps, setFps] = createSignal(10);
  const [name, setName] = createSignal("");
  const last = () => (to() > 0 ? Math.min(to(), count()) : count());

  const make = async () => {
    const e = entry();
    if (!e) return;
    const refs: SpriteRef[] = e.meta.sprites.slice(from() - 1, last()).map((s) => ({ texture: e.meta.guid, id: s.id }));
    try {
      const { path } = await editor.createAnimation(refs, name() || `${e.asset.name}_anim`, fps());
      editor.selectAsset(path);
      toast(`Animation oprettet: ${path}`);
    } catch (err) {
      reportError(err, "Kunne ikke lave animation");
    }
  };

  return (
    <Show when={count() > 1}>
      <div class="section-title">Lav animation</div>
      <div class="component-body">
        <span class="field-label">Navn</span>
        <TextBox value={name} onCommit={setName} placeholder={`${entry()?.asset.name}_anim`} />
        <span class="field-label">Frames</span>
        <div class="field-row">
          <div class="part">
            <span>fra</span>
            <NumberBox value={from} onCommit={(v) => setFrom(v)} integer min={1} max={count()} />
          </div>
          <div class="part">
            <span>til</span>
            <NumberBox value={last} onCommit={(v) => setTo(v)} integer min={1} max={count()} />
          </div>
        </div>
        <span class="field-label">FPS</span>
        <NumberBox value={fps} onCommit={setFps} integer min={1} max={120} />
      </div>
      <div class="button-row">
        <button class="primary" disabled={last() < from()} onClick={make}>
          Lav animation ({Math.max(0, last() - from() + 1)} frames)
        </button>
      </div>
    </Show>
  );
}

// ------------------------------------------------------------------ prefabs

export function PrefabInspector(props: { editor: Editor; path: string }) {
  const editor = props.editor;
  const version = useVersion(editor, "assets", "world");
  const prefab = () => {
    version();
    const guid = editor.db.prefabs.get(props.path)?.guid;
    return guid ? editor.assets.prefabs.get(guid) : undefined;
  };
  const instances = () => {
    const p = prefab();
    if (!p) return 0;
    const P = editor.world.store(PrefabInstance);
    return editor.world.query([PrefabInstance]).toArray().filter((e) => P.prefab[e] === p.guid).length;
  };
  return (
    <Show when={prefab()} fallback={<div class="empty-note">Filen kunne ikke læses</div>}>
      {(p) => (
        <>
          <div class="component-body">
            <span class="field-label">Entities</span>
            <span class="readonly">{p().data.entities.length}</span>
            <span class="field-label">Komponenter</span>
            <span class="readonly" style={{ "white-space": "normal" }}>
              {Object.keys(p().data.entities[0]?.components ?? {}).join(", ")}
            </span>
            <span class="field-label">I scenen</span>
            <span class="readonly">{instances()}</span>
          </div>
          <div class="button-row">
            <button
              class="primary"
              disabled={editor.play.active}
              onClick={() => placePrefab(editor, p().guid, { x: editor.view.x, y: editor.view.y })}
            >
              Indsæt i scenen
            </button>
          </div>
          <div class="readonly hint">
            Rediger en instans i scenen og tryk <b>Anvend</b> i inspectoren for at opdatere prefab'en. I et script:{" "}
            <code>this.spawnPrefab("{p().name}")</code>
          </div>
        </>
      )}
    </Show>
  );
}

// ------------------------------------------------------------------ sounds

export function SoundInspector(props: { editor: Editor; path: string }) {
  const editor = props.editor;
  const entry = () => editor.db.sounds.get(props.path);
  const [sound, setSound] = createSignal<Sound | null>(null);
  onCleanup(() => sound()?.stop());
  const toggle = () => {
    const s = sound();
    if (s?.playing) {
      s.stop();
      setSound(null);
      return;
    }
    const guid = entry()?.guid;
    if (!guid || !editor.db.audio) return;
    const next = editor.db.audio.play(guid, { bus: "ui" });
    setSound(next);
    // poll for the end so the button resets
    const check = setInterval(() => {
      if (!next.playing) {
        clearInterval(check);
        if (sound() === next) setSound(null);
      }
    }, 200);
  };
  return (
    <Show when={entry()} fallback={<div class="empty-note">Lyden er ikke importeret endnu</div>}>
      {(e) => (
        <>
          <div class="button-row">
            <button class="primary" onClick={toggle}>
              {sound()?.playing ? "■ Stop" : "▶ Afspil"}
            </button>
          </div>
          <div class="readonly hint">
            Træk lyden ind i scenen for at få en entity med <code>AudioSource</code>, eller i et script:{" "}
            <code>this.playSound("{e().name}")</code>
          </div>
        </>
      )}
    </Show>
  );
}
