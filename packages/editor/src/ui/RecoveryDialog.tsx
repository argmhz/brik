import { Show, createSignal, onMount } from "solid-js";
import type { Editor } from "../core/editor";

/** What the dialog is asking about, or null while it isn't shown. */
interface Pending {
  scene: string;
  when: string;
  entities: number;
  answer: (restore: boolean) => void;
}

const [pending, setPending] = createSignal<Pending | null>(null);

/**
 * Asks whether to bring back the unsaved changes found when a project was
 * opened, and does what the answer says. Resolves when the user has chosen.
 */
export function offerRecovery(ed: Editor): Promise<void> {
  const rec = ed.recovery;
  if (!rec) return Promise.resolve();
  return new Promise((resolve) => {
    // the AI can answer too (the recovery tool): then the question goes away by itself
    const stop = ed.on("recovery", () => {
      if (ed.recovery) return;
      stop();
      setPending(null);
      resolve();
    });
    setPending({
      scene: rec.scenePath ?? "en ny scene, der aldrig blev gemt",
      when: new Date(rec.savedAt).toLocaleString("da-DK", { dateStyle: "short", timeStyle: "short" }),
      entities: rec.scene.entities.length,
      answer: (restore) => {
        if (restore) ed.restoreRecovery();
        else void ed.discardRecovery();
      },
    });
  });
}

/** The question itself. Shown by Root; there is no way to skip it, since autosave waits for the answer. */
export function RecoveryDialog() {
  return (
    <Show when={pending()}>
      {(p) => {
        let primary!: HTMLButtonElement;
        onMount(() => primary.focus());
        return (
          <div class="modal-backdrop">
            <div class="modal" role="alertdialog" aria-labelledby="recovery-title">
              <h2 id="recovery-title">Ikke-gemte ændringer</h2>
              <p>
                Brik fandt ændringer i <b>{p().scene}</b>, som ikke blev gemt ({p().when}, {p().entities}{" "}
                {p().entities === 1 ? "entity" : "entities"}).
              </p>
              <p class="muted">Gendanner du dem, står scenen som ændret, indtil du gemmer. Kasserer du dem, er de væk.</p>
              <div class="modal-buttons">
                <button onClick={() => p().answer(false)}>Kassér</button>
                <button ref={primary} class="primary" onClick={() => p().answer(true)}>
                  Gendan ændringerne
                </button>
              </div>
            </div>
          </div>
        );
      }}
    </Show>
  );
}
