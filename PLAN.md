# Brik — en web-first game engine

> En game engine i stil med Unity/Unreal, bygget til web. Editoren er en webapp
> (som også kan pakkes som desktop-app via Tauri), og spil eksporteres som en
> statisk mappe, der kan hostes alle steder: itch.io, et CDN, GitHub Pages osv.
>
> **Vi starter med 2D.** 3D kommer i en senere fase oven på det samme fundament.

---

## 1. Mål

- **Web-first:** Både editor og spil kører i browseren. Renderer bygget på WebGL2, med en WebGPU-backend senere.
- **2D først:** Sprites, tilemaps, 2D-fysik og UI skal fungere godt, før 3D kommer på.
- **ECS i kernen:** Data-orienteret, hurtig og nem at serialisere.
- **Scripting i TypeScript** med hot reload, uden at brugeren skal installere noget.
- **Lille runtime:** Det spil, der shippes, indeholder kun det, der bliver brugt, og ingen editor-kode.
- **Lokale projekter:** Projekter ligger i en mappe på brugerens egen maskine. Der er ingen cloud-sync.
- **Git-venligt:** Scener, prefabs og projektfiler er læsbar JSON.

### Ikke-mål (i første omgang)
- 3D (kommer i fase 6)
- Cloud-sync og samarbejde i realtid
- Konsol- og mobil-native builds
- En egen fysik-engine (vi bruger Rapier)

---

## 2. Arkitektur

```
brik/
├── packages/
│   ├── core/        ECS, spil-loop, tid, events, matematik
│   ├── render/      WebGL2-renderer (2D først, 3D senere)
│   ├── physics/     Rapier 2D (WASM) som ECS-systemer
│   ├── audio/       WebAudio
│   ├── input/       Tastatur, mus, touch, gamepad og action-mapping
│   ├── assets/      Billeder, sprite sheets, lyd, fonte, asset-database
│   ├── ui/          In-game UI (knapper, tekst, layout)
│   ├── runtime/     Det som bliver shippet med spillet
│   └── editor/      Editor-UI
├── apps/
│   ├── web/         Editoren som webapp
│   └── desktop/     Tauri-wrapper om editoren
└── examples/        Eksempelspil, der også bruges som tests
```

**Princip:** `editor` afhænger af `runtime`, men aldrig omvendt. Et eksporteret
spil får kun `runtime` og de pakker, det faktisk bruger, med i bundlen.

### Tech-stack
| Område | Valg | Hvorfor |
|---|---|---|
| Sprog | TypeScript | Typer, god værktøjsstøtte, samme sprog til engine og scripts |
| Monorepo | pnpm workspaces | Hurtigt, enkelt |
| Build/dev | Vite | Hurtig HMR, nem bibliotek-build |
| Editor-UI | Solid.js | Hurtig, lille, fin-granuleret reaktivitet |
| Kode-editor | Monaco | VS Code-oplevelse i browseren |
| Script-kompilering | esbuild-wasm | Kompilerer TS i browseren på millisekunder |
| Fysik | Rapier 2D (WASM) | Moden, deterministisk, og 3D-udgaven findes til senere |
| Desktop | Tauri | Lille, native filsystem-adgang |
| Tests | Vitest | Passer til Vite |

### Lokal lagring af projekter
Projekter er en almindelig mappe på disken, som også kan lægges i git.

| Miljø | Hvordan |
|---|---|
| Tauri (desktop) | Native filsystem. Det er den anbefalede måde at bruge Brik på. |
| Chrome/Edge | File System Access API (`showDirectoryPicker`), så editoren arbejder direkte i en mappe |
| Firefox/Safari | Har ikke API'et. Projektet gemmes i browserens OPFS, og man kan importere og eksportere det som `.zip`. |

Lagringen ligger bag en `ProjectFS`-grænseflade, så resten af editoren er ligeglad med, hvilken af dem der er i brug.

---

## 3. Komponenter

Alle komponenter defineres med et skema. Det samme skema bruges til lagring,
serialisering, inspector-UI og undo/redo.

```ts
const Velocity2D = defineComponent("Velocity2D", { x: f32, y: f32 });
```

**Typer i skemaerne:**
- `f32`, `i32`, `u8` og `bool` er tal og flag. De gemmes i typed arrays.
- `vec2` og `color` er sammensatte værdier, der også gemmes i typed arrays.
- `entity` er en reference til en anden entity.
- `asset<T>` er en reference (GUID) til et asset.
- `SpriteRef` er en reference til én sprite: `{ texture: GUID, id }` (se 4.7).
- `string`, `enum` og `array` gemmes i en side-tabel.

### 3.1 Kerne (`core`)
| Komponent | Felter | Beskrivelse |
|---|---|---|
| `Name` | `value: string` | Navn, der vises i hierarchy |
| `Transform2D` | `position: vec2`, `rotation: f32`, `scale: vec2` | Lokal transform |
| `GlobalTransform2D` | `matrix: mat3` | Beregnet world-transform. Sættes kun af motoren. |
| `Parent` | `entity: entity` | Forælder i hierarkiet |
| `Children` | `list: array<entity>` | Børn. Holdes opdateret automatisk. |
| `Active` | `self: bool` | Slå en entity (og dens børn) til og fra |
| `Tags` | `list: array<string>` | Frie tags, fx `"enemy"` og `"pickup"` |
| `Layer` | `mask: u32` | Lag til rendering og fysik-filtre |
| `Lifetime` | `seconds: f32` | Slettes automatisk efter X sekunder |
| `Persistent` | — | Overlever sceneskift |

### 3.2 Rendering 2D (`render`)
| Komponent | Felter | Beskrivelse |
|---|---|---|
| `Camera2D` | `zoom: f32`, `viewport: rect`, `clearColor: color`, `priority: i32` | Kamera. Med flere kameraer bestemmer `priority` rækkefølgen. |
| `CameraFollow2D` | `target: entity`, `smoothing: f32`, `deadzone: vec2`, `bounds: rect`, `boundsMode: view \| center` | Lader kameraet følge en entity |
| `Sprite` | `sprite: SpriteRef`, `color: color`, `flipX/flipY: bool`, `pivotOverride?: vec2` | Tegner en sprite fra et sprite sheet eller atlas (se 4.7) |
| `SortingOrder` | `layer: i32`, `order: i32`, `ySort: bool` | Bestemmer tegnerækkefølgen. `ySort` er til top-down-spil. |
| `SpriteAnimator` | `clip: asset<SpriteAnim>`, `clips: array<asset<SpriteAnim>>`, `speed: f32`, `playing: bool` | Frame-animation. `play("navn")` skifter mellem klip. Sender frame-events. |
| `TileMap` | `tileset: asset<Tileset>`, `tileSize: vec2`, `chunks` | Grid af tiles i flere lag. Bliver til colliders automatisk. |
| `Text2D` | `text: string`, `font: asset<Font>`, `size: f32`, `color: color`, `align: enum` | Tekst i spilverdenen (MSDF-fonte) |
| `Shape2D` | `kind: enum(rect, circle, polygon, line)`, `size`, `fill: color`, `stroke: color` | Simple vektorformer, også nyttige til prototyper |
| `ParticleEmitter2D` | `rate`, `lifetime`, `velocity`, `gravity`, `colorOverLife`, `sizeOverLife`, `texture` | Partikeleffekter |
| `NineSlice` | `texture`, `borders: rect`, `size: vec2` | Skalerbare rammer til fx paneler og knapper |
| `Material2D` | `shader: asset<Shader>`, `uniforms` | Valgfri custom shader på en sprite |
| `Light2D` *(senere)* | `kind`, `color`, `intensity`, `radius` | 2D-belysning med normal maps |

