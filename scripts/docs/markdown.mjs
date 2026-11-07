// A small Markdown to HTML converter for the Brik docs: headings, paragraphs,
// lists (nested), code blocks with light syntax colouring, tables, quotes
// (also as call-outs), rules, links, images, bold, italic and inline code.
// No dependencies, so the docs build anywhere Node runs.

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** An id for a heading: lower case, Danish letters spelled out, dashes between words. */
export function slugify(text) {
  return (
    text
      .toLowerCase()
      .replace(/æ/g, "ae")
      .replace(/ø/g, "oe")
      .replace(/å/g, "aa")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "afsnit"
  );
}

/** Where a link goes in the built site: other pages' .md files become .html. */
function href(url) {
  if (/^(https?:|mailto:|#|\/)/.test(url)) return url;
  return url.replace(/\.md(#|$)/, ".html$1");
}

/** Inline formatting. `s` is raw text. */
export function inline(s) {
  const codes = [];
  // code spans first: their contents stay literal
  let t = s.replace(/`([^`]+)`/g, (_, c) => {
    codes.push(`<code>${esc(c)}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });
  t = esc(t);
  t = t.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, src) => `<img src="${src}" alt="${alt}" loading="lazy">`);
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text, url) => `<a href="${href(url.replace(/&amp;/g, "&"))}">${text}</a>`);
  t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  t = t.replace(/(^|[^*\w])\*([^*\s][^*]*)\*(?![*\w])/g, "$1<em>$2</em>");
  return t.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[Number(i)]);
}

const KEYWORDS = new Set(
  "import export from const let var function return if else for while of in new class extends this true false null undefined async await interface type enum implements static public private readonly void typeof as default throw try catch switch case break continue".split(" "),
);

/** Light syntax colouring for TypeScript and JavaScript: comments, strings, numbers and keywords. */
function highlightCode(code) {
  const out = [];
  const re = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)|(\b\d[\d_.]*\b)|(\b[A-Za-z_$][\w$]*\b)|([\s\S])/g;
  for (let m = re.exec(code); m; m = re.exec(code)) {
    if (m[1]) out.push(`<span class="c">${esc(m[1])}</span>`);
    else if (m[2]) out.push(`<span class="s">${esc(m[2])}</span>`);
    else if (m[3]) out.push(`<span class="n">${esc(m[3])}</span>`);
    else if (m[4]) out.push(KEYWORDS.has(m[4]) ? `<span class="k">${m[4]}</span>` : esc(m[4]));
    else out.push(esc(m[5]));
  }
  return out.join("");
}

function codeBlock(lang, code) {
  const body = lang === "ts" || lang === "typescript" || lang === "js" || lang === "javascript" || lang === "tsx" ? highlightCode(code) : esc(code);
  return `<pre><code${lang ? ` class="lang-${esc(lang)}"` : ""}>${body}</code></pre>`;
}

const CALLOUT = /^\*\*(Tip|Bemærk|Pas på|Vigtigt)\*\*[:.]?\s*/;
const CALLOUT_CLASS = { Tip: "tip", Bemærk: "note", "Pas på": "warn", Vigtigt: "warn" };

/** Splits one table row into cells. */
function cells(line) {
  return line
    .trim()
    .replace(/^\||\|$/g, "")
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, "|"));
}

/** A line's list marker: indent, ordered or not, and where its text starts. */
function marker(line) {
  const m = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(line);
  return m ? { indent: m[1].length, ordered: /\d/.test(m[2]), text: m[3] } : null;
}

