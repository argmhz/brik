# Kom i gang med Brik

Brik er en 2D game engine til web. Du bygger scener i editoren, skriver
gameplay i TypeScript og eksporterer spillet som en statisk mappe, der kan
lægges på itch.io, GitHub Pages eller en hvilken som helst webserver.

## 1. Start editoren

```bash
make editor        # http://localhost:5180
```

`make` alene viser alle genveje. Uden make: `corepack pnpm install` og
derefter `corepack pnpm editor`.

Vælg et projekt på startskærmen:

- **Mappe på din computer** (Chrome/Edge, eller desktop-appen): projektet er en
  almindelig mappe, så du kan bruge git og VS Code ved siden af.
- **Browser-projekt**: gemmes i browseren. Kan eksporteres og importeres som `.zip`.

Når du opretter et nyt projekt, kan du vælge en skabelon:

| Skabelon | Hvad du får |
|---|---|
| Tomt projekt | Et sprite sheet og et eksempel-script |
| Platformer-eksempel | En tilemap-bane, en figur med animationer og lyd, mønter (prefab), partikler og UI |
| Top-down shooter-eksempel | En arena, skud mod musen, fjender fra spawnere, point, liv og genstart |

Eksemplerne er almindelige projektfiler, så du kan læse og rette alt.

## 2. Editoren

| Område | Brug |
|---|---|
| Hierarki (venstre) | Entities i scenen. "+" eller højreklik opretter. Træk for at ændre forælder. |
| Scene (midten) | Flyt (W), rotér (E), skalér (R). Højreklik-træk panorerer, hjulet zoomer, F fokuserer. |
| Spil | Spillet set gennem kameraet, inklusive UI. Ctrl+P er Play/Stop. |
| Kode | Scripts med autocomplete. Ctrl+S gemmer og genindlæser. |
| Inspector (højre) | Komponenter på den valgte entity, eller indstillinger for det valgte asset |
| Assets (bund) | Projektets filer. Træk billeder, animationer, prefabs og lyde ind i scenen. |

Alt kan fortrydes med Ctrl+Z. Ændringer under Play forsvinder, når du stopper.

Ændringer, der ikke er gemt, lægges løbende i `.brik/recovery.json`. Lukkes
editoren, eller genindlæses siden, før du har gemt, spørger Brik næste gang
projektet åbnes, om ændringerne skal gendannes. Selve scenefilen røres først,
når du gemmer.

Panelerne kan flyttes: træk en fane hen på et andet område, eller højreklik
fanen og vælg "Flyt til …". Fx kan Scene og Spil ligge ved siden af hinanden.
Knappen ⊞ i menulinjen sætter panelerne tilbage, hvor de var fra start.

## 3. Grafik

- **Importér** PNG-filer med knappen eller ved at trække dem ind i asset-panelet.
- **Sprite-editoren** åbnes, når du dobbeltklikker et billede. Her kan du:
  - opdele billedet i et grid, finde sprites automatisk eller tegne dem selv.
    Grid starter med én celle pr. figur i billedet, og under "Antal" kan du
    skrive kolonner og rækker i stedet for cellestørrelse. Til animationer er
    grid bedst, fordi alle frames så er lige store,
  - sætte pivot,
  - sætte 9-slice-kanter, som bruges til UI-paneler og knapper og til sprites
    med `drawMode: sliced`, der strækkes til en `size` uden at hjørnerne
    forvrænges (fx platforme og skilte).
- **Animationer:** Vælg et opdelt billede og tryk "Lav animation". Dobbeltklik
  `.anim.json` for at åbne tidslinjen. Der kan du trække frames rundt, ændre
  varighed ved at trække i kanten, bruge onion skin og sætte events på frames.
- **Fra andre værktøjer:**
  - **Aseprite og TexturePacker:** Importér `.png` og `.json` sammen. Du får
    sprites, og Aseprite-tags bliver til animationer.
  - **Tiled:** Importér `.tmj`, tileset (`.tsj`) og billede sammen. Kortet
    bliver til en prefab med ét tilemap pr. lag.

## 4. Scripts

Scripts er TypeScript-filer i `scripts/`. En `Behaviour` sættes på en entity
via "Tilføj komponent" i inspectoren.

```ts
import { Behaviour, expose, Sprite } from "brik";

export class Player extends Behaviour {
  @expose speed = 120;            // kan rettes i inspectoren

  onStart() {}                    // én gang
  onUpdate(dt: number) {          // hver frame
    const x = this.input.axis("horizontal");
    this.transform.position.x += x * this.speed * dt;
    this.get(Sprite).flipX = x < 0;
  }
}
```

