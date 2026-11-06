import { type SceneEntityData, newGuid, newSceneId } from "@brik/runtime";

/**
 * Files for the "Platformer" example project: generated pixel art, sounds,
 * animations, prefabs, scripts and a level with a tilemap and UI. Everything
 * is ordinary project files, so it doubles as a tour of the engine.
 */
export async function platformerFiles(): Promise<Record<string, Uint8Array | string>> {
  const guids = { tiles: newGuid(), hero: newGuid(), coin: newGuid(), panel: newGuid() };
  const clips = { idle: newGuid(), run: newGuid(), jump: newGuid(), coin: newGuid() };
  const prefabs = { coin: newGuid(), sparkle: newGuid() };
  const sounds = { coin: newGuid(), jump: newGuid(), step: newGuid() };

  const files: Record<string, Uint8Array | string> = {};

  // ------------------------------------------------------------------ art
  files["assets/tiles.png"] = await png(64, 16, drawTiles);
  files["assets/tiles.png.meta.json"] = gridMeta(guids.tiles, 16, ["grass", "dirt", "stone", "brick"]);
  files["assets/hero.png"] = await png(96, 16, drawHero);
  files["assets/hero.png.meta.json"] = gridMeta(guids.hero, 16, ["hero_idle", "hero_run_0", "hero_run_1", "hero_run_2", "hero_run_3", "hero_jump"]);
  files["assets/coin.png"] = await png(64, 16, drawCoin);
  files["assets/coin.png.meta.json"] = gridMeta(guids.coin, 16, ["coin_0", "coin_1", "coin_2", "coin_3"]);
  files["assets/panel.png"] = await png(24, 24, drawPanel);
  files["assets/panel.png.meta.json"] = json({
    guid: guids.panel,
    importer: "texture",
    settings: { filter: "nearest", wrap: "clamp", pixelsPerUnit: 1 },
    slicing: { mode: "manual" },
    sprites: [{ id: "panel", name: "panel", rect: [0, 0, 24, 24], pivot: [0.5, 0.5], border: [8, 8, 8, 8] }],
  });

  // ------------------------------------------------------------------ sounds
  files["assets/coin.wav"] = wav(tone([988, 1319], [0.06, 0.14], "square", 0.25));
  files["assets/coin.wav.meta.json"] = json({ guid: sounds.coin, importer: "audio" });
  files["assets/jump.wav"] = wav(sweep(260, 620, 0.16, 0.22));
  files["assets/jump.wav.meta.json"] = json({ guid: sounds.jump, importer: "audio" });
  files["assets/step.wav"] = wav(noise(0.035, 0.18));
  files["assets/step.wav.meta.json"] = json({ guid: sounds.step, importer: "audio" });

  // ------------------------------------------------------------------ animations
  const frame = (tex: string, i: number, duration: number) => ({ sprite: [tex, `cell_${i}`], duration });
  files["assets/hero_idle.anim.json"] = json({ guid: clips.idle, importer: "animation", mode: "loop", frames: [frame(guids.hero, 0, 1)], events: [] });
  files["assets/hero_run.anim.json"] = json({
    guid: clips.run,
    importer: "animation",
    mode: "loop",
    frames: [1, 2, 3, 4].map((i) => frame(guids.hero, i, 0.09)),
    events: [
      { frame: 1, name: "footstep" },
      { frame: 3, name: "footstep" },
    ],
  });
  files["assets/hero_jump.anim.json"] = json({ guid: clips.jump, importer: "animation", mode: "once", frames: [frame(guids.hero, 5, 0.2)], events: [] });
  files["assets/coin_spin.anim.json"] = json({
    guid: clips.coin,
    importer: "animation",
    mode: "pingpong",
    frames: [0, 1, 2, 3].map((i) => frame(guids.coin, i, 0.12)),
    events: [],
  });

  // ------------------------------------------------------------------ prefabs
  const coinRoot = newSceneId();
  const coinComponents = {
    Name: { value: "Coin" },
    Transform2D: { position: { x: 0, y: 0 }, rotation: 0, scale: { x: 1, y: 1 } },
    Sprite: { sprite: { texture: guids.coin, id: "cell_0" } },
    SpriteAnimator: { clip: clips.coin },
    SortingOrder: { layer: 1, order: 0, ySort: false },
    Collider2D: { shape: "circle", size: { x: 12, y: 12 }, isTrigger: true },
    Tags: { list: ["coin"] },
  };
  files["prefabs/Coin.prefab.json"] = json({ guid: prefabs.coin, importer: "prefab", entities: [{ id: coinRoot, components: coinComponents }] });
  files["prefabs/Sparkle.prefab.json"] = json({
    guid: prefabs.sparkle,
    importer: "prefab",
    entities: [
      {
        id: newSceneId(),
        components: {
          Name: { value: "Sparkle" },
          Transform2D: { position: { x: 0, y: 0 } },
          SortingOrder: { layer: 2, order: 0, ySort: false },
          ParticleEmitter2D: {
            rate: 0,
            burst: 18,
            lifetime: { x: 0.25, y: 0.55 },
            speed: { x: 30, y: 90 },
            direction: Math.PI / 2,
            spread: Math.PI * 2,
            gravity: { x: 0, y: -120 },
            startSize: 4,
            endSize: 0.5,
            startColor: { r: 1, g: 0.95, b: 0.4, a: 1 },
            endColor: { r: 1, g: 0.5, b: 0.1, a: 0 },
            autoDestroy: true,
          },
        },
      },
    ],
  });

  // ------------------------------------------------------------------ scripts
  files["scripts/Player.ts"] = PLAYER_TS;
  files["scripts/RestartButton.ts"] = RESTART_TS;

  // ------------------------------------------------------------------ level
  const tiles: Record<string, string> = {};
  const put = (x0: number, x1: number, y: number, id: number) => {
    for (let x = x0; x <= x1; x++) tiles[`${x},${y}`] = `cell_${id}`;
  };
  // ground with a pit at 12..14
  for (const [a, b] of [[-8, 11], [15, 34]]) {
    put(a, b, -1, 0);
    put(a, b, -2, 1);
    put(a, b, -3, 1);
  }
  // walls at both ends
  for (let y = -3; y <= 8; y++) {
    tiles[`-9,${y}`] = "cell_2";
    tiles[`35,${y}`] = "cell_2";
  }
  put(4, 7, 2, 3);
  put(17, 20, 4, 3);
  put(24, 26, 2, 3);
  put(29, 31, 5, 3);

  const ids = { camera: newSceneId(), player: newSceneId(), canvas: newSceneId(), panel: newSceneId(), button: newSceneId() };
  const entities: SceneEntityData[] = [];
  const add = (id: string, components: SceneEntityData["components"]) => entities.push({ id, components });

  add(ids.camera, {
    Name: { value: "Main Camera" },
    Transform2D: { position: { x: 0, y: 40 } },
    Camera2D: { zoom: 3, clearColor: { r: 0.42, g: 0.68, b: 0.93, a: 1 } },
    CameraFollow2D: { target: ids.player, offset: { x: 0, y: 20 }, smoothing: 0.12, deadzone: { x: 16, y: 10 }, useBounds: true, bounds: { x: -144, y: -60, w: 720, h: 300 } },
    AudioListener: {},
  });
  add(newSceneId(), {
    Name: { value: "Level" },
    Transform2D: {},
    TileMap: { tileset: guids.tiles, tileSize: { x: 16, y: 16 }, tiles },
    TileMapCollider: {},
  });
  add(ids.player, {
    Name: { value: "Player" },
    Transform2D: { position: { x: 0, y: 24 } },
    Sprite: { sprite: { texture: guids.hero, id: "cell_0" } },
    SpriteAnimator: { clip: clips.idle },
    SortingOrder: { layer: 1, order: 1, ySort: false },
    RigidBody2D: { type: "kinematic" },
    CharacterController2D: { snapToGround: 4, stepHeight: 0 },
    Collider2D: { size: { x: 10, y: 16 } },
    Scripts: { list: [{ script: "scripts/Player.ts#Player", props: {} }] },
  });
  add(newSceneId(), {
    Name: { value: "Hint" },
    Transform2D: { position: { x: 0, y: 70 } },
    Text2D: { text: "← → eller A D: gå · Mellemrum: hop\nSaml alle mønterne!", size: 8, color: { r: 1, g: 1, b: 1, a: 0.9 } },
  });
  const coinSpots: [number, number][] = [[5.5, 3.5], [8, 0.5], [18.5, 5.5], [25, 3.5], [30, 6.5], [-4, 0.5]];
  for (const [cx, cy] of coinSpots) {
    add(newSceneId(), {
      ...coinComponents,
      Transform2D: { position: { x: cx * 16, y: cy * 16 }, rotation: 0, scale: { x: 1, y: 1 } },
      PrefabInstance: { prefab: prefabs.coin },
    });
  }
  // UI: score panel top-left, restart button bottom-right
  add(ids.canvas, { Name: { value: "UI" }, Transform2D: {}, UICanvas: { scaleMode: "fit", referenceSize: { x: 960, y: 540 } } });
  add(ids.panel, {
    Name: { value: "ScorePanel" },
    Transform2D: {},
    Parent: { entity: ids.canvas },
    UIRect: { anchorMin: { x: 0, y: 1 }, anchorMax: { x: 0, y: 1 }, pivot: { x: 0, y: 1 }, position: { x: 16, y: -16 }, size: { x: 240, y: 56 } },
    UIImage: { sprite: { texture: guids.panel, id: "panel" }, color: { r: 1, g: 1, b: 1, a: 1 } },
  });
  add(newSceneId(), {
    Name: { value: "Score" },
    Transform2D: {},
    Parent: { entity: ids.panel },
    UIRect: { anchorMin: { x: 0, y: 0 }, anchorMax: { x: 1, y: 1 }, size: { x: 0, y: 0 } },
    UIText: { text: "Mønter: 0", size: 24, color: { r: 1, g: 0.92, b: 0.5, a: 1 }, bold: true },
  });
  add(ids.button, {
    Name: { value: "RestartButton" },
    Transform2D: {},
    Parent: { entity: ids.canvas },
    UIRect: { anchorMin: { x: 1, y: 0 }, anchorMax: { x: 1, y: 0 }, pivot: { x: 1, y: 0 }, position: { x: -16, y: 16 }, size: { x: 190, y: 52 } },
    UIImage: { sprite: { texture: guids.panel, id: "panel" } },
    UIButton: { normal: { r: 0.75, g: 0.85, b: 1, a: 1 }, hover: { r: 1, g: 1, b: 1, a: 1 }, pressed: { r: 0.55, g: 0.6, b: 0.75, a: 1 } },
    Scripts: { list: [{ script: "scripts/RestartButton.ts#RestartButton", props: {} }] },
  });
  add(newSceneId(), {
    Name: { value: "Label" },
    Transform2D: {},
    Parent: { entity: ids.button },
    UIRect: { anchorMin: { x: 0, y: 0 }, anchorMax: { x: 1, y: 1 }, size: { x: 0, y: 0 } },
    UIText: { text: "Til start", size: 22 },
  });
  files["scenes/main.scene.json"] = json({ version: 1, entities });
  return files;
}