### 3.3 Fysik 2D (`physics`)
| Komponent | Felter | Beskrivelse |
|---|---|---|
| `RigidBody2D` | `type: enum(dynamic, kinematic, static)`, `mass`, `gravityScale`, `linearDamping`, `angularDamping`, `fixedRotation: bool`, `ccd: bool` | Fysik-krop |
| `Velocity2D` | `linear: vec2`, `angular: f32` | Hastighed. Kan læses og skrives fra scripts. |
| `Collider2D` | `shape: enum(box, circle, capsule, polygon)`, `size`, `offset: vec2`, `friction`, `restitution`, `density`, `isTrigger: bool` | Kollisionsform |
| `CollisionFilter` | `group: u32`, `mask: u32` | Bestemmer, hvem der kan kollidere med hvem |
| `CharacterController2D` | `slopeLimit`, `stepHeight`, `snapToGround`, `grounded: bool` (read-only) | Platformer- og top-down-bevægelse uden "rigtig" fysik |
| `Joint2D` | `type: enum(fixed, revolute, prismatic, rope)`, `other: entity`, `anchor` | Leddet forbindelse mellem to kroppe |

**Events:** `CollisionEnter`, `CollisionExit`, `TriggerEnter` og `TriggerExit`.

### 3.4 Lyd (`audio`)
| Komponent | Felter | Beskrivelse |
|---|---|---|
| `AudioSource` | `clip: asset<Audio>`, `volume`, `pitch`, `loop`, `playOnStart`, `bus: enum(music, sfx, ui)`, `spatial: bool` | Afspiller lyd. Med `spatial` panoreres lyden efter position. |
| `AudioListener` | — | Normalt sat på kameraet |

### 3.5 Input (`input`)
Input er en **resource** og ikke en komponent: `input.action("jump").pressed`.
| Komponent | Felter | Beskrivelse |
|---|---|---|
| `PointerTarget` | `hover: bool`, `pressed: bool` (read-only) | Gør en entity klikbar med mus eller touch |

### 3.6 UI (`ui`)
| Komponent | Felter | Beskrivelse |
|---|---|---|
| `UICanvas` | `scaleMode: enum(constant, fit, expand)`, `referenceSize: vec2` | Rod for UI. Tegnes i skærm-koordinater. |
| `UIRect` | `anchorMin/Max: vec2`, `pivot: vec2`, `offset: rect` | Placering i stil med Unity RectTransform |
| `UILayout` | `direction: enum(row, column)`, `gap`, `padding`, `align`, `justify` | Simpel flexbox-layout af børn |
| `UIImage` | `texture`, `color`, `nineSlice: bool` | Billede |
| `UIText` | `text`, `font`, `size`, `color`, `align`, `wrap: bool` | Tekst |
| `UIButton` | `normal/hover/pressed/disabled: color`, `interactable: bool` | Knap. Sender et `Click`-event. |
| `UISlider`, `UIToggle`, `UITextInput` *(senere)* | — | Flere kontroller |

### 3.7 Scripting
| Komponent | Felter | Beskrivelse |
|---|---|---|
| `Scripts` | `list: { script, props }[]` | Behaviour-klasser sat på en entity. `props` er værdier for `@expose`-felter, der afviger fra standard. En entity kan have flere scripts. |

### 3.8 Gameplay-hjælpere
| Komponent | Felter | Beskrivelse |
|---|---|---|
| `Tween` | `target`, `property`, `to`, `duration`, `easing`, `loop`, `yoyo` | Animerer en værdi over tid |
| `Timer` | `duration`, `repeat: bool`, `elapsed` (read-only) | Sender et `TimerFinished`-event |
| `Spawner` | `prefab: asset<Prefab>`, `interval`, `maxAlive` | Opretter prefabs løbende |
| `Health` *(eksempel)* | `current`, `max` | Bruges i eksempelspillene og viser, hvordan man laver sine egne komponenter |

### 3.9 Kun i editoren
Disse komponenter strippes fra builds.
| Komponent | Beskrivelse |
|---|---|
| `PrefabInstance` | Link til en prefab samt de felter, der er overskrevet |
| `EditorOnly` | Entity'en kommer ikke med i et build, fx hjælpe-markører |
| `Locked` / `Hidden` | Kan ikke vælges, eller er skjult, i scene view |
| `Gizmo` | Custom gizmo-tegning |

### 3.10 3D-komponenter (fase 6, ikke nu)
`Transform3D`, `Camera3D`, `MeshRenderer`, `Material`, `DirectionalLight`,
`PointLight`, `SpotLight`, `RigidBody3D`, `Collider3D`, `SkinnedMesh` og `Animator`.
De kører på samme ECS og bruger samme renderer-abstraktion. 2D og 3D kan blandes
i én scene, så 2D-UI og -sprites kan ligge oven på 3D.

---

## 4. Moduler

### 4.1 ECS-kerne (`core`)
- **Archetype-baseret og data-orienteret:** Komponenter gemmes som Structure of Arrays i typed arrays.
- **Queries:** `all`, `none`, `any`, samt `added()`, `removed()` og `changed(C)`.
- **Lagring:** Komponentdata ligger pr. world og tilgås med `world.store(C).felt[e]`, hvor `e` er entity-indekset.
- **Systemer i faser:** `startup`, `preUpdate`, `fixedUpdate`, `update`, `postUpdate`, `render`.
- **Command buffers** til at oprette og slette entities sikkert under iteration.
- **Resources** (globale singletons som `Time`, `Input` og `Assets`) og **events**.
- **Entity-ID'er** med generation, så genbrugte ID'er ikke giver dangling-referencer.
- **Matematik:** `vec2`, `mat3` og `rect` nu. `vec3`, `quat` og `mat4` kommer med 3D.

