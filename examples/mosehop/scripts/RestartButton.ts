import { Behaviour, expose } from "brik";
import { Game } from "./Game";

/** Starts the game over from the first level. */
export class RestartButton extends Behaviour {
  @expose firstScene = "main";

  onClick() {
    Game.reset();
    this.loadScene(this.firstScene);
  }
}
