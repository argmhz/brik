#!/usr/bin/env node
// Takes the screenshots used in the docs, from a running editor (make editor) in a headless Chromium.
//
//   node scripts/docs/screenshots.mjs [--url http://localhost:5180] [--out docs/images]
//
// It makes a fresh browser project from the platformer template, so the pictures always show the real,
// current editor. Re-run it when the editor's looks change, and commit the new pictures.

import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const URL_ = arg("url", "http://localhost:5180");
const OUT = resolve(arg("out", join(here, "../../docs/images")));
const PORT = 9333;
const W = 1360;
const H = 820;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A minimal Chrome DevTools Protocol client. */
async function connect() {
  let targets;
  for (let i = 0; i < 50; i++) {
    try {
      targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      if (targets.length) break;
    } catch {}
    await sleep(200);
  }
  const page = targets?.find((t) => t.type === "page");
  if (!page) throw new Error("Chromium did not start");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
    }
  };
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      pending.set(++id, { res, rej });
      ws.send(JSON.stringify({ id, method, params }));
    });
  return { send, close: () => ws.close() };
}

const chromium = spawn(
  "chromium",
  ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${await mkdtemp(join(tmpdir(), "brik-shots-"))}`, `--window-size=${W},${H}`, "--hide-scrollbars", "--force-device-scale-factor=1", "--no-first-run", "--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader", "about:blank"],
  { stdio: "ignore" },
);

try {
  await mkdir(OUT, { recursive: true });
  const cdp = await connect();
  const { send } = cdp;
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });

  const js = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  const until = async (expression, what, ms = 20000) => {
    for (let t = 0; t < ms; t += 200) {
      if (await js(`Boolean(${expression})`)) return;
      await sleep(200);
    }
    throw new Error(`Timed out waiting for ${what}`);
  };
  const shot = async (name) => {
    const { data } = await send("Page.captureScreenshot", { format: "png" });
    await writeFile(join(OUT, name), Buffer.from(data, "base64"));
    console.log(`  ${name}`);
  };
  // helpers that run in the page
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: `
      window.__text = (sel, text) => [...document.querySelectorAll(sel)].find((n) => n.textContent.trim() === text);
      window.__click = (el) => el && el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      window.__dbl = (el) => el && el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
      window.__set = (el, v) => {
        const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };
    `,
  });

  await send("Page.navigate", { url: URL_ });
  await until(`document.querySelector('input[placeholder="Navn på nyt projekt"]')`, "the start screen");
  await sleep(500);
  // the start screen is small: a smaller window, so the picture is not mostly empty
  await send("Emulation.setDeviceMetricsOverride", { width: 760, height: 430, deviceScaleFactor: 1, mobile: false });
  await sleep(300);
  await shot("start.png");
  await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });

  // a fresh platformer project
  await js(`(() => {
    __set(document.querySelector('input[placeholder="Navn på nyt projekt"]'), 'Platformer');
    __set(document.querySelector('select'), 'platformer');
  })()`);
  await js(`__click(__text('button', 'Opret'))`);
  await until(`document.querySelector('.workspace') && window.editor && window.editor.world.entityCount > 3`, "the editor");
  await sleep(2500);

  // the editor with the player selected (a real mouse click on its row)
  const row = await js(`(() => { const el = [...document.querySelectorAll('*')].filter((n) => n.children.length === 0 && n.textContent.trim() === 'Player').pop(); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
    await send("Input.dispatchMouseEvent", { type, x: row.x, y: row.y, button: "left", buttons: type === "mousePressed" ? 1 : 0, clickCount: 1 });
  }
  await sleep(700);
  await shot("editor.png");

  // the game running
  await js(`__click([...document.querySelectorAll('button')].find((b) => b.textContent.includes('Play')))`);
  await sleep(300);
  await js(`__click(__text('button, [role=tab], .tab', 'Spil'))`);
  await sleep(2200);
  await shot("spil.png");
  await js(`__click([...document.querySelectorAll('button')].find((b) => b.textContent.includes('Stop')))`);
  await sleep(500);

  // a script in the code editor
  await js(`__dbl(document.querySelector('.asset[title="scripts"]'))`);
  await sleep(500);
  await js(`__dbl(document.querySelector('.asset[title="scripts/Player.ts"]'))`);
  await sleep(1500);
  await shot("kode.png");

  // the sprite editor (back to the project's root first)
  await js(`__click(__text('button, span, a', 'Projekt'))`);
  await sleep(400);
  await js(`__dbl(document.querySelector('.asset[title="assets"]'))`);
  await sleep(600);
  await js(`__dbl(document.querySelector('.asset[title="assets/hero.png"]'))`);
  await sleep(1500);
  await shot("sprite-editor.png");
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await sleep(500);

  // the build window
  await js(`__click(__text('button', 'Byg spil'))`);
  await sleep(2500);
  await shot("byg.png");
  cdp.close();
} finally {
  chromium.kill();
}
// (the temporary profile is in the OS temp folder)
