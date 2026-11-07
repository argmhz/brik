# Scripts

Scripts er TypeScript-filer i `scripts/`. En `Behaviour` sættes på en entity via **Tilføj komponent** i inspectoren.

```ts
import { Behaviour, expose, Sprite } from "brik";

export class Player extends Behaviour {
  @expose speed = 120;            // kan rettes i inspectoren

  onStart() {}                    // én gang
  onUpdate(dt: number) {          // hver frame
    const x = this.input.axis("horizontal");
    this.transform.position.x += x * this.speed * dt;
    this.get(Sprite).flipX = x < 0;
  }
}
```

Felter med `@expose` kan rettes i inspectoren, og værdien gemmes i scenen.

## Hooks

| Hook | Kaldes når |
|---|---|
| `onStart` | Scriptet starter |
| `onEnable` / `onDisable` | Entity'en tændes eller slukkes med `setActive` (også via en forælder). `onEnable` kommer også lige før `onStart`, og `onDisable` før `onDestroy` |
| `onUpdate(dt)` | Hver frame |
| `onFixedUpdate(dt)` | Ved et fast interval (60 Hz) |
| `onDestroy` | Scriptet eller entity'en fjernes |
| `onCollisionEnter/Exit(other)` | To faste colliders rører hinanden eller slipper |
| `onTriggerEnter/Exit(other)` | Noget går ind i eller ud af en trigger |
| `onAnimationEvent(name)` | Animationen når en frame med et event |
| `onAnimationFinished(clip)` | En animation, der kun spiller én gang, er færdig |
| `onTimer` | Entity'ens `Timer` løber ud |
| `onClick` | Entity'ens `UIButton` klikkes |

UI-elementernes hooks (`onValueChanged`, `onSubmit`) står i [UI](ui.md).

## Hjælpere

| Hjælper | Hvad den gør |
|---|---|
| `this.transform`, `this.get(Komponent)`, `this.add(...)`, `this.has(...)` | Læser og ændrer komponenter |
| `this.input.axis("horizontal")`, `this.input.action("jump").pressed`, `this.input.key("Mouse0").down` | Input |
| `this.pointerWorld()` | Musens position i verden |
| `this.moveCharacter(dx, dy)` | Bevæger en `CharacterController2D` med kollisioner |
| `this.playAnimation("hero_run")`, `this.playSound("coin")` | Animation og lyd |
| `this.spawnPrefab("Coin", { position })`, `this.destroy(e)`, `this.find("Navn")` | Opretter, fjerner og finder entities |
| `this.setActive(false, e)` | Slukker en entity og dens børn (fx en beskedboks): den skjules, dens scripts, timere og tweens holder pause, og dens colliders er ude af fysikken |
| `this.tween(Transform2D, "position.y", 100, 0.5)`, `this.after(1, fn)`, `this.every(0.5, fn)` | Tweens og timere |
| `this.emitParticles(20)` | Udsender partikler |
| `this.loadScene("level2")` | Skifter scene |
| `this.behaviourOf(Andet, e)` | Taler med et andet script |

> **Pas på** Giv ikke dine egne metoder samme navn som Behaviours egne (fx `setActive` eller `find`), for så skygger de for dem.

## Felter, der peger på andet

Et felt kan pege på en anden entity, som du vælger i inspectoren:

```ts
@expose({ type: "entity" }) target: Entity = -1; // -1 hvis intet er valgt
```

Felter af typen `"prefab"`, `"audio"` og `"clip"` får en asset-vælger.

## Tilstand på tværs af scener

Tilstand, der skal leve på tværs af scener (liv, point), kan ligge i et almindeligt modul, som scripts importerer:

```ts
// scripts/Game.ts
export const Game = { lives: 3, coins: 0 };
```

Modulerne indlæses forfra, hver gang du trykker Play, ligesom når det eksporterede spil startes.

## Fejl

Fejl i et script vises i Console med fil og linje, både når scriptet kompileres, og når det kaster en fejl, mens spillet kører. Klik på fejlen for at hoppe til linjen.

## Egne komponenter og systemer

Scripts kan definere egne komponenter (`defineComponent`) og systemer. Se [Entities og komponenter](entities-og-komponenter.md#systemer).
