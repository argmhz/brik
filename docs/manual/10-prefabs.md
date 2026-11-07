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

En scene er en fil i `scenes/`. Skift scene fra et script med `this.loadScene("level2")`.
