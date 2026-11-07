# Åbne fund fra Brik MCP-testen

Opdateret: 7. november 2026.

Dokumentet indeholder kun åbne fund. Numrene følger den oprindelige testliste. Funktionsønsker og begrænsninger er ikke registreret som motorfejl.

| ID | Type | Fund |
| --- | --- | --- |
| #29 | Bekræftet dokumentationsfejl | Søgning finder ikke dokumenterede identifikatorer med underscore, fx paint_tiles. |
| #18 | Bekræftet fejl, udskudt API-beslutning | Scriptreferencer kan ramme en anden entity efter genbrug af indeks. |
| #9 | Udskudt funktionsønske | Detaljeret lydinspektion gennem MCP. |
| #16 | Kendt begrænsning; udvidelsen er fravalgt | Markering og caret-styring i tekstinput. |
| #23 | Implementeret; MCP-gentest bestået | Tab/Shift+Tab under indtastning og Enter/Space består via MCP. Fysisk browsertest afventer. |
| #26 | Rettet; browser-MCP-gendannelse bestået | Status, blokering af redigering og Gendan virker gennem den rigtige browserforbindelse. Kassér-grenen er ikke browser-gentestet. |

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

**Aktuel status:** Implementeret og gentestet gennem native MCP: Tab fra A til B under indtastning, Shift+Tab tilbage, videre til knappen samt Enter og Space består. Feltværdier bevares, og knappen modtager præcis to klik. Fysisk browsertest er sat i gang og afventer brugeren. De følgende observationer beskriver den tidligere version.

**Historisk observation før implementeringen:** Native UI havde ikke fokusrækkefølge, fokusmarkering og tastaturaktivering. Fysisk Tab fra et native tekstfelt gik ud af spillets UI i stedet for til næste felt eller knap. `UIButton` håndterede museinput, men havde ikke tilsvarende aktivering med Space/Enter. Udviklerens svar nedenfor erstatter denne observation som implementeringsstatus; Tab under indtastning er stadig åbent.

**Testmateriale:** `scenes/keyboard-focus-test.scene.json` og `scripts/KeyboardFocusProbe.ts`, med to native tekstfelter og en knap. Mus på knappen gav ét klik; efterfølgende Space/Enter gav ikke flere klik. Den manuelle DOM-måling dokumenterede, at Tab forlod tekstfeltet uden at fokusere det næste native element.

**Ønsket funktion:** En defineret fokusrækkefølge, Tab/Shift+Tab-navigation, synlig fokusmarkering og tastaturaktivering af relevante widgets.

**MCP-begrænsning i testen:** `step.press` injicerer spilinput og udfører ikke browserens normale DOM-fokusskift. Det skal håndteres eller beskrives eksplicit ved automatiseret tastaturtest.

## #26 — Gendannelsesdialogen kan ikke håndteres gennem MCP

**Aktuel status:** Rettet og live-gentestet gennem den rigtige browser-MCP-forbindelse. Mens dialogen ventede på svar, virkede recovery-status og project_info; redigering blev korrekt afvist. MCP restore gendannede marker62626, barnets position(2626,6262), rotation0.75, parent og target. Scenen var ændret før gem, og gem ryddede pending recovery. Kassér-grenen er endnu ikke afprøvet gennem browseren. Se `/home/marz/Brik-MCP-recovery-browser-retest-result.json`. Nedenstående forløb er historik før rettelsen.

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


---

# Testagentens opfølgning — eksport/build og lokal offlinefunktion

7. november 2026. **Ingen nye bekræftede funktionsfejl i den afprøvede eksport.** Brugeren eksporterede gennem editorens Byg-dialog, da native MCP ikke har en eksportkommando. Artefakt: `/home/marz/Hentet/Marz the game-web.zip` (6.043.642bytes). Zipfilen blev pakket ud uden for projektet og kørt uændret på `http://127.0.0.1:5183/marz/` i en isoleret Chromium-browser. Spilprojekt og engine-kode blev ikke ændret.

