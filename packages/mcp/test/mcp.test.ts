/// <reference types="node" />
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Transform2D, findBySceneId, initPhysics } from "@brik/runtime";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { Editor, MemoryFS, createBridgeHandlers, createProject } from "@brik/editor";
// @ts-expect-error plain JS module
import { originAllowed } from "../src/bridge.mjs";

const PORT = 5191;
const serverPath = fileURLToPath(new URL("../src/server.mjs", import.meta.url));
const fakeDecode = async () => ({ width: 32, height: 16 }) as unknown as HTMLCanvasElement;

let client: Client;
let editor: Editor;
let socket: WebSocket | null = null;

type ToolResult = { isError?: boolean; content: { type: string; text?: string }[] };
const call = async (name: string, args: Record<string, unknown> = {}) => {
  const r = (await client.callTool({ name, arguments: args })) as ToolResult;
  const text = r.content[0]?.text ?? "";
  return { error: r.isError ? text : null, data: r.isError ? null : JSON.parse(text) };
};

/** A Brik editor in Node that connects to the MCP server like the browser editor does. */
function connectEditor(): Promise<void> {
  const handlers = createBridgeHandlers(editor);
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`, { origin: "http://localhost:5180" });
    socket = ws;
    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "hello", app: "brik-editor", project: editor.settings.name }));
      setTimeout(resolve, 50);
    });
    ws.on("error", reject);
    ws.on("message", async (raw) => {
      const req = JSON.parse(String(raw)) as { id: number; method: string; params: Record<string, unknown> };
      try {
        const result = await handlers[req.method](req.params ?? {});
        ws.send(JSON.stringify({ id: req.id, result: result ?? null }));
      } catch (err) {
        ws.send(JSON.stringify({ id: req.id, error: (err as Error).message }));
      }
    });
  });
}

beforeAll(async () => {
  await initPhysics();
  const fs = new MemoryFS("mcp");
  await createProject(fs, "MCP-test", {});
  editor = await Editor.open(fs, { decode: fakeDecode });
  client = new Client({ name: "brik-test", version: "0.0.0" });
  await client.connect(
    new StdioClientTransport({ command: process.execPath, args: [serverPath], env: { ...process.env, BRIK_MCP_PORT: String(PORT) } as Record<string, string>, stderr: "ignore" }),
  );
}, 20_000);

afterAll(async () => {
  socket?.close();
  await client?.close();
});

describe("Brik MCP server", () => {
  it("lists the tools and explains how to use them", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    for (const n of ["get_hierarchy", "create_entity", "set_fields", "write_script", "play", "screenshot"]) expect(names).toContain(n);
    expect(client.getInstructions()).toMatch(/RigidBody2D/);
  });

  it("tells the AI what to do when the editor is not connected", async () => {
    const r = await call("project_info");
    expect(r.error).toMatch(/AI" button/);
  }, 10_000);

  it("accepts only the editor's own origins", async () => {
    expect(originAllowed("http://localhost:5180")).toBe(true);
    expect(originAllowed("tauri://localhost")).toBe(true);
    expect(originAllowed(undefined)).toBe(true);
    expect(originAllowed("https://evil.example")).toBe(false);
    expect(originAllowed("http://localhost.evil.example")).toBe(false);
    const refused = await new Promise<boolean>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${PORT}`, { origin: "https://evil.example" });
      ws.on("open", () => resolve(false));
      ws.on("error", () => resolve(true));
    });
    expect(refused).toBe(true);
  });

  it("drives the editor: builds a falling box, plays it and undoes", async () => {
    await connectEditor();
    const info = await call("project_info");
    expect(info.data.name).toBe("MCP-test");

    const box = await call("create_entity", {
      kind: "rect",
      name: "Kasse",
      y: 120,
      components: { RigidBody2D: { type: "dynamic" }, Collider2D: { size: { x: 32, y: 32 } } },
    });
    expect(box.error).toBeNull();
    const floor = await call("create_entity", { kind: "rect", name: "Gulv", y: -40, components: { Collider2D: { size: { x: 400, y: 20 } } } });
    const bad = await call("set_fields", { id: floor.data.id, component: "Collider2D", values: { shape: "triangle" } });
    expect(bad.error).toMatch(/box, circle, capsule/);

    expect((await call("play")).data.mode).toBe("play");
    await call("step", { frames: 120 });
    const live = await call("inspect_entity", { id: box.data.id });
    expect(live.data.components.Transform2D.position.y).toBeLessThan(120);
    await call("stop");
    expect(editor.world.store(Transform2D).position.y[findBySceneId(editor.world, box.data.id)]).toBe(120);

    const tree = await call("get_hierarchy");
    expect(tree.data.map((n: { name: string }) => n.name)).toEqual(expect.arrayContaining(["Kasse", "Gulv"]));
    await call("undo");
    await call("undo");
    expect(findBySceneId(editor.world, floor.data.id)).toBe(-1);
  }, 20_000);
});
