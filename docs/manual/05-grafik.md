# Grafik

## Importér billeder

Importér PNG-filer med knappen eller ved at trække dem ind i asset-panelet.

## Sprite-editoren

Sprite-editoren åbnes, når du dobbeltklikker et billede.

![Sprite-editoren med et billede delt i et grid på seks sprites](../images/sprite-editor.png)

Her kan du:

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

### Parallax: lag i baggrunden

`Parallax2D` får en entity og dens børn til at følge kameraet med kun en del af farten, så baggrunden får dybde: fjerne bjerge langsomt, nærmere huse hurtigere. `factor` er den andel af kameraets bevægelse, laget *ikke* flytter sig med: 1 er en almindelig entity, 0 står fast på skærmen (et bagtæppe), 0,5 flytter sig med halv fart. Der er en værdi for x og en for y. Husene i en gade har typisk `(0.65, 1)`: de glider i x, men står stadig på jorden.

1. Lav en tom entity som lag, og sæt `Parallax2D` på den.
2. Læg lagets sprites som børn under den, og giv dem en lav `layer` i `SortingOrder`, så de tegnes bag banen.
3. Lagets egen position er, hvor det ligger, mens kameraet står i (0, 0). Lav laget bredt nok til hele banen: et lag med `factor` 0,5 flytter sig kun halvdelen af kameraets vej, så det behøver kun at dække halvdelen af banens bredde plus skærmen.

**I editoren:** så længe knappen **Parallax** i Scene-fanens værktøjslinje er slået til, viser Scene-fanen lagene, som spillets kamera vil se dem, når det står midt i det udsnit, du kigger på. Placér en baggrundsbygning bag kassen i Scene-fanen, så står den bag kassen, når kameraet kommer dertil i spillet. Når du panorerer, glider lagene, ligesom de gør i spillet, og du kan vælge og trække ting dér, hvor du ser dem. Det er kun visningen, der ændres: tallene i inspectoren er stadig lagets position, når kameraet står i (0, 0). Zoomer du langt ud, passer lagene kun midt i billedet. Slå knappen fra for at se alt stå stille. Knappen vises kun, når scenen har et parallax-lag.

Laget følger kameraet i samme frame, så der er ingen rystelser. Kameraet er det, der tegnes først, med mindre feltet `camera` peger på et andet. Kun entities øverst i hierarkiet kan være lag.

### Skærmryst, zoom-stød og hit-stop

Fire kald fra et script giver spillet vægt. De ændrer kun, hvad der tegnes: kameraets entity flyttes ikke, så `CameraFollow2D` og grænserne virker som før, og UI'et ryster ikke.

| Kald | Virkning |
|---|---|
| `this.shakeCamera(8, 0.3)` | Ryster skærmen højst 8 pixel og aftager over 0,3 sekunder. Flere ryst lægges sammen |
| `this.punchCamera(0.08, 0.2)` | Zoomer hurtigt 8 % ind og glider tilbage. Et negativt tal zoomer ud |
| `this.hitStop(0.06)` | Fryser spillet i 0,06 sekunder, fx når et slag rammer. Animation, fysik og scripts står stille |
| `this.slowMotion(0.3, 1)` | Kører spillet med 30 % hastighed i 1 sekund og vender så tilbage |

Tiderne er rigtige sekunder, så et hit-stop varer lige længe, også i slowmotion. Et ryst ser ens ud hver gang, så et spil kan afspilles ens igen. Uden for scripts: `world.resource(CameraFX)` har de samme metoder plus `stop()`.

```ts
onCollisionEnter(other: number) {
  this.shakeCamera(6, 0.25);
  this.hitStop(0.05);
}
```

Til at lægge en farve over hele skærmen, fx et rødt blink ved skade, er der `world.resource(ScreenFade)` med `r`, `g`, `b` og `alpha` (0 tegner ingenting). Den ligger ovenpå alt, også UI.

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

## Lys og mørke

`Lighting2D` på kameraet gør verden mørk, og `Light2D` er lyskilder (punktlys og kegler med farve). Alt kameraet tegner ganges med lyset. UI'et påvirkes ikke. Se [Lys og mørke](../guide/lyssaetning.md) for en gennemgang.

| Komponent | Bruges til |
|---|---|
| `Lighting2D` | Sættes på kameraet. `ambient` er lyset overalt: sort er helt mørkt, hvidt er ingen mørkelægning |
| `Light2D` | En lyskilde med `color`, `intensity`, `radius`, `softness`, og som `spot` en keglevinkel. Peger langs entity'ens rotation |

Lys har endnu ingen skygger og ingen normal maps. Alle felter står i [Komponentreferencen](komponenter.md).
