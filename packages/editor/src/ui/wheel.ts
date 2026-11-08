/**
 * What the mouse wheel does in the scene view, following the common convention
 * for 2D editors (Godot, Figma, browsers):
 *
 * - wheel: zoom around the pointer
 * - Shift + wheel: pan sideways (as Shift + wheel scrolls sideways everywhere)
 * - Ctrl (Cmd on a Mac) + wheel: pan up and down
 * - sideways scrolling (a touchpad or a tilting wheel): pan sideways
 *
 * Pan amounts are screen pixels; the caller divides by the zoom.
 */
export type WheelAction = { kind: "zoom"; factor: number } | { kind: "pan"; dx: number; dy: number };

export interface WheelInput {
  deltaX: number;
  deltaY: number;
  /** 0: pixels, 1: lines (Firefox with a mouse), 2: pages. */
  deltaMode: number;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

const LINE = 40;

/** `pageSize` is the view height in pixels, for wheels that scroll by pages. */
export function wheelAction(ev: WheelInput, pageSize = 800): WheelAction {
  const unit = ev.deltaMode === 1 ? LINE : ev.deltaMode === 2 ? pageSize : 1;
  const dx = ev.deltaX * unit;
  const dy = ev.deltaY * unit;
  if (ev.shiftKey) {
    // some browsers already turn Shift + wheel into sideways scrolling, others don't
    return { kind: "pan", dx: dx !== 0 ? dx : dy, dy: 0 };
  }
  if (ev.ctrlKey || ev.metaKey) return { kind: "pan", dx: 0, dy };
  if (dy === 0 && dx !== 0) return { kind: "pan", dx, dy: 0 };
  return { kind: "zoom", factor: Math.exp(-dy * 0.0015) };
}
