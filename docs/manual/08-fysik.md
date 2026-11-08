# Fysik

Fysikken kører på Rapier. Tyngdekraft og skala sættes i `brik.project.json` under `physics`.

## Opskrifter

| Du vil have | Brug |
|---|---|
| Faste ting (gulv, væg) | `Collider2D`. Uden `RigidBody2D` er den statisk. |
| Ting der falder og skubbes | `RigidBody2D` (dynamic) sammen med `Collider2D`. Hastigheden læses og skrives gennem `Velocity2D`. |
| Spilfigurer | `RigidBody2D` (kinematic), `CharacterController2D` og `Collider2D`. Flyt figuren med `this.moveCharacter(dx, dy)`. |
| Områder, der kun melder overlap | `isTrigger` på en collider |
| Faste tiles | `TileMapCollider` på et tilemap. Hver tile kan være hel, pynt, envejs, halv eller en skråning: se [Tilemaps](tilemaps.md#kollision) |

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
