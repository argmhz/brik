# Roadmap

Her står, hvad Brik kan i dag, hvad der arbejdes på, og hvad der kommer. Siden opdateres, hver gang en større del er færdig eller planen ændres. Den detaljerede arbejdsplan med alle delopgaver ligger i `PLAN.md` i repoet.

**Sidst opdateret:** 7. november 2026

## Færdigt: 2D

Brik er i dag en komplet 2D-engine med editor, scripting og udgivelse.

| Område | Hvad der er på plads |
|---|---|
| Kerne | ECS, scener og prefabs (med overrides pr. instans), tweens og timere |
| Grafik | WebGL2-rendering, sprites, sprite sheets og atlasser, animationer, partikler, tekst og former, kamera med grænser |
| Editor | Hierarki, scene view med gizmos, inspector, kode-editor, sprite-editor, animations-tidslinje, flytbare paneler, fortryd, autosave og gendannelse |
| Tilemaps | Maling i scene view, auto-tiling med terræner, import fra Tiled (`.tmj`, `.tmx`) |
| Scripting | TypeScript med hot reload, hooks, `@expose`, egne komponenter og systemer |
| Fysik | Rapier 2D: kroppe, colliders, triggers, figurstyring, led og opslag |
| UI | Knapper, tekst, billeder, slider, toggle, tekstfelt og kolonner |
| Lyd | Lydkilder, kanaler og rumlig lyd |
| Udgivelse | Eksport til `.zip` eller mappe, offline og installerbar som app (PWA) |
| AI | MCP-server, så en AI-klient kan bygge og teste spil i editoren eller uden den (headless) |
| Desktop | Tauri-app med adgang til filsystemet |
| Dokumentation | Denne manual, guiderne og roadmappet |

## Næste: 3D (fase 6)

Når manualen er på plads, går arbejdet i gang med 3D. Alle 2D-funktioner bliver ved med at virke.

- [ ] 3D-matematik, `Transform3D`, `Camera3D` og `MeshRenderer`
- [ ] PBR, lys, skygger og post-processing
- [ ] glTF-import og skeletal animation
- [ ] Rapier 3D
- [ ] 3D scene view og gizmos

## Senere (fase 7 og frem)

Det, der skal gøre Brik anderledes. Rækkefølgen er ikke fastlagt.

- [ ] **Time-travel debugging:** spol tilbage og undersøg præcis den frame, hvor en fejl opstod
- [ ] **Visuel scripting**, der kompilerer til læsbar TypeScript
- [ ] **WebGPU-backend**
- [ ] **Multiplayer og rollback-netcode**

## Små ting på listen

- Hørbar lyd kan ikke kontrolleres gennem MCP (kun antal afspilninger og om WebAudio findes).
- Knappen "installér som app" i et eksporteret spil og service worker på itch.io er endnu ikke afprøvet i en rigtig browser.
- Knappen **Hjælp** i desktop-appen er ikke afprøvet.

## Uden for Brik

Disse ting er ikke planlagt: cloud-sync og samarbejde i realtid, native builds til konsol og mobil, en egen fysik-engine (Brik bruger Rapier) og en AI-chat inde i editoren (brug i stedet en ekstern AI-klient over MCP).

## Sådan holdes siden opdateret

Roadmappet skrives i `docs/ROADMAP.md`. Når en fase eller en større del er færdig, flyttes den fra "Næste" til "Færdigt", og datoen øverst rettes. `PLAN.md` har de små skridt; roadmappet har overblikket.
