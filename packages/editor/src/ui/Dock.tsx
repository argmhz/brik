import { For, createEffect, createSignal } from "solid-js";
import {
  DND_PANEL,
  type PanelId,
  ZONES,
  ZONE_LABELS,
  type Zone,
  draggingPanel,
  layout,
  movePanel,
  resetLayout,
  setDraggingPanel,
  showPanel,
} from "./dock-state";
import { MenuItem, openPopup } from "./Popup";

const dragged = (ev: DragEvent): PanelId | null => {
  if (!ev.dataTransfer?.types.includes(DND_PANEL)) return null;
  return draggingPanel();
};

/**
 * One dock zone: a tab strip and the visible panel. Panels are created once by
 * the editor and moved between zones as DOM elements, so canvases and the code
 * editor keep their state.
 */
export function DockZone(props: { zone: Zone; panels: Map<PanelId, HTMLElement>; labels: Record<PanelId, () => string> }) {
  let body!: HTMLDivElement;
  const [over, setOver] = createSignal(false);
  const ids = () => layout().zones[props.zone];
  const active = () => layout().active[props.zone];

  createEffect(() => {
    const act = active();
    for (const id of ids()) {
      const el = props.panels.get(id)!;
      if (el.parentElement !== body) body.appendChild(el);
      el.style.display = id === act ? "flex" : "none";
    }
  });

  const menu = (ev: MouseEvent, id: PanelId) => {
    ev.preventDefault();
    openPopup(ev.clientX, ev.clientY, () => (
      <>
        <For each={ZONES.filter((z) => z !== props.zone)}>
          {(z) => <MenuItem onClick={() => movePanel(id, z)}>Flyt til {ZONE_LABELS[z]}</MenuItem>}
        </For>
        <MenuItem onClick={resetLayout}>Nulstil layout</MenuItem>
      </>
    ));
  };

  return (
    <div
      class="panel dock-zone"
      classList={{ "drop-target": over() }}
      data-zone={props.zone}
      onDragOver={(ev) => {
        if (!dragged(ev)) return;
        ev.preventDefault();
        setOver(true);
      }}
      onDragLeave={(ev) => {
        if (!(ev.currentTarget as HTMLElement).contains(ev.relatedTarget as Node)) setOver(false);
      }}
      onDrop={(ev) => {
        const id = dragged(ev);
        setOver(false);
        if (!id) return;
        ev.preventDefault();
        // dropped on a tab: insert before it
        const tab = (ev.target as HTMLElement).closest<HTMLElement>("[data-panel]");
        const before = tab?.dataset.panel as PanelId | undefined;
        movePanel(id, props.zone, before && before !== id ? before : undefined);
      }}
    >
      <div class="tabs">
        <For each={ids()}>
          {(id) => (
            <button
              class="tab"
              classList={{ active: active() === id }}
              data-panel={id}
              draggable={true}
              title="Træk fanen til et andet sted for at flytte panelet. Højreklik for flere valg."
              onClick={() => showPanel(id)}
              onContextMenu={(ev) => menu(ev, id)}
              onDragStart={(ev) => {
                ev.dataTransfer?.setData(DND_PANEL, id);
                if (ev.dataTransfer) ev.dataTransfer.effectAllowed = "move";
                setDraggingPanel(id);
              }}
              onDragEnd={() => setDraggingPanel(null)}
            >
              {props.labels[id]()}
            </button>
          )}
        </For>
      </div>
      <div class="dock-body" ref={body} />
    </div>
  );
}

/** A thin drop area for an empty zone, shown while a tab is dragged. */
export function DropStrip(props: { zone: Zone }) {
  const [over, setOver] = createSignal(false);
  return (
    <div
      class="dock-strip"
      classList={{ "drop-target": over() }}
      data-zone={props.zone}
      onDragOver={(ev) => {
        if (!dragged(ev)) return;
        ev.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(ev) => {
        const id = dragged(ev);
        setOver(false);
        if (!id) return;
        ev.preventDefault();
        movePanel(id, props.zone);
      }}
    >
      <span>Slip her</span>
    </div>
  );
}
