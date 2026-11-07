# Desktop-appen

`apps/desktop` er editoren som en Tauri-app med adgang til filsystemet. Den kræver Rust ([rustup.rs](https://rustup.rs)) og Tauris systempakker ([v2.tauri.app/start/prerequisites](https://v2.tauri.app/start/prerequisites/)).

```bash
make desktop           # åbner editoren i et vindue
make desktop-build     # laver installere
```

`corepack pnpm build` laver installere til det system, du bygger på. På Linux ligger `.deb`-filen bagefter i `src-tauri/target/release/bundle/deb/`. Vil du kun have den, så kør `make desktop-deb`.

I desktop-appen vælger du projektmappen med en almindelig mappe-dialog, og de seneste mapper vises på startskærmen. Byg-vinduet gemmer spillet med en almindelig gem-dialog.

> **Bemærk** Knappen **Hjælp** åbner dokumentationen i en ny fane. Om det virker i desktop-appen, er ikke afprøvet endnu.