### 4.2 Rendering (`render`)
- Et tyndt GPU-abstraktionslag (`Device`, `Buffer`, `Texture`, `Pipeline`), som 3D og WebGPU kan bygge videre på
- **Sprite-batcher**, der kan tegne mange tusinde sprites i få draw calls, med texture atlases
- Sortering efter lag, order og y-sort
- Tilemap-renderer opdelt i chunks
- MSDF-tekst
- Pixel-perfect mode med heltals-skalering og nearest-filter til pixel art
- Post-processing: bloom, color grading og CRT/vignette
- Debug-tegning: linjer, bokse, cirkler og colliders

### 4.3 Scripting
- **TypeScript-scripts**, kompileret i browseren med esbuild-wasm.
- **Hot reload:** Koden udskiftes, mens spillet kører, og ECS-tilstanden bevares.
- To niveauer:
  - **Behaviours** (Unity-stil):
    ```ts
    export class Player extends Behaviour {
      @expose speed = 200;
      @expose jumpForce = 400;

      onUpdate(dt: number) {
        const vel = this.get(Velocity2D);
        vel.linear.x = this.input.axis("horizontal") * this.speed;
        if (this.input.action("jump").pressed && this.get(CharacterController2D).grounded) {
          vel.linear.y = this.jumpForce;
        }
      }

      onTriggerEnter(other: Entity) {
        if (other.hasTag("coin")) other.destroy();
      }
    }
    ```
  - **Systemer** (ren ECS), når ydelsen tæller:
    ```ts
    export const gravity = system("gravity", (world) => {
      const V = world.store(Velocity2D);
      const dt = world.resource(Time).dt;
      for (const e of world.query([Velocity2D])) V.linear.y[e] -= 9.81 * dt;
    });
    ```
- Felter markeret med `@expose` vises automatisk i inspectoren.
- Monaco med typedefinitioner for engine-API'et, så der er autocomplete.

### 4.4 Assets (`assets`)
- Asset-database med stabile GUID'er og metadata-filer (`.meta.json`)
- **Importers:** PNG/JPG, Aseprite, TexturePacker, Tiled, WAV/OGG/MP3 og TTF (konverteres til MSDF)
- Sprite sheets, animationer og atlas-pakning er beskrevet i 4.7.
- Async loading, reference counting og hot reload af assets

### 4.5 Editor (`editor`)
- **Scene view (2D)** med pan/zoom, gizmos (flyt, rotér, skalér), snapping og grid
- **Tilemap-maler** med pensel, fyld, viskelæder og flere lag
- **Sprite-, animations- og atlas-editor** (se 4.7)
- **Game view** til at se spillet gennem spillets kamera, med valg af opløsning
- **Hierarchy** med drag-and-drop til parenting
- **Inspector**, der genereres automatisk ud fra komponent-skemaer og `@expose`
- **Asset browser** med drag-and-drop ind i scenen
- **Console** med logs, fejl og stack traces, der linker til koden
- **Play mode**, hvor verdenen gemmes som snapshot ved Play og gendannes ved Stop
- **Undo/redo** bygget på command-mønsteret
- **Prefabs** med overrides og nested prefabs
- Dockbart panel-layout og keyboard shortcuts

### 4.6 Byg og eksport (`runtime`)
- "Build for Web" giver en tree-shaken, minificeret bundle, pakkede atlases og en `index.html`.
- Valgfri PWA-indpakning, så spillet kan installeres og spilles offline
- Loading-skærm og build-rapport (størrelse pr. modul og asset)
- Eksport som `.zip`, klar til at uploade til itch.io

### 4.7 Sprites, sprite sheets og atlases

Målet er at kunne gå fra en PNG eller en Aseprite-fil til en animeret figur i
scenen, uden at forlade editoren.

**Grundprincip:** Du arbejder med *sprites* og ikke med billeder eller
koordinater. En sprite refereres altid som `SpriteRef = { texture: GUID, id }`.
Det er motoren, der finder ud af, om spriten ligger i sit eget billede eller i et
pakket atlas. Scripts og komponenter skal aldrig rettes, fordi et atlas ændrer sig.

#### Asset-typer
| Asset | Fil | Indhold |
|---|---|---|
| **Texture** | `hero.png` og `hero.png.meta.json` | Import-indstillinger: filter (nearest/linear), wrap, mipmaps, `pixelsPerUnit`, premultiplied alpha |
| **Sprite sheet** | Ligger i texturens `.meta.json` | En liste af sprites: `{ id, name, rect, pivot, border }`. `border` bruges til 9-slice. |
| **Animation** | `hero_run.anim.json` | Frames som `{ sprite: SpriteRef, duration }`, afspilningsmåde (`loop`, `once` eller `pingpong`) og events på frames, fx `"footstep"` |
| **Atlas** | `characters.atlas.json` | Hvilke mapper og sprites der skal pakkes, og hvordan (se "Atlas-pakker") |
| **Tileset** | `dungeon.tileset.json` | Bygger på et grid-opdelt sprite sheet med collision-former og egenskaber pr. tile |

Hver sprite har et stabilt `id`. Du kan derfor omdøbe den eller skære den om,
uden at referencer i scener og animationer går i stykker.

Eksempel på en `.meta.json`:
```json
{
  "guid": "7f3a…",
  "importer": "texture",
  "settings": { "filter": "nearest", "pixelsPerUnit": 16 },
  "slicing": { "mode": "grid", "cell": [32, 32], "offset": [0, 0], "spacing": [0, 0] },
  "sprites": [
    { "id": "s1", "name": "hero_idle_0", "rect": [0, 0, 32, 32], "pivot": [0.5, 0] },
    { "id": "s2", "name": "hero_idle_1", "rect": [32, 0, 32, 32], "pivot": [0.5, 0] }
  ]
}
```

#### Sprite-editor
Et panel, der åbner, når du dobbeltklikker på en texture.
- Zoom og pan med pixel-grid, så pixel art kan redigeres præcist
- **Slicing-tilstande:**
  - **Single:** hele billedet er én sprite.
  - **Grid:** angiv cellestørrelse eller antal rækker og kolonner samt offset og spacing.
  - **Auto:** finder sprites ud fra gennemsigtighed (sammenhængende områder).
  - **Manuel:** tegn, flyt og tilpas rektangler med musen.
- Automatisk navngivning, fx `hero_0`, `hero_1` …, og omdøbning af flere ad gangen
- Pivot kan trækkes med musen eller vælges fra presets (center, bund-midt osv.)
- 9-slice-kanter kan trækkes direkte på spriten
- Hvis PNG'en gemmes igen udefra, bevares sprites. Ved grid-slicing skæres der automatisk om, hvis størrelsen ændrer sig.

