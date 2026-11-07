# Roadmap

Her står, hvad Brik kan i dag, hvad der arbejdes på, og hvad der kommer. Siden opdateres, hver gang en større del er færdig eller planen ændres. Den detaljerede arbejdsplan med alle delopgaver ligger i `PLAN.md` i repoet.

**Sidst opdateret:** 7. november 2026

## Færdigt: 2D

Brik er i dag en komplet 2D-engine med editor, scripting og udgivelse.

| Område | Hvad der er på plads |
|---|---|
| Kerne | ECS, scener og prefabs (med overrides pr. instans), scene-skift med fade og data, tweens og timere |
| Grafik | WebGL2-rendering, sprites, sprite sheets og atlasser, animationer, partikler, tekst og former, kamera med grænser, 2D-lys med farve (punktlys og kegler), skærmryst, zoom-stød, hit-stop og slowmotion |
| Editor | Hierarki, scene view med gizmos, inspector, kode-editor, sprite-editor, animations-tidslinje, flytbare paneler, fortryd, autosave og gendannelse |
| Tilemaps | Maling i scene view, auto-tiling med terræner, import fra Tiled (`.tmj`, `.tmx`) |
| Scripting | TypeScript med hot reload, hooks, `@expose`, egne komponenter og systemer |
| Fysik | Rapier 2D: kroppe, colliders, triggers, figurstyring, led og opslag |
| UI | Knapper, tekst, billeder, slider, toggle, tekstfelt og kolonner, med tastaturstyring (Tab, Enter, piletaster) og synlig fokusramme |
| Lyd | Lydkilder, kanaler og rumlig lyd |
| Udgivelse | Eksport til `.zip` eller mappe, offline og installerbar som app (PWA) |
| AI | MCP-server, så en AI-klient kan bygge og teste spil i editoren eller uden den (headless), med undo/redo og styring af gendannelse af ugemte ændringer |
| Desktop | Tauri-app med adgang til filsystemet |
| Dokumentation | Denne manual, guiderne og roadmappet |

## Næste: det, et færdigt spil mangler

Før 3D skal 2D kunne bære et spil, man sender til andre. Listen er fundet ved at gennemgå motoren for ting, et rigtigt spil hurtigt støder på. Rækkefølgen er vores forslag.

**Først, fordi spillere mærker det med det samme**

- [ ] **Gem og indlæs spil:** et `Save`-API til point, bane og inventar, oven på `localStorage` i browseren og filer i desktop-appen
- [ ] **Gamepad:** støtte i `Input`, så action-mapping kan binde knapper og akser
- [ ] **Touch og mobil:** virtuelle knapper og joystick, så et eksporteret spil kan spilles på en telefon

**Giver spil et bedre udseende**

- [ ] **Post-processing og egne materialer:** fuldskærmseffekter på kameraet (bloom, CRT, farvekorrektion) og et eget materiale pr. sprite (fx hvid blink ved skade). `Lighting2D` viser, at pipelinen kan det
- [ ] **Bitmap-fonte** til pixel-art-tekst
- [ ] **Lydmixer** med master- og musikvolumen, så et spil kan have en indstillingsmenu

**Gør det lettere at bygge spil**

- [ ] **Pathfinding** (A* på tilemaps) til fjendens AI
- [ ] **Profiler** med frame-tid, draw calls og antal entities, så man kan finde ud af, hvorfor et spil hakker
- [ ] **Lokalisering:** tekst på flere sprog
- [ ] **Fuldskærm og skalering** ved udgivelse, med en klar aftale om pixel-perfekt skalering af selve spillet
- [ ] **Tilgængelighed:** omkonfigurering af taster og hensyn til "reducer bevægelse" (skærmryst og blink bør kunne slås fra)

Isometriske og sekskantede tilemaps er fravalgt indtil videre.

## Derefter: 3D (fase 6)

Når listen ovenfor er klaret, går arbejdet i gang med 3D. Alle 2D-funktioner bliver ved med at virke.

- [ ] 3D-matematik, `Transform3D`, `Camera3D` og `MeshRenderer`
- [ ] PBR, lys, skygger og post-processing
- [ ] glTF-import og skeletal animation
- [ ] Rapier 3D
- [ ] 3D scene view og gizmos

## Senere (fase 7 og frem)

Det, der skal gøre Brik anderledes. Rækkefølgen er ikke fastlagt.

- [ ] **Skygger og normal maps til 2D-lys:** lys og mørke er lavet (`Lighting2D` og `Light2D`), men lyset går endnu igennem vægge, og alle sprites lyses ens op
- [ ] **Time-travel debugging:** spol tilbage og undersøg præcis den frame, hvor en fejl opstod
- [ ] **Visuel scripting**, der kompilerer til læsbar TypeScript
- [ ] **WebGPU-backend**
- [ ] **Multiplayer og rollback-netcode**

## Kendte fejl og mangler

- **Entity-felter i scripts er rå indekser.** Et `@expose({ type: "entity" })`-felt kan pege på en ny entity, når et indeks genbruges efter en sletning. Manualen forklarer, hvordan man bruger `world.ref` og `world.deref`. En egentlig rettelse ændrer script-API'et og er endnu ikke besluttet.
- Detaljeret lydinspektion gennem MCP (status pr. klip og pr. afspilning). Hørbar lyd kan ikke kontrolleres automatisk.
- Tekstfelter har ingen caret-styring eller markering (tekst skrives altid til sidst). Er fravalgt.
- Rapier skriver ved opstart advarslen "using deprecated parameters for the initialization function". Fysikken virker; årsagen er ikke undersøgt.

## Ikke afprøvet endnu

- Knappen "installér som app" i et eksporteret spil, og at et spil kører rigtigt på itch.io (selve offline-funktionen er afprøvet lokalt i en rigtig browser).
- Knappen **Hjælp** i desktop-appen.
- Tastatur-UI med fysiske tastetryk (Enter og mellemrum på en knap) i selve editoren.
- Et helt førstegangsforløb gennem guiderne i editorens egen brugerflade.
- Billederne i dokumentationen er taget i en headless Chromium (`make docs-screenshots`) og skal tages om, når editorens udseende ændres.

## Uden for Brik

Disse ting er ikke planlagt: cloud-sync og samarbejde i realtid, native builds til konsol og mobil, en egen fysik-engine (Brik bruger Rapier) og en AI-chat inde i editoren (brug i stedet en ekstern AI-klient over MCP).

## Sådan holdes siden opdateret

Roadmappet skrives i `docs/ROADMAP.md`. Fejl, der er fundet gennem test, står i `BUGS.md` i repoets rod. Når en fase eller en større del er færdig, flyttes den fra "Næste" til "Færdigt", og datoen øverst rettes. `PLAN.md` har de små skridt; roadmappet har overblikket.
