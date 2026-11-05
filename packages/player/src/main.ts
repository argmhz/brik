import { startGame } from "./index";

// The exported index.html has <canvas id="game"> and a loading screen.
const canvas = document.getElementById("game") as HTMLCanvasElement;
const bar = document.getElementById("bar");
const loading = document.getElementById("loading");

startGame({
  canvas,
  onProgress: (p) => {
    if (bar) bar.style.width = `${Math.round(p * 100)}%`;
  },
}).then(
  () => {
    loading?.remove();
    canvas.focus();
  },
  (err) => {
    console.error(err);
    if (loading) loading.textContent = `Spillet kunne ikke starte: ${err instanceof Error ? err.message : String(err)}`;
  },
);
