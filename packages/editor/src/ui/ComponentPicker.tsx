import { type ComponentDef, scriptDisplayName } from "@brik/runtime";
import { For, Show, createMemo, createSignal, onMount } from "solid-js";
import { closePopup } from "./Popup";

/*
 * The "Tilføj komponent" menu: a search box, category filters, a short
 * description per component and the most recently added ones at the top.
 */

export type Category = "Grafik" | "Fysik" | "UI" | "Lyd" | "Kamera" | "Gameplay" | "Andet";

interface Info {
  category: Category;
  text: string;
  /** Extra search words (Danish and English). */
  words?: string;
}

/** Category and short description of the built-in components. Unknown ones go under "Andet". */
export const COMPONENT_INFO: Record<string, Info> = {
  Transform2D: { category: "Andet", text: "Position, rotation og skala", words: "position flyt placering" },
  Sprite: { category: "Grafik", text: "Tegner et billede", words: "billede image grafik" },
  SpriteAnimator: { category: "Grafik", text: "Afspiller animationer på en Sprite", words: "animation anim" },
  Shape2D: { category: "Grafik", text: "Firkant, cirkel eller polygon i en farve", words: "figur form rect circle" },
  Text2D: { category: "Grafik", text: "Tekst i verden", words: "tekst label" },
  TileMap: { category: "Grafik", text: "Bane tegnet med tiles", words: "tiles bane level grid" },
  ParticleEmitter2D: { category: "Grafik", text: "Partikler: røg, gnister, eksplosioner", words: "partikel effekt" },
  Light2D: { category: "Grafik", text: "Lys (kræver Lighting2D på kameraet)", words: "lys light" },
  Lighting2D: { category: "Kamera", text: "Slår lys til for et kamera", words: "lys mørke ambient" },
  SortingOrder: { category: "Grafik", text: "Hvad der tegnes foran hvad", words: "lag layer rækkefølge z" },
  Parallax2D: { category: "Kamera", text: "Baggrundslag der flytter sig langsommere", words: "baggrund dybde" },
  RigidBody2D: { category: "Fysik", text: "Tyngdekraft og fysik", words: "tyngdekraft gravity body" },
  Collider2D: { category: "Fysik", text: "Form til kollisioner og triggers", words: "kollision hitbox trigger" },
  CharacterController2D: { category: "Fysik", text: "Figur der går og hopper (platformer)", words: "spiller player hop" },
  CollisionFilter: { category: "Fysik", text: "Hvilke ting der kan ramme hinanden", words: "lag gruppe mask" },
  Joint2D: { category: "Fysik", text: "Forbinder to kroppe (hængsel, fjeder, reb)", words: "led fjeder reb" },
  TileMapCollider: { category: "Fysik", text: "Gør en TileMaps tiles solide", words: "kollision bane" },
  Velocity2D: { category: "Fysik", text: "Bevæger entity med en fast fart", words: "fart hastighed" },
  Camera2D: { category: "Kamera", text: "Det spilleren ser igennem", words: "kamera view" },
  CameraFollow2D: { category: "Kamera", text: "Kameraet følger en entity", words: "følg follow" },
  AudioSource: { category: "Lyd", text: "Afspiller en lyd eller musik", words: "lyd musik sound" },
  AudioListener: { category: "Lyd", text: "\"Ørerne\" til lyd i rummet, typisk på kameraet", words: "lyd ører" },
  UICanvas: { category: "UI", text: "Rod for UI, tegnes oven på spillet", words: "hud menu" },
  UIRect: { category: "UI", text: "Placering og størrelse i UI", words: "anker layout" },
  UIImage: { category: "UI", text: "Billede eller farvet felt i UI", words: "billede panel" },
  UIText: { category: "UI", text: "Tekst i UI", words: "tekst label" },
  UIButton: { category: "UI", text: "Knap der kan klikkes", words: "knap klik" },
  UIToggle: { category: "UI", text: "Afkrydsningsfelt", words: "checkbox til fra" },
  UISlider: { category: "UI", text: "Skyder til en værdi", words: "slider værdi" },
  UITextInput: { category: "UI", text: "Felt man kan skrive i", words: "input skriv" },
  UIStack: { category: "UI", text: "Stabler børn under eller ved siden af hinanden", words: "liste layout" },
  Spawner: { category: "Gameplay", text: "Laver en prefab med faste mellemrum", words: "spawn fjender bølger" },
  Timer: { category: "Gameplay", text: "Tæller ned og sender en besked", words: "tid nedtælling" },
  Tween: { category: "Gameplay", text: "Animerer et tal blødt (fx position)", words: "animation ease" },
  Lifetime: { category: "Gameplay", text: "Fjerner entity efter et antal sekunder", words: "død slet levetid" },
  Tags: { category: "Gameplay", text: "Mærker til at finde entities", words: "tag mærke" },
  EditorOnly: { category: "Andet", text: "Kommer ikke med i det eksporterede spil", words: "debug" },
};

