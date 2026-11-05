import { createSignal } from "solid-js";

/*
 * Dockable panels. The workspace has four zones (left, center, bottom, right),
 * each a group of tabs. Panels can be dragged between zones, and the layout is
 * remembered in localStorage. Zones without panels are hidden.
 */

export type PanelId = "hierarchy" | "inspector" | "scene" | "game" | "code" | "assets" | "console";
export type Zone = "left" | "center" | "bottom" | "right";

export const ZONES: Zone[] = ["left", "center", "bottom", "right"];
export const PANELS: PanelId[] = ["hierarchy", "inspector", "scene", "game", "code", "assets", "console"];
export const ZONE_LABELS: Record<Zone, string> = { left: "venstre", center: "midten", bottom: "bunden", right: "højre" };

export interface DockLayout {
  zones: Record<Zone, PanelId[]>;
  active: Record<Zone, PanelId | null>;
}

export function defaultLayout(): DockLayout {
  return {
    zones: { left: ["hierarchy"], center: ["scene", "game", "code"], bottom: ["assets", "console"], right: ["inspector"] },
    active: { left: "hierarchy", center: "scene", bottom: "assets", right: "inspector" },
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

export function zoneOf(id: PanelId): Zone {
  const l = layout();
  return ZONES.find((z) => l.zones[z].includes(id)) ?? "center";
}

/** True if the panel is the visible tab of its zone. */
export function isShown(id: PanelId): boolean {
  return layout().active[zoneOf(id)] === id;
}

/** Brings a panel to the front of its zone. */
export function showPanel(id: PanelId): void {
  const z = zoneOf(id);
  const l = layout();
  if (l.active[z] !== id) commit({ ...l, active: { ...l.active, [z]: id } });
}

/** Moves a panel to a zone (before `before`, or last) and shows it. */
export function movePanel(id: PanelId, zone: Zone, before?: PanelId): void {
  const l = layout();
  const zones = { ...l.zones };
  for (const z of ZONES) zones[z] = zones[z].filter((p) => p !== id);
  const list = [...zones[zone]];
  const at = before ? list.indexOf(before) : -1;
  if (at >= 0) list.splice(at, 0, id);
  else list.push(id);
  zones[zone] = list;
  const active = { ...l.active, [zone]: id };
  for (const z of ZONES) if (active[z] && !zones[z].includes(active[z]!)) active[z] = zones[z][0] ?? null;
  commit({ zones, active });
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
