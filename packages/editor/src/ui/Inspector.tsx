import {
  Active,
  type ComponentDef,
  type Entity,
  type Field,
  Name,
  PrefabInstance,
  RAD2DEG,
  DEG2RAD,
  type SpriteRef,
  Scripts,
  allComponents,
  scriptDisplayName,
  findBySceneId,
  parentOf,
} from "@brik/runtime";
import { For, Match, Show, Switch, createMemo, createSignal } from "solid-js";
import { addComponent, addScript, removeComponent, setEntityRef, setValues } from "../core/commands";
import { applyToPrefab, instanceRootOf, overridesFor, prefabOf, revertOverride, revertToPrefab } from "../core/prefabs";
import { AssetField, EntityField, MultilineField, PointsField, TagsField, assetLabel } from "./asset-fields";
import type { Editor } from "../core/editor";
import { AssetInspector } from "./AssetInspector";
import { ScriptsSection } from "./ScriptsSection";
import { TilePalette } from "./TilePalette";
import { MenuItem, openPopup } from "./Popup";
import { Checkbox, Part, SpriteField, TextBox, fromHex, toHex } from "./fields";
import { reportError, toast, useVersion } from "./hooks";

const INTEGER_KINDS = new Set(["i32", "u32", "u8"]);
const PARTS: Record<string, string[]> = {
  vec2: ["x", "y"],
  rect: ["x", "y", "w", "h"],
};

export function Inspector(props: { editor: Editor }) {
  const editor = props.editor;
  const version = useVersion(editor, "world", "selection");
  const primary = () => {
    version();
    const id = editor.selection.at(-1);
    if (!id) return null;
    const e = findBySceneId(editor.world, id);
    return e >= 0 ? { id, e } : null;
  };

  return (
    <div class="panel" style={{ height: "100%" }}>
      <div class="panel-header">
        <span class="spacer" />
        <Show when={editor.selection.length > 1 && (version(), true)}>
          <span style={{ "text-transform": "none" }}>{editor.selection.length} valgt</span>
        </Show>
      </div>
      <div class="panel-body">
        <Switch fallback={<div class="empty-note">Vælg en entity eller et asset</div>}>
          <Match when={primary()}>{(p) => <EntityInspector editor={editor} id={p().id} e={p().e} />}</Match>
          <Match when={(version(), editor.selectedAsset)}>
            {(path) => <AssetInspector editor={editor} path={path()} />}
          </Match>
        </Switch>
      </div>
    </div>
  );
}

