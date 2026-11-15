import { Behaviour } from "brik";

/** A crystal that bobs until the hero picks it up. */
export class Crystal extends Behaviour {
  t = 0;
  baseY = 0;

  override onStart() {
    this.baseY = this.transform.position.y;
  }

  override onUpdate(dt: number) {
    this.t += dt;
    this.transform.position.y = this.baseY + Math.sin(this.t * 4) * 2;
  }
}
