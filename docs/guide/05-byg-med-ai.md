# Byg med en AI-klient

Brik har en MCP-server, så en AI-klient som Claude Code kan bygge og teste i den åbne editor, mens du følger med.

## 1. Forbind

1. Åbn projektet i editoren, og klik **AI** i menulinjen. Prikken bliver gul.
2. Start din AI-klient i Brik-mappen. Med Claude Code er `.mcp.json` sat op; godkend serveren "brik". Prikken bliver grøn.

Andre klienter og detaljer: [AI og MCP](../manual/ai-og-mcp.md).

## 2. Bed om noget konkret

Fx: "Lav en lille bane med en figur, der kan hoppe, og tre mønter." AI'en kigger på scenen, laver entities, skriver scripts, trykker Play og tager skærmbilleder for at se, om det virker.

## 3. Følg med og ret

Alt, hvad AI'en gør, vises med det samme og står i Console. Du kan fortryde med **Ctrl+Z**.

> **Pas på** Scenen gemmes kun, når AI'en kalder `save_scene`, eller når du selv trykker Ctrl+S.

## Uden editoren

AI'en kan også arbejde uden editoren med `open_project`, fx `open_project({ path: "examples/mosehop" })`. Skærmbilleder er ikke med.
