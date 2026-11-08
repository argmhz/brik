import { beforeAll, describe, expect, it } from "vitest";
import { App, CharacterController2D, Collider2D, GamePlugins, Physics, RigidBody2D, Transform2D, initPhysics } from "../src/index";

beforeAll(async () => {
  await initPhysics();
});

// ground top at y 10, a hero 16x24: standing, its center is at y 22 (plus the 0.5 skin)
const setup = (y = 100) => {
  const app = new App().addPlugin(GamePlugins());
  const w = app.world;
  w.spawn([Transform2D, { position: { x: 0, y: 0 } }], [Collider2D, { size: { x: 2000, y: 20 } }]);
  const hero = w.spawn([Transform2D, { position: { x: 0, y } }], [RigidBody2D, { type: "kinematic" }], [CharacterController2D], [Collider2D, { size: { x: 16, y: 24 } }]);
  app.update(1 / 60);
  return { app, w, hero, physics: w.resource(Physics), T: w.store(Transform2D) };
};

describe("character controller between physics steps", () => {
  it("two moves before the next physics step both count, and the second stops on the ground", () => {
    const { physics, T, hero } = setup(100);
    physics.moveCharacter(hero, 0, -50); // to 50
    physics.moveCharacter(hero, 0, -50); // would end at 0, inside the ground: stops at 22
    expect(T.position.y[hero]).toBeCloseTo(22.5, 1); // 22 plus the 0.5 skin
  });

  it("on a 144 Hz screen (frames without a physics step) the hero lands on the ground, where its collider is", () => {
    const { app, physics, T, hero } = setup(22);
    const ppm = physics.pixelsPerMeter;
    let vy = 0;
    // like a platformer script: gravity, a jump now and then, walking right, once per frame
    for (let f = 0; f < 144 * 4; f++) {
      const dt = 1 / 144;
      const grounded = app.world.store(CharacterController2D).grounded[hero] === 1;
      if (grounded) vy = Math.max(vy, -30);
      if (grounded && f % 100 === 50) vy = 360;
      vy -= 760 * dt;
      physics.moveCharacter(hero, 130 * dt, vy * dt);
      app.update(dt);
    }
    for (let f = 0; f < 144; f++) {
      vy = Math.max(vy - 760 / 144, -30);
      physics.moveCharacter(hero, 0, vy / 144);
      app.update(1 / 144);
    }
    expect(T.position.y[hero]).toBeCloseTo(22.5, 1); // 22 plus the 0.5 skin
    // what is drawn is where the physics has the hero
    const body = (physics as unknown as { bodies: Map<number, { body: { translation(): { x: number; y: number } } }> }).bodies.get(hero)!.body;
    expect(body.translation().y * ppm).toBeCloseTo(T.position.y[hero], 1);
    expect(body.translation().x * ppm).toBeCloseTo(T.position.x[hero], 1);
  });

  it("a respawn (the transform set by a script) moves the physics body too", () => {
    const { app, physics, T, hero } = setup(22.5);
    const ppm = physics.pixelsPerMeter;
    for (let i = 0; i < 30; i++) {
      physics.moveCharacter(hero, 3, -1);
      app.update(1 / 60);
    }
    T.position.x[hero] = 500; // like Player.respawn()
    T.position.y[hero] = 60;
    for (let i = 0; i < 120; i++) {
      physics.moveCharacter(hero, 0, -2);
      app.update(1 / 60);
    }
    const body = (physics as unknown as { bodies: Map<number, { body: { translation(): { x: number; y: number } } }> }).bodies.get(hero)!.body;
    expect(T.position.x[hero]).toBeCloseTo(500, 1);
    expect(T.position.y[hero]).toBeCloseTo(22.5, 1);
    expect(body.translation().x * ppm).toBeCloseTo(500, 1);
    expect(body.translation().y * ppm).toBeCloseTo(22.5, 1);
  });
});
