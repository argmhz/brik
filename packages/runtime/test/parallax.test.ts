import { beforeAll, describe, expect, it } from "vitest";
import { App, Camera2D, CameraFollow2D, GamePlugins, GlobalTransform2D, Parallax2D, Transform2D, initPhysics, previewParallax, propagateTransforms, setParent } from "../src/index";

beforeAll(async () => {
  await initPhysics();
});

function setup() {
  const app = new App().addPlugin(GamePlugins());
  const w = app.world;
  const target = w.spawn([Transform2D, { position: { x: 0, y: 0 } }]);
  const cam = w.spawn([Transform2D, {}], [Camera2D, {}], [CameraFollow2D, { target: w.ref(target), smoothing: 0 }]);
  const layer = (factor: { x: number; y: number }, x = 100, y = 20) => {
    const root = w.spawn([Transform2D, { position: { x, y } }], [Parallax2D, { factor }]);
    const child = w.spawn([Transform2D, { position: { x: 10, y: 5 } }]);
    setParent(w, child, root);
    return { root, child };
  };
  const moveTarget = (x: number, y = 0) => {
    w.store(Transform2D).position.x[target] = x;
    w.store(Transform2D).position.y[target] = y;
  };
  return { app, w, cam, layer, moveTarget };
}

describe("Parallax2D", () => {
  it("a layer moves at its share of the camera's movement, and its children follow", () => {
    const { app, w, layer, moveTarget } = setup();
    const { root, child } = layer({ x: 0.5, y: 1 });
    const T = w.store(Transform2D);
    const G = w.store(GlobalTransform2D).matrix;
    app.update(1 / 60);
    expect(T.position.x[root]).toBe(100); // the camera is at the origin: the layer sits where it was placed
    moveTarget(400, 60);
    app.update(1 / 60);
    // camera at x 400: half of it is left over for the layer (400 * (1 - 0.5))
    expect(T.position.x[root]).toBeCloseTo(300);
    expect(T.position.y[root]).toBeCloseTo(20); // y factor 1: stays with the world
    // the child is drawn at the layer's position plus its own, in the same frame
    expect(G.tx[child]).toBeCloseTo(310);
    expect(G.ty[child]).toBeCloseTo(25);
  });

  it("factor 0 holds the layer still on the screen", () => {
    const { app, w, cam, layer, moveTarget } = setup();
    const { root, child } = layer({ x: 0, y: 0 });
    const T = w.store(Transform2D);
    const G = w.store(GlobalTransform2D).matrix;
    for (const x of [0, 150, 500, 900]) {
      moveTarget(x, x / 10);
      app.update(1 / 60);
      expect(T.position.x[root] - T.position.x[cam]).toBeCloseTo(100);
      expect(G.tx[child] - T.position.x[cam]).toBeCloseTo(110);
      expect(G.ty[child] - T.position.y[cam]).toBeCloseTo(25);
    }
  });

  it("factor 1 is an ordinary entity", () => {
    const { app, w, layer, moveTarget } = setup();
    const { root } = layer({ x: 1, y: 1 });
    moveTarget(700);
    app.update(1 / 60);
    expect(w.store(Transform2D).position.x[root]).toBe(100);
  });

  it("the editor preview shows a layer where the game will have it, without changing what is saved", () => {
    const { app, w, cam, layer, moveTarget } = setup();
    const { root, child } = layer({ x: 0.65, y: 1 });
    const T = w.store(Transform2D);
    const G = w.store(GlobalTransform2D).matrix;
    // the game, with the camera at x 400
    moveTarget(400);
    app.update(1 / 60);
    const inGame = { x: G.tx[child], y: G.ty[child] };
    expect(T.position.x[cam]).toBeCloseTo(400);
    // the editor: the layer is back at its saved place, the view is centered on x 400
    T.position.x[root] = 100;
    T.position.y[root] = 20;
    propagateTransforms.run(w);
    previewParallax(w, 400, T.position.y[cam]);
    expect(G.tx[child]).toBeCloseTo(inGame.x);
    expect(G.ty[child]).toBeCloseTo(inGame.y);
    expect(T.position.x[root]).toBe(100); // saved value untouched
  });
});
