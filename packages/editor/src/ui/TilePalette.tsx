import { type Entity, TileMap } from "@brik/runtime";
import { For, Show } from "solid-js";
import type { Editor, TileTool } from "../core/editor";
import { setTilesCommand } from "../core/tiles";
import { SpriteThumb } from "./fields";
import { useVersion } from "./hooks";
import { TerrainSection, palettePick, usePalettePick } from "./TerrainSection";

const TOOLS: { tool: TileTool; label: string; key: string }[] = [
  { tool: "paint", label: "Pensel", key: "B" },
  { tool: "erase", label: "Viskelæder", key: "X" },
  { tool: "fill", label: "Fyld", key: "G" },
  { tool: "rect", label: "Rektangel", key: "U" },
  { tool: "pick", label: "Pipette", key: "I" },
];

/** Tools and the tileset's sprites, shown under a TileMap in the inspector. */
export function TilePalette(props: { editor: Editor; e: Entity; id: string }) {
  const editor = props.editor;
  const version = useVersion(editor, "world", "settings", "assets");
  const tileset = () => (version(), editor.world.store(TileMap).tileset[props.e]);
  const entry = () => {
    const guid = tileset();
    return guid ? editor.db.byGuid(guid) : undefined;
  };
  const count = () => (version(), Object.keys(editor.world.store(TileMap).tiles[props.e] ?? {}).length);
  const tool = () => (version(), editor.tileTool);
  const sprite = () => (version(), editor.tileSprite);

  const choose = (t: TileTool) => editor.setTileTool(tool() === t ? null : t);

  return (
    <div class="tile-palette">
      <div class="button-row" style={{ padding: "4px 8px" }}>
        <For each={TOOLS}>
          {(t) => (
            <button classList={{ active: tool() === t.tool }} onClick={() => choose(t.tool)} title={`${t.label} (${t.key})`}>
              {t.label}
            </button>
          )}
        </For>
      </div>
      <Show
        when={entry()}
        fallback={<div class="readonly hint">Vælg et tileset (et grid-opdelt billede) for at male.</div>}
      >
        {(en) => (
          <>
            <Show when={en().meta.sprites.length === 0}>
              <div class="readonly hint">Billedet er ikke opdelt. Åbn det i sprite-editoren og vælg Grid.</div>
            </Show>
            <div class="palette-grid" style={{ padding: "0 8px 6px" }}>
              <For each={en().meta.sprites}>
                {(s) => (
                  <div
                    class="palette-item"
                    classList={{ selected: sprite() === s.id, picking: !!palettePick() }}
                    title={s.name}
                    onClick={async () => {
                      // a terrain rule may be waiting for its sprite
                      if (await usePalettePick(editor, en(), s.id)) return;
                      editor.setTileTool(tool() === "erase" || tool() === "pick" || !tool() ? "paint" : tool(), s.id);
                    }}
                  >
                    <SpriteThumb editor={editor} sprite={() => ({ texture: en().meta.guid, id: s.id })} size={28} />
                  </div>
                )}
              </For>
            </div>
            <Show when={en().meta.sprites.length > 0}>
              <TerrainSection editor={editor} entry={en()} brush={sprite()} />
            </Show>
          </>
        )}
      </Show>
      <div class="readonly hint" style={{ "padding-top": "0" }}>
        {count()} tiles · Shift+klik sletter · Esc stopper malingen
        <Show when={count() > 0}>
          {" · "}
          <a
            href="#"
            onClick={(ev) => {
              ev.preventDefault();
              if (!confirm("Slet alle tiles i dette lag?")) return;
              const M = editor.world.store(TileMap);
              editor.execute(setTilesCommand(editor.world, props.id, M.tiles[props.e], {}, "Ryd tilemap"));
            }}
          >
            Ryd alle
          </a>
        </Show>
      </div>
    </div>
  );
}
