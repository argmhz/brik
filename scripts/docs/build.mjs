#!/usr/bin/env node
// Builds the Brik docs site (Manual, Guide, Roadmap) as plain static HTML.
//
//   node scripts/docs/build.mjs [--out <dir>]
//
// Sources (Danish Markdown):
//   docs/index.md           the front page
//   docs/manual/NN-*.md     the manual, one page per topic (NN sets the order)
//   docs/guide/NN-*.md      step-by-step guides
//   docs/ROADMAP.md         the roadmap
// Plus the component reference, generated from the engine (components.mjs).
//
// Link between pages by their name without the number: [Scripts](scripts.md)
// or [Guide](../guide/foerste-spil.md). The build checks every link.

import { copyFile, cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { componentReference } from "./components.mjs";
import { markdownToHtml } from "./markdown.mjs";
import { SECTIONS, page } from "./template.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const MARKER = ".brik-docs";

const slugOf = (file) => file.replace(/\.md$/, "").replace(/^\d+-/, "");

async function readDir(dir) {
  const names = (await readdir(dir).catch(() => [])).filter((n) => n.endsWith(".md")).sort();
  return Promise.all(names.map(async (n) => ({ file: n, slug: slugOf(n), md: await readFile(join(dir, n), "utf8") })));
}

/** First paragraph of a page, as plain text for the section's contents page. */
function summary(text, title) {
  const rest = text.startsWith(title) ? text.slice(title.length).trim() : text;
  return rest.length > 170 ? `${rest.slice(0, 167).replace(/\s+\S*$/, "")}…` : rest;
}

/**
 * Builds the site. Returns the pages and any broken links.
 * @param {{ root?: string, out: string, log?: (s: string) => void }} opts
 */
export async function buildDocs({ root = resolve(here, "../.."), out, log = () => {} }) {
  const docs = join(root, "docs");
  // only empty a folder this build made before
  if (await stat(join(out, MARKER)).then(() => true, () => false)) await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });

  /** @type {{ section: string | null, slug: string, href: string, title: string, md: string, generated?: boolean }[]} */
  const sources = [];
  const manual = await readDir(join(docs, "manual"));
  const guide = await readDir(join(docs, "guide"));
  for (const p of manual) sources.push({ section: "manual", slug: p.slug, href: `manual/${p.slug}.html`, title: "", md: p.md });
  sources.push({ section: "manual", slug: "komponenter", href: "manual/komponenter.html", title: "", md: await componentReference(root), generated: true });
  for (const p of guide) sources.push({ section: "guide", slug: p.slug, href: `guide/${p.slug}.html`, title: "", md: p.md });
  const roadmap = await readFile(join(docs, "ROADMAP.md"), "utf8").catch(() => "# Roadmap\n\nEndnu ikke skrevet.\n");
  sources.push({ section: "roadmap", slug: "roadmap", href: "roadmap.html", title: "", md: roadmap });
  const indexMd = await readFile(join(docs, "index.md"), "utf8").catch(() => "# Brik\n");

  // convert everything first: titles and headings are needed for menus and search
  const converted = sources.map((s) => ({ ...s, ...markdownToHtml(s.md) }));
  const results = [];
  const bySection = (id) => converted.filter((c) => c.section === id);

  const root_ = (href) => "../".repeat(href.split("/").length - 1);
  const menu = (id, prefix) => bySection(id).map((c) => ({ id: c.slug, title: c.title, href: prefix + c.slug + ".html" }));

  for (const c of converted) {
    const sectionPages = bySection(c.section);
    const i = sectionPages.indexOf(c);
    const link = (p) => (p ? { title: p.title, href: p.href.split("/").pop() } : null);
    const html = page({
      title: c.title,
      body: c.html,
      section: c.section,
      root: root_(c.href),
      side: c.section === "roadmap" ? [] : [{ id: "index", title: c.section === "manual" ? "Oversigt" : "Oversigt", href: "index.html" }, ...menu(c.section, "")],
      current: c.slug,
      headings: c.headings,
      prev: c.section === "roadmap" ? null : link(sectionPages[i - 1]),
      next: c.section === "roadmap" ? null : link(sectionPages[i + 1]),
    });
    await write(out, c.href, html);
    results.push({ href: c.href, title: c.title, section: c.section, headings: c.headings.map((h) => h.text), text: c.text, html: c.html });
  }

  // contents pages for the manual and the guide, and the front page
  const titles = { manual: ["Manual", "Alt om Brik, emne for emne: editoren, scripts, grafik, fysik, UI, lyd og udgivelse. Brug den, når du skal slå noget op."], guide: ["Guide", "Trin-for-trin-vejledninger, der tager dig fra det første projekt til et udgivet spil."] };
  for (const id of ["manual", "guide"]) {
    const list = bySection(id);
    const [title, lead] = titles[id];
    const md = [`# ${title}`, "", lead, "", ...list.flatMap((c, n) => [`${n + 1}. [${c.title}](${c.slug}.md)${summary(c.text, c.title) ? ` · ${summary(c.text, c.title)}` : ""}`])].join("\n");
    const r = markdownToHtml(md);
    await write(out, `${id}/index.html`, page({ title, body: r.html, section: id, root: "../", side: [{ id: "index", title: "Oversigt", href: "index.html" }, ...menu(id, "")], current: "index", headings: r.headings }));
    results.push({ href: `${id}/index.html`, title, section: id, headings: r.headings.map((h) => h.text), text: r.text, html: r.html });
  }
  {
    const r = markdownToHtml(indexMd);
    const cards = `<div class="cards">${SECTIONS.map((s) => `<a class="card" href="${s.href}"><strong>${s.title}</strong><span>${{ manual: "Slå op, emne for emne.", guide: "Trin for trin, fra første projekt til udgivelse.", roadmap: "Hvad der er lavet, og hvad der kommer." }[s.id]}</span></a>`).join("")}</div>`;
    await write(out, "index.html", page({ title: r.title || "Brik", body: `<div class="hero">${r.html.replace(/(<\/p>)/, "$1")}</div>${cards}`, section: null, root: "", headings: [] }));
    results.push({ href: "index.html", title: r.title || "Brik", section: "Forside", headings: [], text: r.text, html: r.html });
  }

  // search index and assets
  await write(out, "search-index.json", JSON.stringify(results.map((r) => ({ href: r.href, title: r.title, section: SECTIONS.find((s) => s.id === r.section)?.title ?? "Brik", headings: r.headings, text: r.text }))));
  await copyFile(join(here, "style.css"), join(out, "style.css"));
  await copyFile(join(here, "search.js"), join(out, "search.js"));
  // screenshots (made by scripts/docs/screenshots.mjs)
  const images = (await readdir(join(docs, "images")).catch(() => [])).filter((n) => /\.(png|jpe?g|gif|svg|webp)$/i.test(n));
  if (images.length) await cp(join(docs, "images"), join(out, "images"), { recursive: true });
  await writeFile(join(out, MARKER), "This folder is made by scripts/docs/build.mjs and emptied on every build.\n");

  const problems = checkLinks(results, new Set(images.map((n) => `images/${n}`)));
  log(`docs: ${results.length} sider i ${out}${problems.length ? `, ${problems.length} brudte links` : ""}`);
  return { pages: results.map(({ html, ...r }) => r), problems };
}

