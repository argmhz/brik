import { Behaviour, type Contact, type Entity, Sprite, SpriteAnimator, UIText, componentView, expose } from "brik";
import { Bag } from "./Bag";
import { Crystal } from "./Crystal";
import { Shroom, shrooms } from "./Shroom";

/** The forest guard: walks in four directions, swings a sword with Space, collects crystals. */
export class Player extends Behaviour {
  @expose speed = 90;
  @expose hp = 5;
  @expose({ type: "entity" }) hpText: Entity = -1;
  facing = { x: 0, y: -1 };
  knock = { x: 0, y: 0 };
  hurt = 0;
  cooldown = 0;
  /** Number of sword hits that landed (read by tests). */
  hits = 0;

  override onStart() {
    this.showHp();
  }

  override onUpdate(dt: number) {
    this.cooldown -= dt;
    if (this.hurt > 0) {
      this.hurt -= dt;
      this.get(Sprite).color = { r: 1, g: 1, b: 1, a: this.hurt > 0 && Math.floor(this.hurt * 12) % 2 === 0 ? 0.3 : 1 };
    }
    if (this.input.action("jump").pressed && this.cooldown <= 0) this.swing();
  }

  override onFixedUpdate(dt: number) {
    let x = this.input.axis("horizontal");
    let y = this.input.axis("vertical");
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    const moving = len > 0.1;
    if (moving) {
      this.facing = Math.abs(x) >= Math.abs(y) ? { x: Math.sign(x), y: 0 } : { x: 0, y: Math.sign(y) };
      if (x !== 0) this.get(Sprite).flipX = x < 0;
    }
    this.get(SpriteAnimator).playing = moving;
    this.moveCharacter((x * this.speed + this.knock.x) * dt, (y * this.speed + this.knock.y) * dt);
    this.knock.x *= 0.82;
    this.knock.y *= 0.82;
  }

  private swing() {
    this.cooldown = 0.3;
    const p = this.transform.position;
    const at = { x: p.x + this.facing.x * 14, y: p.y + 6 + this.facing.y * 14 };
    for (const s of [...shrooms]) {
      const q = s.transform.position;
      if (Math.hypot(q.x - at.x, q.y + 4 - at.y) < 16) {
        this.hits++;
        s.hit(this.facing.x, this.facing.y);
        this.hitStop(0.04);
      }
    }
  }

  override onTriggerEnter(other: Entity, contact: Contact) {
    if (this.behaviourOf(Crystal, other)) {
      // changed in place: the bag's HUD system notices through query.changed
      this.get(Bag).crystals.push(`krystal-${other}`);
      this.destroy(other);
      return;
    }
    if (this.behaviourOf(Shroom, other) && this.hurt <= 0) {
      this.hp--;
      this.hurt = 1;
      // pushed away from the side the shroom came from
      this.knock = { x: contact.normal.x * 260, y: contact.normal.y * 260 };
      this.shakeCamera(4, 0.2);
      this.showHp();
      if (this.hp <= 0) this.loadScene("main", { fade: 0.4 });
    }
  }

  private showHp() {
    if (this.hpText < 0) return;
    componentView(this.world, UIText, this.hpText).text = `Liv: ${"♥".repeat(Math.max(0, this.hp))}`;
  }
}
