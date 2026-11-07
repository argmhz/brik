import {
  NEIGHBOUR_ANY,
  NEIGHBOUR_OTHER,
  NEIGHBOUR_SAME,
  type Terrain,
  type TerrainRule,
  blockTerrainRules,
  gridCount,
  newGuid,
  terrainBrush,
} from "@brik/runtime";
import { For, Show, createSignal } from "solid-js";
import type { TextureEntry } from "../core/asset-db";
import type { Editor } from "../core/editor";
import { SpriteThumb } from "./fields";
import { reportError, toast, useVersion } from "./hooks";

/** What the next click on a palette sprite does, besides choosing a brush. */
export type PalettePick = { kind: "rule"; terrain: string; rule: number } | { kind: "block"; terrain: string } | null;

const [pick, setPick] = createSignal<PalettePick>(null);
export { pick as palettePick, setPick as setPalettePick };

const ANY_RULE = (): number[] => Array(8).fill(NEIGHBOUR_ANY);
const CYCLE = [NEIGHBOUR_ANY, NEIGHBOUR_SAME, NEIGHBOUR_OTHER];
const MARK: Record<number, { text: string; title: string; cls: string }> = {
  [NEIGHBOUR_ANY]: { text: "·", title: "Ligegyldigt", cls: "any" },
  [NEIGHBOUR_SAME]: { text: "✓", title: "Samme terræn", cls: "same" },
  [NEIGHBOUR_OTHER]: { text: "✕", title: "Ikke samme terræn", cls: "other" },
};

/**
 * Auto-tiling terrains of a tileset, under the TileMap's palette: choose one as
 * the brush, or edit its rules (a sprite and a 3x3 neighbour pattern each).
 */
export function TerrainSection(props: { editor: Editor; entry: TextureEntry; brush: string | null }) {
  const editor = props.editor;
  const [editing, setEditing] = createSignal<string | null>(null);
  // saveMeta replaces entry.meta in place, so follow the "assets" event
  const version = useVersion(editor, "assets");
  const terrains = () => (version(), props.entry.meta.terrains ?? []);

  const save = async (next: Terrain[]) => {
    try {
      await editor.db.saveMeta(props.entry.path, { ...props.entry.meta, terrains: next });
      editor.emit("assets");
    } catch (err) {
      reportError(err, "Kunne ikke gemme terrænet");
    }
  };
  const update = (id: string, fn: (t: Terrain) => Terrain) => save(terrains().map((t) => (t.id === id ? fn(t) : t)));
  const updateRules = (id: string, fn: (rules: TerrainRule[]) => TerrainRule[]) => update(id, (t) => ({ ...t, rules: fn(t.rules.map((r) => ({ ...r, neighbours: [...r.neighbours] }))) }));

  const add = async () => {
    const name = prompt("Navn på terrænet (fx Græs):", "Terræn");
    if (!name) return;
    const first = props.entry.meta.sprites[0]?.id;
    const t: Terrain = { id: newGuid(), name, rules: first ? [{ sprite: first, neighbours: ANY_RULE() }] : [] };
    await save([...terrains(), t]);
    setEditing(t.id);
  };

  const remove = (t: Terrain) => {
    if (!confirm(`Slet terrænet "${t.name}"? Tiles, der allerede er malet, bliver stående.`)) return;
    void save(terrains().filter((x) => x.id !== t.id));
    if (editing() === t.id) setEditing(null);
  };

  return (
    <div class="terrain-section">
      <div class="terrain-head">
        <span class="field-label">Terræner (auto-tiling)</span>
        <button class="ghost" onClick={add} title="Nyt terræn: mal med det, og kanter og hjørner vælges ud fra naboerne">
          + Nyt
        </button>
      </div>
      <Show when={terrains().length === 0}>
        <div class="readonly hint">Et terræn vælger selv kanter og hjørner ud fra naboerne, mens du maler.</div>
      </Show>
      <For each={terrains()}>
        {(t) => (
          <>
            <div
              class="terrain-row"
              classList={{ selected: props.brush === terrainBrush(t) }}
              title="Mal med terrænet"
              onClick={() => editor.setTileTool(editor.tileTool === "fill" || editor.tileTool === "rect" ? editor.tileTool : "paint", terrainBrush(t))}
            >
              <Show when={t.rules[0]} fallback={<span class="sprite-thumb icon">?</span>}>
                {(r) => <SpriteThumb editor={editor} sprite={() => ({ texture: props.entry.meta.guid, id: r().sprite })} size={22} />}
              </Show>
              <span class="terrain-name">{t.name}</span>
              <span class="muted">{t.rules.length} regler</span>
              <span class="spacer" />
              <button
                class="ghost"
                onClick={(ev) => {
                  ev.stopPropagation();
                  setEditing(editing() === t.id ? null : t.id);
                }}
              >
                {editing() === t.id ? "Luk" : "Rediger"}
              </button>
              <button
                class="ghost danger"
                title="Slet terræn"
                onClick={(ev) => {
                  ev.stopPropagation();
                  remove(t);
                }}
              >
                ✕
              </button>
            </div>
            <Show when={editing() === t.id}>
              <TerrainEditor
                editor={editor}
                entry={props.entry}
                terrain={t}
                rename={(name) => update(t.id, (x) => ({ ...x, name }))}
                updateRules={(fn) => updateRules(t.id, fn)}
              />
            </Show>
          </>
        )}
      </For>
    </div>
  );
}