#### Animations-editor
- Tidslinje med frames. Du trækker sprites ind fra sprite sheetet.
- Varighed pr. frame eller én fælles FPS
- Forhåndsvisning med afspilning, hastighed og onion skin
- Events på frames, som scripts kan lytte efter: `onAnimationEvent("footstep")`
- **Genvej:** Markér frames i sprite-editoren og vælg "Lav animation". Det opretter et klip med det samme.

#### Atlas-pakker
- Pakker mange små sprites i ét eller få store billeder. Det giver færre texture-skift og hurtigere rendering.
- **Algoritme:** MaxRects (best short side fit). Den kører i en Web Worker, så editoren ikke fryser.
- **Indstillinger pr. atlas:**
  - Maks. størrelse (fx 2048 eller 4096)
  - Padding og **extrude**, så kanterne ikke "bløder" ind i hinanden. Det er vigtigt for pixel art og tilemaps.
  - Trim af gennemsigtige kanter. Den oprindelige størrelse og pivot bevares.
  - Power-of-two (til eller fra)
  - Rotation (fra som standard)
  - Flere sider, når der ikke er plads på én
- **Atlas-visning i editoren:** viser de pakkede sider, hvor meget af hver side der er brugt (%), hvilke sprites der ligger på hvilken side, samt advarsler (fx "sprite er større end maks. størrelse").
- **I udvikling** indlæses hver texture for sig, så der er hurtig hot reload.
- **Ved build** bager pakkeren atlasserne og en opslagstabel fra `SpriteRef` til `{ side, uv, trim-offset, oprindelig størrelse }`.

#### Integration i resten af motoren
- **Asset browser:** En texture kan foldes ud og viser sine sprites som under-elementer.
  - Træk én sprite ind i scenen for at oprette en entity med `Sprite`.
  - Træk flere frames ind for at få en entity med `SpriteAnimator` og et nyt klip.
- **Inspector:** `SpriteRef`-felter får en sprite-vælger med miniaturebilleder.
- **Sprite-batcher:** Sprites fra samme atlas-side tegnes i ét draw call.
- **Scripts:**
  ```ts
  this.get(Sprite).sprite = sprites("hero/idle_0");
  this.get(SpriteAnimator).play("hero_run");
  ```

#### Importers
| Format | Hvad vi får ud af det |
|---|---|
| **Aseprite** (JSON-eksport, senere også `.aseprite` direkte) | Frames og varigheder, *tags* som animationer, *slices* som pivot og 9-slice |
| **TexturePacker** (JSON hash og array) | Færdige atlasser med sprites |
| **Tiled** (`.tsj`/`.tmj`) | Tilesets og tilemaps |
| **Løse PNG'er i en mappe** | Hver fil bliver en sprite. Mappen kan markeres som "pak til atlas". |

---

## 5. Det der gør Brik anderledes

1. **Time-travel debugging:** Al tilstand ligger i typed arrays, så vi kan tage et billigt snapshot hver frame. Du kan spole tilbage, sætte på pause og inspicere præcis den frame, hvor buggen opstod.
2. **Visuel scripting, der kompilerer til TypeScript:** Noder for begyndere, men resultatet er læsbar kode, som kan redigeres videre i hånden.
3. **Multiplayer-klar fra start:** Samme komponent-skemaer bruges til netværks-sync, med rollback-netcode for små spil.

---

## 6. Faseplan

### Fase 1 — Kerne og 2D-rendering
- [x] Monorepo-opsætning (pnpm, Vite, TypeScript, Vitest)
- [x] ECS: entities, komponent-skemaer, archetypes, queries, systemer, faser, resources og events
- [x] Spil-loop med fast og variabelt tidsskridt
- [x] Matematik: `vec2`, `mat3` og `rect`
- [x] Kernekomponenter: `Name`, `Transform2D`, `GlobalTransform2D`, `Parent`/`Children` og `Active`
- [x] WebGL2-renderer: teksturer, `Camera2D`, `Sprite`, `SortingOrder` og sprite-batcher
- [x] `SpriteRef` og opslag af sprites. Sprites defineres i kode i denne fase.
- [x] Input (tastatur, mus og action-mapping)
- [x] `changed`-queries (ændringsdetektion pr. komponent, fase 5.5)
- **Resultat:** Sprites, der bevæger sig, styret af systemer

