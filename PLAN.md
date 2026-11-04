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
| `CameraFollow2D` | `target: entity`, `smoothing: f32`, `deadzone: vec2`, `bounds: rect` | Lader kameraet følge en entity |
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
- **Queries:** `all`, `none`, `any`, samt `added()` og `removed()`. `changed` kommer senere.
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
- [ ] `changed`-queries (ændringsdetektion på felter) er udskudt. `added` og `removed` virker.
- **Resultat:** Sprites, der bevæger sig, styret af systemer

### Fase 2 — Editor-skal
- [x] Editor-layout med paneler (Solid.js), som kan ændres i størrelse
- [x] `ProjectFS`: File System Access (mappe på disken), OPFS (browser-projekter) og import/eksport som .zip
- [ ] `ProjectFS` til Tauri flyttes til fase 5 sammen med desktop-appen
- [x] Hierarchy med træk-og-slip, omdøbning og højreklik-menu
- [x] Inspector, der genereres automatisk ud fra skemaer og felt-metadata
- [x] 2D scene view med pan/zoom, grid, snap, selektion og gizmos (flyt, rotér, skalér)
- [x] Gem og indlæs scene (JSON med stabile scene-id'er)
- [x] Undo/redo for alle ændringer i scenen
- [x] Asset browser (billeder), hvor en texture kan foldes ud og vise sine sprites
- [x] Texture-import med `.meta.json` og grid-slicing i inspectoren
- [ ] Dockbare paneler (træk paneler rundt) er udskudt. Layoutet er fast, men kan ændres i størrelse.
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
- [ ] Linjenumre i runtime-fejl (stack traces gennem source maps) er udskudt. Kompileringsfejl har linjenumre.
- [ ] `entity`-felter med `@expose` er udskudt. (Entity-felter på komponenter fik en vælger i fase 4a.)
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

**4b (næste)**
- [ ] Sprite-editor: auto- og manuel slicing, pivot og 9-slice
- [ ] Animations-tidslinje med træk-og-slip og onion skin
- [ ] `TileMap` og tilemap-maler (med automatiske colliders)
- [ ] UI: `UICanvas`, `UIRect`, `UIImage`, `UIText` og `UIButton`
- [ ] `ParticleEmitter2D`
- [ ] Et lille eksempelspil (platformer), der bruger det hele

**Kendte begrænsninger i 4a**
- `CharacterController2D` ignorerer dynamiske kroppe i sine forespørgsler og skubber dem i stedet væk. Den kan derfor endnu ikke stå på løse kasser.
- Prefab-instanser gemmer deres egen fulde kopi. "Anvend" og "Gendan" virker på hele instansen, og kun placeringen (position, rotation, skala) bevares som en instans-ændring. Ændringer pr. felt spores ikke endnu, og det samme gælder nested prefab-overrides.
- `Text2D` bruger canvas-tekst i stedet for MSDF. Den er skarp ved normal zoom, men bliver blød, hvis man zoomer meget ind.
- `Shape2D` har ikke polygon og linje endnu, og `Joint2D` mangler.
- `CameraFollow2D` holder kameraets centrum inden for `bounds`, men tager ikke højde for, hvor stor visningen er.
- **Resultat (4a+4b):** Et rigtigt 2D-spil, fx en platformer med UI og lyd

### Fase 5 — Udgivelse
- [ ] Build/eksport til statisk web og zip til itch.io
- [ ] Tauri-desktop-app
- [ ] Atlas-pakker (MaxRects i en Web Worker) og atlas-visning i editoren
- [ ] Importers til Aseprite, TexturePacker og Tiled
- [ ] Eksempelspil: 2D platformer og top-down shooter
- [ ] Dokumentation og "kom i gang"-guide
- **Resultat:** Version 1.0, en 2D-engine, man kan shippe spil med

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
