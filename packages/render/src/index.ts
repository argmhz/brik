import { AssetsPlugin } from "@brik/assets";
import type { App } from "@brik/core";
import { Renderer, type RendererOptions } from "./renderer";
import { SpriteLogicPlugin } from "./systems";
import { UILayout } from "./ui";

export * from "./components";
export * from "./renderer";
export * from "./systems";
export * from "./particles";
export * from "./ui";
export * from "./ui-widgets";
export { TextCache, layoutLines, textResolution, type TextImage, type TextStyle } from "./text";
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
      // the screen size is known before the first frame is drawn (CameraFollow2D bounds use it)
      const layout = app.world.tryResource(UILayout) ?? app.world.insertResource(new UILayout());
      layout.screenW = renderer.width;
      layout.screenH = renderer.height;
      app.addSystem("render", { name: "render.draw", run: (w) => renderer.render(w) });
    },
  };
}
