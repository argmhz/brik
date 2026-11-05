# Brik

En web-first 2D game engine med ECS, bygget i TypeScript og WebGL2. Spil eksporteres som en statisk mappe, der kan lægges på itch.io eller enhver webserver.

- **[Kom i gang-guide](docs/GUIDE.md)**
- [PLAN.md](PLAN.md) beskriver hele planen og status.

## Kom i gang

```bash
make editor        # installerer, hvis det mangler, og starter editoren på http://localhost:5180
make check         # typecheck og alle tests
make               # viser alle mål
```

| Mål | Hvad det gør |
|---|---|
| `make install` | Installerer afhængigheder |
| `make editor` | Starter editoren på http://localhost:5180 |
| `make demo` | Starter sprites-demoen på http://localhost:5173 |
| `make test` / `make test-watch` | Kører tests (én gang eller ved hver ændring) |
| `make typecheck` / `make check` | Typecheck, eller typecheck og tests |
| `make build` | Bygger web-editoren til `apps/web/dist` |
| `make desktop` | Starter desktop-appen (kræver Rust) |
| `make desktop-build` / `make desktop-deb` | Bygger desktop-appens installere, eller kun `.deb` |
| `make clean` / `make clean-all` | Sletter byggede filer, eller også `node_modules` og Rust-builds |

Uden make kan du bruge pnpm direkte: `corepack pnpm install`, `corepack pnpm editor`, `corepack pnpm test` og `corepack pnpm typecheck`.

Vil du se det hele i brug, så vælg **Platformer-eksempel** eller **Top-down shooter-eksempel** ved siden af "Opret", når du laver et nyt browser-projekt. Du får en bane med tilemap, en figur med animationer og lyd, mønter (prefab), partikler og UI.

## Editor-værktøjer

- **Sprite-editor:** Dobbeltklik et billede. Her kan du opdele i grid, finde sprites automatisk, tegne dem selv, sætte pivot og sætte 9-slice-kanter.
- **Animations-tidslinje:** Dobbeltklik en `.anim.json`. Træk frames rundt, træk i kanten for at ændre varighed, brug onion skin og events.
- **Tile-maler:** Opret en Tilemap i hierarkiet, vælg en tile i inspectoren, og mal i scene view. Genveje: B pensel, X viskelæder, G fyld, U rektangel, I pipette og Esc for at stoppe. Shift+klik sletter.
- **UI:** Opret "Knap", "Tekst" eller "Billede" i hierarkiet. Der laves automatisk et UI Canvas. Se resultatet i Spil-fanen.

## Pakker

| Pakke | Indhold |
|---|---|
| `@brik/core` | ECS, app/spil-loop, tid, matematik, transform-hierarki, `TileMap`, `Tween`, `Timer`, `Lifetime`, `Tags` |
| `@brik/assets` | Teksturer, sprites, `SpriteRef`, grid-slicing, animationsklip og prefabs |
| `@brik/input` | Tastatur, mus og action-mapping |
| `@brik/render` | WebGL2-renderer, `Camera2D`, `Sprite`, `Shape2D`, `Text2D`, `SpriteAnimator`, `CameraFollow2D`, partikler og UI |
| `@brik/physics` | Rapier 2D: `RigidBody2D`, `Collider2D`, `CharacterController2D`, events og raycast |
| `@brik/audio` | WebAudio: `AudioSource`, `AudioListener` og busser |
| `@brik/runtime` | Samler det hele: `createGame({ canvas })`, scripts, prefabs og scene-skift |
| `@brik/player` | Kører et eksporteret spil (`game.json`). Bygges til `brik.js`. |
| `@brik/editor` | Editor-kerne (projekter, undo/redo, asset-database, eksport, importers) og UI (`@brik/editor/ui`) |
| `apps/desktop` | Editoren som Tauri-desktop-app |

## Licens

MIT

## Scripts

Scripts er TypeScript-filer i projektets `scripts/`-mappe. De kompileres i browseren og genindlæses automatisk, også når de ændres i en anden editor.

```ts
import { Behaviour, expose } from "brik";

export class Rotator extends Behaviour {
  @expose speed = 90; // vises i inspectoren

  onUpdate(dt: number) {
    this.transform.rotation += (this.speed * Math.PI / 180) * dt;
  }
}
```

Tilføj scriptet til en entity via "Tilføj komponent" i inspectoren, og tryk Play (Ctrl+P).

### Fysik, lyd, animation og prefabs i scripts

```ts
import { Behaviour, CharacterController2D, expose } from "brik";

export class Player extends Behaviour {
  @expose speed = 120;
  vy = 0;

  onUpdate(dt: number) {
    this.vy -= 900 * dt;
    if (this.input.action("jump").pressed && this.get(CharacterController2D).grounded) this.vy = 350;
    this.moveCharacter(this.input.axis("horizontal") * this.speed * dt, this.vy * dt);
  }

  onTriggerEnter(other: number) {
    this.playSound("coin");
    this.destroy(other);
    this.spawnPrefab("Sparkle", { position: this.transform.position });
  }

  onAnimationEvent(name: string) {
    if (name === "footstep") this.playSound("step", { volume: 0.4 });
  }
}
```

- **Fysik:** Giv en entity `RigidBody2D` og `Collider2D`. En `Collider2D` uden `RigidBody2D` er statisk, fx gulve og vægge.
- **Animation:** Vælg et opdelt sprite sheet i assets og tryk "Lav animation". Træk klippet ind i scenen, eller kald `this.playAnimation("walk")`.
- **Prefabs:** Højreklik en entity i hierarkiet og vælg "Lav prefab". Træk prefab'en ind i scenen. Ret en instans og tryk "Anvend" for at opdatere alle instanser.
- **UI-knapper:** Sæt et script med `onClick()` på en entity med `UIButton`.
- **Partikler:** `ParticleEmitter2D` på en entity. Engangseffekter (rate 0, burst og auto-destroy) virker godt som prefabs: `this.spawnPrefab("Sparkle", { position })`.
- **Lyd:** Importér .wav, .mp3 eller .ogg. Træk lyden ind i scenen, eller kald `this.playSound("navn")`.
