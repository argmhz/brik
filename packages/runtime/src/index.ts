export * from "@brik/core";
export * from "@brik/assets";
export * from "@brik/input";
export * from "@brik/render";
export * from "@brik/physics";
export * from "@brik/audio";
export * from "./behaviour";
export * from "./prefab";
export * from "./scenes";
export * from "./manifest";
export * from "./save";

import { AssetsPlugin } from "@brik/assets";
import { AudioPlugin } from "@brik/audio";
import { App, type AppOptions, CorePlugin, GameplayPlugin } from "@brik/core";
import { InputPlugin } from "@brik/input";
import { PhysicsPlugin, type PhysicsOptions } from "@brik/physics";
import { RenderPlugin, type RendererOptions, SpriteLogicPlugin, UIPlugin, UIWidgetsPlugin } from "@brik/render";
import { PrefabPlugin } from "./prefab";
import { SaveData, saveKey } from "./save";

export interface GameOptions extends AppOptions, RendererOptions {
  canvas: HTMLCanvasElement;
  physics?: PhysicsOptions;
  /** The game's name, so its saved data (`this.save`) is kept apart from other games'. */
  name?: string;
}

/**
 * Everything a game needs except drawing: core, assets, input, gameplay helpers,
 * animation, physics, audio and prefabs. The editor's play mode uses this.
 */
export function GamePlugins(options: { input?: HTMLElement; physics?: PhysicsOptions; name?: string } = {}) {
  return (app: App) => {
    if (!app.world.hasResource(SaveData)) app.world.insertResource(new SaveData(saveKey(options.name ?? "game")));
    app
      .addPlugin(CorePlugin)
      .addPlugin(AssetsPlugin)
      .addPlugin(InputPlugin({ element: options.input }))
      .addPlugin(GameplayPlugin)
      .addPlugin(SpriteLogicPlugin)
      .addPlugin(UIPlugin)
      .addPlugin(UIWidgetsPlugin)
      .addPlugin(PhysicsPlugin(options.physics))
      .addPlugin(AudioPlugin)
      .addPlugin(PrefabPlugin);
  };
}

/** GamePlugins plus rendering, wired to one canvas. */
export function DefaultPlugins(options: GameOptions) {
  return (app: App) => {
    app.addPlugin(GamePlugins({ input: options.canvas, physics: options.physics, name: options.name })).addPlugin(RenderPlugin(options));
  };
}

/** Creates an app with the default plugins. Call `.start()` to run it. */
export function createGame(options: GameOptions): App {
  return new App(options).addPlugin(DefaultPlugins(options));
}
