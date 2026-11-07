# Byg og udgiv

Tryk **Byg spil** i menulinjen.

- Billeder pakkes i atlasser. Du kan se siderne, hvor fyldte de er, og eventuelle advarsler.
- **Eksportér .zip** giver en fil, der kan uploades direkte på **itch.io**. Opret et "HTML"-projekt og vælg "This file will be played in the browser".
- **Eksportér til mappe** skriver filerne, så de kan lægges på GitHub Pages, Netlify eller en anden webserver.

> **Pas på** Spillet skal åbnes over http. Det virker ikke, hvis man dobbeltklikker `index.html`. Til en hurtig lokal test kan du køre `npx serve` i mappen.

## Offline og installér

Slået til som standard. Det lægger en service worker, et web-manifest og ikoner i spillet. Efter første besøg starter spillet uden forbindelse, og browseren kan tilbyde at installere det som en app.

- Læg en `icon.png` (kvadratisk, mindst 192 px) i projektets rod for at bruge dit eget ikon; ellers laves et enkelt.
- Udgiver du en ny version, hentes den i baggrunden og overtager ved næste besøg.
- Det virker over http og https, men ikke fra `file://`.

## Kun i editoren

Entities med komponenten `EditorOnly` kommer ikke med i det færdige spil.

Se [Guide: udgiv på itch.io](../guide/udgiv-paa-itch.md).
