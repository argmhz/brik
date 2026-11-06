/** A reversible edit. `do` is also used for redo. */
export interface EditCommand {
  label: string;
  do(): void;
  undo(): void;
  /**
   * Commands with the same key that follow each other quickly are merged into
   * one undo step, e.g. dragging a number field.
   */
  mergeKey?: string;
}

/** Never on the stack, so a history saved "at" it is always dirty. */
const UNSAVED: EditCommand = { label: "", do() {}, undo() {} };

/** Undo/redo stack. */
export class History {
  private undoStack: EditCommand[] = [];
  private redoStack: EditCommand[] = [];
  private lastPush = 0;
  private savedAt: EditCommand | null = null;
  private listeners = new Set<() => void>();

  constructor(
    readonly limit = 200,
    readonly mergeWindowMs = 800,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** Runs a command and records it. */
  execute(cmd: EditCommand): void {
    cmd.do();
    this.push(cmd);
  }

  /** Records a command that has already been applied (e.g. at the end of a drag). */
  push(cmd: EditCommand): void {
    const t = this.now();
    const top = this.undoStack.at(-1);
    if (top && cmd.mergeKey && top.mergeKey === cmd.mergeKey && t - this.lastPush < this.mergeWindowMs && top !== this.savedAt) {
      this.undoStack[this.undoStack.length - 1] = {
        label: cmd.label,
        mergeKey: cmd.mergeKey,
        do: cmd.do,
        undo: top.undo,
      };
    } else {
      this.undoStack.push(cmd);
      if (this.undoStack.length > this.limit) this.undoStack.shift();
    }
    this.lastPush = t;
    this.redoStack = [];
    this.emit();
  }

  undo(): boolean {
    const cmd = this.undoStack.pop();
    if (!cmd) return false;
    cmd.undo();
    this.redoStack.push(cmd);
    this.lastPush = 0;
    this.emit();
    return true;
  }

  redo(): boolean {
    const cmd = this.redoStack.pop();
    if (!cmd) return false;
    cmd.do();
    this.undoStack.push(cmd);
    this.lastPush = 0;
    this.emit();
    return true;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.savedAt = null;
    this.emit();
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  get undoLabel(): string | undefined {
    return this.undoStack.at(-1)?.label;
  }

  get redoLabel(): string | undefined {
    return this.redoStack.at(-1)?.label;
  }

  /** Marks the current state as saved. */
  markSaved(): void {
    this.savedAt = this.undoStack.at(-1) ?? null;
    this.lastPush = 0;
    this.emit();
  }

  /** Marks the current state as not saved, e.g. after restoring unsaved changes. */
  markUnsaved(): void {
    this.savedAt = UNSAVED;
    this.emit();
  }

  /** True if there are changes since the last save. */
  get dirty(): boolean {
    return (this.undoStack.at(-1) ?? null) !== this.savedAt;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }
}
