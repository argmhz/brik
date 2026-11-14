import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import { SCENE_EXTENSION } from "../core/asset-db";
import type { Editor } from "../core/editor";
import { basename, joinPath } from "../core/fs";
import { reportError, toast } from "./hooks";

/*
 * A question with a few answers, shown as a modal (instead of the browser's
 * confirm(), which only has OK and Cancel). Shown by Root.
 */

interface Choice {
  label: string;
  value: string;
  primary?: boolean;
}

interface Pending {
  title: string;
  text: string;
  choices: Choice[];
  answer: (value: string | null) => void;
}

const [pending, setPending] = createSignal<Pending | null>(null);

/** Shows the question and resolves with the chosen value, or null for Escape. */
export function ask(title: string, text: string, choices: Choice[]): Promise<string | null> {
  pending()?.answer(null);
  return new Promise((resolve) => {
    setPending({
      title,
      text,
      choices,
      answer: (value) => {
        setPending(null);
        resolve(value);
      },
    });
  });
}

export function AskDialog() {
  return (
    <Show when={pending()}>
      {(p) => {
        let primary: HTMLButtonElement | undefined;
        const onKey = (ev: KeyboardEvent) => {
          if (ev.key !== "Escape") return;
          ev.preventDefault();
          ev.stopPropagation();
          p().answer(null);
        };
        onMount(() => {
          primary?.focus();
          window.addEventListener("keydown", onKey, true);
        });
        onCleanup(() => window.removeEventListener("keydown", onKey, true));
        return (
          <div class="modal-backdrop">
            <div class="modal" role="alertdialog" aria-labelledby="ask-title">
              <h2 id="ask-title">{p().title}</h2>
              <p>{p().text}</p>
              <div class="modal-buttons">
                <For each={p().choices}>
                  {(c) => (
                    <button
                      ref={(el) => c.primary && (primary = el)}
                      classList={{ primary: !!c.primary }}
                      onClick={() => p().answer(c.value)}
                    >
                      {c.label}
                    </button>
                  )}
                </For>
              </div>
            </div>
          </div>
        );
      }}
    </Show>
  );
}

/** Saves the open scene, asking for a name if it has none. False when cancelled or failed. */
export async function saveScene(editor: Editor, saveAs = false): Promise<boolean> {
  let path = editor.scenePath;
  if (!path || saveAs) {
    const suggestion = path ? basename(path).replace(SCENE_EXTENSION, "") : "main";
    const name = prompt("Gem scene som:", suggestion);
    if (!name) return false;
    path = name.includes("/") ? name : joinPath("scenes", name);
  }
  try {
    const saved = await editor.saveScene(path);
    toast(`Gemt ${saved}`);
    return true;
  } catch (err) {
    reportError(err, "Kunne ikke gemme");
    return false;
  }
}

/**
 * Before the open scene is replaced or closed: when it has unsaved changes,
 * asks whether to save them first. True when it is fine to go on.
 */
export async function leaveScene(editor: Editor, action: string): Promise<boolean> {
  if (!editor.dirty) return true;
  const name = editor.scenePath ? basename(editor.scenePath).replace(SCENE_EXTENSION, "") : "Scenen";
  const answer = await ask("Ikke-gemte ændringer", `${name} har ændringer, der ikke er gemt. Vil du gemme dem, før du ${action}?`, [
    { label: "Annullér", value: "cancel" },
    { label: "Kassér", value: "discard" },
    { label: "Gem", value: "save", primary: true },
  ]);
  if (answer === "save") return saveScene(editor);
  return answer === "discard";
}
