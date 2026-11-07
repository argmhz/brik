# Lyd

Importér `.wav`, `.mp3`, `.ogg` eller `.m4a` ved at trække filen ind i asset-panelet.

## Fra et script

```ts
this.playSound("coin");
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
