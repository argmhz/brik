import type { SpriteRef } from "@brik/runtime";
import { For, Show, createResource, createSignal } from "solid-js";
import { SCENE_EXTENSION, assetName, isImage, isScene, metaPath } from "../core/asset-db";
import type { Editor } from "../core/editor";
import { type FsEntry, joinPath, splitPath } from "../core/fs";
import { defaultScene, sceneToJson } from "../core/project";
import { isScriptFile, scriptTemplate, toClassName } from "../core/scripts";
import { openFile, setToolWindow } from "./ui-state";
import { openSceneSafely } from "./AssetInspector";
import { MenuItem, openPopup } from "./Popup";
import { SpriteThumb } from "./fields";
import { assetKindOf, clipThumb } from "./asset-fields";
import { DND, reportError, toast, useVersion } from "./hooks";

export function AssetBrowser(props: { editor: Editor }) {
  const editor = props.editor;
  const version = useVersion(editor, "assets", "selection", "scene");
  const [dir, setDir] = createSignal("");
  const [expanded, setExpanded] = createSignal(new Set<string>());
  const [dropping, setDropping] = createSignal(false);
  let fileInput!: HTMLInputElement;

  const [entries, { refetch }] = createResource(
    () => ({ dir: dir(), v: version() }),
    async ({ dir }) => {
      const list = await editor.fs.list(dir).catch(() => [] as FsEntry[]);
      return list.filter((e) => !e.name.endsWith(".meta.json"));
    },
  );

  const refresh = async () => {
    await editor.db.refresh();
    editor.emit("assets");
    editor.emit("world");
    refetch();
  };

  const importFiles = async (files: FileList | File[]) => {
    const list = await Promise.all(
      [...files].map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })),
    );
    if (list.length === 0) return;
    try {
      await editor.db.importFiles(list, dir() || "assets");
      if (!dir()) setDir("assets");
      const report = editor.db.lastImport;
      for (const w of report.warnings) editor.log("warn", `Import: ${w}`);
      const extra = report.created.length ? `, ${report.created.length} oprettet (sprites, animationer, prefabs)` : "";
      toast(
        report.warnings.length
          ? `Importeret med ${report.warnings.length} advarsel${report.warnings.length === 1 ? "" : "r"}. Se Console.`
          : `${list.length} fil${list.length === 1 ? "" : "er"} importeret${extra}`,
        report.warnings.length > 0,
      );
      editor.emit("assets");
    } catch (err) {
      reportError(err, "Import fejlede");
    }
  };

  const newFolder = async () => {
    const name = prompt("Navn på ny mappe:");
    if (!name) return;
    await editor.fs.mkdir(joinPath(dir(), name)).catch(reportError);
    refetch();
  };

  const newScene = async () => {
    const name = prompt("Navn på ny scene:", "level");
    if (!name) return;
    const path = joinPath(dir() || "scenes", `${name}${SCENE_EXTENSION}`);
    if (await editor.fs.exists(path)) return toast("Der findes allerede en scene med det navn", true);
    await editor.fs.writeFile(path, sceneToJson(defaultScene())).catch(reportError);
    editor.emit("assets");
    await openSceneSafely(editor, path);
  };

  const newScript = async () => {
    const name = prompt("Navn på nyt script (bliver også klassens navn):", "Player");
    if (!name) return;
    const cls = toClassName(name);
    const folder = dir().startsWith("scripts") ? dir() : "scripts";
    const path = joinPath(folder, `${cls}.ts`);
    if (await editor.fs.exists(path)) return toast(`${path} findes allerede`, true);
    try {
      await editor.fs.writeFile(path, scriptTemplate(cls));
      setDir(folder);
      editor.emit("assets");
      openFile(path);
      await editor.scripts.rebuild();
    } catch (err) {
      reportError(err, "Kunne ikke oprette scriptet");
    }
  };

  const remove = async (entry: FsEntry) => {
    if (!confirm(`Slet "${entry.path}"? Det kan ikke fortrydes.`)) return;
    try {
      await editor.fs.remove(entry.path);
      if (entry.kind === "file" && isImage(entry.path) && (await editor.fs.exists(metaPath(entry.path)))) {
        await editor.fs.remove(metaPath(entry.path));
      }
      if (editor.selectedAsset === entry.path) editor.selectAsset(null);
      await refresh();
    } catch (err) {
      reportError(err, "Kunne ikke slette");
    }
  };

  const contextMenu = (ev: MouseEvent, entry: FsEntry | null) => {
    ev.preventDefault();
    ev.stopPropagation();
    openPopup(ev.clientX, ev.clientY, () => (
      <>
        <MenuItem onClick={() => fileInput.click()}>Importér filer…</MenuItem>
        <MenuItem onClick={newFolder}>Ny mappe</MenuItem>
        <MenuItem onClick={newScene}>Ny scene</MenuItem>
        <MenuItem onClick={newScript}>Nyt script</MenuItem>
        <Show when={entry}>
          <div class="sep" />
          <MenuItem onClick={() => remove(entry!)}>Slet</MenuItem>
        </Show>
      </>
    ));
  };

  const crumbs = () => {
    const parts = splitPath(dir());
    return [{ name: "Projekt", path: "" }, ...parts.map((p, i) => ({ name: p, path: parts.slice(0, i + 1).join("/") }))];
  };

  const toggleExpand = (path: string) => {
    const next = new Set(expanded());
    if (next.has(path)) next.delete(path);
    else next.add(path);
    setExpanded(next);
  };

  const sprites = (path: string): SpriteRef[] => {
    version();
    const t = editor.db.textures.get(path);
    return t ? t.meta.sprites.map((s) => ({ texture: t.meta.guid, id: s.id })) : [];
  };

  const dragSprite = (ev: DragEvent, ref: SpriteRef) => {
    ev.dataTransfer!.setData(DND.sprite, JSON.stringify(ref));
    ev.dataTransfer!.effectAllowed = "copy";
  };

  return (
    <div class="panel" style={{ height: "100%" }}>
      <div class="asset-toolbar">
        <div class="breadcrumb">
          <For each={crumbs()}>
            {(c, i) => (
              <>
                <Show when={i() > 0}>
                  <span style={{ color: "var(--muted)" }}>/</span>
                </Show>
                <button class="ghost" onClick={() => setDir(c.path)}>
                  {c.name}
                </button>
              </>
            )}
          </For>
        </div>
        <button onClick={() => fileInput.click()} title="Importér billeder eller andre filer">
          Importér
        </button>
        <button onClick={newScene}>Ny scene</button>
        <button onClick={newScript}>Nyt script</button>
        <button onClick={refresh} title="Scan projektet igen">
          ⟳
        </button>
        <input
          ref={fileInput}
          type="file"
          multiple
          accept="image/*,audio/*,.json,.tmj,.tsj"
          style={{ display: "none" }}
          onChange={(ev) => {
            if (ev.currentTarget.files) importFiles(ev.currentTarget.files);
            ev.currentTarget.value = "";
          }}
        />
      </div>
      <div class="panel-body">
        <div
          class="asset-grid"
          classList={{ "drop-target": dropping() }}
          onContextMenu={(ev) => contextMenu(ev, null)}
          onClick={(ev) => ev.target === ev.currentTarget && editor.selectAsset(null)}
          onDragOver={(ev) => {
            if (ev.dataTransfer?.types.includes("Files")) {
              ev.preventDefault();
              setDropping(true);
            }
          }}
          onDragLeave={() => setDropping(false)}
          onDrop={(ev) => {
            setDropping(false);
            if (!ev.dataTransfer?.files.length) return;
            ev.preventDefault();
            importFiles(ev.dataTransfer.files);
          }}
        >
          <Show when={dir() !== ""}>
            <div class="asset" onDblClick={() => setDir(splitPath(dir()).slice(0, -1).join("/"))}>
              <div class="thumb">↩</div>
              <div class="name">..</div>
            </div>
          </Show>
          <For each={entries() ?? []}>
            {(entry) => {
              const tex = () => (version(), editor.db.textures.get(entry.path));
              const subs = () => sprites(entry.path);
              const isOpen = () => expanded().has(entry.path);
              const fullRef = (): SpriteRef | null => {
                const t = tex();
                if (!t) return null;
                return subs()[0] && t.meta.sprites.length > 0 ? subs()[0] : { texture: t.meta.guid, id: "" };
              };
              return (
                <>
                  <div
                    class="asset"
                    classList={{ selected: (version(), editor.selectedAsset === entry.path) }}
                    title={entry.path}
                    draggable={!!tex() || assetKindOf(entry.path) !== null}
                    onDragStart={(ev) => {
                      const ref = fullRef();
                      if (ref) dragSprite(ev, ref);
                      else if (assetKindOf(entry.path)) {
                        ev.dataTransfer!.setData(DND.asset, entry.path);
                        ev.dataTransfer!.effectAllowed = "copy";
                      }
                    }}
                    onClick={() => editor.selectAsset(entry.path)}
                    onDblClick={() => {
                      if (entry.kind === "directory") setDir(entry.path);
                      else if (isScene(entry.path)) openSceneSafely(editor, entry.path);
                      else if (isScriptFile(entry.path)) openFile(entry.path);
                      else if (isImage(entry.path)) setToolWindow({ kind: "sprite", path: entry.path });
                      else if (assetKindOf(entry.path) === "clip") setToolWindow({ kind: "animation", path: entry.path });
                    }}
                    onContextMenu={(ev) => contextMenu(ev, entry)}
                  >
                    <div class="thumb">
                      <Show
                        when={tex()?.url}
                        fallback={
                          assetKindOf(entry.path) === "clip" ? (
                            <SpriteThumb
                              editor={editor}
                              sprite={() => (version(), clipThumb(editor, editor.db.clips.get(entry.path)?.guid ?? null))}
                              size={40}
                            />
                          ) : assetKindOf(entry.path) === "prefab" ? (
                            "🧩"
                          ) : assetKindOf(entry.path) === "audio" ? (
                            "🔊"
                          ) : 
                          entry.kind === "directory"
                            ? "📁"
                            : isScene(entry.path)
                              ? "🎬"
                              : isScriptFile(entry.path)
                                ? "📜"
                                : "📄"
                        }
                      >
                        <img src={tex()!.url} alt="" draggable={false} />
                      </Show>
                    </div>
                    <div class="name">
                      {isScene(entry.path) || assetKindOf(entry.path) ? assetName(entry.path) : entry.name}
                    </div>
                    <Show when={subs().length > 0}>
                      <button
                        class="expand"
                        title={isOpen() ? "Skjul sprites" : "Vis sprites"}
                        onClick={(ev) => {
                          ev.stopPropagation();
                          toggleExpand(entry.path);
                        }}
                      >
                        {isOpen() ? "◀" : subs().length}
                      </button>
                    </Show>
                    <Show when={(version(), editor.settings.startScene === entry.path)}>
                      <span class="badge">start</span>
                    </Show>
                  </div>
                  <Show when={isOpen()}>
                    <For each={subs()}>
                      {(ref) => (
                        <div
                          class="asset sub"
                          draggable={true}
                          onDragStart={(ev) => dragSprite(ev, ref)}
                          title="Træk ind i scenen"
                        >
                          <div class="thumb">
                            <SpriteThumb editor={editor} sprite={() => ref} size={40} />
                          </div>
                          <div class="name">{tex()?.asset.sprites.get(ref.id)?.name}</div>
                        </div>
                      )}
                    </For>
                  </Show>
                </>
              );
            }}
          </For>
        </div>
      </div>
    </div>
  );
}
