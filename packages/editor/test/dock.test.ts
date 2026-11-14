import { describe, expect, it } from "vitest";
import {
  defaultLayout,
  dockHome,
  floatPanel,
  isShown,
  layout,
  movePanel,
  normalizeLayout,
  placeFloating,
  resetLayout,
  setSplit,
  showPanel,
  zoneOf,
} from "../src/ui/dock-state";

describe("dock layout", () => {
  it("repairs stored layouts so every panel is in exactly one zone", () => {
    const l = normalizeLayout({
      zones: { left: ["inspector", "inspector", "bogus"], center: ["scene"], bottom: [], right: [] },
      active: { left: "hierarchy", center: "scene" },
    });
    expect(l.zones.left).toEqual(["inspector", "hierarchy"]); // duplicate and unknown dropped, hierarchy back home
    expect(l.zones.center).toEqual(["scene", "game", "code"]);
    expect(l.zones.bottom).toEqual(["assets", "console"]);
    expect(l.zones.right).toEqual([]);
    expect(l.active.left).toBe("hierarchy");
    expect(l.active.right).toBeNull();
    expect(normalizeLayout("nonsense")).toEqual(defaultLayout());
  });

  it("moves panels between zones and keeps a visible tab in each", () => {
    resetLayout();
    movePanel("console", "right");
    expect(zoneOf("console")).toBe("right");
    expect(isShown("console")).toBe(true);
    expect(layout().active.bottom).toBe("assets");
    movePanel("inspector", "left", "hierarchy");
    expect(layout().zones.left).toEqual(["inspector", "hierarchy"]);
    expect(layout().zones.right).toEqual(["console"]);
    showPanel("hierarchy");
    expect(isShown("inspector")).toBe(false);
    movePanel("console", "bottom");
    expect(layout().zones.right).toEqual([]);
    expect(layout().active.right).toBeNull();
    resetLayout();
    expect(layout()).toEqual(defaultLayout());
  });

  it("floats panels in windows and docks them again", () => {
    resetLayout();
    floatPanel("console");
    floatPanel("inspector", { x: 10, y: 20 });
    expect(zoneOf("console")).toBe("float");
    expect(isShown("console")).toBe(true);
    expect(layout().zones.bottom).toEqual(["assets"]);
    expect(layout().zones.right).toEqual([]);
    expect(layout().floating.map((f) => f.panel)).toEqual(["console", "inspector"]);
    showPanel("console"); // to the top
    expect(layout().floating.map((f) => f.panel)).toEqual(["inspector", "console"]);
    placeFloating("console", { w: 300 });
    expect(layout().floating.find((f) => f.panel === "console")?.w).toBe(300);
    // a stored layout keeps the windows; a panel can't be both docked and floating
    const stored = normalizeLayout(JSON.parse(JSON.stringify(layout())));
    expect(stored.floating).toHaveLength(2);
    expect(normalizeLayout({ ...layout(), zones: { ...layout().zones, left: ["hierarchy", "console"] } }).floating.map((f) => f.panel)).toEqual(["inspector"]);
    movePanel("console", "leftLower");
    expect(layout().zones.leftLower).toEqual(["console"]);
    expect(layout().floating.map((f) => f.panel)).toEqual(["inspector"]);
    dockHome("inspector");
    expect(zoneOf("inspector")).toBe("right");
    setSplit("left", 2);
    expect(layout().split.left).toBe(0.85);
    resetLayout();
  });
});