**Hooks**

| Hook | Kaldes når |
|---|---|
| `onStart` | Scriptet starter |
| `onEnable` / `onDisable` | Entity'en tændes eller slukkes med `setActive` (også via en forælder). `onEnable` kommer også lige før `onStart`, og `onDisable` før `onDestroy` |
| `onUpdate(dt)` | Hver frame |
| `onFixedUpdate(dt)` | Ved et fast interval (60 Hz) |
| `onDestroy` | Scriptet eller entity'en fjernes |
| `onCollisionEnter/Exit(other)` | To faste colliders rører hinanden eller slipper |
| `onTriggerEnter/Exit(other)` | Noget går ind i eller ud af en trigger |
| `onAnimationEvent(name)` | Animationen når en frame med et event |
| `onAnimationFinished(clip)` | En animation, der kun spiller én gang, er færdig |
| `onTimer` | Entity'ens `Timer` løber ud |
| `onClick` | Entity'ens `UIButton` klikkes |

**Hjælpere**

| Hjælper | Hvad den gør |
|---|---|
| `this.transform`, `this.get(Komponent)`, `this.add(...)`, `this.has(...)` | Læser og ændrer komponenter |
| `this.input.axis("horizontal")`, `this.input.action("jump").pressed`, `this.input.key("Mouse0").down` | Input |
| `this.pointerWorld()` | Musens position i verden |
| `this.moveCharacter(dx, dy)` | Bevæger en `CharacterController2D` med kollisioner |
| `this.playAnimation("hero_run")`, `this.playSound("coin")` | Animation og lyd |
| `this.spawnPrefab("Coin", { position })`, `this.destroy(e)`, `this.find("Navn")` | Opretter, fjerner og finder entities |
| `this.setActive(false, e)` | Slukker en entity og dens børn (fx en beskedboks): den skjules, dens scripts, timere og tweens holder pause, og dens colliders er ude af fysikken |
| `this.tween(Transform2D, "position.y", 100, 0.5)`, `this.after(1, fn)`, `this.every(0.5, fn)` | Tweens og timere |
| `this.emitParticles(20)` | Udsender partikler |
| `this.loadScene("level2")` | Skifter scene |
| `this.behaviourOf(Andet, e)` | Taler med et andet script |

Et felt kan pege på en anden entity, som du vælger i inspectoren:

```ts
@expose({ type: "entity" }) target: Entity = -1; // -1 hvis intet er valgt
```

Felter af typen `"prefab"`, `"audio"` og `"clip"` får en asset-vælger.

Tilstand, der skal leve på tværs af scener (liv, point), kan ligge i et
almindeligt modul, som scripts importerer:

```ts
// scripts/Game.ts
export const Game = { lives: 3, coins: 0 };
```

Modulerne indlæses forfra, hver gang du trykker Play, ligesom når det
eksporterede spil startes. Giv ikke dine egne metoder samme navn som Behaviours
egne (fx `setActive` eller `find`), for så skygger de for dem.

Fejl i et script vises i Console med fil og linje, både når scriptet
kompileres, og når det kaster en fejl, mens spillet kører. Klik på fejlen for
at hoppe til linjen.

Scripts kan også definere egne komponenter (`defineComponent`) og systemer
(`system("navn", fn, "update")`). Et system kan nøjes med at behandle det, der
har ændret sig:

```ts
export const follow = system("follow", (world) => {
  // queries huskes af world, så det er billigt at spørge hver frame
  for (const e of world.query([Transform2D]).changed(Transform2D)) {
    // kun entities, der er flyttet siden sidst
  }
});
```

## 5. Fysik

- **Faste ting:** Giv en entity `Collider2D`. Uden `RigidBody2D` er den
  statisk, fx et gulv.
- **Ting der falder og skubbes:** Brug `RigidBody2D` (dynamic) sammen med
  `Collider2D`. Hastigheden kan læses og skrives gennem `Velocity2D`.
- **Spilfigurer:** Brug `RigidBody2D` (kinematic), `CharacterController2D` og
  `Collider2D`, og flyt figuren med `this.moveCharacter`.
- **Triggers:** Sæt `isTrigger` på en collider, så den kun melder overlap.
- **Tilemaps:** `TileMapCollider` gør tiles faste.
- **Opslag:** `this.physics.raycast(origin, dir, distance)` og `this.physics.overlapPoint(p)`.

