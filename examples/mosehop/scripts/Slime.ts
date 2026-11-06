import { Behaviour, Sprite, expose } from "brik";

/** Hops back and forth between start and start + distance. Stomp it from above! */
export class Slime extends Behaviour {
  @expose speed = 24;
  @expose distance = 48;

  startX = 0;
  dir = 1;
  dead = false;

  onStart() {
    this.startX = this.transform.position.x;
    this.playAnimation("slime_walk");
  }

  onUpdate(dt: number) {
    if (this.dead) return;
    const p = this.transform.position;
    p.x += this.dir * this.speed * dt;
    const lo = Math.min(this.startX, this.startX + this.distance);
    const hi = Math.max(this.startX, this.startX + this.distance);
    if (p.x > hi) { p.x = hi; this.dir = -1; }
    if (p.x < lo) { p.x = lo; this.dir = 1; }
    this.get(Sprite).flipX = this.dir < 0;
  }

  /** Squashed by the player. */
  squash() {
    if (this.dead) return;
    this.dead = true;
    this.transform.scale.y = 0.4;
    this.transform.position.y -= 5;
    this.after(0.3, () => this.destroy());
  }
}
