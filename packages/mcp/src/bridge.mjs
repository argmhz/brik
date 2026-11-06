// The MCP server's end of the bridge: a WebSocket server on this machine that
// the Brik editor connects to. Requests go out as { id, method, params } and
// come back as { id, result } or { id, error }.

import { WebSocketServer } from "ws";

/** Browser pages that may connect: the editor on localhost, or the desktop app. */
const ALLOWED_ORIGIN = /^(https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?|tauri:\/\/localhost|https?:\/\/tauri\.localhost)$/;

export function originAllowed(origin) {
  // tools like Node clients send no Origin; any web page does, so only those are checked
  return origin === undefined || ALLOWED_ORIGIN.test(origin);
}

export class EditorBridge {
  /** @param {{ port?: number, host?: string, log?: (msg: string) => void, timeoutMs?: number }} opts */
  constructor(opts = {}) {
    this.port = opts.port ?? 5181;
    this.host = opts.host ?? "127.0.0.1";
    this.log = opts.log ?? ((msg) => process.stderr.write(`[brik-mcp] ${msg}\n`));
    this.timeoutMs = opts.timeoutMs ?? 60_000;
    /** @type {import("ws").WebSocket | null} */
    this.editor = null;
    this.project = null;
    this.nextId = 1;
    /** @type {Map<number, { resolve: (v: unknown) => void, reject: (e: Error) => void, timer: NodeJS.Timeout }>} */
    this.pending = new Map();
    this.waiters = new Set();
    this.server = null;
    this.closed = false;
  }

  /** Starts listening. If the port is taken (e.g. another AI session), keeps trying. */
  start() {
    return new Promise((resolve) => {
      const listen = () => {
        if (this.closed) return resolve();
        const wss = new WebSocketServer({
          host: this.host,
          port: this.port,
          verifyClient: ({ origin }) => originAllowed(origin),
        });
        wss.on("listening", () => {
          this.server = wss;
          this.log(`waiting for the Brik editor on ws://${this.host}:${this.port}`);
          resolve();
        });
        wss.on("error", (err) => {
          if (err.code === "EADDRINUSE" && !this.server) {
            this.log(`port ${this.port} is in use (another Brik MCP server?), retrying in 3 s`);
            wss.close();
            setTimeout(listen, 3000);
            resolve(); // the MCP side can start meanwhile; tools report that the editor isn't connected
          } else this.log(`websocket error: ${err.message}`);
        });
        wss.on("connection", (socket) => this.accept(socket));
      };
      listen();
    });
  }

  accept(socket) {
    socket.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (msg.type === "hello") {
        // the newest editor wins; an older connection is closed
        if (this.editor && this.editor !== socket) this.editor.close(4000, "another editor connected");
        this.editor = socket;
        this.project = msg.project ?? null;
        this.log(`editor connected (project: ${this.project ?? "?"})`);
        for (const w of this.waiters) w();
        this.waiters.clear();
        return;
      }
      const call = this.pending.get(msg.id);
      if (!call) return;
      this.pending.delete(msg.id);
      clearTimeout(call.timer);
      if (msg.error !== undefined) call.reject(new Error(String(msg.error)));
      else call.resolve(msg.result);
    });
    socket.on("close", () => {
      if (this.editor !== socket) return;
      this.editor = null;
      this.log("editor disconnected");
      for (const [id, call] of this.pending) {
        clearTimeout(call.timer);
        call.reject(new Error("The Brik editor disconnected while working on this request."));
        this.pending.delete(id);
      }
    });
  }

  get connected() {
    return this.editor !== null && this.editor.readyState === 1;
  }

  /** Waits a little for the editor, so a call right after it reconnects still works. */
  waitForEditor(ms = 3000) {
    if (this.connected) return Promise.resolve(true);
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        resolve(true);
      };
      const timer = setTimeout(() => {
        this.waiters.delete(done);
        resolve(false);
      }, ms);
      this.waiters.add(done);
    });
  }

  /** Calls a handler in the editor. */
  async call(method, params = {}) {
    if (!(await this.waitForEditor())) {
      throw new Error(
        "The Brik editor is not connected. Ask the user to open their project in the Brik editor " +
          `(make editor, http://localhost:5180) and click the "AI" button in the menu bar so it turns green. ` +
          `The editor connects to ws://127.0.0.1:${this.port}.`,
      );
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`The editor did not answer ${method} within ${this.timeoutMs / 1000} s`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.editor.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.closed = true;
    for (const call of this.pending.values()) clearTimeout(call.timer);
    this.editor?.close();
    return new Promise((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }
}
