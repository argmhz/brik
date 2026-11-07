// The page layout of the docs site: top bar with search, a side menu for the
// current part, the page itself and an "on this page" list.

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const SECTIONS = [
  { id: "manual", title: "Manual", href: "manual/index.html" },
  { id: "guide", title: "Guide", href: "guide/index.html" },
  { id: "roadmap", title: "Roadmap", href: "roadmap.html" },
];

/**
 * @param {{ title: string, body: string, section: string | null, root: string, side?: { title: string, href: string, id: string }[], current?: string, headings?: { level: number, text: string, id: string }[], prev?: { title: string, href: string } | null, next?: { title: string, href: string } | null }} p
 */
export function page(p) {
  const nav = SECTIONS.map((s) => `<a href="${p.root}${s.href}"${s.id === p.section ? ' class="active"' : ""}>${s.title}</a>`).join("");
  const side = p.side?.length
    ? `<nav class="side-nav" aria-label="${esc(p.section ?? "")}">${p.side
        .map((s) => `<a href="${s.href}"${s.id === p.current ? ' class="active" aria-current="page"' : ""}>${esc(s.title)}</a>`)
        .join("")}</nav>`
    : "";
  const toc = (p.headings ?? []).filter((h) => h.level === 2 || h.level === 3);
  const tocHtml = toc.length > 1 ? `<nav class="toc" aria-label="På denne side"><h2>På denne side</h2>${toc.map((h) => `<a class="l${h.level}" href="#${h.id}">${esc(h.text)}</a>`).join("")}</nav>` : "";
  const pager =
    p.prev || p.next
      ? `<nav class="pager">${p.prev ? `<a class="prev" href="${p.prev.href}"><small>Forrige</small>${esc(p.prev.title)}</a>` : "<span></span>"}${p.next ? `<a class="next" href="${p.next.href}"><small>Næste</small>${esc(p.next.title)}</a>` : "<span></span>"}</nav>`
      : "";
  return `<!doctype html>
<html lang="da">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(p.title)} · Brik</title>
<link rel="stylesheet" href="${p.root}style.css">
</head>
<body>
<header class="top">
  <a class="brand" href="${p.root}index.html">Brik<span>.</span></a>
  <nav class="sections">${nav}</nav>
  <div class="search"><input id="search" type="search" placeholder="Søg i dokumentationen…" autocomplete="off" aria-label="Søg"><div id="results" hidden></div></div>
</header>
<div class="layout">
  <aside class="side">${side}</aside>
  <main>
    <article>
${p.body}
    </article>
    ${pager}
  </main>
  <aside class="right">${tocHtml}</aside>
</div>
<script src="${p.root}search.js" data-root="${p.root}"></script>
</body>
</html>
`;
}
