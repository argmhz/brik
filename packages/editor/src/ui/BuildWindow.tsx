import type { PackItem, PackOptions, PackResult } from "@brik/runtime";
import { zipSync } from "fflate";
import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import type { Editor } from "../core/editor";
import { type AtlasPlan, type BuildSettings, DEFAULT_BUILD, type ExportResult, exportGame, planAtlas } from "../core/export";
import { HandleFS, type ProjectFS } from "../core/fs";
import { isTauri, pickTauriFolder, saveBytes } from "../core/tauri-fs";
import { NumberBox, TextBox } from "./fields";
import { reportError, toast, typingInField } from "./hooks";

// ------------------------------------------------------------------ atlas helpers (browser)

let worker: Worker | null = null;
let nextJob = 1;
const jobs = new Map<number, (r: PackResult) => void>();

/** Packs in a Web Worker so the editor stays responsive. */
function packInWorker(items: PackItem[], options: PackOptions): Promise<PackResult> {
  if (!worker) {
    worker = new Worker(new URL("./atlas-worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (ev: MessageEvent<{ id: number; result: PackResult }>) => {
      jobs.get(ev.data.id)?.(ev.data.result);
      jobs.delete(ev.data.id);
    };
  }
  const id = nextJob++;
  return new Promise((resolve) => {
    jobs.set(id, resolve);
    worker!.postMessage({ id, items, options });
  });
}

/** Draws an atlas page, repeating each image's edge pixels `extrude` times outward. */
function drawPageCanvas(page: AtlasPlan["pages"][number], extrude: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = page.w;
  c.height = page.h;
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  for (const p of page.placements) {
    const src = p.entry.asset.source as CanvasImageSource | null;
    if (!src) continue;
    const w = p.entry.asset.width;
    const h = p.entry.asset.height;
    const e = extrude;
    ctx.drawImage(src, p.x, p.y);
    if (e > 0) {
      ctx.drawImage(src, 0, 0, 1, h, p.x - e, p.y, e, h);
      ctx.drawImage(src, w - 1, 0, 1, h, p.x + w, p.y, e, h);
      ctx.drawImage(src, 0, 0, w, 1, p.x, p.y - e, w, e);
      ctx.drawImage(src, 0, h - 1, w, 1, p.x, p.y + h, w, e);
      ctx.drawImage(src, 0, 0, 1, 1, p.x - e, p.y - e, e, e);
      ctx.drawImage(src, w - 1, 0, 1, 1, p.x + w, p.y - e, e, e);
      ctx.drawImage(src, 0, h - 1, 1, 1, p.x - e, p.y + h, e, e);
      ctx.drawImage(src, w - 1, h - 1, 1, 1, p.x + w, p.y + h, e, e);
    }
  }
  return c;
}

async function drawPage(page: AtlasPlan["pages"][number], extrude: number): Promise<Uint8Array> {
  const c = drawPageCanvas(page, extrude);
  const blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("toBlob failed"))), "image/png"));
  return new Uint8Array(await blob.arrayBuffer());
}

