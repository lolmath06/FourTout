import { escapeHtml } from "./html";

/**
 * Rendu Markdown → HTML.
 *
 * Le HTML brut présent dans le Markdown est **échappé**, jamais réinjecté :
 * le document produit ne contient que des balises écrites par ce module. C'est
 * la garantie qu'un fichier `.md` reçu de l'extérieur ne peut rien exécuter,
 * même avant assainissement.
 *
 * Le sous-ensemble couvert est celui d'un document réel : titres, listes
 * (imbriquées), gras, italique, barré, code en ligne et en bloc, liens, images,
 * citations, règles horizontales et tableaux.
 */

export interface MarkdownOptions {
  /** Insérer un `<br>` pour un simple retour à la ligne dans un paragraphe. */
  breaks?: boolean;
}

const HEADING = /^(#{1,6})\s+(.*)$/;
const FENCE = /^\s*(```|~~~)(.*)$/;
const HR = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const UL_ITEM = /^(\s*)[-*+]\s+(.*)$/;
const OL_ITEM = /^(\s*)(\d+)[.)]\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;
const TABLE_DIVIDER = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;

export function markdownToHtml(markdown: string, options: MarkdownOptions = {}): string {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: string[] = [];
  let index = 0;

  const isTableRow = (line: string) => line.includes("|") && line.trim().length > 0;

  while (index < lines.length) {
    const line = lines[index];

    if (line.trim().length === 0) {
      index += 1;
      continue;
    }

    const fence = line.match(FENCE);
    if (fence) {
      const marker = fence[1];
      const language = fence[2].trim().split(/\s+/)[0] ?? "";
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trimStart().startsWith(marker)) {
        body.push(lines[index]);
        index += 1;
      }
      index += 1; // ligne de fermeture
      const classAttribute = language ? ` class="language-${escapeHtml(language)}"` : "";
      blocks.push(`<pre><code${classAttribute}>${escapeHtml(body.join("\n"))}</code></pre>`);
      continue;
    }

    if (HR.test(line)) {
      blocks.push("<hr>");
      index += 1;
      continue;
    }

    const heading = line.match(HEADING);
    if (heading) {
      const level = heading[1].length;
      blocks.push(`<h${level}>${renderInline(heading[2].trim(), options)}</h${level}>`);
      index += 1;
      continue;
    }

    if (QUOTE.test(line)) {
      const body: string[] = [];
      while (index < lines.length && QUOTE.test(lines[index])) {
        body.push(lines[index].match(QUOTE)![1]);
        index += 1;
      }
      blocks.push(`<blockquote>${markdownToHtml(body.join("\n"), options)}</blockquote>`);
      continue;
    }

    if (isTableRow(line) && index + 1 < lines.length && TABLE_DIVIDER.test(lines[index + 1])) {
      const header = splitRow(line);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && isTableRow(lines[index])) {
        rows.push(splitRow(lines[index]));
        index += 1;
      }
      const head = `<thead><tr>${header.map((c) => `<th>${renderInline(c, options)}</th>`).join("")}</tr></thead>`;
      const body = rows
        .map((row) => `<tr>${header.map((_, i) => `<td>${renderInline(row[i] ?? "", options)}</td>`).join("")}</tr>`)
        .join("");
      blocks.push(`<table>${head}<tbody>${body}</tbody></table>`);
      continue;
    }

    if (UL_ITEM.test(line) || OL_ITEM.test(line)) {
      const collected: string[] = [];
      while (
        index < lines.length &&
        (UL_ITEM.test(lines[index]) || OL_ITEM.test(lines[index]) || /^\s+\S/.test(lines[index]))
      ) {
        collected.push(lines[index]);
        index += 1;
      }
      blocks.push(renderList(collected, options));
      continue;
    }

    // Paragraphe : jusqu'à la prochaine ligne vide ou au prochain bloc.
    const paragraph: string[] = [];
    while (
      index < lines.length &&
      lines[index].trim().length > 0 &&
      !HEADING.test(lines[index]) &&
      !FENCE.test(lines[index]) &&
      !HR.test(lines[index]) &&
      !QUOTE.test(lines[index]) &&
      !UL_ITEM.test(lines[index]) &&
      !OL_ITEM.test(lines[index])
    ) {
      paragraph.push(lines[index]);
      index += 1;
    }
    const joined = options.breaks
      ? paragraph.map((p) => renderInline(p.trim(), options)).join("<br>")
      : renderInline(paragraph.join(" ").trim(), options);
    blocks.push(`<p>${joined}</p>`);
  }

  return blocks.join("\n");
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim().replace(/\\\|/g, "|"));
}

interface ListItem {
  indent: number;
  ordered: boolean;
  content: string[];
}

function renderList(lines: readonly string[], options: MarkdownOptions): string {
  const items: ListItem[] = [];
  for (const line of lines) {
    const ul = line.match(UL_ITEM);
    const ol = line.match(OL_ITEM);
    if (ul) items.push({ indent: ul[1].length, ordered: false, content: [ul[2]] });
    else if (ol) items.push({ indent: ol[1].length, ordered: true, content: [ol[3]] });
    else if (items.length > 0) items[items.length - 1].content.push(line.trim());
  }
  return renderLevel(items, 0, options).html;
}

function renderLevel(
  items: readonly ListItem[],
  start: number,
  options: MarkdownOptions,
): { html: string; next: number } {
  if (start >= items.length) return { html: "", next: start };
  const indent = items[start].indent;
  const ordered = items[start].ordered;
  const parts: string[] = [];
  let index = start;

  while (index < items.length && items[index].indent >= indent) {
    if (items[index].indent > indent) {
      const nested = renderLevel(items, index, options);
      if (parts.length > 0) {
        parts[parts.length - 1] = parts[parts.length - 1].replace(/<\/li>$/, `${nested.html}</li>`);
      } else {
        parts.push(`<li>${nested.html}</li>`);
      }
      index = nested.next;
      continue;
    }
    if (items[index].ordered !== ordered) break;
    parts.push(`<li>${renderInline(items[index].content.join(" ").trim(), options)}</li>`);
    index += 1;
  }

  const tag = ordered ? "ol" : "ul";
  return { html: `<${tag}>${parts.join("")}</${tag}>`, next: index };
}

const SAFE_LINK = /^(https?:|mailto:|#|\/|\.\/|\.\.\/)/i;
const SAFE_IMAGE = /^(https?:|data:image\/(png|jpeg|gif|webp|svg\+xml);)/i;

/**
 * Marqueur interne isolant le code en ligne du reste des remplacements.
 * Zone à usage privé Unicode : ce caractère n'apparaît pas dans un vrai texte.
 */
const CODE_SLOT = "\uE000";

/** Rendu des marques en ligne. Le texte est échappé avant toute insertion. */
export function renderInline(input: string, options: MarkdownOptions = {}): string {
  void options;
  // Le code en ligne est extrait d'abord : son contenu ne doit subir aucune
  // autre interprétation.
  const codes: string[] = [];
  let text = input.replace(/`([^`]+)`/g, (_match, code: string) => {
    codes.push(code);
    return `${CODE_SLOT}${codes.length - 1}${CODE_SLOT}`;
  });

  text = escapeHtml(text);

  text = text.replace(
    /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g,
    (match, alt: string, src: string, title?: string) =>
      SAFE_IMAGE.test(src) ? `<img src="${src}" alt="${alt}"${title ? ` title="${title}"` : ""}>` : match,
  );
  text = text.replace(
    /\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g,
    (match, label: string, href: string, title?: string) =>
      SAFE_LINK.test(href) ? `<a href="${href}"${title ? ` title="${title}"` : ""}>${label}</a>` : match,
  );
  text = text.replace(/&lt;(https?:\/\/[^\s&]+)&gt;/g, '<a href="$1">$1</a>');

  text = text.replace(/\*\*\*([^*]+)\*\*\*/g, "<strong><em>$1</em></strong>");
  text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  text = text.replace(/(^|[^*\w])\*([^*]+)\*/g, "$1<em>$2</em>");
  text = text.replace(/(^|[^_\w])_([^_]+)_/g, "$1<em>$2</em>");
  text = text.replace(/~~([^~]+)~~/g, "<del>$1</del>");

  const slot = new RegExp(`${CODE_SLOT}(\\d+)${CODE_SLOT}`, "g");
  return text.replace(slot, (_match, id: string) => `<code>${escapeHtml(codes[Number(id)])}</code>`);
}