function EntityInspector(props: { editor: Editor; id: string; e: Entity }) {
  const editor = props.editor;
  const world = editor.world;
  const version = useVersion(editor, "world");
  const [collapsed, setCollapsed] = createSignal(new Set<string>());
  /** Fields and components where this entity differs from its prefab. */
  const overrides = createMemo(() => (version(), editor.play.active ? new Set<string>() : overridesFor(editor, props.e)));

  const components = () => {
    version();
    return world
      .componentsOf(props.e)
      .filter((c) => !c.options.hidden && c !== Name && c !== Active && c !== Scripts && c !== PrefabInstance)
      .map((c) => c.name);
  };

  const name = () => (version(), world.has(props.e, Name) ? world.store(Name).value[props.e] : "");
  const active = () => (version(), !world.has(props.e, Active) || world.store(Active).self[props.e] === 1);

  const setName = (value: string) => {
    if (world.has(props.e, Name)) {
      editor.execute(setValues(world, "Omdøb", [{ id: props.id, component: "Name", before: { value: name() }, after: { value } }]));
    } else {
      editor.execute(addComponent(world, props.id, Name, { value }));
    }
  };

  const setActive = (value: boolean) => {
    if (world.has(props.e, Active)) {
      editor.execute(
        setValues(world, value ? "Aktivér" : "Deaktivér", [
          { id: props.id, component: "Active", before: { self: !value }, after: { self: value } },
        ]),
      );
    } else {
      editor.execute(addComponent(world, props.id, Active, { self: value }));
    }
  };

  const addMenu = (ev: MouseEvent) => {
    const present = new Set(world.componentsOf(props.e));
    const available = allComponents()
      .filter((c) => !c.options.hidden && !present.has(c) && c !== Name && c !== Active && c !== Scripts && c !== PrefabInstance)
      .sort((a, b) => a.name.localeCompare(b.name));
    const scripts = [...editor.scripts.registry.behaviours.keys()].sort();
    const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    openPopup(r.left, r.bottom + 2, () => (
      <>
        <div class="group">Scripts</div>
        <For each={scripts} fallback={<div class="item" style={{ color: "var(--muted)" }}>Ingen scripts endnu</div>}>
          {(id) => (
            <MenuItem onClick={() => editor.execute(addScript(world, props.id, id))}>
              {scriptDisplayName(id)}
              <span class="readonly">{id.split("#")[0]}</span>
            </MenuItem>
          )}
        </For>
        <div class="group">Komponenter</div>
        <For each={available} fallback={<div class="item" style={{ color: "var(--muted)" }}>Ingen flere komponenter</div>}>
          {(c) => <MenuItem onClick={() => editor.execute(addComponent(world, props.id, c))}>{c.name}</MenuItem>}
        </For>
      </>
    ));
  };

  return (
    <>
      <div class="inspector-header">
        <Checkbox value={active} onChange={setActive} />
        <TextBox value={name} onCommit={setName} placeholder="Navn" />
      </div>
      <PrefabBar editor={editor} id={props.id} e={props.e} />
      <For each={components()}>
        {(compName) => {
          const def = () => world.componentsOf(props.e).find((c) => c.name === compName);
          const requiredBy = () =>
            (version(),
            world
              .componentsOf(props.e)
              .filter((c) => c.options.requires?.some((r) => r.name === compName))
              .map((c) => c.name));
          const isCollapsed = () => collapsed().has(compName);
          return (
            <Show when={def()}>
              {(d) => (
                <div class="component">
                  <div
                    class="component-header"
                    onClick={() => {
                      const next = new Set(collapsed());
                      if (next.has(compName)) next.delete(compName);
                      else next.add(compName);
                      setCollapsed(next);
                    }}
                  >
                    <span style={{ color: "var(--muted)", "font-size": "9px" }}>{isCollapsed() ? "▶" : "▼"}</span>
                    <span classList={{ overridden: overrides().has(compName) }} title={overrides().has(compName) ? "Findes kun på denne instans, ikke i prefab'en" : undefined}>
                      {compName}
                    </span>
                    <span class="spacer" />
                    <button
                      class="ghost danger"
                      disabled={requiredBy().length > 0}
                      title={
                        requiredBy().length > 0 ? `Kræves af ${requiredBy().join(", ")}` : `Fjern ${compName}`
                      }
                      onClick={(ev) => {
                        ev.stopPropagation();
                        editor.execute(removeComponent(world, props.id, d()));
                      }}
                    >
                      ✕
                    </button>
                  </div>
                  <Show when={!isCollapsed()}>
                    <div class="component-body">
                      <For each={Object.keys(d().schema).filter((k) => !d().schema[k].meta?.hidden)}>
                        {(key) => (
                          <FieldEditor
                            editor={editor}
                            id={props.id}
                            e={props.e}
                            def={d()}
                            field={key}
                            overridden={() => overrides().has(`${compName}.${key}`)}
                          />
                        )}
                      </For>
                      <Show when={compName === "TileMap"}>
                        <div style={{ "grid-column": "1 / -1" }}>
                          <TilePalette editor={editor} e={props.e} id={props.id} />
                        </div>
                      </Show>
                      <Show when={Object.keys(d().schema).length === 0}>
                        <span class="field-label" style={{ "grid-column": "1 / -1" }}>
                          Ingen felter
                        </span>
                      </Show>
                    </div>
                  </Show>
                </div>
              )}
            </Show>
          );
        }}
      </For>
      <ScriptsSection editor={editor} id={props.id} e={props.e} />
      <div class="add-component">
        <button style={{ width: "100%" }} onClick={addMenu}>
          Tilføj komponent
        </button>
      </div>
    </>
  );
}

