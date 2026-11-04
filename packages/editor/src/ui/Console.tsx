import { For, Show, createSignal } from "solid-js";
import type { LogEntry, LogLevel } from "../core/console-log";
import type { Editor } from "../core/editor";
import { useVersion } from "./hooks";
import { openFile } from "./ui-state";

const ICON: Record<LogLevel, string> = { log: "·", info: "i", warn: "!", error: "✕" };

export function ConsolePanel(props: { editor: Editor }) {
  const editor = props.editor;
  const version = useVersion(editor, "console");
  const [hidden, setHidden] = createSignal(new Set<LogLevel>());
  let list!: HTMLDivElement;

  const entries = () => {
    version();
    const h = hidden();
    return editor.console.entries.filter((e) => !h.has(e.level));
  };

  const toggle = (level: LogLevel) => {
    const next = new Set(hidden());
    if (next.has(level)) next.delete(level);
    else next.add(level);
    setHidden(next);
  };

  const count = (level: LogLevel) => (version(), editor.console.count(level));

  const time = (e: LogEntry) => new Date(e.time).toLocaleTimeString("da-DK", { hour12: false });

  // keep scrolled to the bottom unless the user scrolled up
  let stick = true;
  const afterRender = () => {
    if (stick) requestAnimationFrame(() => (list.scrollTop = list.scrollHeight));
  };

  return (
    <div class="panel" style={{ height: "100%" }}>
      <div class="asset-toolbar">
        <button
          onClick={() => {
            editor.console.clear();
            editor.emit("console");
          }}
        >
          Ryd
        </button>
        <span class="spacer" style={{ flex: 1 }} />
        <button classList={{ active: !hidden().has("log") }} onClick={() => toggle("log")} title="Vis beskeder">
          · {count("log") + count("info")}
        </button>
        <button classList={{ active: !hidden().has("warn") }} onClick={() => toggle("warn")} title="Vis advarsler">
          ! {count("warn")}
        </button>
        <button classList={{ active: !hidden().has("error") }} onClick={() => toggle("error")} title="Vis fejl">
          ✕ {count("error")}
        </button>
      </div>
      <div
        class="panel-body console-list"
        ref={list}
        onScroll={() => (stick = list.scrollTop + list.clientHeight >= list.scrollHeight - 8)}
      >
        <For each={entries()} fallback={<div class="empty-note">Ingen beskeder</div>}>
          {(e) => {
            afterRender();
            return (
              <div
                class={`log-row ${e.level}`}
                classList={{ clickable: !!e.file }}
                title={e.file ? "Klik for at åbne i kode-editoren" : undefined}
                onClick={() => e.file && openFile(e.file, e.line, e.column)}
              >
                <span class="log-icon">{ICON[e.level]}</span>
                <span class="log-text">{e.text}</span>
                <Show when={e.count > 1}>
                  <span class="log-count">{e.count}</span>
                </Show>
                <span class="log-time">{time(e)}</span>
              </div>
            );
          }}
        </For>
      </div>
    </div>
  );
}
