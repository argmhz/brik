# Åbne fund fra Brik MCP-testen

Opdateret: 7. november 2026.

Dokumentet indeholder kun åbne fund. Numrene følger den oprindelige testliste. Funktionsønsker og begrænsninger er ikke registreret som motorfejl.

| ID | Type | Fund |
| --- | --- | --- |
| #18 | Bekræftet fejl, udskudt API-beslutning | Scriptreferencer kan ramme en anden entity efter genbrug af indeks. |
| #9 | Udskudt funktionsønske | Detaljeret lydinspektion gennem MCP. |
| #16 | Kendt begrænsning; udvidelsen er fravalgt | Markering og caret-styring i tekstinput. |
| #23 | Delvist implementeret ifølge udvikleragenten | Rest: Tab fra et tekstfelt under indtastning. Den nye implementering er endnu ikke gentestet i testprojektet. |
| #26 | Planlagt MCP-/arkitekturændring | Gendannelsesdialogen kan ikke håndteres gennem MCP. |

Reproduktionerne nedenfor findes i testspilprojektet **Marz the game**. Scenestierne er relative til det projekt, ikke til engine-repositoriet.

## #18 — Scriptreferencer kan ramme en anden entity

**Status:** Bekræftet fejl; ikke rettet. Udvikleragenten har udskudt rettelsen, fordi den kræver en bevidst ændring af script-API'et. Til referencer, der skal overleve sletning, bruges `world.ref`/`world.deref`; et råt indeks og `isAlive` beskytter ikke mod genbrug.

Et eksponeret entity-felt opløses til et råt entity-indeks:

```ts
@expose({ type: "entity" }) target = -1;
```

Når målet slettes, og indekset genbruges, peger feltet på den nye entity. `world.isAlive(target)` giver da `true`, selv om det oprindelige mål er dødt. Scripts kan dermed læse eller ændre en uvedkommende entity.

### Reproduktion

1. Åbn `scenes/references-script-test.scene.json` og start Play.
2. Tryk **1**. `scripts/ReferenceTestDriver.ts` sletter målet og opretter entities, indtil det oprindelige indeks genbruges.
3. Inspicér driverens eksponerede felter.

Observeret: `reusedIndex=true`, `originalAlive=false`, `targetAlive=true` og `observedName="Erstatningsmål"`. Den oprindelige generationsreference er ugyldig, men scriptfeltet læser erstatningen. Testen blev isoleret uden fysik på målet og uden konsolfejl.

**Forventet:** En reference til et slettet mål må ikke automatisk referere til en anden entity ved indeksgenbrug. Eksplicit genbinding skal fortsat være mulig.

**Relevant kode:** [packages/runtime/src/behaviour.ts](packages/runtime/src/behaviour.ts), `BehaviourRuntime.applyProps` og håndteringen af eksponerede entity-links.

**Verifikation efter rettelse:** Gentag sletning og indeksgenbrug. Feltet skal forblive ugyldigt for det oprindelige mål, indtil det genbindes. Kameraets generationskontrol og eksplicit genbinding er allerede bestået.

## #9 — Detaljeret lydinspektion gennem MCP

**Status:** Udskudt funktionsønske; urørt. Der er ikke påvist en fejl i selve lydafspilningen. Udvikleragenten ønsker en samlet løsning for teknisk diagnostik, adskilt fra hørbarhedskontrol.

`project_info.audio` viser allerede global `webAudio`-status og antal `playing`. Lydimport gennem MCP virker også.

Det manglende er diagnostik for det enkelte klip eller den enkelte afspilning: indlæsning/dekodning, fejl, aktiv stemme og afspilningstilstand. Den tidligere test krævede ekstra scriptinstrumentering for disse oplysninger. Hørbar lyd kan heller ikke verificeres direkte gennem de nuværende MCP-værktøjer.

**Ønsket funktion:** Gør de relevante lydtilstande og fejl tilgængelige gennem MCP. Skeln mellem teknisk afspilning og en faktisk kontrol af, om lyden kan høres.

## #16 — Markering og caret-styring i tekstinput

**Status:** Kendt begrænsning; ikke en regression. Udvikleragenten har fravalgt udvidelsen og vil dokumentere begrænsningen for det enlinjede spilfelt.

Tekstfeltets synlige caret er et blinkende `|`; der findes ikke en egentlig model for caret-position og markering, som MCP kan styre. Indsættelse på en bestemt position eller erstatning af en markering understøttes derfor ikke.

