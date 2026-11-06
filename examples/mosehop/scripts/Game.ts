/** State that lives across scenes: lives and coins carry over from level to level. */
export const Game = {
  lives: 3,
  coins: 0,
  reset() {
    this.lives = 3;
    this.coins = 0;
  },
};
