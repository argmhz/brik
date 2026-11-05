import { type SceneEntityData, newGuid, newSceneId } from "@brik/runtime";
import { type Px, gridMeta, json, noise, png, sweep, tone, wav } from "./platformer-template";

/**
 * Files for the "Top-down shooter" example: a walled arena (tilemap), a hero
 * that walks with WASD and shoots toward the mouse, enemies from spawners,
 * score and health in the UI, and a restart by reloading the scene.
 */
export async function shooterFiles(): Promise<Record<string, Uint8Array | string>> {
  const g = { tiles: newGuid(), chars: newGuid(), bullet: newGuid() };
  const clip = { slime: newGuid() };
  const prefab = { enemy: newGuid(), bullet: newGuid(), splat: newGuid() };
  const sound = { shoot: newGuid(), hit: newGuid(), hurt: newGuid() };
  const files: Record<string, Uint8Array | string> = {};

  // ------------------------------------------------------------------ art & sound
  files["assets/arena.png"] = await png(32, 16, drawTiles);
  files["assets/arena.png.meta.json"] = gridMeta(g.tiles, 16, ["floor", "wall"]);
  files["assets/chars.png"] = await png(48, 16, drawChars);
  files["assets/chars.png.meta.json"] = gridMeta(g.chars, 16, ["hero", "slime_0", "slime_1"]);
  files["assets/bullet.png"] = await png(6, 6, (px) => {
    px("#fff3a0", 1, 0, 4, 6);
    px("#fff3a0", 0, 1, 6, 4);
    px("#ffffff", 2, 2, 2, 2);
  });
  files["assets/bullet.png.meta.json"] = json({ guid: g.bullet, importer: "texture", settings: { filter: "nearest", wrap: "clamp", pixelsPerUnit: 1 }, slicing: { mode: "single" }, sprites: [] });
  files["assets/shoot.wav"] = wav(sweep(900, 300, 0.08, 0.18));
  files["assets/shoot.wav.meta.json"] = json({ guid: sound.shoot, importer: "audio" });
  files["assets/hit.wav"] = wav(noise(0.09, 0.3));
  files["assets/hit.wav.meta.json"] = json({ guid: sound.hit, importer: "audio" });
  files["assets/hurt.wav"] = wav(tone([220, 140], [0.08, 0.16], "square", 0.25));
  files["assets/hurt.wav.meta.json"] = json({ guid: sound.hurt, importer: "audio" });
  files["assets/slime.anim.json"] = json({
    guid: clip.slime,
    importer: "animation",
    mode: "loop",
    frames: [1, 2].map((i) => ({ sprite: [g.chars, `cell_${i}`], duration: 0.25 })),
    events: [],
  });

  // ------------------------------------------------------------------ prefabs
  const one = (guid: string, name: string, components: SceneEntityData["components"]) =>
    json({ guid, importer: "prefab", entities: [{ id: newSceneId(), components: { Name: { value: name }, Transform2D: { position: { x: 0, y: 0 } }, ...components } }] });
  files["prefabs/Enemy.prefab.json"] = one(prefab.enemy, "Enemy", {
    Sprite: { sprite: { texture: g.chars, id: "cell_1" } },
    SpriteAnimator: { clip: clip.slime },
    SortingOrder: { layer: 1, order: 0, ySort: true },
    RigidBody2D: { type: "dynamic", gravityScale: 0, fixedRotation: true, linearDamping: 4 },
    Velocity2D: {},
    Collider2D: { shape: "circle", size: { x: 12, y: 12 } },
    Tags: { list: ["enemy"] },
    Scripts: { list: [{ script: "scripts/Enemy.ts#Enemy", props: {} }] },
  });
  files["prefabs/Bullet.prefab.json"] = one(prefab.bullet, "Bullet", {
    Sprite: { sprite: { texture: g.bullet, id: "" } },
    SortingOrder: { layer: 2, order: 0, ySort: false },
    RigidBody2D: { type: "dynamic", gravityScale: 0, ccd: true },
    Velocity2D: {},
    Collider2D: { shape: "circle", size: { x: 6, y: 6 }, isTrigger: true },
    Lifetime: { seconds: 1.5 },
    Scripts: { list: [{ script: "scripts/Bullet.ts#Bullet", props: {} }] },
  });
  files["prefabs/Splat.prefab.json"] = one(prefab.splat, "Splat", {
    SortingOrder: { layer: 0, order: 5, ySort: false },
    ParticleEmitter2D: {
      rate: 0,
      burst: 14,
      lifetime: { x: 0.2, y: 0.45 },
      speed: { x: 40, y: 110 },
      spread: Math.PI * 2,
      gravity: { x: 0, y: 0 },
      damping: 3,
      startSize: 5,
      endSize: 1,
      startColor: { r: 0.45, g: 0.95, b: 0.45, a: 1 },
      endColor: { r: 0.1, g: 0.5, b: 0.2, a: 0 },
      autoDestroy: true,
    },
  });

  files["scripts/Shooter.ts"] = SHOOTER_TS;
  files["scripts/Enemy.ts"] = ENEMY_TS;
  files["scripts/Bullet.ts"] = BULLET_TS;

  // ------------------------------------------------------------------ scene
  const W = 30;
  const H = 18;
  const floor: Record<string, string> = {};
  const walls: Record<string, string> = {};
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) {
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) walls[`${x},${y}`] = "cell_1";
      else floor[`${x},${y}`] = "cell_0";
    }
  }
  // a few pillars to hide behind
  for (const [x, y] of [[8, 5], [8, 6], [21, 11], [21, 12], [14, 13], [15, 13], [14, 4], [15, 4]]) walls[`${x},${y}`] = "cell_1";

  const ox = (-W * 16) / 2;
  const oy = (-H * 16) / 2;
  const ids = { player: newSceneId(), canvas: newSceneId() };
  const entities: SceneEntityData[] = [];
  const add = (components: SceneEntityData["components"], id = newSceneId()) => entities.push({ id, components });
  add({
    Name: { value: "Main Camera" },
    Transform2D: { position: { x: 0, y: 0 } },
    Camera2D: { zoom: 2, clearColor: { r: 0.06, g: 0.06, b: 0.08, a: 1 } },
    AudioListener: {},
  });
  add({ Name: { value: "Floor" }, Transform2D: { position: { x: ox, y: oy } }, TileMap: { tileset: g.tiles, tileSize: { x: 16, y: 16 }, tiles: floor }, SortingOrder: { layer: -1, order: 0, ySort: false } });
  add({ Name: { value: "Walls" }, Transform2D: { position: { x: ox, y: oy } }, TileMap: { tileset: g.tiles, tileSize: { x: 16, y: 16 }, tiles: walls }, TileMapCollider: {}, SortingOrder: { layer: 0, order: 0, ySort: false } });
  add(
    {
      Name: { value: "Player" },
      Transform2D: { position: { x: 0, y: 0 } },
      Sprite: { sprite: { texture: g.chars, id: "cell_0" } },
      SortingOrder: { layer: 1, order: 0, ySort: true },
      RigidBody2D: { type: "kinematic" },
      CharacterController2D: { snapToGround: 0 },
      Collider2D: { size: { x: 10, y: 12 } },
      Scripts: { list: [{ script: "scripts/Shooter.ts#Shooter", props: {} }] },
    },
    ids.player,
  );
  for (const [sx, sy] of [[-200, 110], [200, 110], [-200, -110], [200, -110]]) {
    add({ Name: { value: "Spawner" }, Transform2D: { position: { x: sx, y: sy } }, Spawner: { prefab: prefab.enemy, interval: 2.5, maxAlive: 3, spawnOnStart: false } });
  }
  add({ Name: { value: "UI" }, Transform2D: {}, UICanvas: { scaleMode: "fit", referenceSize: { x: 960, y: 540 } } }, ids.canvas);
  const label = (name: string, text: string, anchor: number, align: string) =>
    add({
      Name: { value: name },
      Transform2D: {},
      Parent: { entity: ids.canvas },
      UIRect: { anchorMin: { x: anchor, y: 1 }, anchorMax: { x: anchor, y: 1 }, pivot: { x: anchor, y: 1 }, position: { x: anchor === 0 ? 20 : -20, y: -14 }, size: { x: 260, y: 40 } },
      UIText: { text, size: 26, align, bold: true, color: { r: 1, g: 1, b: 1, a: 1 } },
    });
  label("Score", "Point: 0", 0, "left");
  label("Health", "♥ ♥ ♥", 1, "right");
  add({
    Name: { value: "Help" },
    Transform2D: {},
    Parent: { entity: ids.canvas },
    UIRect: { anchorMin: { x: 0.5, y: 0 }, anchorMax: { x: 0.5, y: 0 }, pivot: { x: 0.5, y: 0 }, position: { x: 0, y: 10 }, size: { x: 600, y: 30 } },
    UIText: { text: "WASD: gå · mus: sigt · venstreklik: skyd", size: 16, color: { r: 1, g: 1, b: 1, a: 0.6 } },
  });
  files["scenes/main.scene.json"] = json({ version: 1, entities });
  return files;
}

