export * from "./math";
export * from "./ecs";
export * from "./app/app";
export * from "./app/time";
export * from "./transform/components";
export * from "./transform/propagate";
export * from "./scene/scene";
export * from "./gameplay/easing";
export * from "./gameplay/gameplay";

import type { App } from "./app/app";
import { propagateTransforms } from "./transform/propagate";

/** Time, transforms and hierarchy. Included in DefaultPlugins. */
export const CorePlugin = {
  name: "brik:core",
  build(app: App) {
    app.addSystem("postUpdate", propagateTransforms);
  },
};
