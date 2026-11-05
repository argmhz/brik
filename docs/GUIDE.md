# Kom i gang med Brik

Brik er en 2D game engine til web. Du bygger scener i editoren, skriver
gameplay i TypeScript og eksporterer spillet som en statisk mappe, der kan
lægges på itch.io, GitHub Pages eller en hvilken som helst webserver.

## 1. Start editoren

```bash
corepack pnpm install
corepack pnpm editor        # http://localhost:5180
```

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

## 3. Grafik

- **Importér** PNG-filer med knappen eller ved at trække dem ind i asset-panelet.
- **Sprite-editoren** åbnes, når du dobbeltklikker et billede. Her kan du:
  - opdele billedet i et grid, finde sprites automatisk eller tegne dem selv,
  - sætte pivot,
  - sætte 9-slice-kanter, som bruges til UI-paneler og knapper.
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
| `this.tween(Transform2D, "position.y", 100, 0.5)`, `this.after(1, fn)`, `this.every(0.5, fn)` | Tweens og timere |
| `this.emitParticles(20)` | Udsender partikler |
| `this.loadScene("level2")` | Skifter scene |
| `this.behaviourOf(Andet, e)` | Taler med et andet script |

Scripts kan også definere egne komponenter (`defineComponent`) og systemer
(`system("navn", fn, "update")`).

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

Tyngdekraft og skala sættes i `brik.project.json` under `physics`.

## 6. Tilemaps

1. Opret "Tilemap" i hierarkiet.
2. Vælg et grid-opdelt billede som tileset.
3. Vælg en tile i inspectoren, og mal i scene view.

Genveje: **B** pensel, **X** viskelæder, **G** fyld, **U** rektangel og **I**
pipette. Shift+klik sletter, og Esc stopper malingen. Brug flere tilemaps som
lag.

## 7. UI

Opret "Knap", "Tekst" eller "Billede" i hierarkiet. Der laves automatisk et
**UI Canvas**. Placering sker med `UIRect`:

- Er ankrene ens, har elementet en fast størrelse.
- Er de forskellige, strækkes elementet med skærmen.

UI vises i Spil-fanen og som omrids i scene view. Knapper sender `onClick` til
scripts på samme entity.

## 8. Prefabs

Højreklik en entity og vælg **Lav prefab**. Træk prefab'en ind i scenen, eller
lav den fra et script med `this.spawnPrefab("Navn")`.

- Ret en instans og tryk **Anvend** for at opdatere alle instanser.
- **Gendan** kasserer en instans' ændringer.
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
cd apps/desktop
corepack pnpm dev      # åbner editoren i et vindue
corepack pnpm build    # laver en installer
```
