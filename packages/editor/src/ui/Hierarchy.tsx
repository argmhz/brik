import {
  Active,
  Camera2D,
  type Entity,
  Name,
  PrefabInstance,
  Sprite,
  childrenOf,
  findBySceneId,
  parentOf,
  rootEntities,
} from "@brik/runtime";
import { For, Show, createSignal } from "solid-js";
import { addComponent, composite, reparent, setValues } from "../core/commands";
import type { Editor } from "../core/editor";
import { MenuItem, openPopup } from "./Popup";
import { createPrefab, revertToPrefab } from "../core/prefabs";
import { DND, reportError, toast, useVersion } from "./hooks";

type Zone = "before" | "into" | "after";

export function Hierarchy(props: { editor: Editor }) {
  const editor = props.editor;
  const world = editor.world;
  const version = useVersion(editor, "world", "selection");
  const [collapsed, setCollapsed] = createSignal(new Set<string>());
  const [renaming, setRenaming] = createSignal<string | null>(null);
  const [drop, setDrop] = createSignal<{ id: string | null; zone: Zone } | null>(null);

  const roots = () => (version(), rootEntities(world));

  const toggle = (id: string) => {
    const next = new Set(collapsed());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setCollapsed(next);
  };

  const rename = (id: string, value: string) => {
    setRenaming(null);
    const e = findBySceneId(world, id);
    if (e < 0) return;
    const old = world.has(e, Name) ? world.store(Name).value[e] : "";
    if (value === old) return;
    const set = setValues(world, "Omdøb", [{ id, component: "Name", before: { value: old }, after: { value } }]);
    editor.execute(world.has(e, Name) ? set : composite("Omdøb", [addComponent(world, id, Name, { value })]));
  };

  const createMenu = (parentId: string | null) => (
    <>
      <MenuItem onClick={() => editor.createEntity("empty", { parentId })}>Tom entity</MenuItem>
      <MenuItem onClick={() => editor.createEntity("sprite", { parentId })}>Sprite</MenuItem>
      <MenuItem onClick={() => editor.createEntity("camera", { parentId })}>Kamera</MenuItem>
      <MenuItem onClick={() => editor.createEntity("rect", { parentId })}>Rektangel</MenuItem>
      <MenuItem onClick={() => editor.createEntity("circle", { parentId })}>Cirkel</MenuItem>
      <MenuItem onClick={() => editor.createEntity("polygon", { parentId })}>Polygon</MenuItem>
      <MenuItem onClick={() => editor.createEntity("line", { parentId })}>Linje</MenuItem>
      <MenuItem onClick={() => editor.createEntity("text", { parentId })}>Tekst</MenuItem>
      <MenuItem onClick={() => editor.createEntity("tilemap", { parentId })}>Tilemap</MenuItem>
      <MenuItem onClick={() => editor.createEntity("particles", { parentId })}>Partikler</MenuItem>
      <MenuItem onClick={() => editor.createEntity("light", { parentId })}>Lys</MenuItem>
      <div class="group">UI</div>
      <MenuItem onClick={() => editor.createEntity("ui-canvas", { parentId })}>UI Canvas</MenuItem>
      <MenuItem onClick={() => editor.createEntity("ui-button", { parentId })}>Knap</MenuItem>
      <MenuItem onClick={() => editor.createEntity("ui-text", { parentId })}>Tekst</MenuItem>
      <MenuItem onClick={() => editor.createEntity("ui-image", { parentId })}>Billede</MenuItem>
      <MenuItem onClick={() => editor.createEntity("ui-slider", { parentId })}>Slider</MenuItem>
      <MenuItem onClick={() => editor.createEntity("ui-toggle", { parentId })}>Toggle</MenuItem>
      <MenuItem onClick={() => editor.createEntity("ui-input", { parentId })}>Tekstfelt</MenuItem>
      <MenuItem onClick={() => editor.createEntity("ui-stack", { parentId })}>Kolonne (stak)</MenuItem>
    </>
  );

  const contextMenu = (ev: MouseEvent, id: string | null) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (id && !editor.selection.includes(id)) editor.select([id]);
    openPopup(ev.clientX, ev.clientY, () => (
      <>
        <div class="group">{id ? "Opret som barn" : "Opret"}</div>
        {createMenu(id)}
        <Show when={id}>
          <div class="sep" />
          <MenuItem onClick={() => setRenaming(id)}>Omdøb</MenuItem>
          <MenuItem onClick={() => editor.duplicateSelection()}>Dupliker (Ctrl+D)</MenuItem>
          <MenuItem onClick={() => editor.deleteSelection()}>Slet (Delete)</MenuItem>
          <div class="sep" />
          <Show
            when={world.has(findBySceneId(world, id!), PrefabInstance)}
            fallback={
              <MenuItem
                onClick={() =>
                  createPrefab(editor, id!).then((path) => toast(`Prefab gemt som ${path}`), reportError)
                }
              >
                Lav prefab
              </MenuItem>
            }
          >
            <MenuItem onClick={() => revertToPrefab(editor, id!)}>Gendan fra prefab</MenuItem>
          </Show>
          <Show when={parentOf(world, findBySceneId(world, id!)) >= 0}>
            <MenuItem
              onClick={() => {
                const cmd = reparent(world, editor.selection, null);
                if (cmd) editor.execute(cmd);
              }}
            >
              Flyt til roden
            </MenuItem>
          </Show>
        </Show>
      </>
    ));
  };

  const draggedIds = (ev: DragEvent): string[] | null => {
    const raw = ev.dataTransfer?.getData(DND.entities);
    return raw ? (JSON.parse(raw) as string[]) : null;
  };

  const onDrop = (ev: DragEvent, targetId: string | null, zone: Zone) => {
    ev.preventDefault();
    ev.stopPropagation();
    setDrop(null);
    const ids = draggedIds(ev);
    if (!ids) return;
    let cmd = null;
    if (!targetId) {
      cmd = reparent(world, ids, null);
    } else if (zone === "into") {
      cmd = reparent(world, ids, targetId);
      const next = new Set(collapsed());
      next.delete(targetId);
      setCollapsed(next);
    } else {
      const target = findBySceneId(world, targetId);
      const parent = parentOf(world, target);
      if (parent < 0) {
        cmd = reparent(world, ids, null);
      } else {
        const moving = new Set(ids.map((id) => findBySceneId(world, id)));
        const siblings = childrenOf(world, parent).filter((c) => !moving.has(c));
        const index = siblings.indexOf(target) + (zone === "after" ? 1 : 0);
        cmd = reparent(world, ids, editor.idOf(parent), index);
      }
    }
    if (cmd) editor.execute(cmd);
  };

  function Node(p: { e: Entity; depth: number }) {
    const id = () => (version(), editor.idOf(p.e));
    const kids = () => (version(), [...childrenOf(world, p.e)]);
    const selected = () => (version(), editor.selection.includes(id()));
    const isCollapsed = () => collapsed().has(id());
    const icon = () => {
      version();
      if (world.has(p.e, PrefabInstance)) return "🧩";
      if (world.has(p.e, Camera2D)) return "🎥";
      if (world.has(p.e, Sprite)) return "◧";
      return "○";
    };
    /** "self": switched off itself, "parent": a parent is switched off, null: on. */
    const off = () => {
      version();
      const A = world.store(Active);
      if (world.has(p.e, Active) && !A.self[p.e]) return "self";
      for (let n = parentOf(world, p.e); n >= 0; n = parentOf(world, n)) {
        if (world.has(n, Active) && !A.self[n]) return "parent";
      }
      return null;
    };
    const dropClass = () => {
      const d = drop();
      return d && d.id === id() ? `drop-${d.zone}` : "";
    };

    return (
      <>
        <div
          class={`tree-row ${dropClass()}`}
          classList={{ selected: selected(), inactive: off() !== null }}
          title={off() === "self" ? "Slukket (Active er slået fra)" : off() === "parent" ? "Slukket, fordi en forælder er slukket" : undefined}
          style={{ "padding-left": `${p.depth * 14 + 4}px` }}
          draggable={renaming() !== id()}
          onClick={(ev) => {
            if (ev.ctrlKey || ev.metaKey) editor.toggleSelect(id());
            else editor.select([id()]);
          }}
          onDblClick={() => setRenaming(id())}
          onContextMenu={(ev) => contextMenu(ev, id())}
          onDragStart={(ev) => {
            const ids = editor.selection.includes(id()) ? editor.selection : [id()];
            ev.dataTransfer!.setData(DND.entities, JSON.stringify(ids));
            ev.dataTransfer!.effectAllowed = "move";
          }}
          onDragOver={(ev) => {
            if (!ev.dataTransfer?.types.includes(DND.entities)) return;
            ev.preventDefault();
            const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
            const y = (ev.clientY - r.top) / r.height;
            setDrop({ id: id(), zone: y < 0.25 ? "before" : y > 0.75 ? "after" : "into" });
          }}
          onDragLeave={() => setDrop(null)}
          onDrop={(ev) => onDrop(ev, id(), drop()?.zone ?? "into")}
        >
          <span
            class="caret"
            onClick={(ev) => {
              ev.stopPropagation();
              toggle(id());
            }}
          >
            {kids().length > 0 ? (isCollapsed() ? "▶" : "▼") : ""}
          </span>
          <span class="icon">{icon()}</span>
          <Show when={renaming() === id()} fallback={<span class="label">{(version(), editor.entityName(p.e))}</span>}>
            <input
              type="text"
              value={world.has(p.e, Name) ? world.store(Name).value[p.e] : ""}
              ref={(el) => requestAnimationFrame(() => (el.focus(), el.select()))}
              onClick={(ev) => ev.stopPropagation()}
              onKeyDown={(ev) => {
                if (ev.key === "Enter") rename(id(), ev.currentTarget.value);
                if (ev.key === "Escape") setRenaming(null);
              }}
              onBlur={(ev) => renaming() === id() && rename(id(), ev.currentTarget.value)}
            />
          </Show>
        </div>
        <Show when={!isCollapsed()}>
          <For each={kids()}>{(c) => <Node e={c} depth={p.depth + 1} />}</For>
        </Show>
      </>
    );
  }

  return (
    <div class="panel" style={{ height: "100%" }}>
      <div class="panel-header">
        <span class="spacer" />
        <button
          class="ghost"
          title="Opret entity"
          onClick={(ev) => openPopup(ev.clientX, ev.clientY + 10, () => createMenu(null))}
        >
          +
        </button>
      </div>
      <div
        class="panel-body"
        style={{ display: "flex", "flex-direction": "column" }}
        onContextMenu={(ev) => contextMenu(ev, null)}
        onClick={(ev) => {
          if (ev.target === ev.currentTarget) editor.select([]);
        }}
        onDragOver={(ev) => {
          if (ev.dataTransfer?.types.includes(DND.entities)) ev.preventDefault();
        }}
        onDrop={(ev) => onDrop(ev, null, "into")}
      >
        <For each={roots()}>{(e) => <Node e={e} depth={0} />}</For>
        <div
          class="tree-empty"
          onClick={() => editor.select([])}
          classList={{ "drop-into": drop()?.id === null }}
        />
      </div>
    </div>
  );
}