const CATEGORIES: (Category | "Scripts")[] = ["Grafik", "Fysik", "UI", "Kamera", "Lyd", "Gameplay", "Scripts", "Andet"];

type Row = { kind: "component"; def: ComponentDef; info: Info } | { kind: "script"; id: string; info: Info };

const RECENT_KEY = "brik.recentComponents";

function loadRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function remember(key: string): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([key, ...loadRecent().filter((k) => k !== key)].slice(0, 5)));
  } catch {
    // no storage: no recent list
  }
}

const rowKey = (r: Row) => (r.kind === "component" ? r.def.name : `script:${r.id}`);
const rowName = (r: Row) => (r.kind === "component" ? r.def.name : scriptDisplayName(r.id));

/** Search score: lower is better, null = no match. */
function score(r: Row, q: string): number | null {
  if (!q) return 0;
  const name = rowName(r).toLowerCase();
  if (name.startsWith(q)) return 0;
  if (name.includes(q)) return 1;
  // "rb2" matches RigidBody2D: the letters in order
  let i = 0;
  for (const ch of name) if (ch === q[i]) i++;
  if (i === q.length) return 2;
  const rest = `${r.info.text} ${r.info.words ?? ""} ${r.kind === "script" ? r.id : ""}`.toLowerCase();
  return q.split(/\s+/).every((w) => rest.includes(w)) ? 3 : null;
}

