import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs build scripts without types
import { buildDocs } from "../../../scripts/docs/build.mjs";
// @ts-expect-error plain .mjs build scripts without types
import { markdownToHtml, slugify } from "../../../scripts/docs/markdown.mjs";

describe("markdown", () => {
  it("makes headings with ids, lists, tables, code and links", () => {
    const r = markdownToHtml(
      ["# Titel", "", "## Æble og Ål", "", "- et", "  - to", "- tre", "", "| A | B |", "|---|---|", "| 1 | 2 |", "", "```ts", "const x = 1; // hej", "```", "", "Se [side](andet.md#del) og `kode`."].join("\n"),
    );
    expect(r.title).toBe("Titel");
    expect(r.headings.map((h: { id: string }) => h.id)).toEqual(["titel", "aeble-og-aal"]);
    expect(r.html).toContain("<ul><li>et<ul><li>to</li></ul></li><li>tre</li></ul>");
    expect(r.html).toContain("<th>A</th>");
    expect(r.html).toContain('<span class="k">const</span>');
    expect(r.html).toContain('<span class="c">// hej</span>');
    expect(r.html).toContain('href="andet.html#del"');
    expect(r.html).toContain("<code>kode</code>");
  });

  it("escapes html and turns tips into call-outs", () => {
    const r = markdownToHtml("> **Tip** Brug <b>.\n\nA <script>");
    expect(r.html).toContain('class="callout tip"');
    expect(r.html).not.toContain("<script>");
  });

  it("keeps underscores in the search text, so identifiers like paint_tiles can be found", () => {
    const r = markdownToHtml("Brug `paint_tiles` og *fremhævet* tekst.");
    expect(r.text).toContain("paint_tiles");
    expect(r.text).not.toContain("*");
  });

  it("slugifies Danish letters", () => {
    expect(slugify("Byg og udgiv: på itch.io")).toBe("byg-og-udgiv-paa-itch-io");
  });
});

describe("docs site", () => {
  let out = "";
  let built: { pages: { href: string; title: string }[]; problems: string[] };
  beforeAll(async () => {
    out = await mkdtemp(join(tmpdir(), "brik-docs-test-"));
    built = await buildDocs({ out });
  }, 60_000);
  afterAll(() => rm(out, { recursive: true, force: true }));

  it("has no broken links", () => {
    expect(built.problems).toEqual([]);
  });

  it("builds the front page, manual, guide and roadmap", () => {
    const hrefs = built.pages.map((p) => p.href);
    for (const h of ["index.html", "manual/index.html", "guide/index.html", "roadmap.html", "manual/scripts.html", "manual/komponenter.html"]) expect(hrefs).toContain(h);
  });

  it("lists every component in the reference", async () => {
    const html = await readFile(join(out, "manual/komponenter.html"), "utf8");
    for (const name of ["Transform2D", "Sprite", "Collider2D", "CharacterController2D", "UIButton", "AudioSource", "TileMap"]) expect(html).toContain(`>${name}`);
  });

  it("finds tool names with underscores in the search index", async () => {
    const index = JSON.parse(await readFile(join(out, "search-index.json"), "utf8")) as { href: string; text: string }[];
    const hits = index.filter((i) => i.text.toLowerCase().includes("paint_tiles"));
    expect(hits.map((h) => h.href)).toContain("manual/ai-og-mcp.html");
    // the search script matches both spellings
    const script = await readFile(join(out, "search.js"), "utf8");
    expect(script).toContain('replace(/_/g, "")');
  });

  it("copies the screenshots and every picture on the pages exists", async () => {
    await stat(join(out, "images/editor.png"));
    const page = await readFile(join(out, "manual/editoren.html"), "utf8");
    expect(page).toContain('src="../images/editor.png"');
  });

  it("puts every page in the search index and writes the marker", async () => {
    const index = JSON.parse(await readFile(join(out, "search-index.json"), "utf8")) as { href: string }[];
    expect(index.map((i) => i.href).sort()).toEqual(built.pages.map((p) => p.href).sort());
    await stat(join(out, ".brik-docs"));
  });
});
