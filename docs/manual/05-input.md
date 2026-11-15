# Input

Brik læser tastatur, mus og gamepad. Det mest praktiske er at spørge efter navngivne **handlinger** og **akser** i stedet for bestemte taster, for så virker det samme script med alle tre, og spilleren kan få andre taster uden at koden ændres.

I et script hedder input-objektet `this.input`. Andre steder er det `world.resource(Input)`.

## Standardbindingerne

Hvert spil starter med disse:

| Navn | Slags | Tastatur og mus | Gamepad |
|---|---|---|---|
| `horizontal` | akse | A/D, pil venstre/højre | venstre stick, d-pad venstre/højre |
| `vertical` | akse | S/W, pil ned/op | venstre stick, d-pad ned/op |
| `jump` | handling | Mellemrum | A |
| `fire` | handling | Venstre museknap | X, højre trigger (RT) |

```ts
onUpdate(dt: number) {
  const x = this.input.axis("horizontal"); // -1..1
  if (this.input.action("jump").pressed) this.hop();
  this.moveCharacter(x * 120 * dt, 0);
}
```

## Handlinger: knapper

`this.input.action(navn)` giver tre ja/nej-værdier for den aktuelle frame:

| Felt | Sandt når |
|---|---|
| `down` | En af handlingens taster er holdt nede |
| `pressed` | En af dem blev trykket ned i denne frame (kun én frame) |
| `released` | En af dem blev sluppet i denne frame (kun én frame) |

Brug `pressed` til ting, der skal ske én gang (hop, skud, åbn en dør), og `down` til ting, der varer (løb, sigt, hold et skjold). `released` er godt til et lavere hop, når knappen slippes tidligt:

```ts
const jump = this.input.action("jump");
if (jump.pressed && grounded) this.vy = 360;
if (jump.released && this.vy > 0) this.vy *= 0.5; // slip tidligt: lavere hop
```

Læs `pressed` og `released` i `onUpdate`. `onFixedUpdate` kører ikke nødvendigvis i hver frame, så et tryk kan gå tabt der.

## Akser: retninger

`this.input.axis(navn)` giver et tal fra -1 til 1. Med taster er det -1, 0 eller 1, og to modsatte taster holdt samtidig ophæver hinanden. Med en stick kan det være alt derimellem, så en figur kan gå langsomt, når sticken kun er skubbet lidt:

```ts
const x = this.input.axis("horizontal");
if (Math.abs(x) > 0.6) this.playAnimation("run");
else if (x !== 0) this.playAnimation("walk");
```

Tastatur og gamepad lægges sammen, men resultatet bliver aldrig større end 1.

## Egne bindinger

En handling kan have så mange taster og knapper, man vil, og en akse kan desuden følge en stick-retning. Lav dem i `onStart` på et script, der altid er med, fx på spilleren:

```ts
onStart() {
  this.input.bindAction("dash", "ShiftLeft", "KeyK", "PadB");
  this.input.bindAction("pause", "Escape", "KeyP", "PadStart");
  // sigte med J/L eller højre stick sidelæns
  this.input.bindAxis("aimX", ["KeyJ"], ["KeyL"], "right-x");
}
```

`bindAction` og `bindAxis` erstatter en eksisterende binding med samme navn, så `this.input.bindAction("jump", "KeyW", "ArrowUp", "PadA")` flytter hop til W og pil op. Stick-retningerne hedder `"left-x"`, `"left-y"`, `"right-x"` og `"right-y"`, med y opad.

Spørger man efter et navn, der ikke er bundet, kommer der en fejl, så stavefejl ikke bare giver et spil, der ikke reagerer.

## Navne på taster og knapper

| Slags | Navne |
|---|---|
| Tastatur | Tastens `KeyboardEvent.code`: `KeyA` … `KeyZ`, `Digit0` … `Digit9`, `Space`, `Enter`, `Escape`, `Tab`, `ShiftLeft`, `ShiftRight`, `ControlLeft`, `AltLeft`, `ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight`, `Backspace`, `F1` … |
| Mus | `Mouse0` (venstre), `Mouse1` (midterste), `Mouse2` (højre) |
| Gamepad | `PadA`, `PadB`, `PadX`, `PadY`, `PadLB`, `PadRB`, `PadLT`, `PadRT`, `PadSelect`, `PadStart`, `PadL3`, `PadR3` (pinden trykket ind), `PadUp`, `PadDown`, `PadLeft`, `PadRight` (d-pad), `PadHome` |

