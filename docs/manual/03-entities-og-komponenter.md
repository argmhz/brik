# Entities og komponenter

Et spil i Brik er bygget af **entities** (ting i scenen) og **komponenter** (data på tingene). En entity er kun et id; det er komponenterne, der giver den udseende og opførsel.

## Entities

Hierarkiet viser entities som et træ. Tegner du en entity under en anden, følger den med sin forælder: flyttes, drejes eller skaleres forælderen, følger børnene med. Hvis du slukker en forælder, slukkes børnene også.

## Komponenter

Vælg en entity og brug **Tilføj komponent** i inspectoren. Fx:

- `Transform2D` giver position, rotation og skala.
- `Sprite` tegner et billede.
- `Collider2D` gør den fast.
- `Behaviour` (dit script) giver den opførsel.

Nogle komponenter kræver andre og tilføjer dem selv. Alle komponenter og deres felter står i [Komponentreferencen](komponenter.md).

## Navne og tags

`Name` navngiver en entity, så scripts kan finde den med `this.find("Navn")`. `Tags` giver den en liste af tags.

## Systemer

Scripts kan selv definere komponenter (`defineComponent`) og systemer (`system("navn", fn, "update")`). Et system kan nøjes med at behandle det, der har ændret sig:

```ts
export const follow = system("follow", (world) => {
  // queries huskes af world, så det er billigt at spørge hver frame
  for (const e of world.query([Transform2D]).changed(Transform2D)) {
    // kun entities, der er flyttet siden sidst
  }
});
```

Se også [Scripts](scripts.md).
