# AI og MCP

Brik har en MCP-server (`packages/mcp`), så en AI-klient kan arbejde direkte i den åbne editor. AI'en kan:

- se scenen, komponenternes felter og projektets assets,
- oprette og ændre entities, komponenter, prefabs og scener,
- skrive scripts (den får kompileringsfejl tilbage med det samme) og sætte dem på,
- importere billeder og lyde fra computeren (`import_asset`), opdele et sprite sheet i et grid (`slice_texture`) og omdøbe sprites og sætte pivots (`edit_sprites`),
- tegne pixel art (`draw_sprites`: hvert tegn er en pixel, slået op i en palet), lave animationer af den og male tilemaps ud fra tekst (`paint_tiles`, `read_tiles`),
- trykke Play, gå frem et antal frames med taster holdt nede (fx `ArrowRight` og `Space`), med en anden billedrate (`fps`, fx 30 eller 144), flytte musen (også til et sted på et UI-element, fx 80 % henad en slider), klikke på UI-knapper eller steder i verden (`click`), skrive i og redigere tekstfelter, læse konsollen og tage skærmbilleder af Scene- og Spil-visningen.

Eksempelspillet `examples/mosehop` (åbn mappen i editoren) er bygget på denne måde: grafik, bane, prefabs, scripts og test er lavet gennem MCP-værktøjerne.

Hver ændring vises med det samme og kan fortrydes med Ctrl+Z. Det, AI'en gør, står også i Console. Scenen gemmes kun, når AI'en kalder `save_scene`.

## Sådan forbinder du

1. Åbn projektet i editoren og klik **AI** i menulinjen.
   - Grå prik: AI er slået fra.
   - Gul prik: editoren venter på MCP-serveren.
   - Grøn prik: AI er forbundet.
2. Start MCP-serveren fra din AI-klient:
   - **Claude Code** i dette repo: `.mcp.json` er allerede sat op. Godkend serveren "brik", første gang Claude Code spørger.
   - **Andre klienter** (fx Claude Desktop): tilføj en MCP-server med kommandoen `node` og argumentet `/sti/til/brik/packages/mcp/src/server.mjs`.

Server og editor finder hinanden på `ws://127.0.0.1:5181`. Porten kan ændres med miljøvariablen `BRIK_MCP_PORT`, men editoren bruger altid 5181. Kun editoren selv (localhost eller desktop-appen) må forbinde, ikke andre hjemmesider. Er AI'en forbundet, men skal ikke længere arbejde, så klik **AI** igen.

Nye projekter får en `CLAUDE.md`, som forklarer projektets filer og Brik-API'et. Så kan en AI-klient også skrive scripts uden MCP-serveren.

## Uden editoren (headless)

Kører editoren ikke, kan AI'en selv åbne en projektmappe med `open_project` (fx `open_project({ path: "examples/mosehop" })`). Projektet åbnes så inde i MCP-serveren, uden browser. Alle værktøjer virker som i editoren, undtagen skærmbilleder: AI'en kan bygge scener, skrive scripts, spille og gå frem frame for frame, og `save_scene` skriver til mappen. `close_project` lukker igen, og den nægter, hvis der er ændringer, der ikke er gemt.

> **Pas på** Har du projektet åbent i editoren samtidig, så luk det først, ellers arbejder I i hver sin kopi.

## Flere AI-sessioner

Kun én MCP-server kan have editoren ad gangen. Starter du en ny (fx i en ny Claude Code-session), beder den den gamle om at slippe porten, og editoren kobler selv over til den nye. Den gamle server melder så til sin AI, at en nyere har overtaget, og hvordan den kommer tilbage (genstart den, eller brug `open_project`).

Til fejlsøgning kan serveren startes alene med `make mcp`. Den venter så på editoren og skriver i terminalen, når den forbinder.
