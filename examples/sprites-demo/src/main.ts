import {
  Assets,
  Camera2D,
  Input,
  Name,
  Renderer,
  SortingOrder,
  Sprite,
  type SpriteRef,
  Time,
  Transform2D,
  type World,
  clamp,
  createGame,
  defineComponent,
  setParent,
  system,
  t,
  withInit,
} from "@brik/runtime";
import { drawSpriteSheet } from "./art";

// ------------------------------------------------------------------ components

const Player = defineComponent("Demo.Player", { speed: t.f32(90) });
const Velocity = defineComponent("Demo.Velocity", { linear: t.vec2(), spin: t.f32() });
const Orbit = defineComponent("Demo.Orbit", { speed: t.f32(2) });
const Coin = defineComponent("Demo.Coin");
/** Simple frame animation. The real SpriteAnimator comes in phase 4. */
const Animated = defineComponent("Demo.Animated", {
  frames: t.ref<SpriteRef[]>(() => []),
  fps: t.f32(8),
  time: t.f32(),
  playing: t.bool(true),
});

class Score {
  coins = 0;
}

const TILE = 16;
const ARENA_W = 60;
const ARENA_H = 40;
const HALF_W = (ARENA_W * TILE) / 2;
const HALF_H = (ARENA_H * TILE) / 2;

// ------------------------------------------------------------------ setup

const canvas = document.querySelector<HTMLCanvasElement>("#game")!;
const app = createGame({ canvas });
const world = app.world;
world.insertResource(new Score());

const assets = world.resource(Assets);
const sheet = assets.addTexture(drawSpriteSheet(), { name: "demo", settings: { filter: "nearest" } });
const cells = assets.sliceGrid(sheet, { cell: [TILE, TILE], prefix: "demo" });
const heroFrames = cells.slice(0, 4);
const coinFrames = cells.slice(4, 8);
const [grass, flowers, stone, gem] = cells.slice(8, 12);

// ground: lots of static tiles, good for testing batching and culling
let seed = 42;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
for (let y = 0; y < ARENA_H; y++) {
  for (let x = 0; x < ARENA_W; x++) {
    const r = rand();
    world.spawn(
      withInit(Transform2D, { position: { x: -HALF_W + x * TILE + TILE / 2, y: -HALF_H + y * TILE + TILE / 2 } }),
      withInit(Sprite, { sprite: r < 0.08 ? stone : r < 0.2 ? flowers : grass }),
      withInit(SortingOrder, { layer: 0 }),
    );
  }
}

// player with two orbiting gems (shows the transform hierarchy)
const player = world.spawn(
  withInit(Name, { value: "Player" }),
  withInit(Transform2D, { position: { x: 0, y: 0 } }),
  withInit(Sprite, { sprite: heroFrames[0] }),
  withInit(SortingOrder, { layer: 1, ySort: true }),
  withInit(Animated, { frames: heroFrames, fps: 10, playing: false }),
  Player,
);
const pivot = world.spawn(withInit(Name, { value: "Orbit" }), Transform2D, Orbit);
setParent(world, pivot, player);
for (const [x, tint] of [
  [18, { r: 1, g: 0.3, b: 0.5, a: 1 }],
  [-18, { r: 0.3, g: 0.9, b: 1, a: 1 }],
] as const) {
  const g = world.spawn(
    withInit(Transform2D, { position: { x, y: 0 }, scale: { x: 0.6, y: 0.6 } }),
    withInit(Sprite, { sprite: gem, color: tint }),
    withInit(SortingOrder, { layer: 2 }),
  );
  setParent(world, g, pivot);
}

const camera = world.spawn(
  withInit(Name, { value: "Main Camera" }),
  Transform2D,
  withInit(Camera2D, { zoom: 3, clearColor: { r: 0.07, g: 0.06, b: 0.1, a: 1 } }),
);

for (let i = 0; i < 40; i++) spawnCoin(world);

// ------------------------------------------------------------------ helpers

function spawnCoin(w: World) {
  w.commands.spawn(
    Coin,
    withInit(Transform2D, {
      position: { x: (rand() * 2 - 1) * (HALF_W - TILE), y: (rand() * 2 - 1) * (HALF_H - TILE) },
    }),
    withInit(Sprite, { sprite: coinFrames[0] }),
    withInit(SortingOrder, { layer: 1, ySort: true }),
    withInit(Animated, { frames: coinFrames, fps: 8, time: rand() }),
  );
}

function spawnGems(w: World, x: number, y: number, count: number) {
  for (let i = 0; i < count; i++) {
    const angle = rand() * Math.PI * 2;
    const speed = 30 + rand() * 120;
    w.commands.spawn(
      withInit(Transform2D, { position: { x, y }, scale: { x: 0.5, y: 0.5 } }),
      withInit(Sprite, { sprite: gem, color: { r: 0.4 + rand() * 0.6, g: 0.4 + rand() * 0.6, b: 0.4 + rand() * 0.6 } }),
      withInit(SortingOrder, { layer: 1, order: 1 }),
      withInit(Velocity, { linear: { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed }, spin: (rand() - 0.5) * 8 }),
    );
  }
}

// ------------------------------------------------------------------ systems

