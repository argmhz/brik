import { Behaviour, UIImage, UIText, expose } from "brik";
import { Game } from "./Game";

/** Shows lives, coins and the level name, plus a message box for "Game over" and "Du vandt!". */
export class Hud extends Behaviour {
  @expose level = "Bane 1";

  onStart() {
    this.setText("Message", "");
    this.show("MessageBox", false);
    this.refresh();
  }

  refresh() {
    this.setText("Score", `Mønter: ${Game.coins}`);
    this.setText("LevelName", this.level);
    for (let i = 1; i <= 3; i++) {
      const heart = this.find(`Heart${i}`);
      if (heart >= 0) this.world.store(UIImage).sprite[heart] = { ...this.world.store(UIImage).sprite[heart], id: i <= Game.lives ? "heart" : "heart_empty" };
    }
  }

  message(title: string, detail: string) {
    this.show("MessageBox", true);
    this.setText("Message", detail ? `${title}\n${detail}` : title);
  }

  setText(name: string, text: string) {
    const e = this.find(name);
    if (e >= 0) this.world.write(e, UIText, { text });
  }

  show(name: string, on: boolean) {
    const e = this.find(name);
    if (e >= 0) this.setActive(on, e);
  }
}
