import { newGuid } from "@brik/runtime";
import { For, Show, createResource, createSignal } from "solid-js";
import {
  HandleFS,
  type ProjectFS,
  deleteBrowserProject,
  lastFolder,
  listBrowserProjects,
  openBrowserProject,
  pickFolder,
  reopenFolder,
  supportsFolderPicker,
  walk,
} from "../core/fs";
import { createProject, isProject } from "../core/project";
import { TauriFS, isTauri, pickTauriFolder, recentTauriFolders, rememberTauriFolder } from "../core/tauri-fs";
import { scriptTemplate } from "../core/scripts";
import { importZip } from "../core/zip";
import { reportError } from "./hooks";
import { platformerFiles } from "./platformer-template";
import { shooterFiles } from "./shooter-template";
import { sampleMeta, samplePng } from "./sample-art";

export type Template = "empty" | "platformer" | "shooter";

/** Makes `fs` a Brik project if it isn't one. Returns false if the user said no. */
export async function ensureProject(fs: ProjectFS, name: string, ask: boolean, template: Template = "empty"): Promise<boolean> {
  if (await isProject(fs)) return true;
  const empty = (await walk(fs)).length === 0;
  if (ask && !empty && !confirm(`"${fs.name}" er ikke et Brik-projekt. Vil du oprette et projekt i mappen?`)) return false;
  const files =
    template === "platformer"
      ? await platformerFiles()
      : template === "shooter"
        ? await shooterFiles()
        : {
          "assets/sample.png": await samplePng(),
          "assets/sample.png.meta.json": sampleMeta(newGuid()),
          "scripts/Rotator.ts": scriptTemplate("Rotator"),
        };
  await createProject(fs, name, files);
  return true;
}