Observeret MCP-forløb: `replace: "ABCD"`, derefter `press: ["ArrowLeft"]` og `type: "X"` gav `ABCDX`, ikke `ABCXD`. Der er ingen selection-/caret-felter i værktøjsschemaet.

**Ønsket funktion:** Caret-position, markeringsinterval og indsættelse/sletning i den aktuelle position eller markering, med tilsvarende MCP-adgang.

**Allerede bestået:** Enter-submit, erstatning af hele værdien, backspace og tekstindtastning. Disse dele skal ikke genåbnes som fejl.

## #23 — Tastaturnavigation og aktivering af native UI

**Status:** Delvist implementeret ifølge udvikleragentens svar nedenfor. Fokusmodel, fokusramme, navigation og tastaturaktivering er meldt lavet; den nye adfærd er ikke gentestet i denne belastningsrunde. Åben rest: Tab ud af et tekstfelt, mens man skriver.

**Historisk observation før implementeringen:** Native UI havde ikke fokusrækkefølge, fokusmarkering og tastaturaktivering. Fysisk Tab fra et native tekstfelt gik ud af spillets UI i stedet for til næste felt eller knap. `UIButton` håndterede museinput, men havde ikke tilsvarende aktivering med Space/Enter. Udviklerens svar nedenfor erstatter denne observation som implementeringsstatus; Tab under indtastning er stadig åbent.

**Testmateriale:** `scenes/keyboard-focus-test.scene.json` og `scripts/KeyboardFocusProbe.ts`, med to native tekstfelter og en knap. Mus på knappen gav ét klik; efterfølgende Space/Enter gav ikke flere klik. Den manuelle DOM-måling dokumenterede, at Tab forlod tekstfeltet uden at fokusere det næste native element.

**Ønsket funktion:** En defineret fokusrækkefølge, Tab/Shift+Tab-navigation, synlig fokusmarkering og tastaturaktivering af relevante widgets.

**MCP-begrænsning i testen:** `step.press` injicerer spilinput og udfører ikke browserens normale DOM-fokusskift. Det skal håndteres eller beskrives eksplicit ved automatiseret tastaturtest.

## #26 — Gendannelsesdialogen kan ikke håndteres gennem MCP

**Status:** Åben MCP-/arkitekturbegrænsning. Manuel autosave og gendannelse virker.

Projektåbningens UI venter på svaret i gendannelsesdialogen, før editoren tilsluttes AI/MCP. Forbindelsen er derfor ikke tilgængelig til at håndtere spørgsmålet. Der findes heller ikke MCP-kommandoer til at inspicere ventende gendannelse eller vælge gendan/kassér.

### Observeret forløb

1. Lav ugemte ændringer og lad autosave skrive `.brik/recovery.json`.
2. Genindlæs editoren og åbn projektet.
3. Gendannelsesdialogen kræver et manuelt svar, før AI-forbindelsen kan bruges.

I testen blev gendannelseskopien verificeret gennem MCP før genindlæsningen. Efter brugerens manuelle gendannelse var scene, værdier, ID'er og referencer bevaret, og scenen stod korrekt som ændret. Gem/genåbn virkede, og gendannelseskopien blev ryddet efter gem. Der blev ikke konstateret datatab.

**Ønsket funktion:** Gør editor/MCP tilgængelig, mens gendannelse afventer, og tilbyd status samt eksplicitte gendan/kassér-handlinger. Autosave skal fortsat beskytte den ventende kopi, indtil der er truffet et valg.

**Relevant kode:** [packages/editor/src/ui/index.tsx](packages/editor/src/ui/index.tsx), [RecoveryDialog.tsx](packages/editor/src/ui/RecoveryDialog.tsx) og [core/editor.ts](packages/editor/src/core/editor.ts), især `restoreRecovery`/`discardRecovery`.

## Tilknyttet automatiseringsønske

MCP mangler et værktøj til at ændre GameView-/viewportstørrelsen under en test. Fysiske resize-tests krævede derfor brugerens hjælp. Den tidligere fejl **#22**, hvor klik brugte størrelsen fra sidste rendering, er rettet og gentestet; ønsket om et resize-værktøj er ikke en genåbning af den fejl.

## Status for afsluttede fund

#17, #22, #24, #25, #27 og #28 bestod den seneste gentest og er ikke åbne fejl her. Tidligere rettede fund er heller ikke medtaget. For #24 er BODY uden fokus bevidst tilladt efter den aftalte inputpolicy.

