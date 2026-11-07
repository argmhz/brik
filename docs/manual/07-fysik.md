# Fysik

Fysikken kører på Rapier. Tyngdekraft og skala sættes i `brik.project.json` under `physics`.

## Opskrifter

| Du vil have | Brug |
|---|---|
| Faste ting (gulv, væg) | `Collider2D`. Uden `RigidBody2D` er den statisk. |
| Ting der falder og skubbes | `RigidBody2D` (dynamic) sammen med `Collider2D`. Hastigheden læses og skrives gennem `Velocity2D`. |
| Spilfigurer | `RigidBody2D` (kinematic), `CharacterController2D` og `Collider2D`. Flyt figuren med `this.moveCharacter(dx, dy)`. |
| Områder, der kun melder overlap | `isTrigger` på en collider |
| Faste tiles | `TileMapCollider` på et tilemap |

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