// ------------------------------------------------------------------ scripts

const PLAYER_TS = `import { Behaviour, CharacterController2D, Sprite, Transform2D, UIText, expose, findByTag, hasTag } from "brik";

/** A platformer hero: walk, jump, collect coins. */
export class Player extends Behaviour {
  @expose speed = 90;
  @expose jumpSpeed = 270;
  @expose gravity = 760;

  vy = 0;
  coins = 0;
  total = 0;
  start = { x: 0, y: 0 };

  onStart() {
    this.start = { x: this.transform.position.x, y: this.transform.position.y };
    this.total = findByTag(this.world, "coin").length;
    this.updateScore();
  }

  onUpdate(dt: number) {
    const ground = this.get(CharacterController2D).grounded;
    const dir = this.input.axis("horizontal");

    if (ground) this.vy = Math.max(this.vy, -30); // stay glued to slopes and edges
    if (ground && this.input.action("jump").pressed) {
      this.vy = this.jumpSpeed;
      this.playSound("jump", { volume: 0.5 });
    }
    this.vy -= this.gravity * dt;
    const moved = this.moveCharacter(dir * this.speed * dt, this.vy * dt);
    if (this.vy > 0 && moved.y < this.vy * dt * 0.5) this.vy = 0; // bumped our head

    const sprite = this.get(Sprite);
    if (dir !== 0) sprite.flipX = dir < 0;
    if (!ground) this.playAnimation("hero_jump");
    else if (dir !== 0) this.playAnimation("hero_run");
    else this.playAnimation("hero_idle");

    if (this.transform.position.y < -120) this.respawn(); // fell into the pit
  }

  respawn() {
    this.transform.position.x = this.start.x;
    this.transform.position.y = this.start.y;
    this.vy = 0;
  }

  onTriggerEnter(other: number) {
    if (!hasTag(this.world, other, "coin")) return;
    const T = this.world.store(Transform2D);
    this.spawnPrefab("Sparkle", { position: { x: T.position.x[other], y: T.position.y[other] } });
    this.playSound("coin", { volume: 0.6 });
    this.destroy(other);
    this.coins++;
    this.updateScore();
  }

  onAnimationEvent(name: string) {
    if (name === "footstep") this.playSound("step", { volume: 0.3 });
  }

  updateScore() {
    const label = this.find("Score");
    if (label < 0) return;
    const done = this.coins === this.total && this.total > 0;
    this.world.store(UIText).text[label] = done ? "Alle mønter! 🎉" : \`Mønter: \${this.coins} / \${this.total}\`;
  }
}
`;

