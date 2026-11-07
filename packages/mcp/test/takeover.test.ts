/// <reference types="node" />
import { createServer } from "node:net";
import { afterAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
// @ts-expect-error plain JS module
import { EditorBridge } from "../src/bridge.mjs";

/*
 * Two MCP servers (two AI sessions) want the same port: the newer one asks the
 * older one to let go, and the editor follows by reconnecting.
 */

const PORT = 5194;
const quiet = () => {};
const open: { close(): unknown }[] = [];
afterAll(async () => {
  for (const o of open) await o.close();
});

/** A stand-in for the editor: says hello and answers every call with its own name. */
function fakeEditor(name: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`, { origin: "http://localhost:5180" });
    open.push({ close: () => ws.close() });
    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "hello", app: "brik-editor", project: name }));
      setTimeout(() => resolve(ws), 50);
    });
    ws.on("error", reject);
    ws.on("message", (raw) => {
      const req = JSON.parse(String(raw)) as { id: number; method: string };
      ws.send(JSON.stringify({ id: req.id, result: { from: name, method: req.method } }));
    });
  });
}

describe("port takeover between MCP servers", () => {
  it("the newer server takes the port, the editor follows, and the older one explains", async () => {
    const older = new EditorBridge({ port: PORT, log: quiet });
    const newer = new EditorBridge({ port: PORT, log: quiet });
    open.push(older, newer);

    await older.start();
    const editorToOlder = await fakeEditor("Spil");
    expect(await older.call("project_info")).toEqual({ from: "Spil", method: "project_info" });

    // the second server starts: it asks the first to let go and listens itself
    const closed = new Promise<number>((resolve) => editorToOlder.on("close", (code) => resolve(code)));
    await newer.start();
    expect(await closed).toBe(4001);
    expect(older.displaced).toBe(true);
    expect(older.connected).toBe(false);

    // the editor reconnects on its own (here: we do what the editor's retry does)
    await fakeEditor("Spil");
    expect(await newer.call("project_info")).toEqual({ from: "Spil", method: "project_info" });

    // the older one says what happened instead of waiting for an editor that went elsewhere
    await expect(older.call("project_info")).rejects.toThrow(/newer Brik MCP server/);
    // and it doesn't fight for the port again
    await new Promise((r) => setTimeout(r, 3500));
    expect(older.server).toBeNull();
    expect(newer.connected).toBe(true);
  }, 15_000);

  it("waits instead of taking over when something else holds the port", async () => {
    const blocker = createServer();
    const sockets: { destroy(): void }[] = [];
    blocker.on("connection", (s) => sockets.push(s));
    await new Promise<void>((resolve) => blocker.listen(5195, "127.0.0.1", resolve));
    open.push({
      close: () => {
        for (const s of sockets) s.destroy();
        return new Promise((r) => blocker.close(r));
      },
    });
    const bridge = new EditorBridge({ port: 5195, log: quiet });
    open.push(bridge);
    const t0 = Date.now();
    await bridge.start();
    // it gave up quickly (the takeover request got no answer) and keeps retrying in the background
    expect(Date.now() - t0).toBeLessThan(6000);
    expect(bridge.server).toBeNull();
    expect(bridge.displaced).toBe(false);
    expect(bridge.connected).toBe(false);
  }, 15_000);
});
