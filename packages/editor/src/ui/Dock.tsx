import { For, createEffect, createSignal, onCleanup } from "solid-js";
import {
  DND_PANEL,
  type FloatingPanel,
  type PanelId,
  ZONES,
  ZONE_LABELS,
  type Zone,
  dockHome,
  draggingPanel,
  floatPanel,
  layout,
  movePanel,
  placeFloating,
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
        <MenuItem onClick={() => floatPanel(id)}>Flydende vindue (dobbeltklik)</MenuItem>
        <div class="sep" />
        <For each={ZONES.filter((z) => z !== props.zone)}>
          {(z) => <MenuItem onClick={() => movePanel(id, z)}>Flyt til {ZONE_LABELS[z]}</MenuItem>}
        </For>
        <div class="sep" />
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
              onDblClick={() => floatPanel(id)}
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

/** The dock zone under a screen point (ignoring floating windows), or null. */
function zoneAt(x: number, y: number): Zone | null {
  for (const el of document.elementsFromPoint(x, y)) {
    if (el.closest(".floating-panel")) continue;
    const z = (el as HTMLElement).closest<HTMLElement>("[data-zone]")?.dataset.zone as Zone | undefined;
    if (z) return z;
  }
  return null;
}

/**
 * A panel in its own window inside the editor. Drag the title bar to move it;
 * let go over a zone to dock it there. Resize from the bottom-right corner.
 */
export function FloatingWindow(props: { id: PanelId; panels: Map<PanelId, HTMLElement>; label: () => string }) {
  let body!: HTMLDivElement;
  let frame!: HTMLDivElement;
  const id = props.id;
  const win = (): FloatingPanel => layout().floating.find((f) => f.panel === id) ?? { panel: id, x: 0, y: 0, w: 400, h: 300 };
  const z = () => 50 + layout().floating.findIndex((f) => f.panel === id);
  const [target, setTarget] = createSignal<Zone | null>(null);

  createEffect(() => {
    const el = props.panels.get(id)!;
    if (el.parentElement !== body) body.appendChild(el);
    el.style.display = "flex";
  });

  // the size is changed with CSS resize; remember it when it settles
  let sizeTimer: ReturnType<typeof setTimeout> | undefined;
  const ro = new ResizeObserver(() => {
    clearTimeout(sizeTimer);
    sizeTimer = setTimeout(() => {
      const w = frame.offsetWidth;
      const h = frame.offsetHeight;
      if (Math.abs(w - win().w) > 1 || Math.abs(h - win().h) > 1) placeFloating(id, { w, h });
    }, 200);
  });
  createEffect(() => ro.observe(frame));
  onCleanup(() => {
    ro.disconnect();
    clearTimeout(sizeTimer);
    document.querySelectorAll("[data-zone].drop-target").forEach((z) => z.classList.remove("drop-target"));
  });

  const highlight = (z: Zone | null) => {
    document.querySelectorAll("[data-zone].drop-target").forEach((el) => el.classList.remove("drop-target"));
    if (z) document.querySelector(`[data-zone="${z}"]`)?.classList.add("drop-target");
    setTarget(z);
  };

  const onTitleDown = (ev: PointerEvent) => {
    if (ev.button !== 0 || (ev.target as HTMLElement).closest("button")) return;
    ev.preventDefault();
    showPanel(id);
    const parent = frame.offsetParent?.getBoundingClientRect() ?? { left: 0, top: 0, width: innerWidth, height: innerHeight };
    const dx = ev.clientX - frame.getBoundingClientRect().left;
    const dy = ev.clientY - frame.getBoundingClientRect().top;
    const title = ev.currentTarget as HTMLElement;
    title.setPointerCapture(ev.pointerId);
    // empty zones show drop strips while a panel is on the move
    setDraggingPanel(id);
    const move = (e: PointerEvent) => {
      // keep the title bar reachable
      const x = Math.min(Math.max(e.clientX - parent.left - dx, 40 - frame.offsetWidth), parent.width - 40);
      const y = Math.min(Math.max(e.clientY - parent.top - dy, 0), parent.height - 30);
      frame.style.left = `${x}px`;
      frame.style.top = `${y}px`;
      highlight(zoneAt(e.clientX, e.clientY));
    };
    const up = (e: PointerEvent) => {
      title.removeEventListener("pointermove", move);
      title.removeEventListener("pointerup", up);
      title.removeEventListener("pointercancel", up);
      const z = zoneAt(e.clientX, e.clientY);
      highlight(null);
      setDraggingPanel(null);
      if (z && e.type === "pointerup") movePanel(id, z);
      else placeFloating(id, { x: frame.offsetLeft, y: frame.offsetTop });
    };
    title.addEventListener("pointermove", move);
    title.addEventListener("pointerup", up);
    title.addEventListener("pointercancel", up);
  };

  return (
    <div
      ref={frame}
      class="floating-panel panel"
      classList={{ docking: !!target() }}
      style={{ left: `${win().x}px`, top: `${win().y}px`, width: `${win().w}px`, height: `${win().h}px`, "z-index": z() }}
      onPointerDown={() => showPanel(id)}
    >
      <div class="floating-title" onPointerDown={onTitleDown} onDblClick={() => dockHome(id)} title="Træk for at flytte. Slip over en zone for at dokke. Dobbeltklik dokker panelet, hvor det hørte til.">
        <span>{props.label()}</span>
        <span class="spacer" />
        <button class="ghost" title="Dok panelet, hvor det hørte til" onClick={() => dockHome(id)}>
          ⤓
        </button>
      </div>
      <div class="dock-body" ref={body} />
    </div>
  );
}