- Opstart, menu, Marz-sprites, tilemap, animationer og fysik virker uden editoren. Fem teksturer, to lydklip og fysik-chunken indlæses fra eksporten.
- Browserens muse- og tastaturinput starter spillet; gå, løb og hop virker. Otte mønter gav800point. Møntlyden blev dekodet til0,2sek/48kHz, og én aktiv stemme blev målt, efterfulgt af0. Hørbarheden er ikke kontrolleret.
- E ved døren skifter main→courtyard→main med score800 og8mønter bevaret. R genstarter ved startpositionen med score0/mønter0.
- Service workeren aktiveres med undermappens scope og cacher14filer. Efter offline-emulering og genindlæsning med almindelig HTTP-cache tilsidesat starter spillet igen fra service-worker-cachen; menuen kan startes, og Marz bevæges med D, mens navigator.onLine=false. Ingen nye runtimefejl i dette forløb.
- De7eksisterende automatiske eksporttests består også. Resultater og afgrænsning: `/home/marz/Brik-MCP-export-browser-result.json`.

**Teknisk observation, ikke en bekræftet funktionsfejl:** Rapier-chunken skriver ved opstart `using deprecated parameters for the initialization function; pass a single object instead`. Gentaget ved offline-opstart. Fysik og opstart virker. Kilden i stacken er `brik-physics.js`; Briks indgang er initPhysics i `packages/physics/src/physics.ts`. Årsagen inde i afhængighedens initialisering er ikke isoleret, og der er ikke ændret kode.

**Ikke verificeret:** fysisk PWA-installation/installationsknap, hosting eller iframe på rigtig itch.io, Tauri og hørbar lyd. Den lokale offline-test lukker ikke disse testopgaver. Hjælp-knappens nye fane, guides og Behaviour-exit-callbacks ved slettede entities er også særskilte rester.

Hovedscenen er tilbage i edit, uden ugemte ændringer,55entities og scripts OK. Næste selvstændige testpunkt er Behaviour-callbacks for CollisionExit/TriggerExit, især ved sletning. Den fysiske Enter/Space-test fra sidste runde forbliver uafklaret: de efterspurgte tastetryk blev ikke registreret før brugeren bad om næste punkt; dette er ikke et nyt fejlfund.


---

# Testagentens opfølgning — Behaviour-exit-callbacks

7. november 2026. **Alle seks forløb bestået; ingen nye fejl fundet.** Separat scene `scenes/exit-callback-test.scene.json`, script `scripts/ExitCallbackTest.ts`, driver `8be46ec9154ec510`. Fixture og scripts er oprettet gennem native MCP; hovedbanen er ikke ændret. Dette tester de faktiske Behaviour-hooks og supplerer de allerede beståede native event-reader-tests.

| Forløb | Enter pr. side | Exit på zone/modpart | Resultat |
| --- | --- | --- | --- |
| Trigger, almindelig adskillelse | 1 / 1 | 1 / 1 | Bestået |
| Trigger, filter slås fra | 1 / 1 | 1 / 1 | Bestået |
| Trigger, modpart slettes | 1 / 1 | 1 / 0 | Bestået |
| Solid kollision, almindelig adskillelse | 1 / 1 | 1 / 1 | Bestået |
| Solid kollision, filter slås fra | 1 / 1 | 1 / 1 | Bestået |
| Solid kollision, modpart slettes | 1 / 1 | 1 / 0 | Bestået |

Ved sletning kørte modpartens onDestroy præcis én gang ved tick60. Den overlevende zones onTriggerExit/onCollisionExit kørte ved tick61 med `otherAlive=false`, ugyldig oprindelig generationsreference og intet læst navn. Det slettede script fik ingen exit-callback. Alle seks overlevende zoneprober fortsatte mere end100onUpdate-kald efter exit; ingen konsolfejl. Ved almindelig adskillelse/filterændring var begge oprindelige entities fortsat gyldige i callbacken.

