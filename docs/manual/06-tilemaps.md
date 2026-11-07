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

`TileMapCollider` gør tiles faste. Se [Fysik](fysik.md).

## Fra Tiled

Importér kortet (`.tmj` eller `.tmx`), tilesettet (`.tsj` eller `.tsx`) og billedet sammen. Kortet bliver til en prefab med ét tilemap pr. lag.

## Kameraet

Lad kameraet følge spilleren med `CameraFollow2D`, og slå `useBounds` til, så det holder sig inden for banen. Se [Grafik](grafik.md#kamera).
