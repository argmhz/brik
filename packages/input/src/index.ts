import type { App } from "@brik/core";

/** State of a button-like input for the current frame. */
export interface ButtonState {
  /** Held down right now. */
  readonly down: boolean;
  /** Went down this frame. */
  readonly pressed: boolean;
  /** Went up this frame. */
  readonly released: boolean;
}

/**
 * Binding names are `KeyboardEvent.code` values (`"KeyW"`, `"Space"`, `"ArrowLeft"`)
 * or mouse buttons (`"Mouse0"` left, `"Mouse1"` middle, `"Mouse2"` right).
 */
export type Binding = string;

interface AxisBinding {
  negative: Binding[];
  positive: Binding[];
}

type RawEvent = { type: "down" | "up"; code: Binding };

/**
 * Keyboard and mouse input with action mapping. Available as a resource:
 * `world.resource(Input)`.
 *
 * ```ts
 * input.bindAction("jump", "Space", "KeyW");
 * if (input.action("jump").pressed) { ... }
 * const x = input.axis("horizontal"); // -1..1
 * ```
 *
 * `pressed` / `released` are true for exactly one frame. Read them in `update`
 * systems; a `fixedUpdate` step may not run on that frame.
 */
export class Input {
  private down = new Set<Binding>();
  private pressedSet = new Set<Binding>();
  private releasedSet = new Set<Binding>();
  private queue: RawEvent[] = [];
  private actions = new Map<string, Binding[]>();
  private axes = new Map<string, AxisBinding>();
  private boundCodes = new Set<Binding>();
  private cleanup: (() => void)[] = [];

  /** Pointer position in CSS pixels relative to the attached element (y down). */
  readonly pointer = { x: 0, y: 0, dx: 0, dy: 0, inside: false };
  /** Wheel delta this frame (positive = scroll down). */
  wheel = 0;
  private pendingWheel = 0;
  private pendingMove = { x: 0, y: 0, dx: 0, dy: 0 };

  constructor() {
    this.bindAxis("horizontal", ["KeyA", "ArrowLeft"], ["KeyD", "ArrowRight"]);
    this.bindAxis("vertical", ["KeyS", "ArrowDown"], ["KeyW", "ArrowUp"]);
    this.bindAction("jump", "Space");
    this.bindAction("fire", "Mouse0");
  }

  // ------------------------------------------------------------ bindings

  bindAction(name: string, ...bindings: Binding[]): this {
    this.actions.set(name, bindings);
    this.rebuildBound();
    return this;
  }

  bindAxis(name: string, negative: Binding[], positive: Binding[]): this {
    this.axes.set(name, { negative, positive });
    this.rebuildBound();
    return this;
  }

  // ------------------------------------------------------------- queries

  key(code: Binding): ButtonState {
    return {
      down: this.down.has(code),
      pressed: this.pressedSet.has(code),
      released: this.releasedSet.has(code),
    };
  }

  action(name: string): ButtonState {
    const bindings = this.actions.get(name);
    if (!bindings) throw new Error(`Brik: unknown input action "${name}"`);
    let down = false;
    let pressed = false;
    let released = false;
    for (const b of bindings) {
      down ||= this.down.has(b);
      pressed ||= this.pressedSet.has(b);
      released ||= this.releasedSet.has(b);
    }
    return { down, pressed, released };
  }

  /** -1..1. Opposite keys held together cancel out. */
  axis(name: string): number {
    const a = this.axes.get(name);
    if (!a) throw new Error(`Brik: unknown input axis "${name}"`);
    let v = 0;
    if (a.negative.some((b) => this.down.has(b))) v -= 1;
    if (a.positive.some((b) => this.down.has(b))) v += 1;
    return v;
  }

  // --------------------------------------------------------- DOM wiring

  /**
   * Decides which key presses reach the game; `keyup` always does, so no key stays down.
   * By default every key on the page counts. The editor narrows it to the Game view.
   */
  keyFilter: ((ev: KeyboardEvent) => boolean) | null = null;

