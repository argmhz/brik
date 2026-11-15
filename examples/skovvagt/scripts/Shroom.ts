import { Behaviour, type Entity, Sprite, Transform2D, UIRect, componentView, expose } from "brik";

/** Every living shroom, so the hero's sword can find them. */
export const shrooms = new Set<Shroom>();

/** A mushroom that wanders, chases the hero when close, and drops a crystal when it dies. */
export class Shroom extends Behaviour {
  @expose speed = 35;
  @expose sight = 140;
  @expose maxHp = 3;
  /** The "Fyld" child of the health bar. */
  @expose({ type: "entity" }) bar: Entity = -1;
  hp = 3;
  wander = { x: 1, y: 0 };
  flash = 0;

  override onStart() {
    this.hp = this.maxHp;
    shrooms.add(this);
    this.every(1.5, () => {
      const a = Math.random() * Math.PI * 2;
      this.wander = { x: Math.cos(a), y: Math.sin(a) };
    });
    this.showHealth();
  }

  override onDestroy() {
    shrooms.delete(this);
  }

  override onFixedUpdate(dt: number) {
    const p = this.transform.position;
    const hero = this.find("Helt");
    let dir = this.wander;
    let speed = this.speed * 0.5;
    if (hero >= 0) {
      const T = this.world.store(Transform2D).position;
      const dx = T.x[hero] - p.x;
      const dy = T.y[hero] - p.y;
      const d = Math.hypot(dx, dy);
      if (d < this.sight && d > 0.01) {
        dir = { x: dx / d, y: dy / d };
        speed = this.speed;
      }
    }
    this.step(dir.x * speed * dt, dir.y * speed * dt, hero);
    if (dir.x !== 0) this.get(Sprite).flipX = dir.x < 0;
    if (this.flash > 0) {
      this.flash -= dt;
      this.get(Sprite).color = this.flash > 0 ? { r: 1, g: 0.5, b: 0.5, a: 1 } : { r: 1, g: 1, b: 1, a: 1 };
    }
  }

  /** Moves unless a wall (not the hero) is in the way. */
  private step(dx: number, dy: number, hero: Entity) {
    const len = Math.hypot(dx, dy);
    if (len === 0) return;
    const p = this.transform.position;
    const hit = this.physics.raycast(p, { x: dx / len, y: dy / len }, len + 7, { exclude: hero, solidOnly: true });
    if (hit) {
      this.wander = { x: -this.wander.x, y: -this.wander.y };
      return;
    }
    p.x += dx;
    p.y += dy;
  }

  /** Hit by the sword, pushed along (dx, dy). */
  hit(dx: number, dy: number) {
    this.hp--;
    this.flash = 0.15;
    this.showHealth();
    const p = this.transform.position;
    this.spawnPrefab("Gnister", { position: { x: p.x, y: p.y + 4 } });
    this.step(dx * 14, dy * 14, this.find("Helt"));
    if (this.hp <= 0) {
      this.spawnPrefab("Krystal", { position: { x: p.x, y: p.y } });
      this.destroy(this.entity);
    }
  }

  private showHealth() {
    if (this.bar < 0) return;
    componentView(this.world, UIRect, this.bar).anchorMax.x = Math.max(0, this.hp / this.maxHp);
  }
}
