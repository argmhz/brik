// Packs atlas rects off the main thread, so big projects don't freeze the editor.
import { type PackItem, type PackOptions, packRects } from "@brik/assets/atlas";

self.onmessage = (ev: MessageEvent<{ id: number; items: PackItem[]; options: PackOptions }>) => {
  const { id, items, options } = ev.data;
  (self as unknown as Worker).postMessage({ id, result: packRects(items, options) });
};
