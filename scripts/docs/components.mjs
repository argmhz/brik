// The component reference page, generated from the engine itself: every
// component's fields, types, defaults and allowed values come from the real
// schemas, so the page can't drift from the code. Descriptions are the doc
// comments in the source (found by a simple scan; they are in English).

import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const AREAS = {
  core: ["Kerne", "Navn, transform, hierarki, tilemaps, tweens, timere og tags."],
  assets: ["Assets", "Teksturer, sprites og animationsklip."],
  render: ["Grafik og UI", "Kamera, sprites, former, tekst, animation, partikler og alt UI."],
  physics: ["Fysik", "Kroppe, colliders, figurstyring og led."],
  audio: ["Lyd", "Lydkilder og lytter."],
  input: ["Input", "Tastatur, mus og action-mapping."],
  runtime: ["Scripts og prefabs", "Scripts på entities, prefab-instanser og spawnere."],
};

/** Collects `defineComponent("Name", { ... })` doc comments from the source: name -> { area, doc, fields }. */
export async function scanComponentDocs(root) {
  const found = new Map();
  const packages = await readdir(join(root, "packages"));
  for (const pkg of packages) {
    const dir = join(root, "packages", pkg, "src");
    const files = await listTs(dir).catch(() => []);
    for (const file of files) {
      const src = await readFile(file, "utf8");
      const re = /defineComponent\(\s*"([A-Za-z0-9_]+)"/g;
      for (let m = re.exec(src); m; m = re.exec(src)) {
        const before = src.slice(0, m.index);
        // the comment right before `export const X =`: its body can't contain a comment end
        const docMatch = /\/\*\*((?:(?!\*\/)[\s\S])*)\*\/\s*export const \w+ =\s*$/.exec(before);
        found.set(m[1], { area: pkg, doc: docMatch ? cleanComment(docMatch[1]) : "", fields: scanFields(src, m.index + m[0].length) });
      }
    }
  }
  return found;
}

async function listTs(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await listTs(p)));
    else if (e.name.endsWith(".ts") && !e.name.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

/** A doc comment's text: stars removed, first paragraph only, code samples dropped. */
function cleanComment(body) {
  const lines = body.split("\n").map((l) => l.replace(/^\s*\*?\s?/, ""));
  const out = [];
  for (const l of lines) {
    if (/^```/.test(l) || (out.length && l.trim() === "")) break;
    out.push(l.trim());
  }
  return out.join(" ").replace(/\s+/g, " ").trim();
}

/** Field doc comments inside a component's schema object. */
function scanFields(src, from) {
  const fields = new Map();
  const start = src.indexOf("{", from);
  if (start < 0) return fields;
  let depth = 0;
  let i = start;
  let comment = "";
  let lineStart = true;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (src.startsWith("/**", i)) {
      const end = src.indexOf("*/", i);
      if (end < 0) break;
      if (depth === 1) comment = cleanComment(src.slice(i + 3, end));
      i = end + 1;
      continue;
    }
    if (src.startsWith("//", i)) {
      i = src.indexOf("\n", i);
      if (i < 0) break;
      continue;
    }
    if (ch === "{" || ch === "(" || ch === "[") depth++;
    else if (ch === "}" || ch === ")" || ch === "]") {
      depth--;
      if (depth === 0) break;
    } else if (depth === 1 && lineStart && /[A-Za-z_]/.test(ch)) {
      const m = /^([A-Za-z_]\w*)\s*:/.exec(src.slice(i, i + 80));
      if (m) {
        fields.set(m[1], comment);
        comment = "";
      }
    }
    if (ch === "\n") lineStart = true;
    else if (!/\s/.test(ch)) lineStart = false;
  }
  return fields;
}

const num = (v) => String(Number(Number(v).toPrecision(7)));

/** A field's type in words. */
function typeOf(field, value) {
  const meta = field.meta ?? {};
  if (meta.options) return meta.options.map((o) => `\`${o}\``).join(" · ");
  switch (field.kind) {
    case "f32":
    case "f64":
      return meta.editor === "angle" ? "vinkel (radianer)" : "tal";
    case "i32":
    case "u32":
    case "u8":
      return "heltal";
    case "bool":
      return "ja/nej";
    case "entity":
      return "entity";
    case "vec2":
      return "(x, y)";
    case "color":
      return "farve (r, g, b, a: 0–1)";
    case "rect":
      return "rektangel (x, y, b, h)";
    case "ref": {
      const labels = { sprite: "sprite", texture: "tekstur", clip: "animationsklip", prefab: "prefab", audio: "lyd", tags: "liste af tags", points: "liste af punkter", multiline: "tekst", enum: "valg" };
      if (labels[meta.editor]) return labels[meta.editor];
      if (typeof value === "string") return "tekst";
      if (Array.isArray(value)) return "liste";
      return "værdi";
    }
    default:
      return field.kind;
  }
}

/** A default value as text. */
function defaultOf(field, value) {
  const meta = field.meta ?? {};
  if (field.kind === "entity") return "ingen";
  if (value === null || value === undefined) return "–";
  if (typeof value === "number") return meta.editor === "angle" ? `${num((value * 180) / Math.PI)}°` : num(value);
  if (typeof value === "boolean") return value ? "ja" : "nej";
  if (typeof value === "string") return value === "" ? "tom" : `\`${value.replace(/\n/g, " ")}\``;
  if (Array.isArray(value)) return value.length === 0 ? "tom liste" : `${value.length} punkter`;
  if (typeof value === "object") {
    const nums = Object.values(value);
    if (nums.every((n) => typeof n === "number")) return `(${nums.map(num).join(", ")})`;
  }
  return "–";
}

const cell = (s) => String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");

/** Bundles the engine, lists its components and renders the reference as Markdown. */
export async function componentReference(root) {
  const dir = await mkdtemp(join(tmpdir(), "brik-docs-"));
  let defs;
  try {
    const result = await build({
      entryPoints: [resolve(root, "packages/runtime/src/index.ts")],
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      write: false,
      logLevel: "silent",
      tsconfig: resolve(root, "tsconfig.base.json"),
    });
    const file = join(dir, "runtime.mjs");
    await writeFile(file, result.outputFiles[0].contents);
    defs = (await import(pathToFileURL(file).href)).allComponents();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  const docs = await scanComponentDocs(root);
  const groups = new Map();
  for (const def of defs) {
    if (def.options?.hidden) continue;
    const area = docs.get(def.name)?.area ?? "andet";
    if (!groups.has(area)) groups.set(area, []);
    groups.get(area).push(def);
  }
  const order = [...Object.keys(AREAS), "andet"].filter((a) => groups.has(a));
  const md = [
    "# Komponentreference",
    "",
    "Alle komponenter, der kan sættes på en entity i editoren, med felter, typer og standardværdier. Siden er genereret ud fra motorens egne skemaer, så den er altid i takt med koden. Beskrivelserne er hentet fra kildekodens kommentarer og er på engelsk.",
    "",
    "Hvordan komponenter bruges, står i [Entities og komponenter](entities-og-komponenter.md). I scener og filer gemmes en komponent som JSON med feltnavnene herunder.",
    "",
  ];
  for (const area of order) {
    const [title, blurb] = AREAS[area] ?? ["Andet", ""];
    md.push(`## ${title}`, "", blurb, "");
    for (const def of groups.get(area).sort((a, b) => a.name.localeCompare(b.name))) {
      const info = docs.get(def.name);
      md.push(`### ${def.name}`, "");
      if (info?.doc) md.push(info.doc, "");
      const requires = (def.options?.requires ?? []).map((r) => `\`${r.name}\``);
      if (requires.length) md.push(`Kræver: ${requires.join(", ")}.`, "");
      const rows = [];
      for (const [key, field] of Object.entries(def.schema)) {
        if (field.meta?.hidden) continue;
        const value = field.make();
        const bits = [];
        const desc = info?.fields.get(key);
        if (desc) bits.push(desc);
        if (field.meta?.min !== undefined) bits.push(`Mindst ${num(field.meta.min)}.`);
        if (field.meta?.max !== undefined) bits.push(`Højst ${num(field.meta.max)}.`);
        rows.push(`| \`${key}\` | ${cell(typeOf(field, value))} | ${cell(defaultOf(field, value))} | ${cell(bits.join(" "))} |`);
      }
      if (rows.length) md.push("| Felt | Type | Standard | Beskrivelse |", "|---|---|---|---|", ...rows, "");
      else md.push("Ingen felter: komponenten er et mærke.", "");
    }
  }
  return md.join("\n");
}

// kept for tests that want the relative path style of the reference's sources
export const sourceArea = (root, file) => relative(join(root, "packages"), file).split(sep)[0];
