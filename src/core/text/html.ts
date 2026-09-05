/**
 * Traitement du HTML fourni par l'utilisateur.
 *
 * Principe non négociable : **le HTML de l'utilisateur n'est jamais exécuté**.
 * Il est analysé avec `DOMParser` (qui n'exécute ni script ni ressource
 * distante), puis reconstruit à partir d'une liste blanche de balises et
 * d'attributs. Ce que l'aperçu affiche est donc du HTML que FourTout a écrit
 * lui-même, pas celui du fichier.
 */

/** Balises conservées par l'assainissement. */
const ALLOWED_TAGS = new Set([
  "a", "b", "blockquote", "br", "caption", "code", "col", "colgroup", "dd", "del",
  "div", "dl", "dt", "em", "figcaption", "figure", "h1", "h2", "h3", "h4", "h5",
  "h6", "hr", "i", "img", "ins", "li", "mark", "ol", "p", "pre", "s", "small",
  "span", "strong", "sub", "sup", "table", "tbody", "td", "tfoot", "th", "thead",
  "tr", "u", "ul",
]);

/** Attributs conservés, par balise. */
const ALLOWED_ATTRIBUTES: Record<string, string[]> = {
  a: ["href", "title"],
  img: ["src", "alt", "title", "width", "height"],
  td: ["colspan", "rowspan"],
  th: ["colspan", "rowspan", "scope"],
  ol: ["start"],
};

/** Éléments dont le contenu entier est supprimé (et pas seulement la balise). */
const DROPPED_SUBTREES = new Set([
  "script", "style", "iframe", "object", "embed", "noscript", "template", "form",
  "input", "button", "select", "textarea", "link", "meta", "svg", "math", "audio", "video",
]);

const SAFE_URL = /^(https?:|mailto:|#|\/|\.\/|\.\.\/)/i;
const SAFE_IMAGE_URL = /^(https?:|data:image\/(png|jpeg|gif|webp|svg\+xml);)/i;

function parseHtml(html: string): Document | null {
  if (typeof DOMParser === "undefined") return null;
  return new DOMParser().parseFromString(html, "text/html");
}

function sanitizeInto(source: Node, target: Node, document: Document): void {
  for (const child of Array.from(source.childNodes)) {
    if (child.nodeType === 3 /* texte */) {
      target.appendChild(document.createTextNode(child.nodeValue ?? ""));
      continue;
    }
    if (child.nodeType !== 1 /* élément */) continue;

    const element = child as Element;
    const tag = element.tagName.toLowerCase();
    if (DROPPED_SUBTREES.has(tag)) continue;

    if (!ALLOWED_TAGS.has(tag)) {
      // Balise inconnue : on garde son contenu, on jette l'enveloppe.
      sanitizeInto(element, target, document);
      continue;
    }

    const clean = document.createElement(tag);
    for (const name of ALLOWED_ATTRIBUTES[tag] ?? []) {
      const value = element.getAttribute(name);
      if (value === null) continue;
      if (name === "href" && !SAFE_URL.test(value.trim())) continue;
      if (name === "src" && !SAFE_IMAGE_URL.test(value.trim())) continue;
      clean.setAttribute(name, value);
    }
    sanitizeInto(element, clean, document);
    target.appendChild(clean);
  }
}

/** Retire tout ce qui pourrait s'exécuter, et ne garde que la mise en forme. */
export function sanitizeHtml(html: string): string {
  const parsed = parseHtml(html);
  if (!parsed) return escapeHtml(html);
  const output = parsed.createElement("div");
  sanitizeInto(parsed.body, output, parsed);
  return output.innerHTML;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* -------------------------------------------------------- HTML → texte */

const BLOCK_TAGS = new Set([
  "address", "article", "aside", "blockquote", "div", "dl", "dt", "dd", "figure",
  "figcaption", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header",
  "hr", "li", "main", "nav", "ol", "p", "pre", "section", "table", "tr", "ul",
]);

/**
 * Texte lisible extrait d'un HTML : les blocs deviennent des paragraphes, les
 * éléments de liste sont préfixés, le reste des balises disparaît.
 */
export function htmlToText(html: string): string {
  const parsed = parseHtml(html);
  if (!parsed) return html.replace(/<[^>]*>/g, "");

  const pieces: string[] = [];
  const walk = (node: Node, listPrefix?: string) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3) {
        pieces.push((child.nodeValue ?? "").replace(/\s+/g, " "));
        continue;
      }
      if (child.nodeType !== 1) continue;
      const element = child as Element;
      const tag = element.tagName.toLowerCase();
      if (DROPPED_SUBTREES.has(tag)) continue;

      if (tag === "br") {
        pieces.push("\n");
        continue;
      }
      if (tag === "hr") {
        pieces.push("\n---\n");
        continue;
      }
      if (tag === "pre") {
        pieces.push("\n" + (element.textContent ?? "") + "\n");
        continue;
      }

      const block = BLOCK_TAGS.has(tag);
      if (block) pieces.push("\n");
      if (tag === "li") pieces.push(listPrefix ?? "- ");

      if (tag === "ol") {
        let index = Number(element.getAttribute("start") ?? "1") || 1;
        for (const item of Array.from(element.children)) {
          if (item.tagName.toLowerCase() !== "li") continue;
          pieces.push("\n" + `${index}. `);
          walk(item);
          index += 1;
        }
        pieces.push("\n");
        continue;
      }

      walk(element, tag === "ul" ? "- " : listPrefix);
      if (block) pieces.push("\n");
      if (tag === "td" || tag === "th") pieces.push("\t");
    }
  };
  walk(parsed.body);

  return pieces
    .join("")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\s+|\s+$/g, "") + "\n";
}