const RESTART_TS = `import { Behaviour } from "brik";
import { Player } from "./Player";

/** Sends the player back to the start when the UI button is clicked. */
export class RestartButton extends Behaviour {
  onClick() {
    const player = this.find("Player");
    if (player >= 0) this.behaviourOf(Player, player)?.respawn();
  }
}
`;

// ------------------------------------------------------------------ helpers

export const json = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;

export function gridMeta(guid: string, cell: number, names: string[]): string {
  return json({
    guid,
    importer: "texture",
    settings: { filter: "nearest", wrap: "clamp", pixelsPerUnit: 1 },
    slicing: { mode: "grid", cell: [cell, cell], offset: [0, 0], spacing: [0, 0], pivot: [0.5, 0.5] },
    sprites: names.map((name, i) => ({ id: `cell_${i}`, name, rect: [i * cell, 0, cell, cell], pivot: [0.5, 0.5] })),
  });
}

export type Px = (c: string, x: number, y: number, w?: number, h?: number) => void;

export async function png(w: number, h: number, draw: (px: Px) => void): Promise<Uint8Array> {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  draw((c, x, y, pw = 1, ph = 1) => {
    ctx.fillStyle = c;
    ctx.fillRect(x, y, pw, ph);
  });
  const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("toBlob failed"))), "image/png"));
  return new Uint8Array(await blob.arrayBuffer());
}

