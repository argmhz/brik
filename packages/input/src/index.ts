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
 * Binding names are `KeyboardEvent.code` values (`"KeyW"`, `"Space"`, `"ArrowLeft"`),
 * mouse buttons (`"Mouse0"` left, `"Mouse1"` middle, `"Mouse2"` right) or gamepad
 * buttons (`"PadA"`, `"PadB"`, `"PadX"`, `"PadY"`, `"PadLB"`, `"PadRB"`, `"PadLT"`, `"PadRT"`,
 * `"PadSelect"`, `"PadStart"`, `"PadL3"`, `"PadR3"`, `"PadUp"`, `"PadDown"`, `"PadLeft"`,
 * `"PadRight"`, `"PadHome"`), named after an Xbox controller's layout.
 */
export type Binding = string;

/** A gamepad stick direction an axis can follow: the left or right stick, x or y (y up). */
export type StickAxis = "left-x" | "left-y" | "right-x" | "right-y";

interface AxisBinding {
  negative: Binding[];
  positive: Binding[];
  stick?: StickAxis;
}

/** The buttons of a "standard" gamepad, in the browser's order. */
const PAD_BUTTONS = [
  "PadA", "PadB", "PadX", "PadY", "PadLB", "PadRB", "PadLT", "PadRT",
  "PadSelect", "PadStart", "PadL3", "PadR3", "PadUp", "PadDown", "PadLeft", "PadRight", "PadHome",
] as const;

/** The parts of the browser's Gamepad object that input reads. */
export interface GamepadLike {
  connected: boolean;
  buttons: readonly { pressed: boolean; value: number }[];
  axes: readonly number[];
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

  /**
   * Gamepad sticks this frame, -1..1 with y up, after the dead zone. All connected
   * gamepads count; the one pushed furthest wins.
   */
  readonly stick = { left: { x: 0, y: 0 }, right: { x: 0, y: 0 } };
  /** True while a gamepad is connected. */
  gamepadConnected = false;
  /** Stick movement smaller than this counts as none (worn sticks don't rest at exactly 0). */
  deadZone = 0.2;
  /** Where gamepads are read from. The browser's by default; tests can put their own here. */
  gamepads: () => readonly (GamepadLike | null)[] = () =>
    typeof navigator !== "undefined" && typeof navigator.getGamepads === "function" ? navigator.getGamepads() : [];
  private padDown = new Set<Binding>();

  constructor() {
    this.bindAxis("horizontal", ["KeyA", "ArrowLeft", "PadLeft"], ["KeyD", "ArrowRight", "PadRight"], "left-x");
    this.bindAxis("vertical", ["KeyS", "ArrowDown", "PadDown"], ["KeyW", "ArrowUp", "PadUp"], "left-y");
    this.bindAction("jump", "Space", "PadA");
    this.bindAction("fire", "Mouse0", "PadX", "PadRT");
  }

  // ------------------------------------------------------------ bindings

  bindAction(name: string, ...bindings: Binding[]): this {
    this.actions.set(name, bindings);
    this.rebuildBound();
    return this;
  }

  /** An axis from two sets of keys or buttons, and optionally a gamepad stick direction. */
  bindAxis(name: string, negative: Binding[], positive: Binding[], stick?: StickAxis): this {
    this.axes.set(name, { negative, positive, stick });
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

  /**
   * -1..1. Opposite keys held together cancel out. A stick gives values in between,
   * so a character can walk slowly when the stick is pushed a little.
   */
  axis(name: string): number {
    const a = this.axes.get(name);
    if (!a) throw new Error(`Brik: unknown input axis "${name}"`);
    let v = 0;
    if (a.negative.some((b) => this.down.has(b))) v -= 1;
    if (a.positive.some((b) => this.down.has(b))) v += 1;
    if (a.stick) {
      const st = a.stick.startsWith("left") ? this.stick.left : this.stick.right;
      v += a.stick.endsWith("x") ? st.x : st.y;
    }
    return Math.max(-1, Math.min(1, v));
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
    this.readGamepads();
  }

  /** Gamepad buttons become bindings that go down and up like keys; the sticks are read too. */
  private readGamepads(): void {
    let pads: readonly (GamepadLike | null)[] = [];
    try {
      pads = this.gamepads() ?? [];
    } catch {
      // some browsers refuse outside a secure context
    }
    const now = new Set<Binding>();
    const left = { x: 0, y: 0 };
    const right = { x: 0, y: 0 };
    let connected = false;
    for (const pad of pads) {
      if (!pad?.connected) continue;
      connected = true;
      pad.buttons.forEach((b, i) => {
        // triggers are analog: past half way counts as pressed
        if (i < PAD_BUTTONS.length && (b.pressed || b.value > 0.5)) now.add(PAD_BUTTONS[i]);
      });
      const take = (out: { x: number; y: number }, x = 0, y = 0) => {
        // the stick reports y down; axes here have y up
        const len = Math.hypot(x, y);
        if (len < this.deadZone || len <= Math.hypot(out.x, out.y)) return;
        // rescale so the edge of the dead zone is 0 and full tilt is 1
        const k = Math.min(1, (len - this.deadZone) / (1 - this.deadZone)) / len;
        out.x = x * k;
        out.y = -y * k;
      };
      take(left, pad.axes[0], pad.axes[1]);
      take(right, pad.axes[2], pad.axes[3]);
    }
    for (const code of now) {
      if (!this.padDown.has(code) && !this.down.has(code)) this.pressedSet.add(code);
      this.down.add(code);
    }
    for (const code of this.padDown) {
      if (!now.has(code) && this.down.delete(code)) this.releasedSet.add(code);
    }
    this.padDown = now;
    this.stick.left.x = left.x;
    this.stick.left.y = left.y;
    this.stick.right.x = right.x;
    this.stick.right.y = right.y;
    this.gamepadConnected = connected;
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