const SHOOTER_TS = `import { Behaviour, Sprite, UIText, Velocity2D, expose, hasTag } from "brik";

/** The hero: WASD to walk, aim with the mouse, hold the left button to shoot. */
export class Shooter extends Behaviour {
  @expose speed = 110;
  @expose bulletSpeed = 340;
  @expose fireRate = 8; // shots per second
  @expose health = 3;

  score = 0;
  cooldown = 0;
  invulnerable = 0;
  /** Enemies touching us right now (enter adds, exit removes). */
  touching = new Set<number>();

  onStart() {
    this.updateUI();
  }

  onUpdate(dt: number) {
    const dx = this.input.axis("horizontal");
    const dy = this.input.axis("vertical");
    const len = Math.hypot(dx, dy) || 1;
    this.moveCharacter((dx / len) * this.speed * dt, (dy / len) * this.speed * dt);

    const p = this.transform.position;
    const aim = this.pointerWorld();
    const ax = aim.x - p.x;
    const ay = aim.y - p.y;
    const sprite = this.get(Sprite);
    sprite.flipX = ax < 0;

    this.cooldown -= dt;
    if (this.input.key("Mouse0").down && this.cooldown <= 0) {
      this.cooldown = 1 / this.fireRate;
      const d = Math.hypot(ax, ay) || 1;
      this.fire(ax / d, ay / d);
    }

    // enemies hurt as long as they touch us, once per invulnerability period
    this.invulnerable -= dt;
    for (const e of this.touching) if (!this.world.isAlive(e)) this.touching.delete(e);
    if (this.touching.size > 0 && this.invulnerable <= 0) this.hurt();

    // blink while invulnerable
    sprite.color.a = this.invulnerable > 0 && Math.floor(this.invulnerable * 12) % 2 === 0 ? 0.3 : 1;
  }

  fire(dx: number, dy: number) {
    const p = this.transform.position;
    const bullet = this.spawnPrefab("Bullet", { position: { x: p.x + dx * 10, y: p.y + dy * 10 } });
    this.world.write(bullet, Velocity2D, { linear: { x: dx * this.bulletSpeed, y: dy * this.bulletSpeed } });
    this.playSound("shoot", { volume: 0.35 });
  }

  onCollisionEnter(other: number) {
    if (hasTag(this.world, other, "enemy")) this.touching.add(other);
  }

  onCollisionExit(other: number) {
    this.touching.delete(other);
  }

  hurt() {
    this.health--;
    this.invulnerable = 1.2;
    this.playSound("hurt", { volume: 0.5 });
    this.updateUI();
    if (this.health <= 0) this.loadScene("main"); // start over
  }

  addScore(n: number) {
    this.score += n;
    this.updateUI();
  }

  updateUI() {
    const score = this.find("Score");
    const hearts = this.find("Health");
    if (score >= 0) this.world.store(UIText).text[score] = \`Point: \${this.score}\`;
    if (hearts >= 0) this.world.store(UIText).text[hearts] = "♥ ".repeat(Math.max(0, this.health)).trim() || "💀";
  }
}
`;