function speckle(px: Px, ox: number, color: string, seed: number, n: number, y0 = 0): void {
  let s = seed;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) % 16;
  for (let k = 0; k < n; k++) px(color, ox + rnd(), y0 + (rnd() % (16 - y0)), 1, 1);
}

function drawTiles(px: Px): void {
  // grass on dirt
  px("#8a5a34", 0, 0, 16, 16);
  speckle(px, 0, "#6e4426", 2, 10, 5);
  px("#3fa34d", 0, 0, 16, 5);
  px("#6ad36b", 0, 0, 16, 2);
  for (const x of [1, 5, 9, 13]) px("#3fa34d", x, 5, 2, 1);
  // dirt
  px("#8a5a34", 16, 0, 16, 16);
  speckle(px, 16, "#6e4426", 5, 14);
  speckle(px, 16, "#a87046", 9, 6);
  // stone
  px("#6b6f7a", 32, 0, 16, 16);
  px("#585c66", 32, 7, 16, 1);
  px("#585c66", 39, 0, 1, 7);
  px("#585c66", 35, 8, 1, 8);
  px("#585c66", 44, 8, 1, 8);
  px("#868a96", 32, 0, 16, 1);
  // brick platform
  px("#b5532f", 48, 0, 16, 16);
  px("#7d3420", 48, 7, 16, 1);
  px("#7d3420", 48, 15, 16, 1);
  px("#7d3420", 55, 0, 1, 7);
  px("#7d3420", 51, 8, 1, 7);
  px("#7d3420", 60, 8, 1, 7);
  px("#d97a52", 48, 0, 16, 1);
}

