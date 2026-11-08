# Prefabs og scener

## Lav en prefab

Højreklik en entity og vælg **Lav prefab**. Træk prefab'en ind i scenen, eller lav den fra et script med `this.spawnPrefab("Navn")`.

## Instanser

- Ret en instans og tryk **Anvend** for at opdatere alle instanser.
- En instans husker, hvilke felter du har ændret på den. De står med fed skrift i inspectoren og bliver ikke overskrevet, når prefab'en ændres. Dobbeltklik på feltets navn for at hente prefab'ens værdi igen. Det gælder også felter på scripts: en instans kan have sit eget `hp`, mens prefab'en stadig bestemmer `speed`.
- **Gendan** kasserer alle en instans' ændringer.
- Prefabs kan indeholde andre prefabs. Ændrer du den inderste, følger de ydre med.

## Spawner

`Spawner`-komponenten opretter prefabs løbende, fx fjender.

## Scener

En scene er en fil i `scenes/`. Skift scene fra et script med `this.loadScene("level2")`. Skiftet sker i begyndelsen af næste frame, når scenen er læst.

### Fade og data mellem scener

```ts
this.loadScene("level2", { fade: 0.4, data: { score: 120 } });
```

- **`fade`** er sekunder pr. retning. Skærmen toner til sort, scenen skiftes, mens den er dækket, og skærmen toner ind igen. Er scenen langsom at læse, bliver skærmen sort, til den er klar. Til en anden farve: `fade: { duration: 0.4, color: { r: 1, g: 1, b: 1 } }`.
- **`data`** følger med til næste scene. Læs den der med `this.sceneData.score`. Værdierne lægges oven i det, der allerede er, og bliver, til du ændrer dem, så point og liv overlever flere baner. `this.sceneData` kan også skrives direkte.

Entities, scripts og felter nulstilles ved et scene-skift. Det eneste, der overlever, er `sceneData`. Derfor skal alt, der skal huskes (point, liv, valgt figur), ligge der.
