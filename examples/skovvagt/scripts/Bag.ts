import { Name, UIText, defineComponent, system, t } from "brik";

/** What the hero carries. `crystals` is changed in place (push), which query.changed must notice. */
export const Bag = defineComponent("Bag", {
  crystals: t.ref<string[]>(() => []),
  /** How many crystals there are in the level. */
  goal: t.i32(6),
});

/** Writes the bag's count into the UI text named "KrystalTekst", only when the bag changed. */
export const bagHud = system("bagHud", (world) => {
  const bags = world.query([Bag]).changed(Bag);
  for (const e of bags) {
    const B = world.store(Bag);
    const n = B.crystals[e].length;
    const goal = B.goal[e];
    const names = world.store(Name).value;
    for (const label of world.query([Name, UIText])) {
      if (names[label] !== "KrystalTekst") continue;
      world.store(UIText).text[label] = n >= goal ? "Skoven er sikker!" : `Krystaller: ${n}/${goal}`;
      world.markChanged(label, UIText);
    }
  }
});