app.addSystem(
  "update",
  system("playerMove", (w) => {
    const input = w.resource(Input);
    const time = w.resource(Time);
    const T = w.store(Transform2D);
    const S = w.store(Sprite);
    const A = w.store(Animated);
    for (const e of w.query([Player, Transform2D])) {
      let dx = input.axis("horizontal");
      let dy = input.axis("vertical");
      const len = Math.hypot(dx, dy);
      if (len > 0) {
        dx /= len;
        dy /= len;
      }
      const speed = w.store(Player).speed[e];
      T.position.x[e] = clamp(T.position.x[e] + dx * speed * time.dt, -HALF_W + 8, HALF_W - 8);
      T.position.y[e] = clamp(T.position.y[e] + dy * speed * time.dt, -HALF_H + 8, HALF_H - 8);
      if (dx !== 0) S.flipX[e] = dx < 0 ? 1 : 0;
      A.playing[e] = len > 0 ? 1 : 0;
      if (len === 0) {
        A.time[e] = 0;
        S.sprite[e] = A.frames[e][0];
      }
    }
  }),
);

app.addSystem(
  "update",
  system("animate", (w) => {
    const dt = w.resource(Time).dt;
    const A = w.store(Animated);
    const S = w.store(Sprite);
    for (const e of w.query([Animated, Sprite])) {
      if (!A.playing[e]) continue;
      A.time[e] += dt;
      const frames = A.frames[e];
      S.sprite[e] = frames[Math.floor(A.time[e] * A.fps[e]) % frames.length];
    }
  }),
);

app.addSystem(
  "update",
  system("orbit", (w) => {
    const dt = w.resource(Time).dt;
    const T = w.store(Transform2D);
    for (const e of w.query([Orbit, Transform2D])) T.rotation[e] += w.store(Orbit).speed[e] * dt;
  }),
);

app.addSystem(
  "fixedUpdate",
  system("bounce", (w) => {
    const dt = w.resource(Time).dt;
    const T = w.store(Transform2D);
    const V = w.store(Velocity);
    for (const e of w.query([Velocity, Transform2D])) {
      let x = T.position.x[e] + V.linear.x[e] * dt;
      let y = T.position.y[e] + V.linear.y[e] * dt;
      if (x < -HALF_W || x > HALF_W) {
        V.linear.x[e] *= -1;
        x = clamp(x, -HALF_W, HALF_W);
      }
      if (y < -HALF_H || y > HALF_H) {
        V.linear.y[e] *= -1;
        y = clamp(y, -HALF_H, HALF_H);
      }
      T.position.x[e] = x;
      T.position.y[e] = y;
      T.rotation[e] += V.spin[e] * dt;
    }
  }),
);

app.addSystem(
  "update",
  system("collectCoins", (w) => {
    const T = w.store(Transform2D);
    const px = T.position.x[player];
    const py = T.position.y[player];
    for (const c of w.query([Coin, Transform2D])) {
      if (Math.hypot(T.position.x[c] - px, T.position.y[c] - py) < 12) {
        w.commands.destroy(c);
        w.resource(Score).coins++;
        spawnGems(w, T.position.x[c], T.position.y[c], 12);
        spawnCoin(w);
      }
    }
  }),
);

app.addSystem(
  "update",
  system("spawnOnInput", (w) => {
    const input = w.resource(Input);
    if (input.action("jump").pressed) {
      const T = w.store(Transform2D);
      spawnGems(w, T.position.x[player], T.position.y[player], 1000);
    }
    if (input.action("fire").pressed) {
      const at = w.resource(Renderer).screenToWorld(w, camera, input.pointer);
      spawnGems(w, at.x, at.y, 50);
    }
    if (input.key("KeyC").pressed) {
      for (const e of w.query([Velocity])) w.commands.destroy(e);
    }
  }),
);

app.addSystem(
  "update",
  system("cameraFollow", (w) => {
    const input = w.resource(Input);
    const dt = w.resource(Time).dt;
    const T = w.store(Transform2D);
    const C = w.store(Camera2D);
    const k = 1 - Math.exp(-8 * dt);
    T.position.x[camera] += (T.position.x[player] - T.position.x[camera]) * k;
    T.position.y[camera] += (T.position.y[player] - T.position.y[camera]) * k;
    if (input.wheel !== 0) C.zoom[camera] = clamp(C.zoom[camera] * Math.exp(-input.wheel * 0.001), 0.5, 8);
  }),
);

// ------------------------------------------------------------------ HUD

const hud = document.querySelector<HTMLDivElement>("#hud")!;
let hudTimer = 0;
let frames = 0;
app.addSystem(
  "render",
  system("hud", (w) => {
    const time = w.resource(Time);
    frames++;
    hudTimer += time.unscaledDt;
    if (hudTimer < 0.25) return;
    const stats = w.resource(Renderer).stats;
    hud.textContent = [
      `FPS ${Math.round(frames / hudTimer)}`,
      `entities ${w.entityCount}`,
      `sprites drawn ${stats.sprites}`,
      `draw calls ${stats.drawCalls}`,
      `coins ${w.resource(Score).coins}`,
    ].join("  ·  ");
    hudTimer = 0;
    frames = 0;
  }),
);

app.start();

// handy for poking around from the devtools console
Object.assign(globalThis, { app, world });
