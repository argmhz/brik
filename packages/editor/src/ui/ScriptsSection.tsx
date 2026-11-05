import {
  BehaviourRuntime,
  type Entity,
  type ExposedField,
  type ScriptEntry,
  type SpriteRef,
  Scripts,
  exposedFields,
  findBySceneId,
  isEntityLink,
  scriptDisplayName,
} from "@brik/runtime";
import { For, Show } from "solid-js";
import { removeScript, setScriptProp } from "../core/commands";
import type { Editor } from "../core/editor";
import { AssetField, EntityField } from "./asset-fields";
import { Checkbox, Part, SpriteField, TextBox, fromHex, toHex } from "./fields";
import { useVersion } from "./hooks";
import { openFile } from "./ui-state";

/** One inspector section per script on the entity, with its exposed fields. */
export function ScriptsSection(props: { editor: Editor; id: string; e: Entity }) {
  const editor = props.editor;
  const version = useVersion(editor, "world", "scripts", "play");
  const list = (): ScriptEntry[] => (version(), editor.world.has(props.e, Scripts) ? editor.world.store(Scripts).list[props.e] : []);

  return (
    <For each={list().map((_, i) => i)}>
      {(index) => {
        const entry = () => list()[index];
        const cls = () => (version(), entry() && editor.scripts.registry.behaviours.get(entry().script));
        const fields = () => {
          const c = cls();
          return c ? exposedFields(c) : [];
        };
        return (
          <Show when={entry()}>
            <div class="component">
              <div class="component-header">
                <span style={{ color: "var(--accent)" }}>{"{ }"}</span>
                {scriptDisplayName(entry().script)}
                <Show when={!cls()}>
                  <span class="error" style={{ "font-weight": 400 }}>
                    (mangler)
                  </span>
                </Show>
                <span class="spacer" />
                <button
                  class="ghost"
                  title="Åbn i kode-editoren"
                  onClick={() => openFile(entry().script.split("#")[0])}
                >
                  ✎
                </button>
                <button
                  class="ghost danger"
                  title="Fjern script"
                  onClick={() => editor.execute(removeScript(editor.world, props.id, index))}
                >
                  ✕
                </button>
              </div>
              <div class="component-body">
                <For each={fields()} fallback={<span class="field-label" style={{ "grid-column": "1 / -1" }}>Ingen felter med @expose</span>}>
                  {(field) => <ScriptField editor={editor} id={props.id} e={props.e} index={index} field={field} entry={entry} />}
                </For>
              </div>
            </div>
          </Show>
        );
      }}
    </For>
  );
}

function ScriptField(props: {
  editor: Editor;
  id: string;
  e: Entity;
  index: number;
  field: ExposedField;
  entry: () => ScriptEntry;
}) {
  const editor = props.editor;
  const version = useVersion(editor, "world", "play");
  const f = props.field;
  const isSet = () => (version(), f.key in props.entry().props);

  /** In play mode show the live value of the running instance. */
  const read = (): any => {
    version();
    if (editor.play.active) {
      const inst = editor.world.tryResource(BehaviourRuntime)?.instance(props.e, props.index) as Record<string, unknown> | undefined;
      if (inst && f.key in inst) return inst[f.key];
    }
    return isSet() ? props.entry().props[f.key] : f.default;
  };
  const commit = (value: any, live = false) =>
    editor.execute(setScriptProp(editor.world, props.id, props.index, f.key, value, live));

  const widget = () => {
    switch (f.type) {
      case "number":
      case "int":
        return (
          <div class="field-row">
            <Part
              letter="#"
              value={() => Number(read() ?? 0)}
              onCommit={(v, live) => commit(v, live)}
              step={f.step ?? (f.type === "int" ? 0.25 : 0.1)}
              integer={f.type === "int"}
              min={f.min}
              max={f.max}
            />
          </div>
        );
      case "bool":
        return <Checkbox value={() => !!read()} onChange={(v) => commit(v)} />;
      case "vec2":
        return (
          <div class="field-row">
            <For each={["x", "y"]}>
              {(p) => (
                <Part
                  letter={p.toUpperCase()}
                  value={() => read()?.[p] ?? 0}
                  onCommit={(v, live) => commit({ ...(read() ?? { x: 0, y: 0 }), [p]: v }, live)}
                  step={f.step ?? 0.1}
                />
              )}
            </For>
          </div>
        );
      case "color":
        return (
          <div class="field-row">
            <input
              type="color"
              value={(() => {
                const c = read() ?? { r: 1, g: 1, b: 1 };
                return toHex(c.r, c.g, c.b);
              })()}
              onInput={(ev) => commit({ a: 1, ...read(), ...fromHex(ev.currentTarget.value) }, true)}
            />
            <Part
              letter="A"
              value={() => read()?.a ?? 1}
              onCommit={(v, live) => commit({ r: 1, g: 1, b: 1, ...read(), a: v }, live)}
              step={0.01}
              min={0}
              max={1}
            />
          </div>
        );
      case "sprite":
        return <SpriteField editor={editor} value={() => (read() ?? null) as SpriteRef | null} onChange={(v) => commit(v)} />;
      case "prefab":
      case "audio":
      case "clip":
        return (
          <AssetField
            editor={editor}
            kind={f.type}
            value={() => (typeof read() === "string" && read()) || null}
            onChange={(guid) => commit(guid)}
          />
        );
      case "entity":
        return (
          <EntityField
            editor={editor}
            value={() => {
              const v = read();
              if (typeof v === "number") return v; // live value in play mode
              return isEntityLink(v) && v.$entity ? findBySceneId(editor.world, v.$entity) : -1;
            }}
            onChange={(id) => commit({ $entity: id })}
            exclude={props.e}
          />
        );
      default:
        return <TextBox value={() => String(read() ?? "")} onCommit={(v) => commit(v)} />;
    }
  };

  return (
    <>
      <span
        class="field-label"
        style={{ "font-weight": isSet() ? 600 : 400, color: isSet() ? "var(--text)" : undefined }}
        title={isSet() ? "Ændret på denne entity. Dobbeltklik for at nulstille." : f.key}
        onDblClick={() => isSet() && commit(undefined)}
      >
        {f.label ?? f.key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase())}
      </span>
      {widget()}
    </>
  );
}
