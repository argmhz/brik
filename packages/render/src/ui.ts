import type { SpriteRef } from "@brik/assets";
import {
  type App,
  type ComponentDef,
  type Entity,
  GlobalTransform2D,
  type Rect,
  type World,
  childrenOf,
  defineComponent,
  defineEvent,
  parentOf,
  t,
  withMeta,
} from "@brik/core";
import { Input } from "@brik/input";

/**
 * The root of a screen-space UI. Its descendants with a UIRect are laid out on
 * the screen (not in the world) and drawn on top of everything.
 */
export const UICanvas = defineComponent("UICanvas", {
  /** constant: 1 unit = 1 CSS pixel. fit / expand: scale `referenceSize` to fit inside / cover the screen. */
  scaleMode: t.enum(["fit", "expand", "constant"] as const, "fit"),
  referenceSize: t.vec2(960, 540),
  /** Higher draws on top of other canvases. */
  order: t.i32(0),
});

/**
 * Where a UI element sits in its parent, like Unity's RectTransform. With equal
 * anchors the element has a fixed `size`; with anchorMin != anchorMax it
 * stretches, and `size` is added to the stretched size.
 */
export const UIRect = defineComponent("UIRect", {
  anchorMin: t.vec2(0.5, 0.5),
  anchorMax: t.vec2(0.5, 0.5),
  pivot: t.vec2(0.5, 0.5),
  /** Offset of the pivot from the anchor point. */
  position: t.vec2(0, 0),
  size: t.vec2(160, 40),
});

/**
 * Lays out its children in a column or a row, in hierarchy order, instead of
 * by their anchors. Each child keeps its UIRect size (with `stretch`, it also
 * fills the stack across).
 */
export const UIStack = defineComponent(
  "UIStack",
  {
    direction: t.enum(["vertical", "horizontal"] as const, "vertical"),
    /** Space between children. */
    spacing: withMeta(t.f32(8), { min: 0, step: 1 }),
    /** Space inside the edges. */
    padding: withMeta(t.f32(0), { min: 0, step: 1 }),
    /** Where children sit across the stack. */
    align: t.enum(["center", "start", "end"] as const, "center"),
    /** Children fill the stack across (width in a column, height in a row). */
    stretch: t.bool(false),
  },
  { requires: [UIRect] },
);

/** A colored rectangle or a sprite (9-sliced if the sprite has borders). */
export const UIImage = defineComponent(
  "UIImage",
  {
    sprite: withMeta(t.ref<SpriteRef | null>(() => null), { editor: "sprite" }),
    color: t.color(1, 1, 1, 1),
  },
  { requires: [UIRect] },
);

export const UIText = defineComponent(
  "UIText",
  {
    text: withMeta(t.string("Tekst"), { editor: "multiline" }),
    size: withMeta(t.f32(20), { min: 1, step: 1 }),
    color: t.color(1, 1, 1, 1),
    font: t.string("sans-serif"),
    align: t.enum(["center", "left", "right"] as const, "center"),
    bold: t.bool(false),
    wrap: t.bool(true),
  },
  { requires: [UIRect] },
);

/** Makes a UIRect clickable. Tints its UIImage and sends `UIClick`. */
export const UIButton = defineComponent(
  "UIButton",
  {
    interactable: t.bool(true),
    normal: t.color(1, 1, 1, 1),
    hover: t.color(0.9, 0.93, 1, 1),
    pressed: t.color(0.7, 0.75, 0.85, 1),
    disabled: t.color(0.6, 0.6, 0.6, 0.6),
    hovered: withMeta(t.bool(false), { hidden: true }),
    down: withMeta(t.bool(false), { hidden: true }),
  },
  { requires: [UIRect] },
);

/** A UIButton was clicked (pressed and released over it). */
export const UIClick = defineEvent<{ entity: Entity }>("UIClick");

export interface UIElement {
  e: Entity;
  /** CSS pixels, origin bottom-left of the screen, y up. */
  rect: Rect;
  /** UI units -> CSS pixels for this element's canvas. */
  scale: number;
}

