export interface EventType<T> {
  readonly name: string;
  /** Phantom marker carrying the payload type. */
  readonly __payload?: T;
}

export function defineEvent<T = void>(name: string): EventType<T> {
  return { name };
}

/**
 * Double-buffered event queue. Events live for two frames, so every system sees
 * an event once, no matter whether it runs before or after the sender. Each
 * reader keeps its own cursor so it never sees the same event twice.
 */
export class EventChannel<T> {
  private prev: { seq: number; data: T }[] = [];
  private curr: { seq: number; data: T }[] = [];
  private seq = 0;

  send(data: T): void {
    this.curr.push({ seq: ++this.seq, data });
  }

  /** Called once per frame by the app. */
  update(): void {
    this.prev = this.curr;
    this.curr = [];
  }

  reader(): EventReader<T> {
    return new EventReader(this, this.seq);
  }

  /** @internal */
  _since(cursor: number, out: T[]): number {
    let last = cursor;
    for (const buf of [this.prev, this.curr]) {
      for (const ev of buf) {
        if (ev.seq > cursor) {
          out.push(ev.data);
          last = ev.seq;
        }
      }
    }
    return last;
  }
}

export class EventReader<T> {
  constructor(
    private readonly channel: EventChannel<T>,
    private cursor: number,
  ) {}

  /** Returns events this reader has not seen yet. */
  read(): T[] {
    const out: T[] = [];
    this.cursor = this.channel._since(this.cursor, out);
    return out;
  }
}