  /** Listens for keyboard on `window` and pointer events on `element`. */
  attach(element: HTMLElement): void {
    this.detach();
    const on = <K extends keyof HTMLElementEventMap>(
      target: HTMLElement | Window,
      type: K,
      fn: (ev: HTMLElementEventMap[K]) => void,
      opts?: AddEventListenerOptions,
    ) => {
      target.addEventListener(type, fn as EventListener, opts);
      this.cleanup.push(() => target.removeEventListener(type, fn as EventListener, opts));
    };

    on(window, "keydown", (ev) => {
      // typing in a text field (or the editor's code panel) is not game input
      if (isTextField(ev.target)) return;
      if (this.keyFilter && !this.keyFilter(ev)) return;
      if (this.boundCodes.has(ev.code)) ev.preventDefault();
      if (!ev.repeat) this.queue.push({ type: "down", code: ev.code });
    });
    on(window, "keyup", (ev) => this.queue.push({ type: "up", code: ev.code }));
    on(window, "blur", () => {
      for (const code of this.down) this.queue.push({ type: "up", code });
    });
    // a touch (or a click with no move first) has no pointermove before it, so take the position here too
    const place = (ev: PointerEvent) => {
      const r = element.getBoundingClientRect();
      this.pendingMove.x = ev.clientX - r.left;
      this.pendingMove.y = ev.clientY - r.top;
      this.pointer.inside = true;
    };
    on(element, "pointerdown", (ev) => {
      element.setPointerCapture?.(ev.pointerId);
      place(ev);
      this.queue.push({ type: "down", code: `Mouse${ev.button}` });
    });
    on(element, "pointerup", (ev) => this.queue.push({ type: "up", code: `Mouse${ev.button}` }));
    on(element, "pointermove", (ev) => {
      place(ev);
      this.pendingMove.dx += ev.movementX;
      this.pendingMove.dy += ev.movementY;
    });
    on(element, "pointerleave", () => {
      this.pointer.inside = false;
    });
    on(element, "wheel", (ev) => {
      this.pendingWheel += ev.deltaY;
      ev.preventDefault();
    }, { passive: false });
    on(element, "contextmenu", (ev) => ev.preventDefault());
  }

  detach(): void {
    for (const fn of this.cleanup) fn();
    this.cleanup = [];
  }

  /** Moves the pointer (CSS pixels, y down), e.g. from tests. Applied next frame. */
  injectPointer(x: number, y: number): void {
    this.pendingMove.x = x;
    this.pendingMove.y = y;
    this.pointer.inside = true;
  }

  /** Feeds a synthetic event, e.g. from tests or an on-screen touch button. */
  inject(type: "down" | "up", code: Binding): void {
    this.queue.push({ type, code });
  }

  /** @internal Applies queued events. Called once per frame in preUpdate. */
  _beginFrame(): void {
    this.pressedSet.clear();
    this.releasedSet.clear();
    for (const ev of this.queue) {
      if (ev.type === "down") {
        if (!this.down.has(ev.code)) this.pressedSet.add(ev.code);
        this.down.add(ev.code);
      } else if (this.down.delete(ev.code)) {
        this.releasedSet.add(ev.code);
      }
    }
    this.queue.length = 0;
    this.pointer.x = this.pendingMove.x;
    this.pointer.y = this.pendingMove.y;
    this.pointer.dx = this.pendingMove.dx;
    this.pointer.dy = this.pendingMove.dy;
    this.pendingMove.dx = 0;
    this.pendingMove.dy = 0;
    this.wheel = this.pendingWheel;
    this.pendingWheel = 0;
  }

  private rebuildBound(): void {
    this.boundCodes.clear();
    for (const b of this.actions.values()) for (const c of b) this.boundCodes.add(c);
    for (const a of this.axes.values()) for (const c of [...a.negative, ...a.positive]) this.boundCodes.add(c);
  }
}

function isTextField(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
}

export interface InputPluginOptions {
  /** Element that receives pointer events. Usually the game canvas. */
  element?: HTMLElement;
}

export function InputPlugin(options: InputPluginOptions = {}) {
  return {
    name: "brik:input",
    build(app: App) {
      const input = app.world.insertResource(new Input());
      if (options.element) input.attach(options.element);
      app.addSystem("preUpdate", { name: "input.beginFrame", run: () => input._beginFrame() });
    },
  };
}
