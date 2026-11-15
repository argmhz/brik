import { describe, expect, it } from "vitest";
import { TILE_CHUNK, TileMap, type TileGrid, Transform2D, World, decodeTiles, encodeTiles, instantiate, serializeEntities, tileChunks, valuesForFile } from "../src/index";

describe("tileChunks", () => {
  it("groups tiles in chunks, also for negative cells", () => {
    const tiles = { "0,0": "a", "15,15": "b", "16,0": "c", "-1,-1": "d", "-16,0": "e", "-17,0": "f" };
    const chunks = tileChunks(tiles, 0);
    expect(TILE_CHUNK).toBe(16);
    expect(chunks.get("0,0")!.keys.sort()).toEqual(["0,0", "15,15"]);
    expect(chunks.get("1,0")!.keys).toEqual(["16,0"]);
    expect(chunks.get("-1,-1")!.keys).toEqual(["-1,-1"]);
    expect(chunks.get("-1,0")!.keys).toEqual(["-16,0"]);
    expect(chunks.get("-2,0")!.keys).toEqual(["-17,0"]);
  });

  it("is cached until the revision changes", () => {
    const tiles: Record<string, string> = { "0,0": "a" };
    const first = tileChunks(tiles, 1);
    expect(tileChunks(tiles, 1)).toBe(first);
    tiles["1,0"] = "b";
    const second = tileChunks(tiles, 2);
    expect(second).not.toBe(first);
    expect(second.get("0,0")!.content).not.toBe(first.get("0,0")!.content);
  });
});

describe("tiles in files", () => {
  it("are saved as rows of characters and read back unchanged", () => {
    const tiles: Record<string, string> = {};
    for (let x = -3; x < 5; x++) tiles[`${x},0`] = "grass";
    tiles["0,2"] = "rock";
    tiles["4,1"] = "door";
    const saved = encodeTiles(tiles) as TileGrid;
    expect(saved.$grid).toEqual({
      x: -3,
      y: 2,
      legend: { d: "door", g: "grass", r: "rock" },
      rows: ["...r", ".......d", "gggggggg"],
    });
    expect(decodeTiles(JSON.parse(JSON.stringify(saved)))).toEqual(tiles);
  });

  it("keeps sparse maps as keys, and reads old files", () => {
    const sparse = { "0,0": "a", "500,300": "b" };
    expect(encodeTiles(sparse)).toEqual(sparse);
    expect(decodeTiles(sparse)).toEqual(sparse);
    expect(encodeTiles({})).toEqual({});
  });

  it("go through the TileMap component when a scene is loaded and saved", () => {
    const world = new World();
    const tiles = { "0,0": "grass", "1,0": "grass", "1,1": "rock" };
    const e = world.spawn([Transform2D], [TileMap, { tiles }]);
    const data = serializeEntities(world, [e]);
    expect(data[0].components.TileMap.tiles).toEqual(tiles); // in memory: keys
    const file = valuesForFile(data);
    expect((file[0].components.TileMap.tiles as TileGrid).$grid.rows).toEqual([".r", "gg"]);
    expect(data[0].components.TileMap.tiles).toEqual(tiles); // not changed by valuesForFile
    const again = new World();
    const [loaded] = instantiate(again, file);
    expect(again.store(TileMap).tiles[loaded]).toEqual(tiles);
  });
});
