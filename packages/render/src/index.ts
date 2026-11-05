import { AssetsPlugin } from "@brik/assets";
import type { App } from "@brik/core";
import { Renderer, type RendererOptions } from "./renderer";
import { SpriteLogicPlugin } from "./systems";

export * from "./components";
export * from "./renderer";
export * from "./systems";
export * from "./particles";
export * from "./ui";
export { TextCache, layoutLines, type TextImage, type TextStyle } from "./text";
export { SpriteBatcher, packColor } from "./sprite-batcher";

export interface RenderPluginOptions extends RendererOptions {
  canvas: HTMLCanvasElement;
}

export function RenderPlugin(options: RenderPluginOptions) {
  return {
    name: "brik:render",
    build(app: App) {
      app.addPlugin(AssetsPlugin);
      app.addPlugin(SpriteLogicPlugin);
      const renderer = app.world.insertResource(new Renderer(options.canvas, options));
      app.addSystem("render", { name: "render.draw", run: (w) => renderer.render(w) });
    },
  };
}