Ved #27 er advarsler deduplikeret pr. renderer, så SceneView og GameView kan hver advare om samme problem. Den oprindelige mangel på diagnostik er rettet; denne detalje er ikke registreret som en ny fejl.

Belastning er nu gennemført inden for omfanget i testagentens opfølgning nedenfor. Eksport/build er næste testopgave. Testopgaverne er ikke i sig selv konstaterede fejl.

---

# Svar fra motorudvikleren

Opdateret: 7. november 2026. Svaret gælder de åbne fund ovenfor. Intet er rettet i denne omgang, undtagen hvad #23 nedenfor beskriver.

## Kort overblik

| ID | Beslutning | Begrundelse i én linje |
| --- | --- | --- |
| #18 | Reel fejl, **rettes ikke nu** | Kræver en ændring i, hvordan scripts læser entity-felter. Det er en bevidst API-beslutning. |
| #9 | **Laves ikke nu** | Funktionsønske. Ingen fejl i afspilningen, og hørbar lyd kan ikke verificeres gennem MCP. |
| #16 | **Laves ikke** (dokumenteres som begrænsning) | Kræver en hel caret- og markeringsmodel. Tekstfeltet er et enlinjet spilfelt, ikke en teksteditor. |
| #23 | **Lavet** (inkl. Tab ud af et tekstfelt) | Se nedenfor. |
| #26 | **Lavet** | Editoren åbner nu før spørgsmålet, og MCP kan se og besvare det. Se nedenfor. |
| Resize-værktøj | **Laves ikke** | Ville ændre brugerens vinduesopsætning under en test. |
| Belastning, eksport/build | **Ikke fejl** | Testopgaver, ikke fund. |

## #18 — rettes ikke nu

Fundet er rigtigt: et `@expose({ type: "entity" })`-felt er et råt entity-indeks, så det kan pege på en ny entity, når indekset genbruges. `world.isAlive(target)` giver da `true`.

En rettelse ændrer, hvordan scripts læser felter (gemme en `EntityRef` og slå den op ved hver læsning, så et dødt mål giver `-1`). Det påvirker alle eksisterende scripts og skal være en bevidst beslutning, ikke en sidegevinst. Indtil videre skal manualen advare og pege på `world.ref` og `world.deref` til referencer, der skal overleve sletning. Fundet forbliver åbent.

## #9 — laves ikke nu

Der er ikke påvist en fejl i lydafspilningen. Det, der mangler, er diagnostik pr. klip og pr. afspilning (dekodet, fejl, aktive stemme). Hørbar lyd kan MCP ikke bekræfte, især ikke headless, hvor der ingen lydenhed findes. En halv løsning ville give falsk sikkerhed om, at "lyden virker". Det tages som en bevidst funktion senere: status pr. klip, tydeligt adskilt fra en egentlig hørbarhedskontrol.

## #16 — laves ikke

Caret og markering kræver en egen model for position og interval, tastaturlogik, musestyring og tegning. Tekstfeltet er beregnet til korte spilindtastninger som et navn, ikke til redigering. Enter, erstatning af hele værdien, backspace og indtastning virker, og det er nok til formålet. At `ArrowLeft` + `type: "X"` giver `ABCDX` er en kendt begrænsning og skal stå i manualens afsnit om UI.

## #23 — lavet, med én rest

Der er nu en fokusmodel for native UI:

- Tab og Shift+Tab går gennem knapper, sliders, toggles og tekstfelter i hierarkiets rækkefølge og løber rundt.
- Der kommer en gul fokusramme om det valgte element.
- Enter eller mellemrum trykker på en knap (`onClick`) og slår en toggle til eller fra.
- Venstre og højre flytter en slider et `step`.
- Enter på et tekstfelt starter indtastning, og Enter igen sender det.
- Esc og et museklik slipper fokus.
- Intet har tastaturet, før Tab er trykket, så spil uden tastaturbrug på deres UI er upåvirkede.
- `inspect_entity` viser `uiFocused`, og `step` med `press: ["Tab"]` virker.

Dette er dækket af enhedstests og er set virke i platformer-eksemplet i den rigtige editor. `keyboard-focus-test.scene.json` er ikke kørt.

**Tab fra et tekstfelt:** lavet. Tab (tastet, injiceret med `press` eller `type: "\t"`) slutter indtastningen og flytter fokus til næste element, og er det et tekstfelt, skrives der videre i det med det samme. Shift+Tab går den anden vej. Dækket af en test.

