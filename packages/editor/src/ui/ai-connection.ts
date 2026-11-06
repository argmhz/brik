import { createSignal } from "solid-js";
import { BridgeError, MUTATING, createBridgeHandlers } from "../core/ai-bridge";
import type { Editor } from "../core/editor";
import { captures } from "./captures";
import { showPanel } from "./dock-state";

/*
 * The editor's end of the AI bridge. When the user switches AI on, the editor
 * connects to the Brik MCP server on this machine (ws://127.0.0.1:5181) and
 * answers its requests. It keeps trying to reconnect while AI is on, so the
 * MCP server can be started before or after the editor.
 */

export const AI_PORT = 5181;
const KEY = "brik.ai.enabled";

export type AiState = "off" | "waiting" | "connected";
export const [aiState, setAiState] = createSignal<AiState>("off");
/** The last few things the AI did, newest last (shown in the button's tooltip). */
export const [aiActivity, setAiActivity] = createSignal<string[]>([]);

interface Request {
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

/**
 * Waits for the next frame, or a moment when no frame comes: a page that isn't
 * on screen gets no animation frames, and a hidden tab's timers may run only
 * once a minute, so there it just yields to the event loop.
 */
const nextFrame = () =>
  new Promise<void>((r) => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      const ch = new MessageChannel();
      ch.port1.onmessage = () => r();
      ch.port2.postMessage(0);
      return;
    }
    requestAnimationFrame(() => r());
    setTimeout(r, 50);
  });

/** Draws a view and returns it as a PNG data URL. Brings the view's tab to the front first. */
async function screenshot(view: "scene" | "game"): Promise<string | null> {
  showPanel(view);
  // let the tab lay out, so its canvas has a size
  await nextFrame();
  await nextFrame();
  return captures[view]?.() ?? null;
}

export function aiEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

/** Connects an open editor to the MCP server while AI is switched on. Returns a function that disconnects. */
export function startAiConnection(editor: Editor): { setEnabled: (on: boolean) => void; dispose: () => void } {
  const handlers = createBridgeHandlers(editor, { screenshot });
  let ws: WebSocket | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let enabled = false;

  const note = (text: string) => setAiActivity([...aiActivity().slice(-7), text]);

  const answer = async (req: Request) => {
    const handler = handlers[req.method];
    try {
      if (!handler) throw new BridgeError(`Unknown method ${req.method}`);
      if (MUTATING.has(req.method)) {
        const what = `AI: ${req.method}${req.params?.name ? ` (${req.params.name})` : ""}`;
        editor.log("info", what);
        note(what);
      }
      const result = await handler(req.params ?? {});
      ws?.send(JSON.stringify({ id: req.id, result: result ?? null }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      ws?.send(JSON.stringify({ id: req.id, error: message }));
      if (!(err instanceof BridgeError)) editor.log("error", `AI-kald ${req.method} fejlede: ${message}`);
    }
  };

  const connect = () => {
    retry = null;
    if (!enabled) return;
    setAiState("waiting");
    let socket: WebSocket;
    try {
      socket = new WebSocket(`ws://127.0.0.1:${AI_PORT}`);
    } catch {
      retry = setTimeout(connect, 2000);
      return;
    }
    ws = socket;
    socket.onopen = () => {
      socket.send(JSON.stringify({ type: "hello", app: "brik-editor", project: editor.settings.name }));
      setAiState("connected");
      editor.log("info", "AI forbundet via MCP");
    };
    socket.onmessage = (ev) => {
      let req: Request;
      try {
        req = JSON.parse(String(ev.data)) as Request;
      } catch {
        return;
      }
      if (typeof req.id === "number" && typeof req.method === "string") void answer(req);
    };
    socket.onclose = () => {
      if (ws === socket) ws = null;
      if (aiState() === "connected") editor.log("info", "AI afbrudt");
      if (enabled) {
        setAiState("waiting");
        retry = setTimeout(connect, 2000);
      } else setAiState("off");
    };
    socket.onerror = () => {
      // onclose follows and schedules the retry
    };
  };

  const stop = () => {
    if (retry) clearTimeout(retry);
    retry = null;
    const s = ws;
    ws = null;
    s?.close();
    setAiState("off");
  };

  const setEnabled = (on: boolean) => {
    enabled = on;
    try {
      localStorage.setItem(KEY, on ? "1" : "0");
    } catch {
      // not remembered
    }
    if (on && !ws && !retry) connect();
    if (!on) stop();
  };

  if (aiEnabled()) setEnabled(true);
  return {
    setEnabled,
    dispose: () => {
      enabled = false;
      stop();
    },
  };
}