/** Turns consecutive list lines into nested <ul>/<ol>. Returns the HTML. */
function renderList(lines) {
  const first = marker(lines[0]);
  const items = [];
  let current = null;
  for (const line of lines) {
    const mk = marker(line);
    if (mk && mk.indent <= first.indent) {
      current = { text: mk.text, rest: [] };
      items.push(current);
    } else if (current) current.rest.push(line);
  }
  const tag = first.ordered ? "ol" : "ul";
  const html = items.map((it) => {
    // continuation lines: nested lists, or more text for the item
    const nested = it.rest.filter((l) => marker(l));
    const text = [it.text, ...it.rest.filter((l) => !marker(l)).map((l) => l.trim())].filter(Boolean).join(" ");
    return `<li>${inline(text)}${nested.length ? renderList(nested) : ""}</li>`;
  });
  return `<${tag}>${html.join("")}</${tag}>`;
}

/**
 * Converts Markdown. Returns the HTML, the headings (for the table of
 * contents), the first `# ` heading as the title and the plain text (for search).
 */
export function markdownToHtml(src) {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const html = [];
  const headings = [];
  const used = new Map();
  const plain = [];
  let title = "";
  let i = 0;

  const heading = (level, text) => {
    let id = slugify(text.replace(/`/g, ""));
    const n = used.get(id) ?? 0;
    used.set(id, n + 1);
    if (n > 0) id = `${id}-${n + 1}`;
    if (level === 1 && !title) title = text.replace(/`/g, "");
    headings.push({ level, text: text.replace(/`/g, ""), id });
    plain.push(text);
    return `<h${level} id="${id}">${inline(text)}${level > 1 ? `<a class="anchor" href="#${id}" aria-label="Link til afsnittet">#</a>` : ""}</h${level}>`;
  };

  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*$/.test(line)) {
      i++;
      continue;
    }
    const fence = /^```(\w*)\s*$/.exec(line);
    if (fence) {
      const body = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) body.push(lines[i++]);
      i++;
      html.push(codeBlock(fence[1], body.join("\n")));
      plain.push(body.join(" "));
      continue;
    }
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) {
      html.push(heading(h[1].length, h[2]));
      i++;
      continue;
    }
    if (/^(-{3,}|\*{3,})\s*$/.test(line)) {
      html.push("<hr>");
      i++;
      continue;
    }
    if (/^>/.test(line)) {
      const body = [];
      while (i < lines.length && /^>/.test(lines[i])) body.push(lines[i++].replace(/^>\s?/, ""));
      let text = body.join(" ").trim();
      const co = CALLOUT.exec(text);
      const cls = co ? CALLOUT_CLASS[co[1]] : "";
      if (co) text = `**${co[1]}.** ${text.slice(co[0].length)}`;
      html.push(`<blockquote${cls ? ` class="callout ${cls}"` : ""}><p>${inline(text)}</p></blockquote>`);
      plain.push(text);
      continue;
    }
    if (line.includes("|") && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1])) {
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes("|") && !/^\s*$/.test(lines[i])) rows.push(cells(lines[i++]));
      html.push(
        `<div class="table"><table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${rows
          .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`)
          .join("")}</tbody></table></div>`,
      );
      plain.push(head.join(" "), ...rows.map((r) => r.join(" ")));
      continue;
    }
    if (marker(line)) {
      const block = [];
      while (i < lines.length && !/^\s*$/.test(lines[i]) && (marker(lines[i]) || /^\s+\S/.test(lines[i]))) block.push(lines[i++]);
      html.push(renderList(block));
      plain.push(block.map((l) => l.replace(/^\s*([-*]|\d+\.)\s+/, "")).join(" "));
      continue;
    }
    const para = [];
    while (
      i < lines.length &&
      !/^\s*$/.test(lines[i]) &&
      !/^(#{1,6}\s|```|>|(-{3,}|\*{3,})\s*$)/.test(lines[i]) &&
      !marker(lines[i]) &&
      !(lines[i].includes("|") && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1]))
    ) {
      para.push(lines[i++].trim());
    }
    html.push(`<p>${inline(para.join(" "))}</p>`);
    plain.push(para.join(" "));
  }
  const text = plain.join(" ").replace(/[`*_>#|]/g, "").replace(/\s+/g, " ").trim();
  return { html: html.join("\n"), headings, title, text };
}