`KeyboardEvent.code` er tastens plads på tastaturet, ikke bogstavet på den. `KeyW` er altså tasten over A, også på et fransk tastatur. Det er det, man vil have til bevægelse.

En enkelt tast kan læses direkte uden en binding: `this.input.key("KeyE").pressed`. Det er fint til debug-taster og prototyper, men en handling er bedre, så snart spilleren skal kunne bruge en gamepad.

## Musen

| Felt | Indhold |
|---|---|
| `this.input.pointer.x`, `.y` | Musens position i skærm-pixels i forhold til spillets lærred (y nedad) |
| `this.input.pointer.dx`, `.dy` | Hvor meget musen flyttede sig i denne frame |
| `this.input.pointer.inside` | Om musen er over spillet |
| `this.input.wheel` | Hjulets bevægelse i denne frame (positiv er ned) |
| `this.pointerWorld()` | Musens position i verden, set gennem hovedkameraet |

```ts
// sigt mod musen
const m = this.pointerWorld();
const p = this.transform.position;
this.transform.rotation = Math.atan2(m.y - p.y, m.x - p.x);

// zoom med hjulet
const cam = this.find("Main Camera");
this.world.store(Camera2D).zoom[cam] *= Math.exp(-this.input.wheel * 0.001);
```

Museknapperne er almindelige bindinger (`Mouse0` osv.), så de kan bruges i handlinger som `fire`. Højreklik-menuen er slået fra over spillet.

## Gamepad

Brik bruger browserens Gamepad API med standard-layoutet (Xbox-lignende, som de fleste controllere melder sig som). Knapperne virker som taster med `down`, `pressed` og `released`, og triggerne tæller som trykket, når de er presset over halvvejs.

| Felt | Indhold |
|---|---|
| `this.input.stick.left`, `.right` | Stickenes position, `{ x, y }` fra -1 til 1, med y opad |
| `this.input.gamepadConnected` | Om der er en controller |
| `this.input.deadZone` | Hvor meget en stick skal skubbes, før det tæller (standard 0,2) |

```ts
// vis den rigtige hjælpetekst
const hint = this.input.gamepadConnected ? "Tryk A for at hoppe" : "Tryk mellemrum for at hoppe";

// sigt med højre stick, når den bruges
const s = this.input.stick.right;
if (Math.hypot(s.x, s.y) > 0.3) this.transform.rotation = Math.atan2(s.y, s.x);
```

- **Vækning:** en controller skal som regel have en knap trykket, før browseren viser den til spillet. Det er browserens regel.
- **Flere controllere:** er der flere, læses de samlet. Den stick, der er skubbet længst, vinder. Spil for flere spillere med hver sin controller er ikke understøttet endnu.
- **Dødzone:** gamle sticks hviler ikke præcis på 0. Dødzonen fjerner den drift, og bevægelsen skaleres, så kanten af dødzonen er 0 og fuldt udslag er 1.

## UI med tastatur og gamepad

Knapper, sliders, toggles og tekstfelter i UI'et kan bruges uden mus:

| Tast | Gamepad | Virkning |
|---|---|---|
| Tab, Shift+Tab | | Næste eller forrige element |
| Pil ned, pil op | d-pad ned/op | Næste eller forrige element, når noget allerede har fokus |
| Enter, mellemrum | A | Tryk på knappen eller skift toggle |
| Pil venstre/højre | d-pad venstre/højre | Flyt en slider |
| Escape | B | Fjern fokus |

Pilene og d-pad'en flytter kun fokus, når noget allerede har det. Ellers ville pil ned i et spil pludselig vælge en knap i HUD'en, og mellemrum (hop) ville trykke på den. En menu giver derfor sin første knap fokus, når den åbner:

```ts
onStart() {
  this.world.resource(UIFocus).entity = this.find("Nyt spil");
}
```

Det fokuserede element får en gul ramme. Se også [UI](ui.md).

## Touch og mobil

Et eksporteret spil kan spilles på en telefon eller tablet med styring på skærmen. Der er to UI-komponenter, og scripts læser dem gennem de samme handlinger og akser som tastaturet, så spillets kode skal ikke ændres:

