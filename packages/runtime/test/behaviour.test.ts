import { describe, expect, it } from "vitest";
import {
  App,
  Behaviour,
  BehaviourRuntime,
  CorePlugin,
  InputPlugin,
  ScriptRegistry,
  Scripts,
  ScriptsPlugin,
  Transform2D,
  expose,
  exposedFields,
  system,
} from "../src";

class Mover extends Behaviour {
  speed = 10;
  label = "hi";
  started = 0;
  destroyed = 0;
  override onStart() {
    this.started++;
  }
  override onUpdate(dt: number) {
    this.transform.position.x += this.speed * dt;
  }
  override onDestroy() {
    this.destroyed++;
  }
}
expose(Mover.prototype, "speed");
expose({ label: "Navn" })(Mover.prototype, "label");

function setup() {
  const registry = new ScriptRegistry();
  registry.load({ "scripts/mover.ts": { Mover } });
  const app = new App({ fixedHz: 10 }).addPlugin(CorePlugin).addPlugin(InputPlugin()).addPlugin(ScriptsPlugin(registry));
  const runtime = app.world.resource(BehaviourRuntime);
  return { app, registry, runtime, w: app.world };
}

describe("Behaviours", () => {
  it("lists exposed fields with inferred types and defaults", () => {
    expect(exposedFields(Mover)).toEqual([
      { key: "speed", type: "number", default: 10 },
      { key: "label", type: "string", default: "hi", label: "Navn" },
    ]);
  });

  it("creates instances, applies props and runs lifecycle methods", () => {
    const { app, runtime, w } = setup();
    const e = w.spawn(Transform2D, [Scripts, { list: [{ script: "scripts/mover.ts#Mover", props: { speed: 100 } }] }]);
    app.update(0.1);
    const inst = runtime.instance(e, 0) as Mover;
    expect(inst.started).toBe(1);
    expect(w.store(Transform2D).position.x[e]).toBeCloseTo(10);
    app.update(0.1);
    expect(inst.started).toBe(1);
    expect(w.store(Transform2D).position.x[e]).toBeCloseTo(20);

    w.destroy(e);
    app.update(0.1);
    expect(inst.destroyed).toBe(1);
    expect(runtime.count).toBe(0);
  });

  it("keeps runtime state but picks up prop edits", () => {
    const { app, runtime, w } = setup();
    const e = w.spawn(Transform2D, [Scripts, { list: [{ script: "scripts/mover.ts#Mover", props: { speed: 1 } }] }]);
    app.update(0.1);
    const inst = runtime.instance(e, 0) as Mover;
    inst.label = "changed at runtime";
    app.update(0.1);
    expect(inst.label).toBe("changed at runtime");
    // the editor replaces the props object when a value is edited
    w.store(Scripts).list[e] = [{ script: "scripts/mover.ts#Mover", props: { speed: 5 } }];
    app.update(0.1);
    expect(inst.speed).toBe(5);
    expect(inst.label).toBe("changed at runtime");
  });

  it("swaps to a reloaded class and keeps field values", () => {
    const { app, registry, runtime, w } = setup();
    const e = w.spawn(Transform2D, [Scripts, { list: [{ script: "scripts/mover.ts#Mover", props: {} }] }]);
    app.update(0.1);
    (runtime.instance(e, 0) as Mover).speed = 42;
    class Mover2 extends Behaviour {
      speed = 0;
      override onUpdate() {
        this.transform.position.y = this.speed;
      }
    }
    registry.load({ "scripts/mover.ts": { Mover: Mover2 } });
    app.update(0.1);
    expect(runtime.instance(e, 0)).toBeInstanceOf(Mover2);
    expect(w.store(Transform2D).position.y[e]).toBe(42);
  });

  it("loads systems from modules and survives throwing scripts", () => {
    const registry = new ScriptRegistry();
    let ticks = 0;
    class Boom extends Behaviour {
      override onUpdate() {
        throw new Error("boom");
      }
    }
    registry.load({ "scripts/a.ts": { tick: system("tick", () => ticks++, "postUpdate"), Boom, notAThing: 5 } });
    expect(registry.systems.map((s) => [s.id, s.phase])).toEqual([["scripts/a.ts#tick", "postUpdate"]]);
    const app = new App().addPlugin(InputPlugin()).addPlugin(ScriptsPlugin(registry));
    app.world.spawn([Scripts, { list: [{ script: "scripts/a.ts#Boom", props: {} }] }]);
    const err = console.error;
    console.error = () => {};
    app.update(0.016);
    app.update(0.016);
    console.error = err;
    expect(ticks).toBe(2);
  });
});