/* ---------------------------------------------------- HTML → Markdown */

/**
 * Conversion HTML → Markdown, sur le sous-ensemble que FourTout sait rendre
 * dans l'autre sens. Ce n'est pas un convertisseur exhaustif : ce qui n'a pas
 * d'équivalent Markdown (styles en ligne, colonnes, div de mise en page) est
 * réduit à son contenu textuel, et l'outil le dit.
 */
export function htmlToMarkdown(html: string): string {
  const parsed = parseHtml(html);
  if (!parsed) return htmlToText(html);

  const inline = (node: Node): string => {
    let out = "";
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3) {
        out += (child.nodeValue ?? "").replace(/\s+/g, " ");
        continue;
      }
      if (child.nodeType !== 1) continue;
      const element = child as Element;
      const tag = element.tagName.toLowerCase();
      if (DROPPED_SUBTREES.has(tag)) continue;
      switch (tag) {
        case "strong":
        case "b":
          out += `**${inline(element).trim()}**`;
          break;
        case "em":
        case "i":
          out += `*${inline(element).trim()}*`;
          break;
        case "del":
        case "s":
          out += `~~${inline(element).trim()}~~`;
          break;
        case "code":
          out += `\`${element.textContent ?? ""}\``;
          break;
        case "br":
          out += "  \n";
          break;
        case "a": {
          const href = element.getAttribute("href") ?? "";
          const label = inline(element).trim();
          out += SAFE_URL.test(href) ? `[${label}](${href})` : label;
          break;
        }
        case "img": {
          const src = element.getAttribute("src") ?? "";
          const alt = element.getAttribute("alt") ?? "";
          out += SAFE_IMAGE_URL.test(src) ? `![${alt}](${src})` : alt;
          break;
        }
        default:
          out += inline(element);
      }
    }
    return out;
  };

  const blocks: string[] = [];
  const walk = (node: Node, depth = 0, quote = false) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3) {
        const text = (child.nodeValue ?? "").replace(/\s+/g, " ").trim();
        if (text) blocks.push(text);
        continue;
      }
      if (child.nodeType !== 1) continue;
      const element = child as Element;
      const tag = element.tagName.toLowerCase();
      if (DROPPED_SUBTREES.has(tag)) continue;

      const push = (value: string) =>
        blocks.push(quote ? value.split("\n").map((l) => `> ${l}`.trimEnd()).join("\n") : value);

      if (/^h[1-6]$/.test(tag)) {
        push(`${"#".repeat(Number(tag[1]))} ${inline(element).trim()}`);
      } else if (tag === "p") {
        const text = inline(element).trim();
        if (text) push(text);
      } else if (tag === "pre") {
        push("```\n" + (element.textContent ?? "").replace(/\n+$/, "") + "\n```");
      } else if (tag === "blockquote") {
        walk(element, depth, true);
      } else if (tag === "ul" || tag === "ol") {
        const ordered = tag === "ol";
        let index = Number(element.getAttribute("start") ?? "1") || 1;
        const items: string[] = [];
        for (const item of Array.from(element.children)) {
          if (item.tagName.toLowerCase() !== "li") continue;
          const marker = ordered ? `${index++}. ` : "- ";
          const nested = item.querySelector("ul, ol");
          const own = inline(nested ? withoutLists(item) : item).trim();
          items.push("  ".repeat(depth) + marker + own);
          if (nested) {
            const sub: string[] = [];
            collectList(nested, depth + 1, sub);
            items.push(...sub);
          }
        }
        if (items.length > 0) push(items.join("\n"));
      } else if (tag === "table") {
        const table = tableToMarkdown(element);
        if (table) push(table);
      } else if (tag === "hr") {
        push("---");
      } else {
        walk(element, depth, quote);
      }
    }
  };

  const withoutLists = (item: Element): Element => {
    const clone = item.cloneNode(true) as Element;
    for (const list of Array.from(clone.querySelectorAll("ul, ol"))) list.remove();
    return clone;
  };

  const collectList = (list: Element, depth: number, out: string[]) => {
    const ordered = list.tagName.toLowerCase() === "ol";
    let index = 1;
    for (const item of Array.from(list.children)) {
      if (item.tagName.toLowerCase() !== "li") continue;
      const marker = ordered ? `${index++}. ` : "- ";
      const nested = item.querySelector("ul, ol");
      out.push("  ".repeat(depth) + marker + inline(nested ? withoutLists(item) : item).trim());
      if (nested) collectList(nested, depth + 1, out);
    }
  };

  const tableToMarkdown = (table: Element): string => {
    const rows = Array.from(table.querySelectorAll("tr"));
    if (rows.length === 0) return "";
    const cells = rows.map((row) =>
      Array.from(row.children).map((cell) => inline(cell).trim().replace(/\|/g, "\\|")),
    );
    const width = Math.max(...cells.map((row) => row.length));
    const line = (values: string[]) =>
      `| ${Array.from({ length: width }, (_, i) => values[i] ?? "").join(" | ")} |`;
    return [line(cells[0]), `|${" --- |".repeat(width)}`, ...cells.slice(1).map(line)].join("\n");
  };

  walk(parsed.body);
  return blocks.join("\n\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}