| Komponent | Virkning |
|---|---|
| `UITouchStick` | Et joystick. En finger i dets felt flytter knoppen, og knoppen styrer akserne `axisX` og `axisY` (standard `horizontal` og `vertical`) |
| `UITouchButton` | En knap, der holder handlingen `action` (standard `jump`), så længe en finger er på den |

Højreklik i Hierarki og vælg **UI → Joystick (touch)** og **UI → Knap (touch)**. Joysticket lægger sig nederst til venstre og knappen nederst til højre, på en UI Canvas. Lav én knap pr. handling, fx en til `jump` og en til `fire`.

```ts
// virker med tastatur, gamepad og touch uden ændringer
const x = this.input.axis("horizontal");
if (this.input.action("jump").pressed) this.hop();
```

**Felter på joysticket**

| Felt | Indhold |
|---|---|
| `radius` | Hvor langt knoppen kan flyttes fra midten, i UI-enheder. Skubbet helt ud giver det 1 |
| `deadZone` | Bevægelse under denne brøkdel af radius tæller som ingen (standard 0,15) |
| `floating` | Joysticket starter dér, hvor fingeren lander. Så kan feltet være stort, fx hele venstre halvdel af skærmen |
| `baseColor`, `knobColor` | Farverne på ringen og knoppen |

**Felter på knappen:** `action`, `color` og `pressedColor`. Uden en `UIImage` tegnes knappen som en cirkel i sit felt; med en `UIImage` farves billedet i stedet. Knappens tekst er et `UIText`-barn.

Sådan opfører de sig:

- **Flere fingre:** hver styring tager sin egen finger, så man kan gå med venstre tommelfinger og hoppe med højre samtidig.
- **De klikker ikke:** en finger på en styring trykker ikke `Mouse0`, så `fire` går ikke af, og UI-knapper under den bliver ikke trykket. En finger andre steder virker som musen, så menuer og UI-knapper kan trykkes som før.
- **Knappen slipper først, når fingeren løftes**, også hvis den glider ud af knappen.
- **Kun på berøringsskærme:** med `showOn: "touch"` (standard) er styringen skjult på en computer og dukker op, første gang skærmen røres. Trykkes en tast på tastaturet, forsvinder den igen. Sæt `showOn: "always"` for at prøve den med musen under Play i editoren. I scene view vises den altid.

`this.input.touchMode` er sand, når spilleren bruger en berøringsskærm. Brug den fx til hjælpeteksten: "Tryk på knappen" i stedet for "Tryk på mellemrum".

**Fingrene direkte:** `this.input.pointers` er en liste over fingre (og museknapper), der holdes på spillet, med `x`, `y` (skærm-pixels, y nedad), `startX`, `startY`, `pressed`, `released` og `owner` (den styring, der har taget fingeren, ellers -1). Den kan bruges til egne bevægelser som at stryge.

Eksporten er gjort klar til telefoner: siden kan ikke zoomes eller rulles, og et langt tryk markerer ikke tekst og åbner ikke en menu.

## Tekstfelter og editoren

- **Tekstfelter:** mens man skriver i et tekstfelt (`UITextInput`), går tasterne til feltet og ikke til spillet.
- **Editoren:** under Play i editoren når tasterne kun spillet, når Spil-fanen har fokus. Ellers ville man styre spilleren, mens man skriver i hierarkiet eller kode-editoren. Klik i Spil-fanen for at give den fokus.
- **Tastaturets standardvirkning:** taster, spillet bruger, får ikke deres normale virkning i browseren. Mellemrum og piletaster ruller altså ikke siden.

## Falske tryk

`this.input.inject("down", "Space")` og `inject("up", "Space")` giver tryk, der ikke kommer fra et rigtigt tastatur, fx fra tests. `injectPointer(x, y)` flytter musen, og `injectTouch("down" | "move" | "up", id, x, y)` sætter en finger ned, flytter den eller løfter den. Det er det samme, MCP-værktøjet `step` bruger, når en AI-klient tester spillet (med `touches` for fingre).

Til knapper på en berøringsskærm skal man ikke bruge `inject`: brug `UITouchButton` (se [Touch og mobil](#touch-og-mobil)).

To metoder er lavet til egne styringer på skærmen: `this.input.setButton("Touch:jump", true)` holder handlingen `jump` med det samme i denne frame, og `this.input.addAxis("horizontal", 0.5)` lægger til en akse i denne frame (kald den hver frame).
