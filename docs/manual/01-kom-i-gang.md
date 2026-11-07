# Kom i gang

Brik er en 2D game engine til web. Du bygger scener i editoren, skriver gameplay i TypeScript og eksporterer spillet som en statisk mappe.

## Start editoren

```bash
make editor        # http://localhost:5180
```

`make` alene viser alle genveje. Uden make: `corepack pnpm install` og derefter `corepack pnpm editor`.

## Vælg et projekt

- **Mappe på din computer** (Chrome/Edge, eller desktop-appen): projektet er en almindelig mappe, så du kan bruge git og VS Code ved siden af.
- **Browser-projekt**: gemmes i browseren. Kan eksporteres og importeres som `.zip`.

## Skabeloner

Når du opretter et nyt projekt, kan du vælge en skabelon:

| Skabelon | Hvad du får |
|---|---|
| Tomt projekt | Et sprite sheet og et eksempel-script |
| Platformer-eksempel | En tilemap-bane, en figur med animationer og lyd, mønter (prefab), partikler og UI |
| Top-down shooter-eksempel | En arena, skud mod musen, fjender fra spawnere, point, liv og genstart |

Eksemplerne er almindelige projektfiler, så du kan læse og rette alt.

> **Tip** Vil du have en gennemgået start, så følg [Dit første spil](../guide/foerste-spil.md).

## Projektets filer

| Fil eller mappe | Indhold |
|---|---|
| `brik.project.json` | Projektets indstillinger, fx fysik (tyngdekraft og skala) |
| `scenes/` | Scener |
| `scripts/` | Dine TypeScript-scripts |
| `assets/` | Billeder, lyde og animationer (`.anim.json`) |
| `prefabs/` | Prefabs (`.prefab.json`) |
| `icon.png` | Valgfrit ikon til det eksporterede spil |
| `CLAUDE.md` | Forklaring af projektet til en AI-klient (se [AI og MCP](ai-og-mcp.md)) |

Næste skridt: [Editoren](editoren.md).
