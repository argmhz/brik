import { createSignal } from "solid-js";

/*
 * Dockable panels. The workspace has zones (left, center, bottom, right, and
 * a lower half of the left and right columns), each a group of tabs. Panels
 * can be dragged between zones or float in their own window inside the editor.
 * The layout is remembered in localStorage. Zones without panels are hidden.
 */

export type PanelId = "hierarchy" | "inspector" | "scene" | "game" | "code" | "assets" | "console";
export type Zone = "left" | "leftLower" | "center" | "bottom" | "right" | "rightLower";
export type Side = "left" | "right";

export const ZONES: Zone[] = ["left", "leftLower", "center", "bottom", "right", "rightLower"];
export const PANELS: PanelId[] = ["hierarchy", "inspector", "scene", "game", "code", "assets", "console"];
export const ZONE_LABELS: Record<Zone, string> = {
  left: "venstre",
  leftLower: "venstre, nederst",
  center: "midten",
  bottom: "bunden",
  right: "højre",
  rightLower: "højre, nederst",
};

/** A panel in a floating window: position and size in CSS pixels, relative to the editor. */
export interface FloatingPanel {
  panel: PanelId;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DockLayout {
  zones: Record<Zone, PanelId[]>;
  active: Record<Zone, PanelId | null>;
  /** Floating windows, back to front. */
  floating: FloatingPanel[];
  /** How much of a split side column the upper zone gets (0..1). */
  split: Record<Side, number>;
}

export function defaultLayout(): DockLayout {
  return {
    zones: {
      left: ["hierarchy"],
      leftLower: [],
      center: ["scene", "game", "code"],
      bottom: ["assets", "console"],
      right: ["inspector"],
      rightLower: [],
    },
    active: { left: "hierarchy", leftLower: null, center: "scene", bottom: "assets", right: "inspector", rightLower: null },
    floating: [],
    split: { left: 0.5, right: 0.5 },
  };
}

const KEY = "brik.layout.dock";

/** A stored layout, repaired so every panel is in exactly one zone. */
export function normalizeLayout(raw: unknown): DockLayout {
  const out = defaultLayout();
  const r = raw as Partial<DockLayout> | null;
  if (!r || typeof r !== "object" || !r.zones) return out;
  const seen = new Set<PanelId>();
  for (const z of ZONES) {
    out.zones[z] = [];
    for (const p of Array.isArray(r.zones[z]) ? r.zones[z] : []) {
      if (!PANELS.includes(p) || seen.has(p)) continue;
      seen.add(p);
      out.zones[z].push(p);
    }
  }
  const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  for (const f of Array.isArray(r.floating) ? r.floating : []) {
    if (!f || !PANELS.includes(f.panel) || seen.has(f.panel)) continue;
    seen.add(f.panel);
    out.floating.push({ panel: f.panel, x: num(f.x, 80), y: num(f.y, 80), w: Math.max(200, num(f.w, 420)), h: Math.max(120, num(f.h, 320)) });
  }
  for (const side of ["left", "right"] as Side[]) out.split[side] = Math.min(0.85, Math.max(0.15, num(r.split?.[side], 0.5)));
  // panels missing from the stored layout go back to their default zone
  const def = defaultLayout();
  for (const p of PANELS) {
    if (seen.has(p)) continue;
    const z = ZONES.find((zone) => def.zones[zone].includes(p))!;
    out.zones[z].push(p);
  }
  for (const z of ZONES) {
    const a = r.active?.[z];
    out.active[z] = a && out.zones[z].includes(a) ? a : (out.zones[z][0] ?? null);
  }
  return out;
}

function load(): DockLayout {
  try {
    return normalizeLayout(JSON.parse(localStorage.getItem(KEY) ?? "null"));
  } catch {
    return defaultLayout();
  }
}

const [layoutSignal, setLayoutSignal] = createSignal<DockLayout>(load());
export const layout = layoutSignal;

function commit(next: DockLayout): void {
  setLayoutSignal(next);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // storage unavailable: the layout just isn't remembered
  }
}

