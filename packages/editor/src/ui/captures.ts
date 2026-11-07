/** Ways to grab a picture of the scene and game views, registered by the views themselves. */
export const captures: {
  scene?: () => string | null;
  game?: () => string | null;
  /** The Game view's current size in CSS pixels, or null while it is hidden. */
  gameSize?: () => { w: number; h: number } | null;
} = {};
