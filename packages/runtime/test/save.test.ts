import { describe, expect, it } from "vitest";
import { App, GamePlugins, SaveData, saveKey } from "../src/index";

/** A stand-in for localStorage. */
const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
};

describe("saved game data", () => {
  it("keeps values in storage, so a new game session reads them back", () => {
    const store = memory();
    const a = new SaveData(saveKey("Marz World"), store);
    a.set("level", 3);
    a.set("best", { score: 120, name: "Marz" });
    expect(store.m.get("brik-save:Marz World")).toContain('"level":3');
    const b = new SaveData(saveKey("Marz World"), store); // the game started again
    expect(b.get("level", 1)).toBe(3);
    expect(b.get("best")).toEqual({ score: 120, name: "Marz" });
    expect(b.keys().sort()).toEqual(["best", "level"]);
  });

  it("gives the fallback when nothing is saved, and copies, so changes need set()", () => {
    const s = new SaveData("k", memory());
    expect(s.get("coins", 0)).toBe(0);
    expect(s.has("coins")).toBe(false);
    s.set("inventory", ["key"]);
    const inv = s.get<string[]>("inventory", []);
    inv.push("map");
    expect(s.get("inventory")).toEqual(["key"]);
  });

  it("delete, set undefined and clear forget values", () => {
    const store = memory();
    const s = new SaveData("k", store);
    s.set("a", 1);
    s.set("b", 2);
    s.delete("a");
    s.set("b", undefined);
    expect(s.keys()).toEqual([]);
    s.set("c", 3);
    s.clear();
    expect(s.get("c")).toBeUndefined();
    expect(store.m.has("k")).toBe(false);
  });

  it("works without storage (tests, blocked storage), and reads broken data as empty", () => {
    const none = new SaveData("k", null);
    none.set("x", 1);
    expect(none.get("x")).toBe(1);
    const store = memory();
    store.setItem("k", "{not json");
    expect(new SaveData("k", store).get("x", 5)).toBe(5);
  });

  it("games keep their saves apart by name", () => {
    const app = new App().addPlugin(GamePlugins({ name: "Mosehop" }));
    expect(app.world.resource(SaveData).key).toBe("brik-save:Mosehop");
  });
});