const ENEMY_TS = `import { Behaviour, Sprite, Transform2D, Velocity2D, expose } from "brik";

/** Slimes walk straight toward the player. */
export class Enemy extends Behaviour {
  @expose speed = 45;
  player = -1;

  onUpdate() {
    if (this.player < 0 || !this.world.isAlive(this.player)) this.player = this.find("Player");
    if (this.player < 0) return;
    const me = this.transform.position;
    const target = this.world.read(this.player, Transform2D).position;
    const dx = target.x - me.x;
    const dy = target.y - me.y;
    const d = Math.hypot(dx, dy) || 1;
    const v = this.get(Velocity2D);
    v.linear.x = (dx / d) * this.speed;
    v.linear.y = (dy / d) * this.speed;
    this.get(Sprite).flipX = dx < 0;
  }
}
`;

const BULLET_TS = `import { Behaviour, TileMap, Transform2D, hasTag } from "brik";
import { Shooter } from "./Shooter";

/** Hits an enemy (both disappear) or stops at a wall. */
export class Bullet extends Behaviour {
  onTriggerEnter(other: number) {
    if (hasTag(this.world, other, "enemy")) {
      const T = this.world.store(Transform2D);
      this.spawnPrefab("Splat", { position: { x: T.position.x[other], y: T.position.y[other] } });
      this.playSound("hit", { volume: 0.4 });
      this.destroy(other);
      this.destroy();
      const player = this.find("Player");
      if (player >= 0) this.behaviourOf(Shooter, player)?.addScore(1);
    } else if (this.world.has(other, TileMap)) {
      this.destroy();
    }
  }
}
`;