function drawHero(px: Px): void {
  // 6 frames: idle, run 0-3, jump. Feet on the bottom row.
  const legs = [
    [5, 9, 0, 0],
    [4, 10, 0, 1],
    [5, 9, 1, 0],
    [6, 8, 0, 1],
    [5, 9, 1, 0],
    [4, 10, 2, 2],
  ];
  for (let f = 0; f < 6; f++) {
    const ox = f * 16;
    const bob = f === 2 || f === 4 ? 1 : 0;
    const top = 2 + bob - (f === 5 ? 1 : 0);
    // body
    px("#1d2b53", ox + 4, top + 5, 8, 7);
    px("#29adff", ox + 5, top + 6, 6, 5);
    // head
    px("#1d2b53", ox + 4, top, 8, 6);
    px("#ffccaa", ox + 5, top + 1, 6, 4);
    px("#7e2553", ox + 4, top - 1, 8, 2); // hair
    px("#000000", ox + 9, top + 2, 1, 2); // eye (facing right)
    // arms
    px("#ffccaa", ox + 3, top + 7 + (f % 2), 1, 2);
    px("#ffccaa", ox + 12, top + 7 + ((f + 1) % 2), 1, 2);
    // legs
    const [l, r, liftL, liftR] = legs[f];
    px("#1d2b53", ox + l, 13 - liftL, 2, 3 - (f === 5 ? 1 : 0));
    px("#1d2b53", ox + r, 13 - liftR, 2, 3 - (f === 5 ? 1 : 0));
  }
}

function drawCoin(px: Px): void {
  [10, 7, 4, 2].forEach((w, f) => {
    const x = f * 16 + 8 - w / 2;
    px("#c27a00", x, 3, w, 10);
    if (w > 2) px("#ffd23f", x + 1, 4, w - 2, 8);
    if (w > 4) px("#fff3a0", x + 2, 5, 1, 4);
  });
}

function drawPanel(px: Px): void {
  px("#0f1a33", 1, 0, 22, 24);
  px("#0f1a33", 0, 1, 24, 22);
  px("#e8eefc", 2, 1, 20, 22);
  px("#e8eefc", 1, 2, 22, 20);
  px("#22345e", 3, 3, 18, 18);
  px("#2b4278", 3, 3, 18, 2);
}

// ------------------------------------------------------------------ sound

const RATE = 22050;

export function tone(freqs: number[], durations: number[], wave: "square" | "sine", volume: number): Float32Array {
  const total = durations.reduce((a, b) => a + b, 0);
  const out = new Float32Array(Math.round(total * RATE));
  let i = 0;
  let phase = 0;
  freqs.forEach((f, k) => {
    const n = Math.round(durations[k] * RATE);
    for (let j = 0; j < n && i < out.length; j++, i++) {
      phase += f / RATE;
      const s = wave === "square" ? (phase % 1 < 0.5 ? 1 : -1) : Math.sin(phase * Math.PI * 2);
      const env = Math.min(1, j / 40) * (k === freqs.length - 1 ? 1 - j / n : 1);
      out[i] = s * env * volume;
    }
  });
  return out;
}

export function sweep(f0: number, f1: number, dur: number, volume: number): Float32Array {
  const n = Math.round(dur * RATE);
  const out = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    phase += (f0 + (f1 - f0) * t) / RATE;
    out[i] = (phase % 1 < 0.5 ? 1 : -1) * volume * (1 - t) * Math.min(1, i / 40);
  }
  return out;
}

export function noise(dur: number, volume: number): Float32Array {
  const n = Math.round(dur * RATE);
  const out = new Float32Array(n);
  let s = 7;
  for (let i = 0; i < n; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    out[i] = ((s / 0x7fffffff) * 2 - 1) * volume * (1 - i / n);
  }
  return out;
}

/** 16-bit mono PCM WAV. */
export function wav(samples: Float32Array): Uint8Array {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + samples.length * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, RATE, true);
  v.setUint32(28, RATE * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, samples.length * 2, true);
  samples.forEach((s, i) => v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, s)) * 0x7fff, true));
  return new Uint8Array(buf);
}