/** The zone a panel is in, or "float" for a floating window. */
export function zoneOf(id: PanelId): Zone | "float" {
  const l = layout();
  if (l.floating.some((f) => f.panel === id)) return "float";
  return ZONES.find((z) => l.zones[z].includes(id)) ?? "center";
}

/** True if the panel is the visible tab of its zone (floating panels are always shown). */
export function isShown(id: PanelId): boolean {
  const z = zoneOf(id);
  return z === "float" || layout().active[z] === id;
}

/** Brings a panel to the front of its zone (or a floating one to the top). */
export function showPanel(id: PanelId): void {
  const z = zoneOf(id);
  const l = layout();
  if (z === "float") {
    const f = l.floating.find((x) => x.panel === id)!;
    if (l.floating.at(-1) !== f) commit({ ...l, floating: [...l.floating.filter((x) => x !== f), f] });
  } else if (l.active[z] !== id) commit({ ...l, active: { ...l.active, [z]: id } });
}

/** Moves a panel to a zone (before `before`, or last) and shows it. */
export function movePanel(id: PanelId, zone: Zone, before?: PanelId): void {
  const l = without(layout(), id);
  const list = [...l.zones[zone]];
  const at = before ? list.indexOf(before) : -1;
  if (at >= 0) list.splice(at, 0, id);
  else list.push(id);
  commit({ ...l, zones: { ...l.zones, [zone]: list }, active: { ...l.active, [zone]: id } });
}

/** The layout with a panel taken out of its zone or window (other zones keep a visible tab). */
function without(l: DockLayout, id: PanelId): DockLayout {
  const zones = { ...l.zones };
  for (const z of ZONES) zones[z] = zones[z].filter((p) => p !== id);
  const active = { ...l.active };
  for (const z of ZONES) if (!active[z] || !zones[z].includes(active[z]!)) active[z] = zones[z][0] ?? null;
  return { ...l, zones, active, floating: l.floating.filter((f) => f.panel !== id) };
}

/** Puts a panel in a floating window (on top), at `at` or a little offset from the last one. */
export function floatPanel(id: PanelId, at?: Partial<Omit<FloatingPanel, "panel">>): void {
  const l = without(layout(), id);
  const n = l.floating.length;
  const win: FloatingPanel = { panel: id, x: 120 + n * 28, y: 90 + n * 28, w: 460, h: 340, ...at };
  commit({ ...l, floating: [...l.floating, win] });
}

/** Moves or resizes a floating window. */
export function placeFloating(id: PanelId, rect: Partial<Omit<FloatingPanel, "panel">>): void {
  const l = layout();
  if (!l.floating.some((f) => f.panel === id)) return;
  commit({ ...l, floating: l.floating.map((f) => (f.panel === id ? { ...f, ...rect } : f)) });
}

/** Puts a floating panel back in the zone it has in the default layout. */
export function dockHome(id: PanelId): void {
  const def = defaultLayout();
  movePanel(id, ZONES.find((z) => def.zones[z].includes(id)) ?? "center");
}

/** Sets how much of a split side column the upper zone gets. */
export function setSplit(side: Side, fraction: number): void {
  const l = layout();
  commit({ ...l, split: { ...l.split, [side]: Math.min(0.85, Math.max(0.15, fraction)) } });
}

export function resetLayout(): void {
  commit(defaultLayout());
}

/** Shows the default tab of every zone (when a project is opened), keeping where panels are. */
export function resetActivePanels(): void {
  const l = layout();
  const def = defaultLayout();
  const active = { ...l.active };
  for (const z of ZONES) active[z] = def.active[z] && l.zones[z].includes(def.active[z]!) ? def.active[z] : (l.zones[z][0] ?? null);
  commit({ ...l, active });
}

/** The panel being dragged by its tab, if any. */
export const [draggingPanel, setDraggingPanel] = createSignal<PanelId | null>(null);
export const DND_PANEL = "application/x-brik-panel";
