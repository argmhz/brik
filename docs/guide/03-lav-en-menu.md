# Lav en menu

En startskærm med en knap, der starter spillet.

## 1. Opret en scene til menuen

Tryk **Ny scene** i asset-panelet og kald den `menu`. Scenen bliver en fil i `scenes/` og åbnes med det samme.

## 2. Opret knap og tekst

I hierarkiet: opret **Tekst** og **Knap**. Der laves automatisk et **UI Canvas**. Placér dem med `UIRect`: er ankrene ens, har elementet en fast størrelse, og er de forskellige, strækkes det med skærmen. Vil du have dem stillet under hinanden, så opret en **Kolonne** (`UIStack`) og læg dem under den.

## 3. Giv knappen et script

Opret et script med navnet `StartButton` i asset-panelet (højreklik, **Nyt script**), og erstat indholdet:

```ts
import { Behaviour, expose } from "brik";

export class StartButton extends Behaviour {
  @expose firstScene = "main";

  onClick() {
    this.loadScene(this.firstScene);
  }
}
```

Sæt scriptet på knappen. `onClick` kaldes, når knappen klikkes.

## 4. Prøv det

Tryk Play og klik knappen. Hvis scenen ikke findes, står der en fejl i Console.

Flere UI-elementer, fx slider og tekstfelt, står i [UI](../manual/ui.md).
