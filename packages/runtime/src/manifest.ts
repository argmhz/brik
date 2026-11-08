import type { TileCollision } from "@brik/assets";
import type { AnimationClip } from "@brik/assets";
import { type SceneData, defineComponent } from "@brik/core";
import type { PhysicsOptions } from "@brik/physics";

/** Entities with this component (and their children) are left out of exported games. */
export const EditorOnly = defineComponent("EditorOnly", {});

type Box = [number, number, number, number];

/** `game.json`: everything an exported game needs, except images, sounds and the script bundle. */
export interface GameManifest {
  format: "brik-game";
  version: 1;
  title: string;
  startScene: string;
  physics?: PhysicsOptions;
  /**
   * True when a scene or prefab has physics components: the player then loads
   * Rapier (brik-physics.js) before the game starts. Otherwise it loads only
   * if the game adds physics at runtime.
   */
  usesPhysics?: boolean;
  /** Atlas pages (or standalone images), relative to game.json. */
  pages: { file: string; filter: "nearest" | "linear"; wrap: "clamp" | "repeat" }[];
  /** Each project texture, as a region of a page. Sprite rects are in page pixels. */
  textures: {
    guid: string;
    name: string;
    page: number;
    region: Box;
    pixelsPerUnit: number;
    sprites: { id: string; name: string; rect: Box; pivot: [number, number]; border?: Box; collision?: TileCollision }[];
  }[];
  clips: AnimationClip[];
  prefabs: { guid: string; name: string; entities: SceneData["entities"] }[];
  sounds: { guid: string; name: string; file: string }[];
  scenes: Record<string, SceneData>;
  /** The compiled scripts (ES module), relative to game.json, or null if the game has none. */
  scripts: string | null;
}