- **Led:** `Joint2D` forbinder en krop med en anden (`connected`) eller med et
  punkt i verden: `hinge` (pendul, dør, hjul), `fixed` (svejst fast), `spring`
  (fjeder), `rope` (reb med en største længde) og `slider` (glider langs en akse).

Tyngdekraft og skala sættes i `brik.project.json` under `physics`.

## 6. Tilemaps

1. Opret "Tilemap" i hierarkiet.
2. Vælg et grid-opdelt billede som tileset.
3. Vælg en tile i inspectoren, og mal i scene view.

**Auto-tiling (terræner):** Under paletten kan du lave et terræn med "+ Nyt".
Mal med terrænet, så vælger hver celle selv sit tile ud fra naboerne, fx græs
øverst, jord under og kanter i siderne. Har tilesettet en 3×3-blok med hjørner,
kanter og midte, så tryk "Fra 3×3-blok…" og klik på blokkens øverste venstre
tile. Ellers laver du reglerne selv: hver regel har et tile og et 3×3-mønster,
hvor hver nabo er ✓ (samme terræn), ✕ (ikke samme) eller · (ligegyldigt).
Reglerne prøves oppefra, og den første, der passer, vinder.

Lad kameraet følge spilleren med `CameraFollow2D`. Slå `useBounds` til og sæt
`bounds` til banens kanter, så holder kameraet hele udsnittet inden for banen,
uanset hvor stort vinduet er.

Genveje: **B** pensel, **X** viskelæder, **G** fyld, **U** rektangel og **I**
pipette. Shift+klik sletter, og Esc stopper malingen. Brug flere tilemaps som
lag.

## 7. UI

Opret "Knap", "Tekst", "Billede", "Slider", "Toggle", "Tekstfelt" eller
"Kolonne" i hierarkiet. Der laves automatisk et **UI Canvas**. Placering sker med `UIRect`:

- Er ankrene ens, har elementet en fast størrelse.
- Er de forskellige, strækkes elementet med skærmen.

En **kolonne** (`UIStack`) stiller sine børn under hinanden (eller ved siden af
hinanden med `direction: horizontal`) i hierarkiets rækkefølge. Børnene beholder
deres størrelse, og `stretch` får dem til at fylde bredden.

UI vises i Spil-fanen og som omrids i scene view. Klik inden for et omrids for
at vælge elementet, og træk for at flytte det (det ændrer `UIRect.position`).

Scripts på samme entity får:

| Element | Hook |
|---|---|
| Knap (`UIButton`) | `onClick()` |
| Slider (`UISlider`) | `onValueChanged(value: number)` |
| Toggle (`UIToggle`) | `onValueChanged(on: boolean)` |
| Tekstfelt (`UITextInput`) | `onValueChanged(text: string)` mens man skriver, og `onSubmit(text)` ved Enter |

Et tekstfelt viser sin tekst gennem sin `UIText`, så skrifttype, størrelse og
farve sættes der.

## 8. Prefabs

Højreklik en entity og vælg **Lav prefab**. Træk prefab'en ind i scenen, eller
lav den fra et script med `this.spawnPrefab("Navn")`.

- Ret en instans og tryk **Anvend** for at opdatere alle instanser.
- En instans husker, hvilke felter du har ændret på den. De står med fed skrift
  i inspectoren og bliver ikke overskrevet, når prefab'en ændres. Dobbeltklik
  på feltets navn for at hente prefab'ens værdi igen.
  Det gælder også felter på scripts: en instans kan have sit eget `hp`, mens
  prefab'en stadig bestemmer `speed`.
- **Gendan** kasserer alle en instans' ændringer.
- Prefabs kan indeholde andre prefabs. Ændrer du den inderste, følger de
  ydre med.
- `Spawner`-komponenten opretter prefabs løbende.

## 9. Byg og udgiv

Tryk **Byg spil** i menulinjen.

- Billeder pakkes i atlasser. Du kan se siderne, hvor fyldte de er, og eventuelle advarsler.
- **Eksportér .zip** giver en fil, der kan uploades direkte på **itch.io**.
  Opret et "HTML"-projekt og vælg "This file will be played in the browser".
- **Eksportér til mappe** skriver filerne, så de kan lægges på GitHub Pages,
  Netlify eller en anden webserver.
- Spillet skal åbnes over http. Det virker ikke, hvis man dobbeltklikker
  `index.html`. Til en hurtig lokal test kan du køre `npx serve` i mappen.

Entities med komponenten `EditorOnly` kommer ikke med i det færdige spil.

## 10. Desktop-appen