**Semantik:** Exit-callbacken kan modtage indekset på en allerede slettet entity. Testscriptet kontrollerer isAlive og den oprindelige world.ref/world.deref-reference, før det læser komponenter. Det er ikke et løfte om, at ubevogtet komponentadgang er sikker; den kendte #18 ved indeksgenbrug er ikke gentestet eller lukket.

Reproduktion: Play, step170frames ved60fps, inspect_entity på driveren; report.finished=true, report.passed=true og alle seks lanes.ok=true. Rå audit/resultat: `/home/marz/Brik-MCP-exit-callback-result.json`. Hovedscenen gendannes i edit efter testen. **Næste punkt: Hjælp-knappens browserfane og guide-workflow.**


## #29 — Dokumentsøgning mister underscores i identifikatorer

**Status:** Bekræftet i den serverede hjælp i rigtig Chromium; ikke rettet. Både `paint_tiles` og `read_tiles` giver ingen resultater, mens `painttiles` og `readtiles` finder AI/MCP-siden.

1. Åbn `/docs/index.html` eller en hjælpeside, tryk `/` for søgning.
2. Skriv `paint_tiles`.
3. Observer: Ingen resultater, selv om `/docs/manual/ai-og-mcp.html` indeholder netop `paint_tiles`.

**Årsag:** `scripts/docs/markdown.mjs` bygger søgeteksten med en generel fjernelse af Markdown-tegn, inklusive `_`. Derfor bliver værktøjsnavnet til `painttiles` i søgeindekset, mens `scripts/docs/search.js` søger med det uændrede ord.

**Forventet:** Dokumenterede kode-/værktøjsnavne skal kunne findes med deres korrekte stavning. Bevar underscores i kode/identifikatorer, eller normalisér søgetekst og forespørgsel på en konsistent måde.

**Gentest:** `paint_tiles` og `read_tiles` finder AI/MCP-siden; almindelig tekstsøgning og flerdelte søgninger virker fortsat. Ingen engine-/docs-kode ændret af testagenten.


# Testagentens opfølgning — Hjælp og guider

7. november 2026. **Nyt fund #29 er registreret ovenfor.** Brugeren klikkede Hjælp i editoren og rapporterede `http://localhost:5180/docs/index.html`. Den adresse indlæses korrekt i testbrowseren. Den konkrete Tauri-knap er ikke testet.

- Alle23serverede hjælpesider svarer200 og har korrekt h1.682interne links inklusive fragmenter/ankre er kontrolleret uden brud. CSS, søgescript og søgeindeks svarer200.
- Browserens søgning: `/` fokuserer feltet; `tilemaps` giver resultater, og Enter åbner Tilemaps-siden. Dansk `første` finder Dit første spil; pil ned vælger næste resultat; Escape skjuler listen. Underscore-søgning fejler som beskrevet i#29.
- Alle7eksisterende dokumentationstests består; de dækker ikke den fundne søgefejl. Minimal parserkontrol viser HTML med `<code>paint_tiles</code>` men søgetekst med `painttiles`.
- Guidernes Walker- og StartButton-kode er kopieret uændret og skrevet gennem MCP i en separat testscene. Walker går24enheder på60frames og vender korrekt efter distance48. En prefab-instans vedx150 har egen distance72 og påvirker ikke originalen. StartButton med standard firstScene="main" indlæser hovedscenen med ét klik. Ingen konsolfejl.

**Testmateriale:** `scenes/guide-walkthrough-test.scene.json`, `scripts/Walker.ts`, `scripts/StartButton.ts`, `prefabs/Guide Walker.prefab.json`. Målinger: `/home/marz/Brik-MCP-help-guides-result.json`. Hovedscenen er tilbage i edit uden ugemte ændringer,55entities og scripts OK. Ingen engine-/docs-kode ændret.

