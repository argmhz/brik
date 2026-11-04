import { type Slicing, type TextureMeta, type TextureSettings, sliceSprites } from "@brik/runtime";
import { For, Match, Show, Switch, createEffect, createSignal, on } from "solid-js";
import { isAudio, isClip, isImage, isPrefab, isScene, textureName } from "../core/asset-db";
import { ClipInspector, MakeAnimation, PrefabInspector, SoundInspector } from "./asset-panels";
import type { Editor } from "../core/editor";
import { isScriptFile } from "../core/scripts";
import { openFile } from "./ui-state";
import { NumberBox } from "./fields";
import { reportError, toast, useVersion } from "./hooks";

export function AssetInspector(props: { editor: Editor; path: string }) {
  const editor = props.editor;
  const version = useVersion(editor, "assets", "scene", "scripts");
  return (
    <>
      <div class="inspector-header" style={{ "flex-direction": "column", gap: "2px" }}>
        <strong>{props.path.split("/").pop()}</strong>
        <span class="readonly">{props.path}</span>
      </div>
      <Switch fallback={<div class="empty-note">Ingen indstillinger for denne filtype</div>}>
        <Match when={isImage(props.path) && (version(), editor.db.textures.get(props.path))}>
          <TextureInspector editor={editor} path={props.path} />
          <MakeAnimation editor={editor} path={props.path} />
        </Match>
        <Match when={isClip(props.path)}>
          <ClipInspector editor={editor} path={props.path} />
        </Match>
        <Match when={isPrefab(props.path)}>
          <PrefabInspector editor={editor} path={props.path} />
        </Match>
        <Match when={isAudio(props.path)}>
          <SoundInspector editor={editor} path={props.path} />
        </Match>
        <Match when={isScriptFile(props.path)}>
          <div class="button-row">
            <button class="primary" onClick={() => openFile(props.path)}>
              Åbn i kode-editor
            </button>
          </div>
          <div class="section-title">Behaviours i filen</div>
          <div class="readonly" style={{ padding: "4px 8px 12px", "white-space": "normal" }}>
            {(version(),
            [...editor.scripts.registry.behaviours.keys()]
              .filter((id) => id.startsWith(`${props.path}#`))
              .map((id) => id.split("#")[1])
              .join(", ") || "Ingen (eller scriptet har fejl)")}
          </div>
        </Match>
        <Match when={isScene(props.path)}>
          <div class="button-row">
            <button class="primary" onClick={() => openSceneSafely(editor, props.path)}>
              Åbn scene
            </button>
            <button
              disabled={(version(), editor.settings.startScene === props.path)}
              onClick={() => editor.setStartScene(props.path).then(() => toast("Startscene sat"), reportError)}
            >
              {(version(), editor.settings.startScene === props.path) ? "Er startscene" : "Sæt som startscene"}
            </button>
          </div>
        </Match>
      </Switch>
    </>
  );
}

export async function openSceneSafely(editor: Editor, path: string): Promise<void> {
  if (editor.dirty && !confirm("Scenen har ændringer, der ikke er gemt. Åbn en anden scene alligevel?")) return;
  try {
    await editor.openScene(path);
  } catch (err) {
    reportError(err, "Kunne ikke åbne scenen");
  }
}

type GridSlicing = Extract<Slicing, { mode: "grid" }>;

const PIVOTS: { label: string; value: [number, number] }[] = [
  { label: "Midt", value: [0.5, 0.5] },
  { label: "Bund midt", value: [0.5, 0] },
  { label: "Top midt", value: [0.5, 1] },
  { label: "Nederst venstre", value: [0, 0] },
  { label: "Øverst venstre", value: [0, 1] },
];

