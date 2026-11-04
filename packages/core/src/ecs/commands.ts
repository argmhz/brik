import type { ComponentDef } from "./component";
import type { Entity } from "./entity";
import type { Init, Schema } from "./schema";
import type { World } from "./world";

/** A component, or a component with initial values. */
export type SpawnEntry = ComponentDef<any> | readonly [ComponentDef<any>, Init<any>?];

/** @internal */
export function splitEntry(entry: SpawnEntry): readonly [ComponentDef<any>, Init<any>?] {
  return "schema" in entry ? [entry] : entry;
}

/** Builds a typed spawn entry: `withInit(Sprite, { sprite })`. */
export function withInit<S extends Schema>(def: ComponentDef<S>, init: Init<S>): readonly [ComponentDef<S>, Init<S>] {
  return [def, init];
}

type Op =
  | { kind: "add"; e: Entity; def: ComponentDef<any>; init?: Init<any> }
  | { kind: "remove"; e: Entity; def: ComponentDef<any> }
  | { kind: "destroy"; e: Entity }
  | { kind: "run"; fn: (world: World) => void };

/**
 * Records structural changes and applies them later (after the current system).
 * Use this while iterating a query to avoid changing what you are iterating.
 */
export class Commands {
  private ops: Op[] = [];

  constructor(private readonly world: World) {}

  /**
   * The entity id is reserved immediately, so you can refer to it right away.
   * Its components are added when the commands are flushed.
   */
  spawn(...entries: SpawnEntry[]): Entity {
    const e = this.world.spawn();
    for (const entry of entries) {
      const [def, init] = splitEntry(entry);
      this.ops.push({ kind: "add", e, def, init });
    }
    return e;
  }

  add<S extends Schema>(e: Entity, def: ComponentDef<S>, init?: Init<S>): this {
    this.ops.push({ kind: "add", e, def, init });
    return this;
  }

  remove(e: Entity, def: ComponentDef): this {
    this.ops.push({ kind: "remove", e, def });
    return this;
  }

  destroy(e: Entity): this {
    this.ops.push({ kind: "destroy", e });
    return this;
  }

  /** Runs arbitrary code at flush time. */
  run(fn: (world: World) => void): this {
    this.ops.push({ kind: "run", fn });
    return this;
  }

  get pending(): number {
    return this.ops.length;
  }

  flush(): void {
    // ops may enqueue more ops, so loop until empty
    while (this.ops.length > 0) {
      const ops = this.ops;
      this.ops = [];
      for (const op of ops) {
        switch (op.kind) {
          case "add":
            if (this.world.isAlive(op.e)) this.world.add(op.e, op.def, op.init);
            break;
          case "remove":
            this.world.remove(op.e, op.def);
            break;
          case "destroy":
            this.world.destroy(op.e);
            break;
          case "run":
            op.fn(this.world);
            break;
        }
      }
    }
  }
}
