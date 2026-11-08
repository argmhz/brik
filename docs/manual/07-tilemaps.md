# Tilemaps

1. Opret "Tilemap" i hierarkiet.
2. Vælg et grid-opdelt billede som tileset.
3. Vælg en tile i inspectoren, og mal i scene view.

Genveje: **B** pensel, **X** viskelæder, **G** fyld, **U** rektangel og **I** pipette. Shift+klik sletter, og Esc stopper malingen. Brug flere tilemaps som lag.

## Auto-tiling (terræner)

Under paletten kan du lave et terræn med "+ Nyt". Mal med terrænet, så vælger hver celle selv sit tile ud fra naboerne, fx græs øverst, jord under og kanter i siderne.

- Har tilesettet en 3×3-blok med hjørner, kanter og midte, så tryk **Fra 3×3-blok…** og klik på blokkens øverste venstre tile.
- Ellers laver du reglerne selv: hver regel har et tile og et 3×3-mønster, hvor hver nabo er ✓ (samme terræn), ✕ (ikke samme) eller · (ligegyldigt).

Reglerne prøves oppefra, og den første, der passer, vinder.

## Kollision

`TileMapCollider` gør tiles faste. Som udgangspunkt er hver tile en hel blok, men hver sprite i tilesettet kan have sin egen kollisionsform. Vælg den i sprite-editoren under **Kollision**:

| Form | Bruges til |
|---|---|
| Hel blok | Gulv, vægge og kasser (standard) |
| Ingen (pynt) | Græs, vinduer, skilte: tegnes, men intet støder mod dem |
| Envejs | Platforme man hopper op igennem nedefra og lander oven på. Kun figurer med `CharacterController2D` går igennem dem. Løse ting som kasser ser dem som faste |
| Halv | Den nederste halvdel af cellen er fast, fx en lav mur |
| Skråning op mod højre / ned mod højre | Ramper. En hel tile er 45°, og det kan en figur gå op ad med standard-`slopeLimit` |

Ændrer du formen, bygges tilemappets collidere om med det samme, også mens spillet kører. Gennem MCP sættes den med `edit_sprites` (`collision`), og `read_tiles` viser, hvilke tiles der ikke er hele blokke.

Envejsplatforme virker kun på tilemaps, der ikke er roteret. For at hoppe ned igennem en envejsplatform kalder figurens script `this.dropThrough()`, fx når spilleren trykker pil ned og hop:

```ts
if (ground && this.input.axis("vertical") < 0 && this.input.action("jump").pressed) this.dropThrough();
```

Se [Fysik](fysik.md).

## Fra Tiled

Importér kortet (`.tmj` eller `.tmx`), tilesettet (`.tsj` eller `.tsx`) og billedet sammen. Kortet bliver til en prefab med ét tilemap pr. lag.

## Kameraet

Lad kameraet følge spilleren med `CameraFollow2D`, og slå `useBounds` til, så det holder sig inden for banen. Se [Grafik](grafik.md#kamera).