const kb = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(2)} MB`);

// ------------------------------------------------------------------ window

/** "Byg": atlas settings and preview, then export as a zip (itch.io) or to a folder. */
export function BuildWindow(props: { editor: Editor; onClose: () => void }) {
  const editor = props.editor;
  const [settings, setSettings] = createSignal<BuildSettings>(structuredClone(editor.settings.build ?? DEFAULT_BUILD));
  const [plan, setPlan] = createSignal<AtlasPlan | null>(null);
  const [result, setResult] = createSignal<ExportResult | null>(null);
  const [busy, setBusy] = createSignal("");
  const [page, setPage] = createSignal(0);

  const update = (patch: Partial<BuildSettings>, pack?: Partial<PackOptions>) => {
    const next = { ...settings(), ...patch, pack: { ...settings().pack, ...pack } };
    setSettings(next);
    setResult(null);
    void editor.updateSettings({ build: next }).catch(reportError);
    void replan();
  };

  const replan = async () => {
    try {
      setPlan(await planAtlas(editor, settings(), packInWorker));
      setPage((p) => Math.min(p, Math.max(0, (plan()?.pages.length ?? 1) - 1)));
    } catch (err) {
      reportError(err, "Atlas fejlede");
    }
  };

  const build = async (): Promise<ExportResult | null> => {
    setBusy("Bygger …");
    try {
      const [{ default: brik }, { default: physics }, esbuild] = await Promise.all([
        import("../generated/brik.js?raw"),
        import("../generated/brik-physics.js?raw"),
        editor.scripts.compiler(),
      ]);
      const playerFiles = { "brik.js": brik, "brik-physics.js": physics };
      const r = await exportGame(editor, { esbuild, playerFiles, drawPage, pack: packInWorker }, settings());
      setResult(r);
      return r;
    } catch (err) {
      reportError(err, "Byg fejlede");
      return null;
    } finally {
      setBusy("");
    }
  };

  const fileName = () => (settings().title?.trim() || editor.settings.name).replace(/[\\/:*?"<>|]/g, "_");

  const downloadZip = async () => {
    const r = await build();
    if (!r) return;
    const zip = zipSync(r.files, { level: 6 });
    if (!(await saveBytes(`${fileName()}-web.zip`, zip, "application/zip"))) return;
    toast(`Spillet er pakket (${kb(zip.length)}). Upload zip-filen på itch.io som et HTML-spil.`);
  };

  const toFolder = async () => {
    if (isTauri()) {
      const out = await pickTauriFolder("Vælg mappe til det færdige spil");
      if (!out) return;
      const r = await build();
      if (!r) return;
      await writeAll(out, r.files, out.name);
      return;
    }
    const picker = (window as unknown as { showDirectoryPicker?: (o: object) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
    if (!picker) {
      toast("Din browser kan ikke skrive til mapper. Brug zip i stedet.", true);
      return;
    }
    let handle: FileSystemDirectoryHandle;
    try {
      handle = await picker.call(window, { mode: "readwrite", id: "brik-export" });
    } catch {
      return; // cancelled
    }
    const r = await build();
    if (!r) return;
    await writeAll(new HandleFS(handle, "fsa"), r.files, handle.name);
  };

  const writeAll = async (out: ProjectFS, files: Record<string, Uint8Array>, name: string) => {
    setBusy("Skriver filer …");
    try {
      for (const [path, bytes] of Object.entries(files)) await out.writeFile(path, bytes);
      toast(`${Object.keys(files).length} filer skrevet til ${name}`);
    } catch (err) {
      reportError(err, "Kunne ikke skrive filerne");
    } finally {
      setBusy("");
    }
  };

  // preview of the selected page
  let preview!: HTMLDivElement;
  const showPage = () => {
    const p = plan()?.pages[page()];
    preview.replaceChildren();
    if (!p) return;
    const c = drawPageCanvas(p, settings().pack.extrude);
    c.className = "atlas-page";
    preview.append(c);
  };

  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === "Escape" && !typingInField()) {
      ev.stopPropagation();
      props.onClose();
    }
  };
  onMount(() => {
    window.addEventListener("keydown", onKey, true);
    void replan().then(showPage);
  });
  onCleanup(() => window.removeEventListener("keydown", onKey, true));

  const s = settings;
  return (
    <div class="tool-window">
      <div class="tool-header">
        <strong>Byg spillet</strong>
        <span class="readonly">statisk web · itch.io</span>
        <span class="spacer" />
        <Show when={busy()}>
          <span class="readonly">{busy()}</span>
        </Show>
        <button onClick={toFolder} disabled={!!busy()} title="Skriv de færdige filer til en mappe">
          Eksportér til mappe…
        </button>
        <button class="primary" onClick={downloadZip} disabled={!!busy()} title="En zip, der kan uploades direkte på itch.io">
          Eksportér .zip
        </button>
        <button onClick={props.onClose}>Luk</button>
      </div>
      <div class="tool-body">
        <div class="tool-canvas atlas-view">
          <div class="atlas-tabs">
            <For each={plan()?.pages ?? []}>
              {(p, i) => (
                <button
                  classList={{ active: page() === i() }}
                  onClick={() => {
                    setPage(i());
                    showPage();
                  }}
                >
                  {p.standalone ? p.standalone.path.split("/").pop() : `Atlas ${i() + 1}`}
                  <span class="readonly">
                    {" "}
                    {p.w}×{p.h} · {Math.round(p.used * 100)}%
                  </span>
                </button>
              )}
            </For>
          </div>
          <div class="atlas-preview" ref={preview} />
          <Show when={plan()?.pages[page()]}>
            {(p) => (
              <div class="tool-hint">
                {p().standalone
                  ? p().wrap === "repeat"
                    ? "Gentages (wrap: repeat), så den får sin egen side"
                    : "Egen side"
                  : `${p().placements.length} billeder · filter ${p().filter}: ${p().placements.map((x) => x.entry.asset.name).join(", ")}`}
              </div>
            )}
          </Show>
        </div>
        <div class="tool-side">
          <div class="section-title">Spil</div>
          <div class="component-body">
            <span class="field-label">Titel</span>
            <TextBox value={() => s().title ?? ""} placeholder={editor.settings.name} onCommit={(title) => update({ title })} />
            <span class="field-label">Startscene</span>
            <span class="readonly">{editor.settings.startScene}</span>
          </div>
          <div class="section-title">Atlas</div>
          <div class="component-body">
            <span class="field-label">Pak billeder</span>
            <input type="checkbox" checked={s().atlas} onChange={(e) => update({ atlas: e.currentTarget.checked })} />
            <span class="field-label">Maks. størrelse</span>
            <select value={s().pack.maxSize} onChange={(e) => update({}, { maxSize: Number(e.currentTarget.value) })}>
              <For each={[512, 1024, 2048, 4096]}>{(n) => <option value={n}>{n}</option>}</For>
            </select>
            <span class="field-label" title="Tomme pixels mellem billederne">
              Padding
            </span>
            <NumberBox value={() => s().pack.padding} integer min={0} max={16} onCommit={(padding) => update({}, { padding })} />
            <span class="field-label" title="Gentager kantpixels udad, så kanterne ikke bløder ved skæve zoom-niveauer">
              Extrude
            </span>
            <NumberBox value={() => s().pack.extrude} integer min={0} max={8} onCommit={(extrude) => update({}, { extrude })} />
            <span class="field-label">Power of two</span>
            <input type="checkbox" checked={s().pack.pot} onChange={(e) => update({}, { pot: e.currentTarget.checked })} />
          </div>
          <Show when={(plan()?.warnings.length ?? 0) > 0}>
            <div class="section-title">Advarsler</div>
            <div class="readonly hint">
              <For each={plan()!.warnings}>{(w) => <div>⚠ {w}</div>}</For>
            </div>
          </Show>
          <Show
            when={result()}
            fallback={<div class="readonly hint">Tryk "Eksportér" for at bygge. Rapporten over filstørrelser vises her bagefter.</div>}
          >
            {(r) => (
              <>
                <div class="section-title">
                  Byg-rapport · {kb(r().report.reduce((n, f) => n + f.bytes, 0))}
                </div>
                <div class="report">
                  <For each={r().report}>
                    {(f) => (
                      <div class="report-row">
                        <span>{f.path}</span>
                        <span class="readonly">{kb(f.bytes)}</span>
                      </div>
                    )}
                  </For>
                </div>
                <For each={r().warnings}>{(w) => <div class="readonly hint">⚠ {w}</div>}</For>
              </>
            )}
          </Show>
          <div class="readonly hint">
            Spillet er en statisk mappe med <code>index.html</code>. Det kan lægges på itch.io (upload zip som HTML-spil), GitHub Pages eller
            enhver webserver. Det skal serveres over http, ikke åbnes direkte som fil.
          </div>
        </div>
      </div>
    </div>
  );
}
