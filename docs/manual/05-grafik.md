# Grafik

## Importér billeder

Importér PNG-filer med knappen eller ved at trække dem ind i asset-panelet.

## Sprite-editoren

Sprite-editoren åbnes, når du dobbeltklikker et billede. Her kan du:

- opdele billedet i et grid, finde sprites automatisk eller tegne dem selv. Grid starter med én celle pr. figur i billedet, og under "Antal" kan du skrive kolonner og rækker i stedet for cellestørrelse. Til animationer er grid bedst, fordi alle frames så er lige store,
- sætte pivot,
- sætte 9-slice-kanter, som bruges til UI-paneler og knapper og til sprites med `drawMode: sliced`, der strækkes til en `size` uden at hjørnerne forvrænges (fx platforme og skilte).

## Animationer

Vælg et opdelt billede og tryk **Lav animation**. Dobbeltklik `.anim.json` for at åbne tidslinjen. Der kan du trække frames rundt, ændre varighed ved at trække i kanten, bruge onion skin og sætte events på frames. Et event kommer til `onAnimationEvent(name)` i scriptet på samme entity.

Fra et script: `this.playAnimation("hero_run")`.

## Fra andre værktøjer

- **Aseprite og TexturePacker:** Importér `.png` og `.json` sammen. Du får sprites, og Aseprite-tags bliver til animationer.
- **Tiled:** Se [Tilemaps](tilemaps.md#fra-tiled).

## Kamera

Kameraet bestemmer, hvad Spil-fanen viser. Lad det følge spilleren med `CameraFollow2D`. Slå `useBounds` til og sæt `bounds` til banens kanter, så holder kameraet hele udsnittet inden for banen, uanset hvor stort vinduet er.

## Partikler, tekst og former

| Komponent | Bruges til |
|---|---|
| `ParticleEmitter2D` | Partikler. De kan spille i verdens- eller lokale koordinater (`space`). Fra et script: `this.emitParticles(20)`. |
| `Text2D` | Tekst i verden |
| `Shape2D` | Udfyldte og optegnede former. Gode til prototyper og fejlsøgning |
| `SpriteAnimator` | Afspiller en animation |

Alle felter står i [Komponentreferencen](komponenter.md).

## Tegnerækkefølge

`SortingOrder` bestemmer, hvad der tegnes øverst: lave `layer` først, og inden for et lag lave `order` først. Med `ySort` sorteres efter y-position, så figurer længere nede foran dem længere oppe (top-down-spil).
