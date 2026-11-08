# Space Invaders

Åbn denne mappe med **Åbn mappe…** i Brik-editoren, og tryk **Play**.

- **← / →** eller **A / D**: flyt skibet.
- Hold **mellemrum** eller venstre museknap: skyd.
- **P**: pause / fortsæt.
- **Enter** efter game over: nyt spil.

Du har tre liv. Skyd de 36 rumvæsner, før de når ned til skibet. Bunkerne
absorberer skud fra begge sider og bliver gradvist ødelagt. Hver ryddet bølge
giver en ny, hurtigere formation. De øverste rækker giver flere point.

Grafikken er et lille pixelatlas med nearest-neighbor-filtrering. Spillet bruger
Briks egne entities, sprites, tekst og Behaviour-scripts. Kameraet tilpasser sig
størrelsen på Spil-visningen.

Kør integrationstesten fra repository-roden:

```sh
node packages/mcp/space-invaders-check.mjs
```

Testen starter en separat MCP-server på port 5198 og tester projektet headless.
Den kontrollerer bevægelse, skærmgrænser, skud, fjendedrab, point, pause,
bunkernes nedbrydning, game over, genstart og skift til næste bølge. Den første kørsel kan også bygge
scenen fra et tomt projekt. Browserens rendering skal kontrolleres i editoren.