/**
 * Which UI element has the keyboard (Tab, Shift+Tab, Enter, Space, arrows), or -1.
 * Nothing has it until the player presses Tab, so games that never use the keyboard on their UI are not affected.
 * A mouse press clears it. Available as a resource: `world.resource(UIFocus)`.
 */
export class UIFocus {
  entity: Entity = -1;
}

/** Laid out UI. Available as a resource: `world.resource(UILayout)`. */
export class UILayout {
  /** Elements in draw order (later ones on top). */
  elements: UIElement[] = [];
  readonly byEntity = new Map<Entity, UIElement>();
  screenW = 0;
  screenH = 0;

  /** Recomputes every rect for a screen of `w` x `h` CSS pixels. */
  update(world: World, w: number, h: number): void {
    this.screenW = w;
    this.screenH = h;
    this.elements = [];
    this.byEntity.clear();
    const C = world.store(UICanvas);
    const canvases = world
      .query([UICanvas])
      .toArray()
      .sort((a, b) => C.order[a] - C.order[b] || a - b);
    for (const c of canvases) {
      if (!isActive(world, c)) continue;
      const rw = Math.max(1, C.referenceSize.x[c]);
      const rh = Math.max(1, C.referenceSize.y[c]);
      const mode = C.scaleMode[c];
      const scale = mode === "constant" ? 1 : mode === "fit" ? Math.min(w / rw, h / rh) : Math.max(w / rw, h / rh);
      const root: Rect = { x: 0, y: 0, w: w / scale, h: h / scale };
      for (const child of childrenOf(world, c)) this.visit(world, child, root, scale);
    }
  }

  /** The topmost interactable button under a point (CSS pixels, y down), or -1. */
  buttonAt(world: World, x: number, yDown: number): Entity {
    const e = this.interactiveAt(world, x, yDown);
    return e >= 0 && world.has(e, UIButton) ? e : -1;
  }

  /**
   * The topmost element under a point (CSS pixels, y down) that reacts to the
   * mouse: a button, slider, toggle or text field. Images and text block
   * clicks to what is under them.
   */
  interactiveAt(world: World, x: number, yDown: number): Entity {
    const y = this.screenH - yDown;
    for (let i = this.elements.length - 1; i >= 0; i--) {
      const el = this.elements[i];
      const r = el.rect;
      if (x < r.x || x > r.x + r.w || y < r.y || y > r.y + r.h) continue;
      if (INTERACTIVE.some((c) => world.has(el.e, c))) return el.e;
      if (world.has(el.e, UIImage)) return -1;
    }
    return -1;
  }

  /** `fixed`: the rect a UIStack parent gave the element, instead of its anchors. */
  private visit(world: World, e: Entity, parent: Rect, scale: number, fixed?: Rect): void {
    if (!isActive(world, e)) return;
    let rect = parent;
    if (world.has(e, UIRect)) {
      rect = fixed ?? layoutRect(world, e, parent);
      const el: UIElement = {
        e,
        rect: { x: rect.x * scale, y: rect.y * scale, w: rect.w * scale, h: rect.h * scale },
        scale,
      };
      this.elements.push(el);
      this.byEntity.set(e, el);
    }
    const kids = childrenOf(world, e);
    if (world.has(e, UIStack) && world.has(e, UIRect)) {
      const rects = stackRects(world, e, rect, kids);
      kids.forEach((child, i) => this.visit(world, child, rect, scale, rects[i] ?? undefined));
    } else for (const child of kids) this.visit(world, child, rect, scale);
  }
}

/** Components that make an element react to the mouse (set by the widgets module too). */
export const INTERACTIVE: ComponentDef[] = [UIButton];

