/**
 * Messages du socle natif (Rust) affichés par l'interface.
 *
 * Le code Rust renvoie ses erreurs et ses constats en français, souvent
 * composés par `format!` (« Création impossible : {e} »). Plutôt que de
 * traduire dans le binaire, l'interface reconnaît ces messages : ce script
 * recense les gabarits du code Rust, l'extraction les ajoute au catalogue, et
 * `tx()` les retrouve à l'affichage, arguments compris.
 *
 * Écrit `src/i18n/native.json` : la liste des gabarits, au format des
 * messages (`{nom}` pour un argument).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ACCENT = /[àâçéèêëîïôûùüÿœ«»’…]/;
const FRENCH =
  /(^|\s)(le|la|les|un|une|des|du|de|d'\w+|l'\w+|vos|votre|est|sont|pour|avec|sans|aucun|aucune|fichier|fichiers|dossier|ou|et|en|au|aux|ce|cette|ces|dans|sur|par|pas|ne|n'\w+|qu'\w+|que|qui|plus|été)(\s|$)/i;

function rustFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...rustFiles(path));
    else if (entry.endsWith(".rs")) out.push(path);
  }
  return out;
}

/** Retire les modules de test : leurs chaînes ne sont jamais affichées. */
function withoutTests(source) {
  const marker = source.search(/#\[cfg\(test\)\]\s*mod\s+\w+\s*\{/);
  return marker < 0 ? source : source.slice(0, marker);
}

/**
 * Littéraux de chaîne Rust ordinaires, lus par un petit analyseur lexical :
 * commentaires, caractères (`'"'`) et chaînes brutes (`r#"…"#`) sont sautés.
 */
function stringLiterals(source) {
  const out = [];
  let i = 0;
  const n = source.length;
  while (i < n) {
    const c = source[i];
    const next = source[i + 1];
    if (c === "/" && next === "/") {
      while (i < n && source[i] !== "\n") i += 1;
    } else if (c === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end < 0 ? n : end + 2;
    } else if (c === "r" && (next === '"' || next === "#") && !/[\w]/.test(source[i - 1] ?? "")) {
      const hashes = /^r(#*)"/.exec(source.slice(i));
      if (!hashes) {
        i += 1;
        continue;
      }
      const close = `"${hashes[1]}`;
      const end = source.indexOf(close, i + hashes[0].length);
      i = end < 0 ? n : end + close.length;
    } else if (c === "'") {
      // Caractère ('a', '\'', '"') ou durée de vie ('a) : on saute au plus court.
      const literal = /^'(?:\\.|[^\\'])'/.exec(source.slice(i));
      i += literal ? literal[0].length : 1;
    } else if (c === '"') {
      let j = i + 1;
      let text = "";
      while (j < n && source[j] !== '"') {
        if (source[j] === "\\") {
          text += source[j] + (source[j + 1] ?? "");
          j += 2;
        } else {
          text += source[j];
          j += 1;
        }
      }
      out.push(text);
      i = j + 1;
    } else {
      i += 1;
    }
  }
  return out;
}

function unescapeRust(text) {
  return text
    .replace(/\\\n\s*/g, "")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\\\/g, "\\")
    .replace(/\\u\{([0-9a-fA-F]+)\}/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)));
}

/**
 * Gabarit `format!` → message : `{name}`, `{}`, `{0}`, `{x:?}`, `{:.1}` →
 * `{name}`, `{p0}`… Les accolades doublées (`{{`) rendent le gabarit
 * inutilisable : il est écarté.
 */
export function toMessage(template) {
  if (/\{\{|\}\}/.test(template)) return undefined;
  let index = 0;
  const message = template.replace(/\{([A-Za-z_][\w.]*)?(?::[^}]*)?\}/g, (_, name) => {
    if (name) return `{${name.replace(/\./g, "_")}}`;
    const placeholder = `{p${index}}`;
    index += 1;
    return placeholder;
  });
  return /[{}]/.test(message.replace(/\{[\p{L}\p{N}_]+\}/gu, "")) ? undefined : message;
}

function looksLikeUserText(text) {
  const literal = text.replace(/\{[^}]*\}/g, " ").trim();
  if (!/\p{L}{3,}/u.test(literal)) return false;
  if (/^[a-z_:]+$/.test(literal)) return false; // identifiants, commandes
  if (/^(-|\/|\\|https?:|\.|%)/.test(literal)) return false; // options, chemins, URL
  if (ACCENT.test(literal)) return true;
  if (/\s/.test(literal) && FRENCH.test(literal)) return true;
  return /^\p{Lu}\p{Ll}+(\s\p{Ll}[\p{L}'-]*)+[ .:!?]*$/u.test(literal);
}

/**
 * Libellés de type de fichier reconnus par leur signature (`sig("zip",
 * "Conteneur ZIP", …)` dans `files/magic.rs`) : courts, souvent sans mot
 * français reconnaissable, ils échappent à `looksLikeUserText` alors qu'ils
 * s'affichent tels quels.
 */
function signatureLabels(source) {
  return [...source.matchAll(/\bsig\(\s*"[^"]*",\s*"([^"]+)"/g)].map((match) => unescapeRust(match[1]));
}

export function collectNativeTemplates(root) {
  const templates = new Set();
  for (const file of rustFiles(join(root, "src-tauri", "src"))) {
    const source = withoutTests(readFileSync(file, "utf8"));
    for (const raw of stringLiterals(source)) {
      const text = unescapeRust(raw);
      if (!looksLikeUserText(text)) continue;
      const message = toMessage(text);
      if (message) templates.add(message.trim());
    }
    for (const label of signatureLabels(source)) templates.add(label.trim());
  }
  return [...templates].sort((a, b) => a.localeCompare(b, "fr"));
}