function PrefabBar(props: { editor: Editor; id: string; e: Entity }) {
  const editor = props.editor;
  const world = editor.world;
  const version = useVersion(editor, "world", "assets");
  const guid = () => (version(), prefabOf(world, props.e));
  const changes = () => (version(), world.has(props.e, PrefabInstance) ? (world.store(PrefabInstance).overrides[props.e]?.length ?? 0) : 0);
  /** For an entity inside an instance: the instance root. */
  const owner = () => {
    version();
    if (guid()) return -1;
    const p = parentOf(world, props.e);
    return p >= 0 ? instanceRootOf(world, p) : -1;
  };
  return (
    <>
      <Show when={guid()}>
        {(g) => (
          <div class="prefab-bar">
            <span title="Prefab">🧩 {assetLabel(editor, "prefab", g())}</span>
            <Show when={changes() > 0}>
              <span class="readonly" title="Felter med fed skrift afviger fra prefab'en">
                · {changes()} {changes() === 1 ? "ændring" : "ændringer"}
              </span>
            </Show>
            <span class="spacer" />
            <button
              title="Gem denne instans' ændringer i prefab'en og opdatér alle instanser"
              disabled={editor.play.active}
              onClick={() =>
                applyToPrefab(editor, props.id).then(
                  (n) => toast(`Prefab gemt, ${n} ${n === 1 ? "instans" : "instanser"} opdateret`),
                  reportError,
                )
              }
            >
              Anvend
            </button>
            <button
              title="Kassér alle ændringer og hent prefab'en igen (placeringen bevares)"
              disabled={editor.play.active || changes() === 0}
              onClick={() => revertToPrefab(editor, props.id)}
            >
              Gendan
            </button>
            <button
              class="ghost"
              title="Vis prefab-filen"
              onClick={() => {
                const path = editor.db.pathOf(g());
                if (path) editor.selectAsset(path);
              }}
            >
              ↗
            </button>
          </div>
        )}
      </Show>
      <Show when={owner() >= 0}>
        <div class="prefab-bar part">
          <span>🧩 Del af {editor.entityName(owner())}</span>
          <span class="spacer" />
          <button class="ghost" title="Vælg prefab-instansen" onClick={() => editor.select([editor.idOf(owner())])}>
            Vælg instans
          </button>
        </div>
      </Show>
    </>
  );
}

function prettyLabel(key: string): string {
  return key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
}