`apps/desktop` er editoren som en Tauri-app med adgang til filsystemet. Den
kræver Rust ([rustup.rs](https://rustup.rs)) og Tauris systempakker
([v2.tauri.app/start/prerequisites](https://v2.tauri.app/start/prerequisites/)).

```bash
make desktop           # åbner editoren i et vindue
make desktop-build     # laver installere
```

`corepack pnpm build` laver installere til det system, du bygger på. På Linux
ligger `.deb`-filen bagefter i `src-tauri/target/release/bundle/deb/`. Vil du
kun have den, så kør `make desktop-deb`.

I desktop-appen vælger du projektmappen med en almindelig mappe-dialog, og de
seneste mapper vises på startskærmen. Byg-vinduet gemmer spillet med en
almindelig gem-dialog.

## 11. AI

Brik har en MCP-server (`packages/mcp`), så en AI-klient kan arbejde direkte i
den åbne editor. AI'en kan:
- se scenen, komponenternes felter og projektets assets,
- oprette og ændre entities, komponenter, prefabs og scener,
- skrive scripts (den får kompileringsfejl tilbage med det samme) og sætte dem på,
- importere billeder og lyde fra computeren (`import_asset`), opdele et
  sprite sheet i et grid (`slice_texture`) og omdøbe sprites og sætte pivots
  (`edit_sprites`),
- tegne pixel art (`draw_sprites`: hvert tegn er en pixel, slået op i en
  palet), lave animationer af den og male tilemaps ud fra tekst (`paint_tiles`,
  `read_tiles`),
- trykke Play, gå frem et antal frames med taster holdt nede (fx `ArrowRight`
  og `Space`), med en anden billedrate (`fps`, fx 30 eller 144), flytte musen
  (også til et sted på et UI-element, fx 80 % henad en slider), klikke på
  UI-knapper eller steder i verden (`click`), skrive i og redigere tekstfelter, læse konsollen og tage skærmbilleder af Scene- og
  Spil-visningen.

Eksempelspillet `examples/mosehop` (åbn mappen i editoren) er bygget på
denne måde: grafik, bane, prefabs, scripts og test er lavet gennem
MCP-værktøjerne.

Hver ændring vises med det samme og kan fortrydes med Ctrl+Z. Det, AI'en gør,
står også i Console. Scenen gemmes kun, når AI'en kalder `save_scene`.

**Sådan forbinder du**
1. Åbn projektet i editoren og klik **AI** i menulinjen.
   - Grå prik: AI er slået fra.
   - Gul prik: editoren venter på MCP-serveren.
   - Grøn prik: AI er forbundet.
2. Start MCP-serveren fra din AI-klient:
   - **Claude Code** i dette repo: `.mcp.json` er allerede sat op. Godkend
     serveren "brik", første gang Claude Code spørger.
   - **Andre klienter** (fx Claude Desktop): tilføj en MCP-server med kommandoen
     `node` og argumentet `/sti/til/brik/packages/mcp/src/server.mjs`.

Server og editor finder hinanden på `ws://127.0.0.1:5181`. Porten kan ændres med
miljøvariablen `BRIK_MCP_PORT`, men editoren bruger altid 5181. Kun editoren selv
(localhost eller desktop-appen) må forbinde, ikke andre hjemmesider. Er AI'en
forbundet, men skal ikke længere arbejde, så klik **AI** igen.

Nye projekter får en `CLAUDE.md`, som forklarer projektets filer og Brik-API'et.
Så kan en AI-klient også skrive scripts uden MCP-serveren.

**Uden editoren (headless)**

Kører editoren ikke, kan AI'en selv åbne en projektmappe med `open_project`
(fx `open_project({ path: "examples/mosehop" })`). Projektet åbnes så inde i
MCP-serveren, uden browser. Alle værktøjer virker som i editoren, undtagen
skærmbilleder: AI'en kan bygge scener, skrive scripts, spille og gå frem frame
for frame, og `save_scene` skriver til mappen. `close_project` lukker igen, og
den nægter, hvis der er ændringer, der ikke er gemt. Har du projektet åbent i
editoren samtidig, så luk det først, ellers arbejder I i hver sin kopi.

**Flere AI-sessioner:** Kun én MCP-server kan have editoren ad gangen. Starter du
en ny (fx i en ny Claude Code-session), beder den den gamle om at slippe
porten, og editoren kobler selv over til den nye. Den gamle server melder så
til sin AI, at en nyere har overtaget, og hvordan den kommer tilbage (genstart
den, eller brug `open_project`).

Til fejlsøgning kan serveren startes alene med `make mcp`. Den venter så på
editoren og skriver i terminalen, når den forbinder.