export function StartScreen(props: { onOpen: (fs: ProjectFS) => void }) {
  const [projects, { refetch }] = createResource(() => listBrowserProjects().catch(() => [] as string[]));
  const [last] = createResource(() => lastFolder());
  const [newName, setNewName] = createSignal("");
  const [template, setTemplate] = createSignal<Template>("empty");
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");
  let zipInput!: HTMLInputElement;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : String(err));
      reportError(err);
    } finally {
      setBusy(false);
    }
  };

  const openFolder = (getFs: () => Promise<HandleFS>) =>
    run(async () => {
      const fs = await getFs();
      if (await ensureProject(fs, fs.name, true)) props.onOpen(fs);
    });

  const createBrowserProject = () =>
    run(async () => {
      const name = newName().trim();
      if (!name) return;
      if ((projects() ?? []).includes(name)) throw new Error(`Der findes allerede et projekt med navnet "${name}"`);
      const fs = await openBrowserProject(name, true);
      await ensureProject(fs, name, false, template());
      props.onOpen(fs);
    });

  const importZipProject = (file: File) =>
    run(async () => {
      let name = file.name.replace(/\.zip$/i, "");
      const existing = new Set(projects() ?? []);
      for (let i = 2; existing.has(name); i++) name = `${file.name.replace(/\.zip$/i, "")} ${i}`;
      const fs = await openBrowserProject(name, true);
      await importZip(fs, new Uint8Array(await file.arrayBuffer()));
      await ensureProject(fs, name, false);
      props.onOpen(fs);
    });

  return (
    <div class="start">
      <div class="start-card">
        <div>
          <h1>
            Brik<span>.</span>
          </h1>
          <p>Web-first 2D game engine. Vælg et projekt for at komme i gang.</p>
        </div>

        <Show when={isTauri()}>
          <div class="start-section">
            <h2>Mappe på din computer</h2>
            <p>Projekter er almindelige mapper, så du kan bruge git og dine egne værktøjer ved siden af.</p>
            <div class="inline-form">
              <button
                class="primary"
                disabled={busy()}
                onClick={() =>
                  run(async () => {
                    const fs = await pickTauriFolder();
                    if (fs && (await ensureProject(fs, fs.name, true, template()))) props.onOpen(fs);
                  })
                }
              >
                Åbn eller opret mappe…
              </button>
            </div>
            <For each={recentTauriFolders()}>
              {(path) => (
                <div class="project-row">
                  <span class="name" title={path}>
                    {path.split(/[\\/]/).pop()}
                  </span>
                  <span class="readonly" style={{ flex: 1, overflow: "hidden", "text-overflow": "ellipsis" }}>
                    {path}
                  </span>
                  <button
                    disabled={busy()}
                    onClick={() =>
                      run(async () => {
                        const fs = new TauriFS(path);
                        rememberTauriFolder(path);
                        if (await ensureProject(fs, fs.name, true, template())) props.onOpen(fs);
                      })
                    }
                  >
                    Åbn
                  </button>
                </div>
              )}
            </For>
          </div>
        </Show>

        <div class="start-section" style={{ display: isTauri() ? "none" : undefined }}>
          <h2>Mappe på din computer</h2>
          <Show
            when={supportsFolderPicker()}
            fallback={
              <p>
                Din browser kan ikke åbne mapper direkte (det kan Chrome og Edge). Brug et browser-projekt herunder, og
                eksportér det som .zip, når du vil have filerne ud.
              </p>
            }
          >
            <p>Editoren arbejder direkte i mappen, så du kan bruge git og dine egne værktøjer ved siden af.</p>
            <div class="inline-form">
              <button class="primary" disabled={busy()} onClick={() => openFolder(pickFolder)}>
                Åbn mappe…
              </button>
              <Show when={last()}>
                {(h) => (
                  <button disabled={busy()} onClick={() => openFolder(() => reopenFolder(h()))}>
                    Genåbn "{h().name}"
                  </button>
                )}
              </Show>
            </div>
          </Show>
        </div>

        <div class="start-section">
          <h2>Browser-projekter</h2>
          <p>Gemmes i browserens eget lager på denne maskine.</p>
          <For each={projects() ?? []}>
            {(name) => (
              <div class="project-row">
                <span class="name">{name}</span>
                <button
                  class="ghost danger"
                  disabled={busy()}
                  onClick={() =>
                    confirm(`Slet browser-projektet "${name}"? Det kan ikke fortrydes.`) &&
                    run(async () => {
                      await deleteBrowserProject(name);
                      refetch();
                    })
                  }
                >
                  Slet
                </button>
                <button
                  disabled={busy()}
                  onClick={() =>
                    run(async () => {
                      const fs = await openBrowserProject(name);
                      await ensureProject(fs, name, false);
                      props.onOpen(fs);
                    })
                  }
                >
                  Åbn
                </button>
              </div>
            )}
          </For>
          <form
            class="inline-form"
            onSubmit={(ev) => {
              ev.preventDefault();
              createBrowserProject();
            }}
          >
            <input
              type="text"
              placeholder="Navn på nyt projekt"
              value={newName()}
              onInput={(ev) => setNewName(ev.currentTarget.value)}
            />
            <select
              value={template()}
              onChange={(ev) => setTemplate(ev.currentTarget.value as Template)}
              title="Hvad projektet starter med"
              style={{ width: "auto" }}
            >
              <option value="empty">Tomt projekt</option>
              <option value="platformer">Platformer-eksempel</option>
              <option value="shooter">Top-down shooter-eksempel</option>
            </select>
            <button class="primary" type="submit" disabled={busy() || !newName().trim()}>
              Opret
            </button>
          </form>
          <div class="inline-form">
            <button disabled={busy()} onClick={() => zipInput.click()}>
              Importér .zip…
            </button>
            <input
              ref={zipInput}
              type="file"
              accept=".zip,application/zip"
              style={{ display: "none" }}
              onChange={(ev) => {
                const f = ev.currentTarget.files?.[0];
                ev.currentTarget.value = "";
                if (f) importZipProject(f);
              }}
            />
          </div>
        </div>
        <Show when={error()}>
          <p class="error">{error()}</p>
        </Show>
      </div>
    </div>
  );
}
