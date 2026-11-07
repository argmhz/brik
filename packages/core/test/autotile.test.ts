import { describe, expect, it } from "vitest";
import {
  NEIGHBOUR_ANY as A,
  NEIGHBOUR_OTHER as O,
  NEIGHBOUR_SAME as S,
  type Terrain,
  type TileData,
  autotile,
  changedTiles,
  terrainBrush,
  terrainOf,
} from "../src";

// grass on top (nothing above), dirt below; edges on the left and right of the top row
const ground: Terrain = {
  id: "g",
  name: "Græs",
  rules: [
    { sprite: "dirt", neighbours: [A, A, A, A, A, A, A, A] },
    { sprite: "grass_left", neighbours: [A, O, A, O, A, A, A, A] },
    { sprite: "grass_right", neighbours: [A, O, A, A, O, A, A, A] },
    { sprite: "grass", neighbours: [A, O, A, A, A, A, A, A] },
  ],
};
// rules are tried in order, so the specific ones go first
ground.rules = [ground.rules[1], ground.rules[2], ground.rules[3], ground.rules[0]];

const water: Terrain = { id: "w", name: "Vand", rules: [{ sprite: "water", neighbours: [A, A, A, A, A, A, A, A] }] };

/** Paints a rectangle with a terrain brush and auto-tiles it. */
function paint(tiles: TileData, x0: number, y0: number, x1: number, y1: number, t: Terrain) {
  const before = { ...tiles };
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) tiles[`${x},${y}`] = terrainBrush(t);
  autotile(tiles, [ground, water], changedTiles(before, tiles));
}

const rows = (tiles: TileData, y: number, x0: number, x1: number) =>
  Array.from({ length: x1 - x0 + 1 }, (_, i) => tiles[`${x0 + i},${y}`] ?? ".");

describe("auto-tiling", () => {
  it("picks edges and fill from the neighbours", () => {
    const tiles: TileData = {};
    paint(tiles, 0, 0, 3, 1, ground);
    expect(rows(tiles, 1, 0, 3)).toEqual(["grass_left", "grass", "grass", "grass_right"]);
    expect(rows(tiles, 0, 0, 3)).toEqual(["dirt", "dirt", "dirt", "dirt"]);
  });

  it("updates the neighbours when a cell is removed or added", () => {
    const tiles: TileData = {};
    paint(tiles, 0, 0, 3, 1, ground);
    // dig a hole in the top row: the cell under it gets grass, the sides get edges
    const before = { ...tiles };
    delete tiles["1,1"];
    autotile(tiles, [ground, water], changedTiles(before, tiles));
    // the lone cell on the left has empty on both sides: the first matching rule (left edge) wins
    expect(rows(tiles, 1, 0, 3)).toEqual(["grass_left", ".", "grass_left", "grass_right"]);
    expect(tiles["1,0"]).toBe("grass");
    // build on top: the old top row turns to dirt
    paint(tiles, 2, 2, 3, 2, ground);
    expect(rows(tiles, 2, 2, 3)).toEqual(["grass_left", "grass_right"]);
    expect(rows(tiles, 1, 2, 3)).toEqual(["dirt", "dirt"]);
  });

  it("treats other terrains and plain tiles as not the same", () => {
    const tiles: TileData = { "0,2": "rock" };
    paint(tiles, 0, 1, 0, 1, ground);
    paint(tiles, 1, 2, 1, 2, water);
    // a rock (no terrain) and water above-right don't count as ground
    expect(tiles["0,1"]).toBe("grass_left");
    expect(tiles["0,2"]).toBe("rock");
    expect(tiles["1,2"]).toBe("water");
    expect(terrainOf("grass", [ground, water])).toBe(ground);
    expect(terrainOf("rock", [ground, water])).toBeNull();
  });
});
