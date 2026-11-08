import { Behaviour, expose, ensureSceneId, Name, Transform2D, Sprite, Shape2D, Text2D, SortingOrder, Camera2D, UILayout } from "brik";

type Body = { e: number; x: number; y: number; w: number; h: number; dead?: boolean; row?: number; hp?: number; vy?: number };
const cyan = { r: .25, g: .95, b: 1, a: 1 };
const pink = { r: 1, g: .3, b: .55, a: 1 };

export class Invaders extends Behaviour {
  @expose texture = "";
  @expose score = 0;
  @expose lives = 3;
  @expose wave = 1;
  @expose kills = 0;
  @expose shotsFired = 0;
  @expose gameOver = false;
  enemies: Body[] = [];
  shots: Body[] = [];
  bunkers: Body[] = [];
  sparks: Body[] = [];
  player!: Body;
  direction = 1;
  shotTimer = 0;
  enemyTimer = 1;
  invincible = 0;
  waveTimer = 0;
  elapsed = 0;
  hud = -1;
  message = -1;
  camera = -1;
  paused = false;

  body(name: string, x: number, y: number, w: number, h: number, sprite?: string, color = cyan): Body {
    const e = this.world.spawn([Name, { value: name }], [Transform2D, { position: { x, y } }], [SortingOrder, { layer: 1 }]);
    ensureSceneId(this.world, e);
    if (sprite) this.world.add(e, Sprite, { sprite: { texture: this.texture, id: sprite }, color });
    else this.world.add(e, Shape2D, { size: { x: w, y: h }, fill: color });
    return { e, x, y, w, h };
  }
  label(name: string, text: string, x: number, y: number, size: number, color = cyan) {
    return this.world.spawn([Name, { value: name }], [Transform2D, { position: { x, y } }],
      [Text2D, { text, size, color, font: "monospace", bold: true }], [SortingOrder, { layer: 5 }]);
  }
  move(b: Body) { this.world.write(b.e, Transform2D, { position: { x: b.x, y: b.y } }); }
  retire(b: Body) { if (!b.dead) { b.dead = true; this.setActive(false, b.e); this.destroy(b.e); } }
  hit(a: Body, b: Body) { return Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.y - b.y) < (a.h + b.h) / 2; }
  say(text: string) { this.world.write(this.message, Text2D, { text }); }
  burst(x: number, y: number) {
    for (let i = 0; i < 7; i++) {
      const b = this.body("Spark", x + (i - 3) * 3, y, 3, 3, undefined, i % 2 ? pink : cyan);
      b.vy = 30 + i * 12; b.hp = .32; this.sparks.push(b);
    }
  }
  onStart() {
    this.camera = this.find("Main Camera");
    const preview = this.find("Preview"); if (preview >= 0) this.setActive(false, preview);
    for (let i = 0; i < 65; i++) this.body("Star", ((i * 137) % 640) - 320, ((i * 89) % 460) - 220, i % 4 ? 1 : 2, 2, undefined,
      { r: .15 + (i % 3) * .12, g: .25, b: .45, a: 1 });
    this.label("Title", "S P A C E   I N V A D E R S", 0, 255, 22);
    this.hud = this.label("HUD", "", 0, 220, 15);
    this.message = this.label("Message", "", 0, 0, 21);
    this.label("Controls", "A/D eller ←/→  ·  MELLEMRUM skyd  ·  P pause", 0, -250, 12);
    this.body("Baseline", 0, -225, 640, 1);
    this.player = this.body("Player", 0, -200, 28, 20, "ship");
    this.reset();
  }
  reset() {
    for (const b of [...this.enemies, ...this.shots, ...this.bunkers, ...this.sparks]) this.retire(b);
    this.enemies = []; this.shots = []; this.bunkers = []; this.sparks = [];
    this.score = 0; this.kills = 0; this.shotsFired = 0; this.lives = 3; this.wave = 1;
    this.gameOver = false; this.paused = false; this.invincible = 1; this.shotTimer = 0; this.waveTimer = 0;
    this.player.x = 0; this.setActive(true, this.player.e); this.move(this.player);
    for (const cx of [-210, -70, 70, 210]) for (let y = 0; y < 3; y++) for (let x = 0; x < 7; x++) {
      if (y === 0 && x >= 2 && x <= 4) continue;
      if (y === 2 && (x === 0 || x === 6)) continue;
      const b = this.body("Bunker", cx + (x - 3) * 8, -143 + y * 8, 8, 8); b.hp = 2; this.bunkers.push(b);
    }
    this.startWave();
  }
  startWave() {
    this.direction = 1; this.enemyTimer = .8; this.waveTimer = 0; this.say("");
    for (let row = 0; row < 4; row++) for (let col = 0; col < 9; col++) {
      const b = this.body("Invader", (col - 4) * 48, 60 + row * 34, 26, 22, row > 1 ? "alienA" : "alienB",
        row > 1 ? pink : { r: .65, g: 1, b: .3, a: 1 });
      b.row = row; this.enemies.push(b);
    }
  }
  finish() { this.gameOver = true; this.say("GAME OVER\n\nENTER: prøv igen"); }
  onUpdate(dt: number) {
    const layout = this.world.tryResource(UILayout);
    if (layout?.screenW && layout.screenH) this.world.write(this.camera, Camera2D, { zoom: Math.min(layout.screenW / 680, layout.screenH / 560) });
    if (this.gameOver) { if (this.input.key("Enter").pressed) this.reset(); return; }
    if (this.input.key("KeyP").pressed) { this.paused = !this.paused; this.say(this.paused ? "PAUSE\nP: fortsæt" : ""); }
    if (this.paused) return;
    this.elapsed += dt; this.invincible -= dt; this.shotTimer -= dt;
    this.setActive(this.invincible <= 0 || Math.floor(this.elapsed * 16) % 2 === 0, this.player.e);
    this.player.x = Math.max(-300, Math.min(300, this.player.x + this.input.axis("horizontal") * 270 * dt)); this.move(this.player);
    if ((this.input.key("Space").down || this.input.key("Mouse0").down) && this.shotTimer <= 0) {
      const b = this.body("Player shot", this.player.x, -182, 4, 16); b.vy = 530; this.shots.push(b);
      this.shotTimer = .18; this.shotsFired++;
    }
    const speed = 20 + this.wave * 9 + (36 - this.enemies.length) * 1.6;
    if (this.enemies.some(b => b.x + this.direction * speed * dt > 300 || b.x + this.direction * speed * dt < -300)) {
      this.direction *= -1; for (const b of this.enemies) b.y -= 18;
    }
    for (const b of this.enemies) {
      b.x += this.direction * speed * dt; this.move(b);
      if (b.y < -178) this.finish();
      for (const block of this.bunkers) if (!block.dead && this.hit(b, block)) this.retire(block);
    }
    this.enemyTimer -= dt;
    if (this.enemies.length && this.enemyTimer <= 0) {
      const shooters = this.enemies.filter(b => !this.enemies.some(other => Math.abs(other.x - b.x) < 8 && other.y < b.y));
      const source = shooters[Math.floor(Math.random() * shooters.length)];
      const b = this.body("Enemy shot", source.x, source.y - 15, 5, 14, undefined, pink);
      b.vy = -(150 + this.wave * 22); this.shots.push(b); this.enemyTimer = Math.max(.2, .85 - this.wave * .06);
    }
    for (const shot of this.shots) {
      if (shot.dead) continue;
      // Small substeps prevent fast shots from jumping through bunker blocks.
      const steps = Math.max(1, Math.ceil(Math.abs(shot.vy! * dt) / 4));
      for (let i = 0; i < steps && !shot.dead; i++) {
        shot.y += shot.vy! * dt / steps;
        for (const block of this.bunkers) if (!block.dead && this.hit(shot, block)) {
          this.retire(shot); if (--block.hp! <= 0) this.retire(block); break;
        }
        if (shot.dead) break;
        if (shot.vy! > 0) {
          const enemy = this.enemies.find(b => !b.dead && this.hit(shot, b));
          if (enemy) { this.retire(enemy); this.retire(shot); this.score += 10 + enemy.row! * 10; this.kills++; this.burst(enemy.x, enemy.y); }
        } else if (this.invincible <= 0 && this.hit(shot, this.player)) {
          this.retire(shot); this.lives--; this.invincible = 1.6; this.burst(this.player.x, this.player.y);
          if (this.lives <= 0) this.finish();
        }
      }
      if (!shot.dead) { if (Math.abs(shot.y) > 205) this.retire(shot); else this.move(shot); }
    }
    for (const b of this.sparks) { b.hp! -= dt; if (b.hp! <= 0) this.retire(b); else { b.y += b.vy! * dt; this.move(b); } }
    this.enemies = this.enemies.filter(b => !b.dead); this.shots = this.shots.filter(b => !b.dead);
    this.bunkers = this.bunkers.filter(b => !b.dead); this.sparks = this.sparks.filter(b => !b.dead);
    if (!this.enemies.length && !this.gameOver) {
      this.waveTimer += dt; this.say(`BØLGE ${this.wave} KLARET`);
      if (this.waveTimer > 1.8) { for (const s of this.shots) this.retire(s); this.shots = []; this.wave++; this.startWave(); }
    }
    this.world.write(this.hud, Text2D, { text: `POINT ${String(this.score).padStart(5, "0")}    LIV ${this.lives}    BØLGE ${this.wave}` });
  }
}
