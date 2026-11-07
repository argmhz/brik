# Tilføj en fjende

Her laver du en fjende, der går frem og tilbage, som en prefab, så du kan sætte flere ud.

## 1. Lav scriptet

Opret et script med navnet `Walker` i asset-panelet (højreklik, **Nyt script**). Det åbner i **Kode**-panelet; erstat indholdet:

```ts
import { Behaviour, Sprite, expose } from "brik";

/** Går frem og tilbage mellem start og start + distance. */
export class Walker extends Behaviour {
  @expose speed = 24;
  @expose distance = 48;

  startX = 0;
  dir = 1;

  onStart() {
    this.startX = this.transform.position.x;
  }

  onUpdate(dt: number) {
    const p = this.transform.position;
    p.x += this.dir * this.speed * dt;
    if (p.x > this.startX + this.distance) this.dir = -1;
    if (p.x < this.startX) this.dir = 1;
    this.get(Sprite).flipX = this.dir < 0;
  }
}
```

Tryk **Ctrl+S**. Fejl vises i Console med fil og linje.

## 2. Sæt det på en entity

1. Opret en entity i hierarkiet, og giv den en `Sprite`.
2. Tryk **Tilføj komponent** og vælg `Walker`.
3. Ret `speed` og `distance` i inspectoren.

## 3. Gør den til en prefab

Højreklik entity'en og vælg **Lav prefab**. Træk prefab'en ind i scenen, så ofte du vil. Ændrer du den ene instans' `distance`, huskes det kun for den instans (feltet står med fed skrift).

## 4. Lad den gøre skade

Giv fjenden en `Collider2D` med `isTrigger`, og lad figurens script reagere:

```ts
onTriggerEnter(other: number) {
  // other er den entity, der blev rørt
}
```

Eksempelspillet `examples/mosehop` viser et helt forløb med tags, point og liv i `scripts/Player.ts`. Se [Fysik](../manual/fysik.md) og [Scripts](../manual/scripts.md#hooks).
