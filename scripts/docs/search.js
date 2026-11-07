// Search: loads search-index.json once and filters it as you type.
(() => {
  const root = document.currentScript.dataset.root || "";
  const input = document.getElementById("search");
  const box = document.getElementById("results");
  let index = null;
  let selected = -1;

  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const load = () => (index ??= fetch(root + "search-index.json").then((r) => r.json()).catch(() => []));

  function mark(text, words) {
    let out = esc(text);
    for (const w of words) out = out.replace(new RegExp(`(${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "ig"), "<mark>$1</mark>");
    return out;
  }

  async function run() {
    const words = input.value.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return (box.hidden = true);
    const pages = await load();
    const hits = [];
    for (const p of pages) {
      const hay = (p.title + " " + p.text).toLowerCase();
      if (!words.every((w) => hay.includes(w))) continue;
      const inTitle = words.every((w) => p.title.toLowerCase().includes(w));
      const at = hay.indexOf(words[0]) - p.title.length - 1;
      const snippet = at >= 0 ? p.text.slice(Math.max(0, at - 40), at + 110) : p.text.slice(0, 120);
      hits.push({ p, score: (inTitle ? 100 : 0) + (p.headings.some((h) => words.every((w) => h.toLowerCase().includes(w))) ? 20 : 0), snippet });
    }
    hits.sort((a, b) => b.score - a.score);
    box.innerHTML = hits.length
      ? hits.slice(0, 8).map((h, i) => `<a href="${root}${h.p.href}"${i === 0 ? ' class="sel"' : ""}><b>${mark(h.p.title, words)}</b><small>${esc(h.p.section)} · ${mark(h.snippet, words)}…</small></a>`).join("")
      : `<a><b>Ingen resultater</b><small>Prøv et andet ord, fx en komponent eller en hook.</small></a>`;
    selected = hits.length ? 0 : -1;
    box.hidden = false;
  }

  input.addEventListener("input", run);
  input.addEventListener("focus", () => input.value && run());
  input.addEventListener("keydown", (e) => {
    const links = [...box.querySelectorAll("a[href]")];
    if (e.key === "Escape") box.hidden = true;
    if ((e.key === "ArrowDown" || e.key === "ArrowUp") && links.length) {
      e.preventDefault();
      selected = (selected + (e.key === "ArrowDown" ? 1 : -1) + links.length) % links.length;
      links.forEach((l, i) => l.classList.toggle("sel", i === selected));
    }
    if (e.key === "Enter" && links[selected]) location.href = links[selected].href;
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".search")) box.hidden = true;
  });
  // "/" focuses the search, like on most docs sites
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && document.activeElement !== input && !/INPUT|TEXTAREA/.test(document.activeElement?.tagName)) {
      e.preventDefault();
      input.focus();
    }
  });
})();
