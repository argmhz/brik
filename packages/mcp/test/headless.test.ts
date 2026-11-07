/// <reference types="node" />
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/*
 * Headless mode: no editor connects, so the MCP server opens a copy of the
 * Mosehop example itself and the AI works on it through the normal tools.
 */

const PORT = 5192;
const serverPath = fileURLToPath(new URL("../src/server.mjs", import.meta.url));
const mosehop = fileURLToPath(new URL("../../../examples/mosehop", import.meta.url));

let client: Client;
let dir: string;

type ToolResult = { isError?: boolean; content: { type: string; text?: string }[] };
const call = async (name: string, args: Record<string, unknown> = {}) => {
  const r = (await client.callTool({ name, arguments: args })) as ToolResult;
  const text = r.content[0]?.text ?? "";
  return { error: r.isError ? text : null, data: r.isError ? null : JSON.parse(text) };
};

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "brik-headless-"));
  cpSync(mosehop, dir, { recursive: true });
  client = new Client({ name: "brik-test", version: "0.0.0" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [serverPath],
      env: { ...process.env, BRIK_MCP_PORT: String(PORT) } as Record<string, string>,
      stderr: "ignore",
    }),
  );
}, 20_000);

afterAll(async () => {
  await client?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("Brik MCP server, headless", () => {
  it("points to open_project when the editor isn't connected", async () => {
    const r = await call("project_info");
    expect(r.error).toMatch(/open_project/);
    expect((await call("open_project", { path: join(dir, "scenes") })).error).toMatch(/not a Brik project/);
  }, 15_000);

  it("opens a project folder, plays it and saves to disk", async () => {
    const opened = await call("open_project", { path: dir });
    expect(opened.error).toBeNull();
    expect(opened.data).toMatchObject({ name: "Mosehop", headless: true, scripts: { status: "ok" } });

    // a script that logs: the text must reach get_console, and not break the protocol on stdout
    const script = await call("write_script", {
      path: "scripts/Hello.ts",
      content: `import { Behaviour } from "brik";\nexport class Hello extends Behaviour {\n  onStart() { console.log("hej fra headless"); }\n}\n`,
    });
    expect(script.data.status).toBe("ok");
    expect(existsSync(join(dir, "scripts/Hello.ts"))).toBe(true);
    const { id } = (await call("create_entity", { name: "Greeter" })).data;
    await call("attach_script", { id, script: "Hello" });

    const [player] = (await call("find_entities", { name: "Player" })).data;
    const x0 = (await call("inspect_entity", { id: player.id })).data.components.Transform2D.position.x;
    expect((await call("play")).error).toBeNull();
    await call("step", { frames: 30, hold: ["ArrowRight"] });
    const x1 = (await call("inspect_entity", { id: player.id })).data.components.Transform2D.position.x;
    expect(x1).toBeGreaterThan(x0 + 10);
    const shot = await call("screenshot", {});
    expect(shot.error).toMatch(/headless/);
    await call("stop");
    const log = JSON.stringify((await call("get_console", {})).data);
    expect(log).toContain("hej fra headless");

    // unsaved changes are protected, and save_scene writes the scene file
    expect((await call("close_project")).error).toMatch(/unsaved/);
    expect((await call("save_scene")).error).toBeNull();
    expect(readFileSync(join(dir, "scenes/main.scene.json"), "utf8")).toContain("Greeter");
    expect((await call("close_project")).data.closed).toBe(dir);
    expect((await call("project_info")).error).toMatch(/not connected/);
  }, 60_000);
});