export function ComponentPicker(props: {
  components: ComponentDef[];
  scripts: string[];
  /** Category to start on (e.g. "UI" under a canvas). */
  initial?: Category | "Scripts" | null;
  onComponent: (def: ComponentDef) => void;
  onScript: (id: string) => void;
}) {
  const [query, setQuery] = createSignal("");
  const [category, setCategory] = createSignal<Category | "Scripts" | null>(props.initial ?? null);
  const [active, setActive] = createSignal(0);
  let input!: HTMLInputElement;
  let list!: HTMLDivElement;

  const rows: Row[] = [
    ...props.scripts.map((id): Row => ({
      kind: "script",
      id,
      info: { category: "Andet", text: id.split("#")[0] },
    })),
    ...props.components.map((def): Row => ({
      kind: "component",
      def,
      info: COMPONENT_INFO[def.name] ?? { category: "Andet", text: "" },
    })),
  ];
  const catOf = (r: Row) => (r.kind === "script" ? "Scripts" : r.info.category);
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(catOf(r), (counts.get(catOf(r)) ?? 0) + 1);
  const recent = loadRecent();

  /** Visible rows, in groups. Searching looks in every category. */
  const groups = createMemo(() => {
    const q = query().trim().toLowerCase();
    const cat = q ? null : category();
    const hits = rows
      .map((r) => ({ r, s: score(r, q) }))
      .filter((x) => x.s !== null && (!cat || catOf(x.r) === cat))
      .sort((a, b) => a.s! - b.s! || rowName(a.r).localeCompare(rowName(b.r)))
      .map((x) => x.r);
    const out: { title: string; rows: Row[] }[] = [];
    if (q) out.push({ title: `${hits.length} resultat${hits.length === 1 ? "" : "er"}`, rows: hits });
    else {
    const recentRows = cat ? [] : recent.map((k) => hits.find((r) => rowKey(r) === k)).filter((r): r is Row => !!r);
    if (recentRows.length) out.push({ title: "Senest brugt", rows: recentRows });
    for (const c of CATEGORIES) {
      const inCat = hits.filter((r) => catOf(r) === c);
      if (inCat.length) out.push({ title: c, rows: inCat });
    }
    }
    // number the rows, for the keyboard
    let i = 0;
    return out.map((g) => ({ title: g.title, items: g.rows.map((r) => ({ r, i: i++ })) }));
  });
  const flat = createMemo(() => groups().flatMap((g) => g.items.map((x) => x.r)));

  const pick = (r: Row | undefined) => {
    if (!r) return;
    remember(rowKey(r));
    closePopup();
    if (r.kind === "component") props.onComponent(r.def);
    else props.onScript(r.id);
  };

  const move = (d: number) => {
    const n = flat().length;
    if (n === 0) return;
    setActive((active() + d + n) % n);
    list.querySelector(".item.active")?.scrollIntoView({ block: "nearest" });
    requestAnimationFrame(() => list.querySelector(".item.active")?.scrollIntoView({ block: "nearest" }));
  };

  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === "ArrowDown") move(1);
    else if (ev.key === "ArrowUp") move(-1);
    else if (ev.key === "Enter") pick(flat()[active()]);
    else if (ev.key === "Tab") {
      // Tab / Shift+Tab steps through the categories
      const all = [null, ...CATEGORIES.filter((c) => counts.has(c))];
      const i = all.indexOf(category());
      setCategory(all[(i + (ev.shiftKey ? -1 : 1) + all.length) % all.length]);
      setActive(0);
    } else return;
    ev.preventDefault();
  };

  // after the popup is in the page and the click that opened it is done
  onMount(() => requestAnimationFrame(() => input.focus()));

  return (
    <div class="component-picker" onKeyDown={onKey}>
      <input
        ref={input}
        class="picker-search"
        type="search"
        placeholder="Søg: navn eller hvad den gør (fx “hop”, “lyd”)"
        value={query()}
        onInput={(ev) => {
          setQuery(ev.currentTarget.value);
          setActive(0);
        }}
      />
      <div class="picker-cats">
        <button classList={{ on: category() === null }} onClick={() => (setCategory(null), setActive(0), input.focus())}>
          Alle
        </button>
        <For each={CATEGORIES.filter((c) => counts.has(c))}>
          {(c) => (
            <button
              classList={{ on: category() === c }}
              onClick={() => {
                setCategory(category() === c ? null : c);
                setActive(0);
                input.focus();
              }}
            >
              {c}
            </button>
          )}
        </For>
      </div>
      <div class="picker-list" ref={list}>
        <Show when={flat().length > 0} fallback={<div class="picker-empty">Ingen komponenter passer</div>}>
          <For each={groups()}>
            {(g) => (
              <>
                <div class="group">{g.title}</div>
                <For each={g.items}>
                  {({ r, i }) => (
                    <div
                      class="item"
                      classList={{ active: active() === i }}
                      onMouseMove={() => setActive(i)}
                      onClick={() => pick(r)}
                    >
                      <span class="picker-name">{rowName(r)}</span>
                      <span class="picker-text">{r.info.text}</span>
                    </div>
                  )}
                </For>
              </>
            )}
          </For>
        </Show>
      </div>
      <div class="picker-hint">↑↓ vælg · Enter tilføj · Tab skift kategori · Esc luk</div>
    </div>
  );
}