function FieldEditor(props: { editor: Editor; id: string; e: Entity; def: ComponentDef; field: string; overridden: () => boolean }) {
  const editor = props.editor;
  const world = editor.world;
  const version = useVersion(editor, "world");
  const field = props.def.schema[props.field] as Field;
  const meta = field.meta ?? {};
  const label = meta.label ?? prettyLabel(props.field);

  const read = (): any => {
    version();
    if (!world.has(props.e, props.def)) return undefined;
    return world.read(props.e, props.def)[props.field];
  };

  /** Writes a new value for the whole field. `live` edits (scrubbing) merge into one undo step. */
  const commit = (value: any, live = false) => {
    const before = read();
    editor.execute(
      setValues(
        world,
        `Ændr ${props.def.name}.${props.field}`,
        [{ id: props.id, component: props.def.name, before: { [props.field]: before }, after: { [props.field]: value } }],
        live ? `${props.id}/${props.def.name}/${props.field}` : undefined,
      ),
    );
  };

  const integer = INTEGER_KINDS.has(field.kind);
  const step = meta.step ?? (integer ? 0.25 : props.field === "rotation" ? 0.5 : 0.1);

  const editorWidget = () => {
    const kind = field.kind;
    if (meta.editor === "sprite") {
      return <SpriteField editor={editor} value={() => read() as SpriteRef | null} onChange={(v) => commit(v)} />;
    }
    if (meta.editor === "clip" || meta.editor === "prefab" || meta.editor === "audio" || meta.editor === "texture") {
      return <AssetField editor={editor} kind={meta.editor} value={() => (read() as string | null) ?? null} onChange={(v) => commit(v)} />;
    }
    if (meta.editor === "tags") return <TagsField value={() => read() as string[]} onCommit={(v) => commit(v)} />;
    if (meta.editor === "points") return <PointsField value={() => read() as { x: number; y: number }[]} onCommit={(v) => commit(v)} />;
    if (meta.editor === "multiline") return <MultilineField value={() => read() as string} onCommit={(v) => commit(v)} />;
    if (meta.editor === "enum" && meta.options) {
      return (
        <select value={read()} onChange={(ev) => commit(ev.currentTarget.value)}>
          <For each={[...meta.options]}>{(o) => <option value={o}>{o}</option>}</For>
        </select>
      );
    }
    if (meta.editor === "angle") {
      return (
        <div class="field-row">
          <Part
            letter="°"
            value={() => (read() ?? 0) * RAD2DEG}
            onCommit={(v, live) => commit(v * DEG2RAD, live)}
            step={0.5}
          />
        </div>
      );
    }
    if (kind === "bool") return <Checkbox value={() => !!read()} onChange={(v) => commit(v)} />;
    if (kind === "f32" || kind === "f64" || integer) {
      return (
        <div class="field-row">
          <Part
            letter="#"
            value={() => read() ?? 0}
            onCommit={(v, live) => commit(v, live)}
            step={step}
            integer={integer}
            min={meta.min}
            max={meta.max}
          />
        </div>
      );
    }
    if (kind === "vec2" || kind === "rect") {
      return (
        <div class="field-row">
          <For each={PARTS[kind]}>
            {(p) => (
              <Part
                letter={p.toUpperCase()}
                value={() => read()?.[p] ?? 0}
                onCommit={(v, live) => commit({ ...read(), [p]: v }, live)}
                step={step}
              />
            )}
          </For>
        </div>
      );
    }
    if (kind === "color") {
      return (
        <div class="field-row">
          <input
            type="color"
            value={(() => {
              const c = read() ?? { r: 1, g: 1, b: 1 };
              return toHex(c.r, c.g, c.b);
            })()}
            onInput={(ev) => commit({ ...read(), ...fromHex(ev.currentTarget.value) }, true)}
          />
          <Part
            letter="A"
            value={() => read()?.a ?? 1}
            onCommit={(v, live) => commit({ ...read(), a: v }, live)}
            step={0.01}
            min={0}
            max={1}
          />
        </div>
      );
    }
    if (kind === "entity") {
      return (
        <EntityField
          editor={editor}
          value={() => (version(), world.deref(read() as number))}
          exclude={props.e}
          onChange={(target) => editor.execute(setEntityRef(world, props.id, props.def.name, props.field, target))}
        />
      );
    }
    if (kind === "ref" && typeof read() === "string") {
      return <TextBox value={() => read() ?? ""} onCommit={(v) => commit(v)} />;
    }
    if (kind === "mat3") return <span class="readonly">matrix</span>;
    return <span class="readonly">{JSON.stringify(read())}</span>;
  };

  return (
    <>
      <span
        class="field-label"
        classList={{ overridden: props.overridden() }}
        title={props.overridden() ? "Ændret i forhold til prefab'en. Dobbeltklik for at hente prefab'ens værdi." : props.field}
        onDblClick={() => props.overridden() && revertOverride(editor, props.id, `${props.def.name}.${props.field}`)}
      >
        {label}
      </span>
      {editorWidget()}
    </>
  );
}