/** Rects for a UIStack's children (null for children it doesn't place). In UI units, y up. */
function stackRects(world: World, e: Entity, box: Rect, kids: readonly Entity[]): (Rect | null)[] {
  const S = world.store(UIStack);
  const U = world.store(UIRect);
  const vertical = S.direction[e] === "vertical";
  const pad = S.padding[e];
  const gap = S.spacing[e];
  const align = S.align[e];
  const stretch = S.stretch[e] !== 0;
  const inner = { x: box.x + pad, y: box.y + pad, w: Math.max(0, box.w - pad * 2), h: Math.max(0, box.h - pad * 2) };
  // a column fills from the top down, a row from the left
  let cursor = vertical ? inner.y + inner.h : inner.x;
  return kids.map((child) => {
    if (!world.has(child, UIRect) || !isActive(world, child)) return null;
    let w = Math.max(0, U.size.x[child]);
    let h = Math.max(0, U.size.y[child]);
    if (stretch) {
      if (vertical) w = inner.w;
      else h = inner.h;
    }
    const across = (space: number, size: number) => (align === "start" ? 0 : align === "end" ? space - size : (space - size) / 2);
    let r: Rect;
    if (vertical) {
      cursor -= h;
      r = { x: inner.x + across(inner.w, w), y: cursor, w, h };
      cursor -= gap;
    } else {
      // "start" across a row is the top, like reading order
      r = { x: cursor, y: inner.y + inner.h - h - across(inner.h, h), w, h };
      cursor += w + gap;
    }
    return r;
  });
}

function isActive(world: World, e: Entity): boolean {
  return !world.has(e, GlobalTransform2D) || world.store(GlobalTransform2D).active[e] !== 0;
}

/** Places a UIRect inside its parent's rect (all in UI units, y up). */
export function layoutRect(world: World, e: Entity, p: Rect): Rect {
  const U = world.store(UIRect);
  const aMinX = p.x + U.anchorMin.x[e] * p.w;
  const aMinY = p.y + U.anchorMin.y[e] * p.h;
  const aMaxX = p.x + U.anchorMax.x[e] * p.w;
  const aMaxY = p.y + U.anchorMax.y[e] * p.h;
  const w = Math.max(0, aMaxX - aMinX + U.size.x[e]);
  const h = Math.max(0, aMaxY - aMinY + U.size.y[e]);
  const px = aMinX + (aMaxX - aMinX) * U.pivot.x[e] + U.position.x[e];
  const py = aMinY + (aMaxY - aMinY) * U.pivot.y[e] + U.position.y[e];
  return { x: px - w * U.pivot.x[e], y: py - h * U.pivot.y[e], w, h };
}

/** The UICanvas an element belongs to, or -1. */
export function canvasOf(world: World, e: Entity): Entity {
  for (let p = e; p >= 0; p = parentOf(world, p)) if (world.has(p, UICanvas)) return p;
  return -1;
}

/** Hover, press and click for UIButtons. Uses the layout from the last rendered frame. */
export function updateButtons(world: World): void {
  const layout = world.resource(UILayout);
  const input = world.tryResource(Input);
  const B = world.store(UIButton);
  const I = world.store(UIImage);
  const hit = input?.pointer.inside ? layout.buttonAt(world, input.pointer.x, input.pointer.y) : -1;
  const mouse = input?.key("Mouse0");
  for (const e of world.query([UIButton])) {
    const enabled = B.interactable[e] !== 0;
    const over = enabled && hit === e;
    B.hovered[e] = over ? 1 : 0;
    if (over && mouse?.pressed) B.down[e] = 1;
    if (mouse?.released || !enabled) {
      if (B.down[e] && over && mouse?.released) world.emit(UIClick, { entity: e });
      B.down[e] = 0;
    }
    if (world.has(e, UIImage)) {
      const c = !enabled ? B.disabled : B.down[e] && over ? B.pressed : over ? B.hover : B.normal;
      I.color.r[e] = c.r[e];
      I.color.g[e] = c.g[e];
      I.color.b[e] = c.b[e];
      I.color.a[e] = c.a[e];
    }
  }
}

/** UI layout and buttons. The renderer draws the UI. */
export const UIPlugin = {
  name: "brik:ui",
  build(app: App) {
    if (!app.world.hasResource(UILayout)) app.world.insertResource(new UILayout());
    if (!app.world.hasResource(UIFocus)) app.world.insertResource(new UIFocus());
    app.addSystem("preUpdate", { name: "ui.buttons", run: updateButtons });
  },
};