function drawTiles(px: Px): void {
  px("#2a2d3a", 0, 0, 16, 16);
  px("#313546", 0, 0, 8, 8);
  px("#313546", 8, 8, 8, 8);
  px("#242733", 0, 15, 16, 1);
  px("#242733", 15, 0, 1, 16);
  // wall
  px("#59607a", 16, 0, 16, 16);
  px("#6f7795", 16, 0, 16, 3);
  px("#3d4256", 16, 13, 16, 3);
  px("#4b5168", 23, 3, 1, 10);
}

function drawChars(px: Px): void {
  // hero: top-down, cape and helmet
  px("#1d2b53", 4, 3, 8, 11);
  px("#ff004d", 4, 8, 8, 6);
  px("#c2c3c7", 5, 2, 6, 6);
  px("#29adff", 6, 4, 4, 2);
  px("#ffccaa", 3, 9, 1, 3);
  px("#ffccaa", 12, 9, 1, 3);
  px("#ffec27", 12, 7, 3, 1); // gun
  // slime, two frames
  for (const [f, squash] of [[1, 0], [2, 1]] as const) {
    const ox = f * 16;
    px("#1e6b2e", ox + 2 - squash, 6 + squash, 12 + squash * 2, 8 - squash);
    px("#47c25a", ox + 3 - squash, 7 + squash, 10 + squash * 2, 6 - squash);
    px("#9ff0a8", ox + 4, 8 + squash, 3, 2);
    px("#000000", ox + 6, 10, 1, 2);
    px("#000000", ox + 10, 10, 1, 2);
  }
}
