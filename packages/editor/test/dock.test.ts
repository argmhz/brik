import { describe, expect, it } from "vitest";
import { defaultLayout, isShown, layout, movePanel, normalizeLayout, resetLayout, showPanel, zoneOf } from "../src/ui/dock-state";

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
});
