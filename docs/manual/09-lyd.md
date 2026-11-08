# Lyd

Importér `.wav`, `.mp3`, `.ogg` eller `.m4a` ved at trække filen ind i asset-panelet.

## Fra et script

```ts
this.playSound("coin");
```

## Lydstyrke og mixer

Al lyd går gennem tre kanaler (busser), `music`, `sfx` og `ui`, og derefter en fælles `master`. Styrkerne går fra 0 til 1 og kan ændres når som helst, fx fra en indstillingsmenu:

```ts
this.audio.volume.music = 0.4; // musikken lavere
this.audio.volume.sfx = 1;
this.audio.volume.master = 0.8; // alt lidt lavere
this.audio.muted = true; // slå al lyd fra
```

Ændringen gælder fra næste billede, også for lyde, der allerede spiller. Hvilken kanal en lyd går i, vælges med `bus` på `AudioSource` eller i `this.playSound("tema", { bus: "music" })`.

En slider i UI'et kan styre det direkte:

```ts
import { Behaviour } from "brik";

// på en entity med UISlider (min 0, max 1)
export class MusicVolume extends Behaviour {
  onValueChanged(value: number | boolean | string) {
    this.audio.volume.music = Number(value);
  }
}
```

## Som komponent

`AudioSource` spiller en lyd fra en entity.

| Felt | Betydning |
|---|---|
| `clip` | Lyden |
| `volume`, `pitch` | Styrke (0–1) og tonehøjde |
| `loop`, `playOnStart` | Gentag, og start når scenen starter |
| `bus` | `music`, `sfx` eller `ui` |
| `spatial`, `range` | Panorér og dæmp lyden efter afstanden til lytteren |

`AudioListener` er "ørerne" til rumlige lyde og sidder som regel på kameraet.

Se også [Komponentreferencen](komponenter.md).