**Resterende guidekontrol:** Et komplet manuelt førstegangsforløb med nyt browserprojekt og Platformer-skabelon, ændring af Player-felter via Inspector og maling via editorens UI er ikke gennemført. Den verificerede script-/prefab-/menukomposition og hjælpenavigation skal ikke gentages som nye tests. Rigtig itch.io-udgivelse, fysisk PWA-installation og Tauri er stadig særskilte rester.


---

# Svar fra motorudvikleren: dokumentationen

7. november 2026. Dokumentationen er gennemgået efter testagentens fund. Intet er committet endnu.

## #29 — rettet

Årsagen var den, testagenten fandt: `markdownToHtml` fjernede `_` fra søgeteksten. Underscore bevares nu (emphasis i manualen bruger kun `*`), og søgescriptet matcher både `paint_tiles` og `painttiles`. Kontrolleret mod det byggede søgeindeks: `paint_tiles`, `painttiles` og `read_tiles` finder AI/MCP-siden, og `tilemaps` og `første` giver de samme resultater som før. To nye tests i `packages/editor/test/docs.test.ts` dækker det.

## #18 — manualen advarer nu

Selve fejlen er stadig udskudt (se ovenfor), men [Scripts](docs/manual/04-scripts.md) forklarer nu, at et `Entity` er et indeks, der genbruges, og at `world.ref`/`world.deref` skal bruges til referencer, der skal overleve en sletning.

## Exit-hooks ved slettede entities — dokumenteret

Testagentens resultat er lagt ind i Scripts-siden under "Når noget forsvinder": Exit kommer også ved sletning, slukning og ændret `group`/`mask`. Er modparten slettet, er `other` et dødt indeks, og den slettede entity får ingen exit-hook (kun `onDestroy`). Siden har et eksempel med `EntityRef`, som er compilet gennem `write_script` i en test, så det ikke kan gå i stykker uden at nogen opdager det. Fysik-siden peger på det.

## Roadmappet

Roadmappet nævner nu tastaturstyring af UI, undo/redo og gendannelse gennem MCP som færdigt, og har fået afsnittene "Kendte fejl og mangler" og "Ikke afprøvet endnu" med #18, #9, #16, Rapier-advarslen, installér-knappen, itch.io, Tauri og det fulde førstegangsforløb.

## Ikke gjort

- **Rapier-advarslen** ("using deprecated parameters for the initialization function") er en teknisk observation i motoren, ikke dokumentation. Den er skrevet på roadmappet, men ikke undersøgt.
- **Et fysisk førstegangsforløb** gennem guiderne i editorens egen brugerflade er ikke kørt. Testagentens afprøvning af scripts, prefab og menu dækker koden i guiderne, ikke klikkene.

## Dokumentationen: skærmbilleder og to fejl i guiden

7. november 2026. Manualen og guiderne har nu seks skærmbilleder (startskærm, editor med Player valgt, spillet under Play, kodeeditoren, sprite-editoren og byg-vinduet) i `docs/images/`. De tages af `scripts/docs/screenshots.mjs` (`make docs-screenshots`) i en headless Chromium ud fra en frisk platformer-skabelon, så de kan tages om, når editoren ændrer udseende. Docs-buildet kopierer dem og afviser et billede, der peger på en fil, som ikke findes.

Arbejdet fandt to fejl i min egen guide, som testagentens gennemgang ikke fangede, fordi den afprøvede kode og ikke skabelonens indhold: guiden lovede en fjende i platformer-skabelonen (der er ingen) og talte om en "Tilemap" i hierarkiet (entity'en hedder **Level**). Begge er rettet, og manualen peger på guiden "Tilføj en fjende". Selve det manuelle førstegangsforløb i brugerfladen er stadig ikke kørt som en ny bruger; billederne er taget af scriptet, ikke af et menneske.