async function write(out, href, content) {
  const file = join(out, href);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, content);
}

/** Every relative link and #anchor in the built pages must lead somewhere. */
function checkLinks(results, imageFiles = new Set()) {
  const pages = new Map(results.map((r) => [r.href, r]));
  const ids = new Map(results.map((r) => [r.href, new Set([...r.html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]))]));
  const problems = [];
  for (const r of results) {
    for (const m of r.html.matchAll(/<a [^>]*href="([^"]+)"/g)) {
      const url = m[1];
      if (/^(https?:|mailto:)/.test(url)) continue;
      const [path, hash] = url.split("#");
      const target = path ? new URL(path, `http://x/${r.href}`).pathname.slice(1) : r.href;
      if (!pages.has(target)) problems.push(`${r.href}: ${url} peger på en side, der ikke findes`);
      else if (hash && !ids.get(target)?.has(hash)) problems.push(`${r.href}: ${url} peger på et afsnit, der ikke findes`);
    }
  }
  // pictures must exist too
  for (const r of results) {
    for (const m of r.html.matchAll(/<img [^>]*src="([^"]+)"/g)) {
      if (/^(https?:|data:)/.test(m[1])) continue;
      const target = new URL(m[1], `http://x/${r.href}`).pathname.slice(1);
      if (!imageFiles.has(target)) problems.push(`${r.href}: billedet ${m[1]} findes ikke i docs/images`);
    }
  }
  return problems;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = process.argv.indexOf("--out");
  const root = resolve(here, "../..");
  const out = resolve(arg > 0 ? process.argv[arg + 1] : join(root, "apps/web/public/docs"));
  const { problems } = await buildDocs({ root, out, log: (s) => console.log(s) });
  for (const p of problems) console.error(`  ${p}`);
  if (problems.length) process.exit(1);
}