function TextureInspector(props: { editor: Editor; path: string }) {
  const editor = props.editor;
  const entry = () => editor.db.textures.get(props.path)!;
  const [draft, setDraft] = createSignal<TextureMeta>(structuredClone(entry().meta));
  // reset the draft when another texture is selected
  createEffect(on(() => props.path, () => setDraft(structuredClone(entry().meta))));

  const changed = () => JSON.stringify(draft()) !== JSON.stringify(entry().meta);
  const setSettings = (patch: Partial<TextureSettings>) => setDraft({ ...draft(), settings: { ...draft().settings, ...patch } });
  const grid = (): GridSlicing | null => {
    const s = draft().slicing;
    return s.mode === "grid" ? s : null;
  };
  const setGrid = (patch: Partial<GridSlicing>) => {
    const g = grid();
    if (g) setDraft({ ...draft(), slicing: { ...g, ...patch } });
  };

  const preview = (): TextureMeta => {
    const d = draft();
    const tex = entry().asset;
    return { ...d, sprites: sliceSprites(d.slicing, tex.width, tex.height, textureName(props.path), entry().meta.sprites) };
  };

  const apply = async () => {
    try {
      await editor.db.saveMeta(props.path, preview());
      setDraft(structuredClone(entry().meta));
      editor.emit("assets");
      editor.emit("world");
      toast("Import-indstillinger gemt");
    } catch (err) {
      reportError(err, "Kunne ikke gemme");
    }
  };

  let canvas!: HTMLCanvasElement;
  createEffect(() => {
    const meta = preview();
    const tex = entry().asset;
    const img = tex.source as CanvasImageSource | null;
    if (!img || !tex.width) return;
    const scale = Math.max(1, Math.floor(260 / Math.max(tex.width, tex.height)));
    canvas.width = tex.width * scale;
    canvas.height = tex.height * scale;
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = meta.settings.filter === "linear";
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "rgba(76,141,255,0.9)";
    ctx.lineWidth = 1;
    for (const s of meta.sprites) {
      ctx.strokeRect(s.rect.x * scale + 0.5, s.rect.y * scale + 0.5, s.rect.w * scale - 1, s.rect.h * scale - 1);
      ctx.fillStyle = "#ffcc00";
      const px = (s.rect.x + s.pivot.x * s.rect.w) * scale;
      const py = (s.rect.y + (1 - s.pivot.y) * s.rect.h) * scale;
      ctx.fillRect(px - 1.5, py - 1.5, 3, 3);
    }
  });

  return (
    <>
      <div class="texture-preview">
        <canvas ref={canvas} />
      </div>
      <div class="readonly" style={{ padding: "0 8px" }}>
        {entry().asset.width} × {entry().asset.height} px · {preview().sprites.length || 1} sprite
        {preview().sprites.length === 1 ? "" : "s"}
      </div>

      <div class="section-title">Import</div>
      <div class="component-body">
        <span class="field-label">Filter</span>
        <select value={draft().settings.filter} onChange={(ev) => setSettings({ filter: ev.currentTarget.value as "nearest" })}>
          <option value="nearest">Nearest (pixel art)</option>
          <option value="linear">Linear (glat)</option>
        </select>
        <span class="field-label">Wrap</span>
        <select value={draft().settings.wrap} onChange={(ev) => setSettings({ wrap: ev.currentTarget.value as "clamp" })}>
          <option value="clamp">Clamp</option>
          <option value="repeat">Repeat</option>
        </select>
        <span class="field-label" title="Hvor mange pixels i billedet der svarer til én enhed i verden">
          Pixels pr. enhed
        </span>
        <NumberBox value={() => draft().settings.pixelsPerUnit} onCommit={(v) => setSettings({ pixelsPerUnit: v })} min={0.001} />
      </div>

      <div class="section-title">Opdeling</div>
      <div class="component-body">
        <span class="field-label">Tilstand</span>
        <select
          value={draft().slicing.mode}
          onChange={(ev) => {
            const mode = ev.currentTarget.value;
            const tex = entry().asset;
            const cell = Math.min(32, tex.width, tex.height);
            setDraft({
              ...draft(),
              slicing:
                mode === "grid"
                  ? { mode: "grid", cell: [cell, cell], offset: [0, 0], spacing: [0, 0], pivot: [0.5, 0.5] }
                  : { mode: "single" },
            });
          }}
        >
          <option value="single">Hele billedet</option>
          <option value="grid">Grid</option>
        </select>
        <Show when={grid()}>
          {(g) => (
            <>
              <span class="field-label">Cellestørrelse</span>
              <Pair value={() => g().cell} onChange={(v) => setGrid({ cell: v })} min={1} />
              <span class="field-label">Offset</span>
              <Pair value={() => g().offset} onChange={(v) => setGrid({ offset: v })} min={0} />
              <span class="field-label">Mellemrum</span>
              <Pair value={() => g().spacing} onChange={(v) => setGrid({ spacing: v })} min={0} />
              <span class="field-label">Pivot</span>
              <select
                value={JSON.stringify(g().pivot)}
                onChange={(ev) => setGrid({ pivot: JSON.parse(ev.currentTarget.value) })}
              >
                <For each={PIVOTS}>{(p) => <option value={JSON.stringify(p.value)}>{p.label}</option>}</For>
              </select>
            </>
          )}
        </Show>
      </div>

      <div class="button-row">
        <button class="primary" disabled={!changed()} onClick={apply}>
          Anvend
        </button>
        <button disabled={!changed()} onClick={() => setDraft(structuredClone(entry().meta))}>
          Fortryd
        </button>
      </div>

      <Show when={entry().meta.sprites.length > 0}>
        <div class="section-title">Sprites</div>
        <div class="readonly" style={{ padding: "4px 8px 12px", "white-space": "normal" }}>
          {entry()
            .meta.sprites.map((s) => s.name)
            .join(", ")}
        </div>
      </Show>
    </>
  );
}

function Pair(props: { value: () => [number, number]; onChange: (v: [number, number]) => void; min?: number }) {
  return (
    <div class="field-row">
      <div class="part">
        <span class="x">X</span>
        <NumberBox
          value={() => props.value()[0]}
          onCommit={(v) => props.onChange([v, props.value()[1]])}
          integer
          min={props.min}
        />
      </div>
      <div class="part">
        <span class="y">Y</span>
        <NumberBox
          value={() => props.value()[1]}
          onCommit={(v) => props.onChange([props.value()[0], v])}
          integer
          min={props.min}
        />
      </div>
    </div>
  );
}
