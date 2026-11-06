/** Ways to grab a picture of the scene and game views, registered by the views themselves. */
export const captures: { scene?: () => string | null; game?: () => string | null } = {};
