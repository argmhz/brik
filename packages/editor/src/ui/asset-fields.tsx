import { type Entity, Name, type SpriteRef, findBySceneId } from "@brik/runtime";
import { For, Show, createEffect } from "solid-js";
import { isAudio, isClip, isPrefab } from "../core/asset-db";
import type { Editor } from "../core/editor";
import { MenuItem, openPopup } from "./Popup";
import { SpriteThumb } from "./fields";
import { DND } from "./hooks";

export type AssetKind = "clip" | "prefab" | "audio";

const ICONS: Record<AssetKind, string> = { clip: "🎞", prefab: "🧩", audio: "🔊" };

export function assetKindOf(path: string): AssetKind | null {
  if (isClip(path)) return "clip";
  if (isPrefab(path)) return "prefab";
  if (isAudio(path)) return "audio";
  return null;
}

/** Assets of one kind: guid, name and path. */
export function assetsOfKind(editor: Editor, kind: AssetKind): { guid: string; name: string; path: string }[] {
  const map = kind === "clip" ? editor.db.clips : kind === "prefab" ? editor.db.prefabs : editor.db.sounds;
  return [...map.values()].sort((a, b) => a.path.localeCompare(b.path)).map((e) => ({ guid: e.guid, name: e.name, path: e.path }));
}

export function assetLabel(editor: Editor, kind: AssetKind, guid: string | null): string {
  if (!guid) return "Ingen";
  return assetsOfKind(editor, kind).find((a) => a.guid === guid)?.name ?? "Mangler";
}

/** First frame of a clip, for thumbnails. */
export function clipThumb(editor: Editor, guid: string | null): SpriteRef | null {
  return guid ? (editor.assets.clips.get(guid)?.frames[0]?.sprite ?? null) : null;
}

/** Picks a clip, prefab or sound. Accepts drops from the asset browser. */
export function AssetField(props: {
  editor: Editor;
  kind: AssetKind;
  value: () => string | null;
  onChange: (guid: string | null) => void;
}) {
  const editor = props.editor;
  const open = (ev: MouseEvent) => {
    const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    const list = assetsOfKind(editor, props.kind);
    openPopup(r.left, r.bottom + 2, () => (
      <>
        <MenuItem onClick={() => props.onChange(null)}>Ingen</MenuItem>
        <For each={list}>
          {(a) => (
            <MenuItem onClick={() => props.onChange(a.guid)}>
              <Show when={props.kind === "clip"} fallback={<span>{ICONS[props.kind]}</span>}>
                <SpriteThumb editor={editor} sprite={() => clipThumb(editor, a.guid)} />
              </Show>
              {a.name}
              <span class="readonly">{a.path}</span>
            </MenuItem>
          )}
        </For>
        <Show when={list.length === 0}>
          <div class="group">Ingen i projektet endnu</div>
        </Show>
      </>
    ));
  };
  const droppedGuid = (ev: DragEvent): string | null => {
    const path = ev.dataTransfer?.getData(DND.asset);
    if (!path || assetKindOf(path) !== props.kind) return null;
    return assetsOfKind(editor, props.kind).find((a) => a.path === path)?.guid ?? null;
  };
  return (
    <button
      class="sprite-field"
      onClick={open}
      onDragOver={(ev) => ev.dataTransfer?.types.includes(DND.asset) && ev.preventDefault()}
      onDrop={(ev) => {
        const guid = droppedGuid(ev);
        if (guid) props.onChange(guid);
      }}
      title="Vælg, eller træk en fil hertil fra assets"
    >
      <Show when={props.kind === "clip"} fallback={<span class="sprite-thumb icon">{ICONS[props.kind]}</span>}>
        <SpriteThumb editor={editor} sprite={() => clipThumb(editor, props.value())} />
      </Show>
      <span>{assetLabel(editor, props.kind, props.value())}</span>
    </button>
  );
}

/** Points at another entity. Pick from a list, or drag an entity here from the hierarchy. */
export function EntityField(props: {
  editor: Editor;
  value: () => Entity;
  onChange: (sceneId: string | null) => void;
  exclude?: Entity;
}) {
  const editor = props.editor;
  const world = editor.world;
  const open = (ev: MouseEvent) => {
    const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    const list = world
      .query([Name])
      .toArray()
      .filter((e) => e !== props.exclude)
      .sort((a, b) => editor.entityName(a).localeCompare(editor.entityName(b)));
    openPopup(r.left, r.bottom + 2, () => (
      <>
        <MenuItem onClick={() => props.onChange(null)}>Ingen</MenuItem>
        <For each={list}>{(e) => <MenuItem onClick={() => props.onChange(editor.idOf(e))}>{editor.entityName(e)}</MenuItem>}</For>
      </>
    ));
  };
  return (
    <button
      class="sprite-field"
      onClick={open}
      onDragOver={(ev) => ev.dataTransfer?.types.includes(DND.entities) && ev.preventDefault()}
      onDrop={(ev) => {
        const raw = ev.dataTransfer?.getData(DND.entities);
        const ids = raw ? (JSON.parse(raw) as string[]) : [];
        if (ids[0] && findBySceneId(world, ids[0]) >= 0) props.onChange(ids[0]);
      }}
      title="Vælg entity, eller træk en entity hertil fra hierarkiet"
    >
      <span class="sprite-thumb icon">◎</span>
      <span>{props.value() >= 0 ? editor.entityName(props.value()) : "Ingen"}</span>
    </button>
  );
}

/** Comma-separated tags. */
export function TagsField(props: { value: () => string[]; onCommit: (v: string[]) => void }) {
  let el!: HTMLInputElement;
  createEffect(() => {
    const v = (props.value() ?? []).join(", ");
    if (document.activeElement !== el) el.value = v;
  });
  return (
    <input
      ref={el}
      type="text"
      placeholder="fx enemy, flying"
      onKeyDown={(ev) => ev.key === "Enter" && el.blur()}
      onBlur={() => {
        const next = [...new Set(el.value.split(",").map((s) => s.trim()).filter(Boolean))];
        if (JSON.stringify(next) !== JSON.stringify(props.value() ?? [])) props.onCommit(next);
      }}
    />
  );
}

/** A text area that commits on blur or Ctrl+Enter. */
export function MultilineField(props: { value: () => string; onCommit: (v: string) => void }) {
  let el!: HTMLTextAreaElement;
  createEffect(() => {
    const v = props.value() ?? "";
    if (document.activeElement !== el) el.value = v;
  });
  return (
    <textarea
      ref={el}
      rows={2}
      onKeyDown={(ev) => {
        if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) el.blur();
        if (ev.key === "Escape") {
          el.value = props.value() ?? "";
          el.blur();
        }
      }}
      onBlur={() => el.value !== props.value() && props.onCommit(el.value)}
    />
  );
}