### Fase 2 — Editor-skal
- [x] Editor-layout med paneler (Solid.js), som kan ændres i størrelse
- [x] `ProjectFS`: File System Access (mappe på disken), OPFS (browser-projekter) og import/eksport som .zip
- [x] `ProjectFS` til Tauri (`TauriFS`, fase 5)
- [x] Hierarchy med træk-og-slip, omdøbning og højreklik-menu
- [x] Inspector, der genereres automatisk ud fra skemaer og felt-metadata
- [x] 2D scene view med pan/zoom, grid, snap, selektion og gizmos (flyt, rotér, skalér)
- [x] Gem og indlæs scene (JSON med stabile scene-id'er)
- [x] Undo/redo for alle ændringer i scenen
- [x] Asset browser (billeder), hvor en texture kan foldes ud og vise sine sprites
- [x] Texture-import med `.meta.json` og grid-slicing i inspectoren
- [x] Dockbare paneler (fase 5.5)
- **Resultat:** Man kan bygge en scene visuelt og gemme den lokalt

### Fase 3 — Scripting og Play mode
- [x] Kompilering af TS-scripts i browseren med esbuild-wasm (relative imports mellem scripts, `import ... from "brik"`)
- [x] Behaviours, `@expose`, `Scripts`-komponent og script-systemer (`system(navn, fn, fase)`)
- [x] Komponenter kan defineres i scripts og bruges i scener
- [x] Monaco-integration med typedefinitioner (autocomplete og typefejl)
- [x] Typer og `tsconfig.json` skrives ind i projektet, så VS Code også giver autocomplete
- [x] Play/Pause/Step/Stop med snapshot og gendannelse, plus Game view
- [x] Hot reload, også når scripts ændres uden for editoren (fx i VS Code)
- [x] Console med logs og fejl, der linker til linjen i scriptet
- [x] Linjenumre i runtime-fejl: stack traces oversættes gennem scriptenes source map til fil og linje (fase 5.8)
- [x] `entity`-felter med `@expose` (fase 5.5)
- **Resultat:** Man kan lave et simpelt spil i editoren

### Fase 4 — 2D-indhold
Delt i to: 4a er runtime-delen og de editor-paneler, der hører til. 4b er de store editor-værktøjer.

**4a (færdig)**
- [x] Rapier 2D (`@brik/physics`): `RigidBody2D`, `Velocity2D`, `Collider2D` (box, circle, capsule), `CollisionFilter`, `CharacterController2D`, kollisions- og trigger-events, raycast og punkt-forespørgsler
- [x] Lyd (`@brik/audio`): `AudioSource`, `AudioListener`, busser (music, sfx, ui), spatial panorering og `audio.play()`
- [x] `SpriteAnimator` med `.anim.json`-klip (loop, once, pingpong) og frame-events. "Lav animation" fra et sprite sheet og en klip-inspector med forhåndsvisning, varighed pr. frame og events.
- [x] `Text2D` (tegnet med canvas) og `Shape2D` (rect med runde hjørner og cirkel, tegnet med SDF i sprite-batcheren)
- [x] Prefabs (`.prefab.json`): lav fra hierarkiet, indsæt (knap eller træk ind i scenen), Anvend og Gendan, automatisk opdatering når filen ændres udefra, `spawnPrefab()` og `Spawner`
- [x] `Tween` (komponent og `tweens.to()`), `Timer`, `Lifetime`, `Tags` og `CameraFollow2D`
- [x] Behaviour-hooks: `onCollisionEnter/Exit`, `onTriggerEnter/Exit`, `onAnimationEvent`, `onAnimationFinished` og `onTimer`. Hjælpere: `moveCharacter`, `tween`, `after`, `every`, `playSound`, `playAnimation` og `spawnPrefab`.
- [x] Editor: entity-felter med vælger og træk-og-slip, asset-felter (klip, lyd, prefab), collider-gizmos og nye entity-typer i hierarkiet

**4b (færdig)**
- [x] Sprite-editor (fuldskærm): grid, automatisk slicing ud fra gennemsigtighed, manuel tegning, flytning og ændring af rektangler, pivot (træk eller presets) og 9-slice-kanter (træk eller tal). Automatisk slicing beholder eksisterende sprites' id, navn og pivot-punkt, så animationer ikke går i stykker. Har egen fortryd.
- [x] Animations-tidslinje (fuldskærm): frames med bredde efter varighed, flyt ved at trække, træk kanten for at ændre varighed, palette med træk-og-slip, onion skin, pivot-justeret forhåndsvisning, events (dobbeltklik), afspilningshastighed og fortryd
- [x] `TileMap` (lag = flere TileMaps) og `TileMapCollider`, der samler tiles til få bokse. Tile-maler i scene view med pensel, viskelæder, fyld, rektangel og pipette, palette i inspectoren og undo pr. strøg.
- [x] UI: `UICanvas` (fit, expand, constant), `UIRect` (ankre i stil med Unity), `UIImage` (farve, sprite eller 9-slice), `UIText` og `UIButton` (hover, pressed, `UIClick` og `onClick`). UI vises i Spil-fanen og som omrids i scene view.
- [x] `ParticleEmitter2D` med rate, burst, levetid, fart, spredning, tyngdekraft, størrelse og farve over tid, sprite eller runde partikler og auto-destroy. Forhåndsvises i scene view, når den er valgt.
- [x] Platformer-eksempel som projektskabelon: genereret pixel art og lyd, animationer, prefabs, tilemap-bane, UI og to scripts

**Kendte begrænsninger i 4b**
- UI er kun i skærm-koordinater (ingen world-space canvas). ~~Ingen layout, slider, toggle eller tekstfelt.~~ (fase 5.9)
- ~~UI-elementer kan ikke vælges eller trækkes i scene view.~~ (fase 5.9; størrelsen ændres stadig i inspectoren)
- Tilemap-data gemmes som ét objekt pr. lag, ikke i chunks. Det er fint til tusinder af tiles, men ikke til meget store verdener. ~~Der er ingen auto-tiling.~~ (fase 5.9)
- Partikler har ingen kollision. ~~De simulerer kun i world space.~~ (gruppe 3: `space: "local"` lader dem følge emitteren)
- ~~`Sprite` har ikke 9-slice i verdenen.~~ (fase 5.9)

**Kendte begrænsninger fra 4a**
- ~~`CharacterController2D` kan ikke stå på løse kasser.~~ (fase 5.9)
- ~~`Text2D` bliver blød, hvis man zoomer meget ind.~~ (fase 5.9, uden MSDF)
- ~~`Shape2D` har ikke polygon og linje, og `Joint2D` mangler.~~ (fase 5.9)
- ~~`CameraFollow2D` tager ikke højde for, hvor stor visningen er.~~ (fase 5.8)
- **Resultat (4a+4b):** Et rigtigt 2D-spil, fx en platformer med UI og lyd

### Fase 5 — Udgivelse
- [x] Build/eksport til statisk web: `index.html` med loading-skærm, `brik.js` (player), `game.json`, atlas-sider, lyde og minificerede scripts. Eksport som `.zip` til itch.io eller direkte til en mappe. Byg-vindue med rapport over filstørrelser.
- [x] Scene-skift i spillet: `this.loadScene("level2")`. Virker både i editorens Play og i det eksporterede spil.
- [x] Atlas-pakker: MaxRects (best short side fit) i en Web Worker, padding, extrude, power-of-two og flere sider. Atlas-visning med fyldningsgrad og advarsler. Textures med `wrap: repeat` og for store billeder får egne sider.
- [x] Importers: Aseprite og TexturePacker (JSON hash og array: sprites, pivots, 9-slice fra slices, tags som animationer) samt Tiled (`.tmj`/`.tsj`: tile-lag i alle kodninger, også zlib og gzip, object-lag som entities, collision-lag som `TileMapCollider`)
- [x] Tauri-desktop-app (`apps/desktop`) med `TauriFS`, native dialoger til at åbne, eksportere og gemme, og ikoner. Bygget og testet på Linux: projektmapper, platformer-skabelonen, scripts og Monaco, Play, atlas-worker og eksport virker i appen. `tauri build` giver en `.deb` på 7,6 MB.
- [x] Eksempelspil som projektskabeloner: 2D-platformer og top-down shooter
- [x] Dokumentation: [docs/GUIDE.md](docs/GUIDE.md)
- **Resultat:** En 2D-engine, man kan shippe spil med, både i browseren og som desktop-app.

**Kendte begrænsninger i fase 5**
- ~~Playeren er ca. 1,75 MB, fordi Rapier indlejrer sin WASM.~~ (fase 5.9)
- Atlas-pakkeren pakker hele billeder. Sprites inde i et sprite sheet trimmes ikke enkeltvis, og der er kun extrude om hele billedet. Rotation i atlas er ikke understøttet.
- ~~Ingen PWA/offline-indpakning.~~ (fase 5.9)
- ~~Tiled: XML-formaterne (`.tmx`/`.tsx`) understøttes ikke.~~ (gruppe 3: de oversættes til JSON-formen af en lille XML-læser, også eksterne tilesets og kort med chunks.) Spejlede tiles importeres stadig uden spejling.
- TexturePacker: Roterede frames understøttes ikke (der gives en advarsel).
- Desktop-appen er kun bygget og testet på Linux. De native åbn- og gem-dialoger er ikke testet automatisk, og der er ingen signering, auto-opdatering eller builds til Windows og macOS.

### Fase 5.5 — Editor-oplevelse
- [x] `query.changed(C)`: entities, hvis komponent er tilføjet eller ændret siden sidste kald. Ændringer gennem `world.write`, `world.add` og views (`this.get(C)` i scripts) markeres automatisk. Direkte skrivning til `world.store(C)` kræver `world.markChanged(e, C)`.
- [x] `@expose({ type: "entity" })` med entity-vælger i inspectoren. Gemmes som scene-id (`{ $entity: id }`) og følger med, når prefabs spawnes og entities kopieres. Felter af typen prefab, lyd og klip fik også en asset-vælger.
- [x] Prefab-overrides pr. felt: instansen husker, hvor den afviger fra prefab'en (felter, tilføjede og fjernede komponenter og entities). Når prefab'en ændres, følger alt andet med. Afvigende felter står med fed skrift i inspectoren, og et dobbeltklik henter prefab'ens værdi. Instanser opdateres også, når en scene åbnes, eksporteres eller indlæses med `loadScene`.
- [x] Nested prefabs: prefabs inde i prefabs opdateres, når den inderste ændres, også i prefab-filerne på disken. En prefab kan ikke indeholde sig selv.
- [x] Dockbare paneler: træk en fane til en anden zone (venstre, midte, bund, højre), eller brug højreklik-menuen. Layoutet huskes, og ⊞ i menulinjen nulstiller det.

**Kendte begrænsninger i 5.5**
- ~~Script-felter tæller som ét override (`Scripts.list`).~~ (fase 5.9)
- Docking har fire faste zoner. Zoner kan ikke deles yderligere, og paneler kan ikke flyde i egne vinduer.
- `changed` ser ikke ændringer inde i `ref`-felter (fx arrays), som ændres på stedet.

### Fase 5.6 — AI via MCP
- [x] `@brik/mcp`: MCP-server (stdio) med værktøjer til at se, ændre, scripte, afprøve og tage skærmbilleder i den åbne editor.
- [x] Bridge over WebSocket på `127.0.0.1:5181`. Editoren forbinder, når brugeren klikker **AI**. Andre origins end editorens bliver afvist.
- [x] Alle ændringer går gennem editorens kommandoer, så de vises live og kan fortrydes. Fejl forklarer, hvad AI'en skal gøre i stedet (fx feltnavne og tilladte værdier).
- [x] `.mcp.json` til Claude Code, `make mcp` og afsnit 11 i guiden.

**Næste skridt for AI**
- ~~`CLAUDE.md` i projekt-skabelonerne~~ (fase 5.8)
- ~~Headless-tilstand~~ (fase 5.8)
- AI-chat inde i editoren er fravalgt: den ville kræve en API-nøgle og koste pr. token. AI-klienter som Claude Code arbejder i stedet i Brik via MCP-serveren.

### Fase 5.7 — Første rigtige spil
Spillet **Mosehop** (`examples/mosehop`) blev bygget fra platformer-skabelonen gennem MCP-værktøjerne, som en AI ville gøre det: to baner, slim, der kan trampes på, pigge, liv, mønter på tværs af baner, HUD, baneskift og vindeskærm. Undervejs blev følgende fundet og rettet:
- [x] AI'en kunne ikke lave grafik eller male baner. Nye værktøjer: `draw_sprites` (pixel art fra tekst og palet til PNG), `create_animation`, `read_tiles` og `paint_tiles` (baner som tekstrækker).
- [x] AI'en kunne ikke afprøve styringen. `step` tager nu `hold` og `press` med tastekoder, og holdte taster bliver holdt på tværs af kald.
- [x] `create_entity` mistede positionen, når `components` også satte `Transform2D` (fx skala). Værdier lægges nu oven i standarden felt for felt.
- [x] Modultilstand i scripts (fx liv og point) overlevede fra én Play til den næste. Modulerne indlæses nu forfra ved hver Play, ligesom i det eksporterede spil.
- [x] At skjule en entity fra et script krævede, at `Active` var tilføjet først. Nyt: `setActive(world, e, on)`, `isActive(world, e)` og `this.setActive(on, e)`.
- [x] Screenshot hang i 60 sekunder, når editoren ikke var synlig, fordi `requestAnimationFrame` ikke kører der. Den venter nu højst et øjeblik.
- [x] esbuild blev initialiseret igen efter hot reload ("Cannot call initialize more than once").
- [x] Regressionstest, der åbner `examples/mosehop` headless, spiller fra flaget på bane 1 til bane 2 og tramper på en slim.

**Fundet, men ikke rettet**
- ~~En genindlæsning af siden mister alt, der ikke er gemt.~~ (fase 5.8)
- ~~`CameraFollow2D.bounds` holder kun kameraets midtpunkt inden for rammen.~~ (fase 5.8)
- ~~AI'en kan ikke klikke på UI-knapper i spillet.~~ (fase 5.8)
- ~~`setActive` skjuler kun: scripts og colliders på en inaktiv entity kører videre.~~ (fase 5.8)
- ~~Det kan tage op til et minut at forbinde til AI'en igen fra en baggrundsfane.~~ (fase 5.8)
- ~~Scener skifter asynkront, så det ses først et `step` senere.~~ (fase 5.8)
- Fjender uden fysik-krop skal flyttes i scripts, og triggere melder først, når overlappet er sket. Et tramp-tjek skal derfor være tilgivende.

### Fase 5.8 — Oprydning efter Mosehop
- [x] `setActive(false)` slukker nu en entity helt, også når det er en forælder, der er slukket: scripts (`onStart`, `onUpdate`, `onFixedUpdate` og events) holder pause, og det samme gør tweens og timere fra `this.after`/`this.every`. Kroppe og colliders er ude af fysikken, så de ikke falder, støder eller rammes af `raycast` og `overlapPoint`. `onStart` venter, til entity'en tændes første gang.
- [x] Autosave: ændringer, der ikke er gemt, skrives til `.brik/recovery.json` lidt efter hver ændring (aldrig under Play). Når projektet åbnes igen, spørger editoren, om de skal gendannes. Gendannede ændringer står som ikke gemt, til man gemmer. Filen fjernes, når scenen gemmes, eller når man fortryder tilbage til det gemte.
- [x] MCP: `click` klikker på en UI-knap (entity-id) eller et sted i verden og fortæller, hvilken knap der blev ramt. `step` tager `mouse` (`{ entity }` eller `{ x, y }`), så AI'en kan sigte. UI'et lægges ud, selv om Spil-fanen ikke har tegnet.
- [x] `CameraFollow2D.boundsMode`: med "view" (standard) holdes hele udsnittet inden for `bounds`, uanset skærmens størrelse og zoom. Er udsnittet større end rammen, centreres det. "center" er den gamle opførsel. Skærmstørrelsen kendes fra første frame. Platformer-skabelonen og Mosehop bruger nu banernes kanter som `bounds`.
- [x] Sceneskift under AI-afprøvning: `step` og `click` venter på en scene, der er ved at blive læst, så skiftet sker i samme frame som i et spil, der kører, og ses i det samme kald (`sceneLoaded` i svaret). En scene, der ikke kan læses, låser ikke længere `Scenes.busy`.
- [x] AI-forbindelsen prøver igen hvert 2. sekund, også fra en baggrundsfane (timeren ligger i en Web Worker, som browseren ikke bremser), og med det samme, når fanen bliver synlig.
- [x] Sprite-editoren og store sprite sheets (fx AI-genererede): Grid starter med én celle pr. figur, der findes i billedet (8 figurer på række giver 8 × 1 celler) i stedet for altid 16×16, og der er et felt "Antal" (kolonner × rækker), som regner cellestørrelsen ud. "Find automatisk" ignorerer næsten usynlige pixels (alfa ≤ 16), så støj i baggrunden ikke giver hundredvis af sprites. "Tilpas" kan nu zoome under 100 %, så store billeder kan ses helt.
- [x] `onEnable`/`onDisable` i Behaviours: kaldes, når entity'en tændes og slukkes (også via en forælder). `onEnable` kommer lige før `onStart`, og `onDisable` før `onDestroy`.
- [x] Headless-tilstand: `open_project({ path })` åbner en projektmappe inde i MCP-serveren, når editoren ikke kører. Editorens egen kode gør arbejdet (bundtet med esbuild første gang), med et Node-filsystem og billedstørrelser læst fra filernes header. Alle værktøjer virker undtagen `screenshot`. `console.log` fra scripts havner i `get_console` og på stderr, aldrig på stdout, som MCP bruger. `close_project` beskytter ændringer, der ikke er gemt.
- [x] Runtime-fejl i scripts peger på fil og linje: stack tracen oversættes gennem bundlens source map (fx `scripts/Player.ts:42:7`), motorens egne linjer under scriptet skæres fra, og Console-linjen kan klikkes og åbner linjen. `get_console` giver AI'en det samme (`at`). Desuden hopper kode-editoren nu også til linjen, når den åbnes første gang fra Console.
- [x] `CLAUDE.md` i alle nye projekter (og i Mosehop) med filer, script-API, hooks og tommelfingerregler, så AI-klienter kender Brik uden MCP-serveren.

**Kendte begrænsninger i 5.8**
- Autosave dækker kun den åbne scene.
- ~~Gendannelsesspørgsmålet bruger browserens `confirm()`-dialog.~~ (gruppe 3: en egen dialog med scenens navn, tidspunkt og antal entities)
- ~~Eksisterende projekter får ikke `CLAUDE.md`.~~ (gruppe 3: de får den, når de åbnes, hvis den mangler. En markør i `.brik/` sørger for, at en slettet fil ikke kommer tilbage, og en eksisterende røres aldrig.)
- Headless har ingen renderer, så der er ingen skærmbilleder, og byg/eksport kan ikke køres derfra. Er projektet åbent i både editoren og headless, ser de ikke hinandens ændringer.
- Scener, der er gemt før `boundsMode` kom, får "view" og skal have deres `bounds` sat til banens kanter (eller `boundsMode: "center"`).
- ~~Kameraets rotation tages ikke med, når udsnittet holdes inden for rammen.~~ (gruppe 3)

### Fase 5.9 — 2D gjort færdig
De kendte begrænsninger fra fase 4–5.8, der mærkes mest, når man laver og udgiver spil.

- [x] Rapier lazy-loades: playeren er delt i `brik.js` (ca. 100 KB) og `brik-physics.js` (ca. 1,65 MB med Rapiers WASM). `game.json` får `usesPhysics`, når en scene eller prefab har fysik-komponenter, og så hentes fysikken, før spillet starter. Ellers hentes den kun, hvis spillet senere får brug for den (første gang en entity med fysik dukker op). Et spil uden fysik henter nu ca. 105 KB i stedet for 1,75 MB.
- [x] `CharacterController2D` kan stå på løse kasser: bevægelsen beregnes som før uden dynamiske kroppe (så figuren skubber dem væk og ikke går i stå, hvis noget lander på hovedet), og når den bevæger sig nedad, tjekkes den lodrette del igen mod dynamiske kroppe, så den lander på dem i stedet for at falde igennem. Testet med at stå på, hoppe op på og skubbe en kasse.
- [x] Auto-tiling: et tileset kan have terræner (i sin `.meta.json`). Et terræn er en ordnet liste af regler med et sprite og et 3×3-mønster (samme terræn / ikke samme / ligegyldigt), og den første regel, der passer, vinder. Man maler med terrænet (pensel, fyld, rektangel), og de malede celler og deres naboer får de rigtige kanter og hjørner. Det gælder også, når man sletter. "Fra 3×3-blok…" laver de 9 regler for en almindelig blok med hjørner, kanter og midte. Pipetten på et terræn-tile vælger terrænet. AI'en maler med `"terrain:<navn>"` i `paint_tiles`, og `read_tiles` viser terrænerne. Runtime er uændret, for tilemaps gemmer stadig almindelige sprite-id'er.
- [x] UI: `UISlider`, `UIToggle`, `UITextInput` og `UIStack` (kolonne eller række, i stedet for det planlagte `UILayout`, som allerede er navnet på det udregnede layout). Slider og toggle tegnes af rendereren; tekstfeltet viser sin tekst gennem sin `UIText` og tager imod tastatur gennem et skjult HTML-felt, så æøå, indsæt og skærmtastaturer virker. Scripts får `onValueChanged` og `onSubmit`, og AI'en kan skrive med `step({ type })`. Undervejs: et klik eller tryk uden musebevægelse først (fx på en touchskærm) ramte position (0, 0), fordi kun `pointermove` satte positionen. Nu gør `pointerdown` det også.
- [x] UI-elementer kan vælges og trækkes i scene view: et klik inden for et omrids vælger elementet (UI ligger øverst som i spillet, men store baggrunde, der dækker over halvdelen af skærmen, kommer efter verdenen, så den stadig kan vælges). At trække ændrer `UIRect.position` i UI-enheder (med snap og fortryd), og flyt-gizmoen vises ikke for UI. Elementer i en `UIStack` placeres af stakken og flyttes ikke.

**Gruppe 2**
- [x] Skarp tekst ved zoom: `Text2D` rasteriseres ved den opløsning, den vises med (kameraets eller scene views zoom × entityens skala × skærmens pixeltæthed), rundet op til faste trin (1, 1,5, 2, 3 … 32 pixels pr. enhed), så zoom kun giver ny rasterisering, når et trin krydses. Højst 4096 pixels pr. side. Valgt frem for MSDF: alle systemfonte virker stadig, og der skal ikke genereres font-atlasser.
- [x] 9-slice på `Sprite` i verden: `drawMode: "sliced"` strækker spritet til `size` (verdensenheder), og et sprite med 9-slice-kanter beholder hjørnernes størrelse, mens kanter og midte strækkes. Virker med rotation og flip, og valg i scene view følger den strakte størrelse.
- [x] `Shape2D` polygon og linje: `points` i lokale koordinater, tegnet med Canvas2D til en tekstur ved den viste opløsning (fyld, kant, runde samlinger). Inspectoren har et punktfelt.
- [x] `Joint2D`: `hinge`, `fixed`, `spring`, `rope` og `slider` mellem to kroppe, eller til et punkt i verden, når `connected` er tom. `fixed` svejser kroppene, hvor de står. Scene view viser leddet som en stiplet linje mellem ankrene.
- [x] Atlas-pakkeren pakker et sprite sheets sprites én for én (tæt og med padding og extrude om hver sprite, så tiles ikke bløder ind i hinanden) og lægger resultatet ind i atlasset som én blok. Billeder, der bruges som helt billede (sprite-id `""`), pakkes som før. Ikke afprøvet i et eksporteret spil i browseren endnu.
- [x] PWA/offline for udgivne spil: eksporten får `sw.js` (cache først; versionen er en hash af alle filerne, så en ny udgivelse henter sig selv i baggrunden og rydder den gamle cache), `manifest.webmanifest` og ikoner (projektets `icon.png`, ellers et genereret). Alt med relative stier, så det virker i en undermappe. Cachen har scopet i navnet, så flere spil på samme side ikke rydder hinandens. Fysik-filen (1,65 MB) forhåndshentes kun, hvis spillet bruger fysik; ellers gemmes den, første gang den hentes. Kan slås fra i byg-vinduet (`pwa: false`).
- [x] Prefab-overrides pr. script-felt: et script-felt, der afviger fra prefab'en, er et eget override (`<id>:Scripts:<script>@<n>.<felt>`, hvor n tæller kopier af samme script). Prefab'en kan ændre de andre felter, og instansen beholder sit eget; felter, der kommer til, følger med. Inspectoren viser det som andre overrides, og dobbeltklik henter prefab'ens værdi. Tilføjes, fjernes eller flyttes scripts, er hele listen stadig ét override (`Scripts.list`).

**Fra MCP-brug (et spil bygget gennem værktøjerne)**
- [x] Rettet i motoren: `CharacterController2D` bruger figurens eget collision-filter, en `Spawner` uden `asChildren` spawner ved verdenspositionen under en flyttet forælder, og `Joint2D.connectedAnchor` følger den forbundne krops skalering.
- [x] MCP: `create_entity` oplyser komponenter, børn og automatisk oprettet canvas; `create_prefab` returnerer en id-oversættelse for børnene; `click` læser klik efter hver frame og opdager genindlæsning af samme scene; `project_info` viser spillets scene under Play og lydstatus; `inspect_entity` viser levende partikler, aktiv og verdensposition under Play.
- [x] MCP: `step({ fps })`, `mouse`/`click` med `at` og `offset` på UI-elementer, tekstredigering (`backspace`, `replace`, Backspace i `press`), `import_asset` (billeder og lyd fra disken), `slice_texture` og `edit_sprites`. Vejledning om bevægelse i `onUpdate` og `onFixedUpdate` står i MCP-instruktionerne og i `CLAUDE.md`.
- [x] Flere MCP-klienter om port 5181: en ny server beder den gamle om at slippe porten (den nyeste vinder), og editoren kobler selv over. Den gamle bliver passiv og forklarer sin AI, hvad der skete. Ligger noget andet på porten, ventes der som før.
- [ ] Hørbar lyd kan ikke kontrolleres gennem MCP (kun antal afspilninger og om WebAudio findes).

### Fase 6 — 3D
- [ ] 3D-matematik, `Transform3D`, `Camera3D` og `MeshRenderer`
- [ ] PBR, lys, shadows og post-processing
- [ ] glTF-import og skeletal animation
- [ ] Rapier 3D
- [ ] 3D scene view og gizmos

### Fase 7+ — Det der gør Brik anderledes
- [ ] Time-travel debugging
- [ ] Visuel scripting
- [ ] WebGPU-backend
- [ ] Multiplayer og rollback-netcode

---

## 7. Licens

**Besluttet: MIT**

- Det er den mest udbredte licens til game engines og frameworks. Godot, Phaser, PixiJS og three.js bruger den.
- Den er kort og nem at forstå. Folk må bruge engine'en i kommercielle spil uden at skulle frigive deres egen kode.
- Spil lavet med Brik kan have den licens, udvikleren vil.
- **Alternativ:** Dobbelt-licens med MIT og Apache-2.0, som Bevy og Rust-økosystemet bruger. Apache-2.0 giver en eksplicit patent-beskyttelse, men er længere. Den giver mest mening, hvis mange eksterne bidrager.
- **Fravalgt:** GPL/LGPL. Den kræver, at ændringer frigives, og det skræmmer spiludviklere væk, især når engine-koden bundles direkte ind i spillet, som den gør på web.

Vigtigt: Tredjeparts-afhængigheder skal være kompatible. Rapier (Apache-2.0),
Monaco (MIT), Solid (MIT) og esbuild (MIT) er alle fine.

---

## 8. Beslutninger
| Emne | Beslutning |
|---|---|
| 2D eller 3D | 2D først, 3D i fase 6 |
| Lagring | Kun lokalt (Tauri-filsystem, File System Access eller OPFS + zip). Ingen sync. |
| Licens | MIT (se `LICENSE`) |