function TerrainEditor(props: {
  editor: Editor;
  entry: TextureEntry;
  terrain: Terrain;
  rename: (name: string) => void;
  updateRules: (fn: (rules: TerrainRule[]) => TerrainRule[]) => void;
}) {
  const t = () => props.terrain;
  const guid = () => props.entry.meta.guid;
  const picking = (rule: number) => {
    const p = pick();
    return p?.kind === "rule" && p.terrain === t().id && p.rule === rule;
  };

  const cycle = (rule: number, i: number) =>
    props.updateRules((rules) => {
      const n = rules[rule].neighbours;
      n[i] = CYCLE[(CYCLE.indexOf(n[i] ?? NEIGHBOUR_ANY) + 1) % CYCLE.length];
      return rules;
    });
  const move = (rule: number, by: number) =>
    props.updateRules((rules) => {
      const j = rule + by;
      if (j < 0 || j >= rules.length) return rules;
      [rules[rule], rules[j]] = [rules[j], rules[rule]];
      return rules;
    });

  return (
    <div class="terrain-editor">
      <div class="field-row">
        <span class="field-label">Navn</span>
        <input value={t().name} onChange={(ev) => ev.currentTarget.value.trim() && props.rename(ev.currentTarget.value.trim())} />
      </div>
      <div class="readonly hint">
        Reglerne prøves oppefra; den første, der passer, vinder. Klik på naboerne for at skifte mellem
        <b> · </b>ligegyldigt, <b>✓</b> samme terræn og <b>✕</b> ikke samme. Klik på midten og derefter på et tile i paletten for at
        vælge billedet.
      </div>
      <For each={t().rules}>
        {(rule, ri) => (
          <div class="terrain-rule">
            <div class="rule-grid">
              <For each={[0, 1, 2, 3, -1, 4, 5, 6, 7]}>
                {(i) =>
                  i < 0 ? (
                    <button
                      class="rule-center"
                      classList={{ picking: picking(ri()) }}
                      title="Vælg billede: klik derefter på et tile i paletten"
                      onClick={() => setPick(picking(ri()) ? null : { kind: "rule", terrain: t().id, rule: ri() })}
                    >
                      <SpriteThumb editor={props.editor} sprite={() => ({ texture: guid(), id: rule.sprite })} size={22} />
                    </button>
                  ) : (
                    <button
                      class={`rule-cell ${MARK[rule.neighbours[i] ?? NEIGHBOUR_ANY].cls}`}
                      title={MARK[rule.neighbours[i] ?? NEIGHBOUR_ANY].title}
                      onClick={() => cycle(ri(), i)}
                    >
                      {MARK[rule.neighbours[i] ?? NEIGHBOUR_ANY].text}
                    </button>
                  )
                }
              </For>
            </div>
            <div class="rule-buttons">
              <button class="ghost" title="Flyt op" disabled={ri() === 0} onClick={() => move(ri(), -1)}>
                ↑
              </button>
              <button class="ghost" title="Flyt ned" disabled={ri() === t().rules.length - 1} onClick={() => move(ri(), 1)}>
                ↓
              </button>
              <button class="ghost danger" title="Slet regel" onClick={() => props.updateRules((rules) => rules.filter((_, j) => j !== ri()))}>
                ✕
              </button>
            </div>
          </div>
        )}
      </For>
      <div class="button-row">
        <button
          onClick={() =>
            props.updateRules((rules) => [...rules, { sprite: rules.at(-1)?.sprite ?? props.entry.meta.sprites[0]?.id ?? "", neighbours: ANY_RULE() }])
          }
        >
          + Regel
        </button>
        <Show when={props.entry.meta.slicing.mode === "grid"}>
          <button
            classList={{ active: pick()?.kind === "block" }}
            title="Tilesettet har en 3×3-blok med hjørner, kanter og midte: klik derefter på blokkens øverste venstre tile i paletten"
            onClick={() => setPick(pick()?.kind === "block" ? null : { kind: "block", terrain: t().id })}
          >
            Fra 3×3-blok…
          </button>
        </Show>
      </div>
    </div>
  );
}

/**
 * Handles a click on a palette sprite while a terrain rule waits for one.
 * Returns true when the click was used for that (and not to choose a brush).
 */
export async function usePalettePick(editor: Editor, entry: TextureEntry, spriteId: string): Promise<boolean> {
  const p = pick();
  if (!p) return false;
  setPick(null);
  const terrains = entry.meta.terrains ?? [];
  const t = terrains.find((x) => x.id === p.terrain);
  if (!t) return true;
  let rules: TerrainRule[];
  if (p.kind === "rule") {
    rules = t.rules.map((r, i) => (i === p.rule ? { ...r, sprite: spriteId } : r));
  } else {
    // the 3x3 block starting at this cell of the grid
    const slicing = entry.meta.slicing;
    const k = Number(spriteId.replace(/^cell_/, ""));
    if (slicing.mode !== "grid" || !Number.isInteger(k)) return true;
    const [cols, rows] = gridCount(slicing, entry.asset.width, entry.asset.height);
    const col = k % cols;
    const row = Math.floor(k / cols);
    if (col + 2 >= cols || row + 2 >= rows) {
      toast("Blokken skal være 3×3 tiles fra det valgte tile og mod højre og ned");
      return true;
    }
    const ids = [0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => `cell_${(row + r) * cols + col + c}`));
    rules = blockTerrainRules(ids);
    toast(`${t.name}: 9 regler lavet fra 3×3-blokken`);
  }
  try {
    await editor.db.saveMeta(entry.path, { ...entry.meta, terrains: terrains.map((x) => (x.id === t.id ? { ...x, rules } : x)) });
    editor.emit("assets");
  } catch (err) {
    reportError(err, "Kunne ikke gemme terrænet");
  }
  return true;
}
