import { Behaviour, CharacterController2D, Sprite, Transform2D, expose, hasTag } from "brik";
import { Game } from "./Game";
import { Hud } from "./Hud";
import { Slime } from "./Slime";

/** The hero: walk, jump, collect coins, stomp slimes, avoid spikes, reach the flag. */
export class Player extends Behaviour {
  @expose speed = 90;
  @expose jumpSpeed = 300;
  @expose gravity = 760;
  /** Scene to load when the flag is reached. Empty: this is the last level. */
  @expose nextScene = "";

  vy = 0;
  start = { x: 0, y: 0 };
  hurtTime = 0;
  frozen = false;
  coyote = 0;
  jumpBuffer = 0;

  onStart() {
    this.start = { x: this.transform.position.x, y: this.transform.position.y };
    this.hud()?.refresh();
  }

  hud() {
    const e = this.find("UI");
    return e >= 0 ? this.behaviourOf(Hud, e) : undefined;
  }

  onUpdate(dt: number) {
    if (this.frozen) return;
    const ground = this.get(CharacterController2D).grounded;
    const dir = this.input.axis("horizontal");

    // a little forgiveness: jump just after leaving a ledge, or just before landing
    this.coyote = ground ? 0.1 : this.coyote - dt;
    this.jumpBuffer = this.input.action("jump").pressed ? 0.12 : this.jumpBuffer - dt;

    if (ground) this.vy = Math.max(this.vy, -30);
    if (this.coyote > 0 && this.jumpBuffer > 0) {
      this.vy = this.jumpSpeed;
      this.coyote = 0;
      this.jumpBuffer = 0;
      this.playSound("jump", { volume: 0.5 });
    }
    // release jump early for a short hop
    if (!this.input.action("jump").down && this.vy > 0) this.vy -= this.gravity * dt;
    this.vy -= this.gravity * dt;
    const moved = this.moveCharacter(dir * this.speed * dt, this.vy * dt);
    if (this.vy > 0 && moved.y < this.vy * dt * 0.5) this.vy = 0;

    const sprite = this.get(Sprite);
    if (dir !== 0) sprite.flipX = dir < 0;
    if (!ground) this.playAnimation("hero_jump");
    else if (dir !== 0) this.playAnimation("hero_run");
    else this.playAnimation("hero_idle");

    // blink while invulnerable
    if (this.hurtTime > 0) {
      this.hurtTime -= dt;
      sprite.color.a = Math.floor(this.hurtTime * 12) % 2 ? 0.3 : 1;
    } else sprite.color.a = 1;

    if (this.transform.position.y < -120) this.hurt(true);
  }

  onTriggerEnter(other: number) {
    if (this.frozen) return;
    const T = this.world.store(Transform2D);
    if (hasTag(this.world, other, "coin")) {
      this.spawnPrefab("Sparkle", { position: { x: T.position.x[other], y: T.position.y[other] } });
      this.playSound("coin", { volume: 0.6 });
      this.destroy(other);
      Game.coins++;
      this.hud()?.refresh();
    } else if (hasTag(this.world, other, "enemy")) {
      const slime = this.behaviourOf(Slime, other);
      if (slime?.dead) return;
      // falling onto it squashes it (the trigger fires a frame late, so be generous)
      if (this.vy < 0 && this.transform.position.y > T.position.y[other] - 2) {
        slime?.squash();
        this.vy = this.jumpSpeed * 0.7;
        this.playSound("jump", { volume: 0.4 });
      } else this.hurt(false);
    } else if (hasTag(this.world, other, "hazard")) {
      this.hurt(false);
    } else if (hasTag(this.world, other, "goal")) {
      this.win();
    }
  }

  hurt(fell: boolean) {
    if (this.hurtTime > 0 && !fell) return;
    Game.lives--;
    this.hud()?.refresh();
    if (Game.lives <= 0) {
      this.frozen = true;
      this.hud()?.message("Game over", "Tryk på knappen for at prøve igen");
      return;
    }
    this.hurtTime = 1.5;
    this.vy = fell ? 0 : this.jumpSpeed * 0.6;
    if (fell) {
      this.transform.position.x = this.start.x;
      this.transform.position.y = this.start.y;
    }
  }

  win() {
    this.frozen = true;
    this.playSound("coin", { volume: 0.8 });
    if (this.nextScene) {
      this.hud()?.message("Bane klaret!", "");
      this.after(1.2, () => this.loadScene(this.nextScene));
    } else {
      this.hud()?.message("Du vandt! 🎉", `Du samlede ${Game.coins} mønter`);
    }
  }

  onAnimationEvent(name: string) {
    if (name === "footstep") this.playSound("step", { volume: 0.3 });
  }
}
