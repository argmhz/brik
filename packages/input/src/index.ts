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

type RawEvent =
  | { type: "down" | "up"; code: Binding }
  | { type: "pdown" | "pmove" | "pup"; id: number; x: number; y: number; dx: number; dy: number; button: number; touch: boolean };

/**
 * A finger or mouse button held on the game, in CSS pixels relative to the
 * attached element (y down). Listed in `Input.pointers` while held, and for one
 * more frame with `released` set.
 */
export interface PointerInfo {
  readonly id: number;
  x: number;
  y: number;
  /** Where it went down. */
  readonly startX: number;
  readonly startY: number;
  down: boolean;
  /** Went down this frame. */
  pressed: boolean;
  /** Was lifted this frame. */
  released: boolean;
  /** A finger (or pen), not a mouse. */
  readonly touch: boolean;
  /**
   * What took it when it went down (e.g. an on-screen joystick's entity), or -1.
   * A taken pointer doesn't move `pointer` and doesn't press `Mouse0`, so pressing
   * an on-screen jump button doesn't also fire.
   */
  readonly owner: number;
}

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

  /** Fingers and mouse buttons held on the game this frame (and ones lifted this frame). */
  readonly pointers: PointerInfo[] = [];
  private pointerById = new Map<number, PointerInfo>();
  /** The finger that acts as the mouse (`pointer` and `Mouse0`), or null. Only the first free finger does. */
  private mouseFinger: number | null = null;
  /**
   * Decides who takes a pointer when it goes down (CSS pixels, y down): an owner id, or -1
   * for nobody. The UI sets it so on-screen controls get their own fingers.
   */
  claim: ((x: number, y: number) => number) | null = null;
  /**
   * True on a touch screen: set when a finger touches the game (or the device's main pointer is
   * coarse at start), cleared when a key is pressed. On-screen controls show only while it is true.
   */
  touchMode =
    typeof matchMedia === "function" ? (() => { try { return matchMedia("(pointer: coarse)").matches; } catch { return false; } })() : false;
  private virtualAxes = new Map<string, number>();

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
    // an on-screen button for the action holds "Touch:<action>"
    const touch = `Touch:${name}`;
    let down = this.down.has(touch);
    let pressed = this.pressedSet.has(touch);
    let released = this.releasedSet.has(touch);
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
    v += this.virtualAxes.get(name) ?? 0;
    return Math.max(-1, Math.min(1, v));
  }

  // ------------------------------------------------- on-screen controls

  /**
   * Holds or lets go of a binding right away, in this frame (`pressed` / `released`
   * are set at once). On-screen buttons use `"Touch:<action>"`, which every action
   * of that name listens to. Call it after input has started the frame (preUpdate).
   */
  setButton(code: Binding, down: boolean): void {
    if (down && !this.down.has(code)) {
      this.down.add(code);
      this.pressedSet.add(code);
    } else if (!down && this.down.delete(code)) {
      this.releasedSet.add(code);
    }
  }

  /** Adds to an axis for this frame only (an on-screen joystick does it every frame). Values add up and are clamped by `axis`. */
  addAxis(name: string, value: number): void {
    this.virtualAxes.set(name, (this.virtualAxes.get(name) ?? 0) + value);
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
      // a keyboard on a tablet: the on-screen controls go away
      this.touchMode = false;
      if (!ev.repeat) this.queue.push({ type: "down", code: ev.code });
    });
    on(window, "keyup", (ev) => this.queue.push({ type: "up", code: ev.code }));
    on(window, "blur", () => {
      for (const code of this.down) if (!code.startsWith("Touch:")) this.queue.push({ type: "up", code });
      for (const p of this.pointerById.values()) this.queue.push({ type: "pup", id: p.id, x: p.x, y: p.y, dx: 0, dy: 0, button: 0, touch: p.touch });
    });
    const raw = (type: "pdown" | "pmove" | "pup", ev: PointerEvent) => {
      const r = element.getBoundingClientRect();
      const touch = ev.pointerType === "touch" || ev.pointerType === "pen";
      this.queue.push({ type, id: ev.pointerId, x: ev.clientX - r.left, y: ev.clientY - r.top, dx: ev.movementX ?? 0, dy: ev.movementY ?? 0, button: ev.button, touch });
    };
    on(element, "pointerdown", (ev) => {
      element.setPointerCapture?.(ev.pointerId);
      if (ev.pointerType === "touch") this.touchMode = true;
      raw("pdown", ev);
    });
    on(element, "pointerup", (ev) => raw("pup", ev));
    on(element, "pointercancel", (ev) => raw("pup", ev));
    on(element, "pointermove", (ev) => raw("pmove", ev));
    on(element, "pointerleave", (ev) => {
      if (ev.pointerType === "mouse") this.pointer.inside = false;
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

  /**
   * Puts a finger down, moves it or lifts it (CSS pixels, y down), e.g. from tests or an AI.
   * Applied next frame, like a real touch. `id` tells fingers apart.
   */
  injectTouch(type: "down" | "move" | "up", id: number, x: number, y: number): void {
    this.touchMode = true;
    const p = this.pointerById.get(id);
    this.queue.push({ type: type === "down" ? "pdown" : type === "move" ? "pmove" : "pup", id, x, y, dx: p ? x - p.x : 0, dy: p ? y - p.y : 0, button: 0, touch: true });
  }

  /** @internal Applies queued events. Called once per frame in preUpdate. */
  _beginFrame(): void {
    this.pressedSet.clear();
    this.releasedSet.clear();
    // pointers lifted last frame are gone; the rest are no longer new
    for (let i = this.pointers.length - 1; i >= 0; i--) {
      const p = this.pointers[i];
      p.pressed = false;
      if (p.released) {
        this.pointers.splice(i, 1);
        if (this.pointerById.get(p.id) === p) this.pointerById.delete(p.id);
      }
    }
    const press = (code: Binding) => {
      if (!this.down.has(code)) this.pressedSet.add(code);
      this.down.add(code);
    };
    const lift = (code: Binding) => {
      if (this.down.delete(code)) this.releasedSet.add(code);
    };
    for (const ev of this.queue) {
      if (!("code" in ev)) this.pointerEvent(ev, press, lift);
      else if (ev.type === "down") press(ev.code);
      else lift(ev.code);
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
    this.virtualAxes.clear();
    this.readGamepads();
  }

  /**
   * One pointer event. A pointer nobody claims acts as the mouse: it moves `pointer` and holds
   * `Mouse<button>` (for fingers, only the first free finger does, as `Mouse0`).
   */
  private pointerEvent(
    ev: Extract<RawEvent, { type: "pdown" | "pmove" | "pup" }>,
    press: (code: Binding) => void,
    lift: (code: Binding) => void,
  ): void {
    const moveMouse = () => {
      this.pendingMove.x = ev.x;
      this.pendingMove.y = ev.y;
      this.pointer.inside = true;
    };
    let p = this.pointerById.get(ev.id);
    if (ev.type === "pdown") {
      if (!p || p.released) {
        const owner = this.claim?.(ev.x, ev.y) ?? -1;
        p = { id: ev.id, x: ev.x, y: ev.y, startX: ev.x, startY: ev.y, down: true, pressed: true, released: false, touch: ev.touch, owner: owner >= 0 ? owner : -1 };
        this.pointers.push(p);
        this.pointerById.set(ev.id, p);
      }
      if (p.owner >= 0) return;
      if (!ev.touch) {
        // a mouse: every button is its own binding
        moveMouse();
        press(`Mouse${ev.button}`);
      } else if (this.mouseFinger === null || this.mouseFinger === ev.id) {
        this.mouseFinger = ev.id;
        moveMouse();
        press("Mouse0");
      }
      return;
    }
    if (p) {
      p.x = ev.x;
      p.y = ev.y;
    }
    if (ev.type === "pmove") {
      // a hovering mouse has no pointer entry; a claimed pointer doesn't move the mouse
      if (p && p.owner >= 0) return;
      if (ev.touch && this.mouseFinger !== ev.id) return;
      moveMouse();
      this.pendingMove.dx += ev.dx;
      this.pendingMove.dy += ev.dy;
      return;
    }
    // up
    if (p) {
      p.down = false;
      p.released = true;
    }
    if (p && p.owner >= 0) return;
    if (!ev.touch) lift(`Mouse${ev.button}`);
    else if (this.mouseFinger === ev.id) {
      this.mouseFinger = null;
      lift("Mouse0");
    }
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