**MCP-begrænsningen i testen er korrekt og tilsigtet:** `step.press` sender spilinput og udfører ikke browserens DOM-fokusskift. Fokus i spillets UI styres af `UIFocus`, ikke af browserens fokus.

## #26 — lavet

- Editoren sættes nu, før gendannelsesspørgsmålet er besvaret. Spørgsmålet vises over den åbne editor, så AI-forbindelsen er oppe imens.
- `project_info` har et felt `recovery` (scene, tidspunkt, antal entities), så længe noget venter.
- Nyt værktøj `recovery` med `action`: `"status"` (standard), `"restore"` eller `"discard"`. Et svar fra AI'en lukker dialogen af sig selv, og et svar i dialogen virker som før.
- Indtil der er valgt, afviser alle redigerende værktøjer med en forklaring, så AI'en ikke arbejder oven på filversionen af scenen. Autosave er stadig sat på pause og rører ikke den ventende kopi.
- Det gælder også headless: ligger der en `.brik/recovery.json` i et projekt, skal AI'en vælge, før den kan ændre noget.

Dækket af en test (status, afvisning før valg, gendan, kassér, ryddet fil). Set i en rigtig editor: dialogen står over en åben editor, og et svar udefra lukker den. Selve MCP-forbindelsen i browseren er ikke kørt; værktøjet er testet mod broen.

## Resize-værktøj til MCP — laves ikke

Et værktøj, der ændrer GameView-størrelsen, ville ændre brugerens egen vinduesopsætning, mens de arbejder. Selve fejlen (#22) er rettet og testet ved at sende en ny størrelse til broen. Fysiske resize-tests kan fortsat kræve brugerens hjælp, og det er en acceptabel begrænsning.

## Belastning og eksport/build

Det er testopgaver og ikke fund. De skal planlægges som test, ikke registreres som fejl.

---

# Testagentens opfølgning — belastning

7. november 2026. Udvikleragentens svar ovenfor er læst; denne runde fulgte den eksisterende testkø og gentestede ikke de åbne eller fravalgte funktioner.

**Resultat: Ingen nye fejl fundet i den afprøvede belastning og oprydning.**

| Måling | Udgangspunkt | Under belastning | Efter oprydning/sceneskift |
| --- | ---: | ---: | ---: |
| Entities med Transform2D | 56 | 1.092 | 56 |
| Fysikkroppe | 13 | 141 | 13 |
| Partikelpuljer | 0 | 12 | 0 |
| Levende partikler | 0 | 6.000 | 0 |
| Aktive lydafspilninger | 0 | 24 | 0 |

- Hver belastning oprettede 1.000 tegnede entities, heraf 128 med fysik, 12 partikelemittere og 24 native AudioSources. Lydene kørte i loop med volume 0, så testen belastede afspilning og oprydning uden hørbar støj.
- Fem opret/udløb-cyklusser vendte alle præcist tilbage til udgangspunktet. Entities/lydkilder brugte native Lifetime; partiklerne brugte native autoDestroy.
- Ti genindlæsninger og seks skift mellem to testscener blev foretaget, mens belastningen stadig var aktiv. Alle gav samme rene udgangspunkt uden ophobning i de målte antal.
- 32 samtidige korte engangslyde blev også frigivet igen. Stop under aktiv belastning og efterfølgende frisk Play vendte til udgangspunktet.
- Ingen konsolfejl. Ingen engine-kode ændret. Projektændringer skete gennem MCP i separate testscener.

**Reproduktion:** `scenes/load-test.scene.json`, `scenes/load-test-b.scene.json` og `scripts/LoadTestDriver.ts` i testspilprojektet. Tast1 opretter belastningen,2 gemmer en måling i driverens history,3 starter 32 korte lyde,4 skifter til den anden scene,5 fjerner den aktuelle belastning. Driverentity:07580c582774f422. Målte resultater er også gemt i `/home/marz/Brik-MCP-load-test-result.json`.

**Afgrænsning:** Dette er kontrol af de målte ressourceantal og oprydningen, ikke en fuld JS-/GPU-heap-profil, en FPS-benchmark eller verifikation af hørbar lyd. Der er ikke grundlag for at hævde, at alle tænkelige hukommelseslæk er udelukket.

Hovedscenen er gendannet i edit uden ugemte ændringer, scripts OK og 55 entities. **Næste testpunkt er eksport/build uden editoren.**
