# Fysik

Fysikken kører på Rapier. Tyngdekraft og skala sættes i `brik.project.json` under `physics`.

## Opskrifter

| Du vil have | Brug |
|---|---|
| Faste ting (gulv, væg) | `Collider2D`. Uden `RigidBody2D` er den statisk. |
| Ting der falder og skubbes | `RigidBody2D` (dynamic) sammen med `Collider2D`. Hastigheden læses og skrives gennem `Velocity2D`. |
| Spilfigurer | `RigidBody2D` (kinematic), `CharacterController2D` og `Collider2D`. Flyt figuren med `this.moveCharacter(dx, dy)`, og læg selv tyngdekraften på (se [Figurer og tyngdekraft](#figurer-og-tyngdekraft)). |
| Områder, der kun melder overlap | `isTrigger` på en collider |
| Faste tiles | `TileMapCollider` på et tilemap. Hver tile kan være hel, pynt, envejs, halv eller en skråning: se [Tilemaps](tilemaps.md#kollision) |

## Figurer og tyngdekraft

`CharacterController2D` gør kroppen **kinematisk**, uanset hvad der står i `RigidBody2D`'s `type`. En kinematisk krop bliver ikke trukket af fysikkens tyngdekraft og skubbes ikke af andre ting. Den flytter sig kun, når et script kalder `this.moveCharacter(dx, dy)`. Det er samme model som `CharacterBody2D` i Godot og `CharacterController` i Unity. Til gengæld får man præcis styring: ingen glidning eller væltning, hop med præcis den højde, man vil have, og figuren følger skråninger og stopper ved vægge.

Tyngdekraften lægger scriptet derfor selv på figurens fart:

```ts
import { Behaviour, CharacterController2D } from "brik";

export class Figur extends Behaviour {
  vy = 0; // lodret fart, enheder pr. sekund

  onUpdate(dt: number) {
    const grounded = this.get(CharacterController2D).grounded;
    if (grounded) this.vy = Math.max(this.vy, -30); // bliv på jorden, men saml ikke fart op
    if (grounded && this.input.action("jump").pressed) this.vy = 360;
    this.vy -= 760 * dt; // tyngdekraften
    const moved = this.moveCharacter(this.input.axis("horizontal") * 130 * dt, this.vy * dt);
    if (this.vy > 0 && moved.y < this.vy * dt * 0.5) this.vy = 0; // stødte hovedet
  }
}
```

Linjen med `-30` holder figuren trykket mod jorden, så den følger skråninger ned og ikke "flyver" ud over små kanter, uden at farten vokser, mens den står stille.

Skal noget bare falde og skubbes rundt af fysikken, fx en kasse eller en bold, så brug ikke `CharacterController2D`. Brug `RigidBody2D` med typen `dynamic` og en `Collider2D`, så virker tyngdekraften af sig selv.

## Fart

Hvor fart findes, afhænger af, hvordan tingen bevæger sig.

**Dynamiske kroppe** (`RigidBody2D` med typen `dynamic`: kasser, bolde, alt det fysikken skubber rundt med) har deres fart i komponenten `Velocity2D`. Den lægges ikke på af sig selv sammen med `RigidBody2D`, så tilføj den i inspectoren. Fysikken skriver farten tilbage efter hvert skridt, og ændrer du den, sender Brik den videre:

```ts
import { Behaviour, Velocity2D } from "brik";

export class Bold extends Behaviour {
  onUpdate() {
    const v = this.get(Velocity2D);
    if (this.input.action("jump").pressed) v.linear.y = 300; // enheder pr. sekund, y opad
    if (Math.abs(v.linear.x) > 400) v.linear.x = Math.sign(v.linear.x) * 400; // en topfart
    v.angular = 0; // rotation i radianer pr. sekund
  }
}
```

En anden entitys fart læses med `this.world.store(Velocity2D).linear.x[e]`.

**Figurer** med `CharacterController2D` har ingen `Velocity2D`. De flyttes med `this.moveCharacter(dx, dy)`, så det er scriptet selv, der holder styr på farten, typisk i et felt som `vy` til tyngdekraft og hop. Vil du vide, hvor langt figuren faktisk kom efter vægge, gulv og skråninger, så brug det, `moveCharacter` returnerer:

```ts
const moved = this.moveCharacter(dir * this.speed * dt, this.vy * dt);
const fartX = moved.x / dt; // den fart, figuren faktisk havde i denne frame
if (this.vy > 0 && moved.y < this.vy * dt * 0.5) this.vy = 0; // stødte hovedet: stop opad
```

## Står den på jorden?

**Figurer:** `CharacterController2D` har feltet `grounded`, som er sandt, når figuren står på noget: gulv, en skråning, en envejsplatform eller en løs kasse.

```ts
const grounded = this.get(CharacterController2D).grounded;
if (grounded && this.input.action("jump").pressed) this.vy = 360;
```

`grounded` opdateres af `moveCharacter`. Læser du det før kaldet i en frame, er det fra sidste frame, og det er som regel det, man vil have til at bestemme, om man må hoppe. Læser du det efter, er det den nye stilling, fx til at opdage en landing:

```ts
const was = this.get(CharacterController2D).grounded;
this.moveCharacter(dx, dy);
const now = this.get(CharacterController2D).grounded;
if (now && !was) this.playSound("land");
```

Et lille spillerum gør hop mere tilgivende: tæl, hvor længe siden figuren sidst stod på noget, og tillad et hop op til 0,1 sekund efter, at den gik ud over kanten ("coyote time").

**Dynamiske kroppe** har ikke noget `grounded`. Kast en kort stråle lige ned fra bunden og se, om den rammer noget. `exclude` springer kroppens egen collider over:

```ts
const p = this.transform.position;
const hit = this.physics.raycast({ x: p.x, y: p.y }, { x: 0, y: -1 }, 18, { exclude: this.entity });
const grounded = hit !== null; // 18 = halv højde plus lidt luft
```

## Se collidere

Knappen **Collidere** i Spil-fanens øverste højre hjørne tegner fysikkens egne former oven på spillet, mens det kører: cyan for collidere og orange for envejsplatformes overkant. Det er det, fysikken faktisk bruger, så det er det rigtige sted at kigge, når en figur står forkert i forhold til en kasse eller svæver over jorden. Med knappen slået til kommer stregerne også med på skærmbilleder taget gennem MCP.

## Opslag

```ts
this.physics.raycast(origin, dir, distance);
this.physics.overlapPoint(p);
```

## Kollisionshooks

`onCollisionEnter/Exit(other)` kaldes for faste colliders, `onTriggerEnter/Exit(other)` for triggers. Se [Scripts](scripts.md#hooks). Et Exit kommer også, når modparten slettes eller slukkes, eller når en ny `group`/`mask` skiller dem ad. Er modparten slettet, så se [Når noget forsvinder](scripts.md#naar-noget-forsvinder).

## Led

`Joint2D` forbinder en krop med en anden (`connected`) eller med et punkt i verden:

| Type | Bruges til |
|---|---|
| `hinge` | pendul, dør, hjul |
| `fixed` | svejst fast |
| `spring` | fjeder |
| `rope` | reb med en største længde |
| `slider` | glider langs en akse |
