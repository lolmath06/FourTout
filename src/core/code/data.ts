/**
 * Formats de données : JSON, YAML, XML.
 *
 * Trois outils du catalogue, un seul module, parce qu'ils posent le même
 * problème — lire un document non fiable et le réécrire proprement — et
 * partagent la même exigence de sécurité : **aucune évaluation, aucune
 * résolution d'entité externe, aucun tag exécutable**. Un formateur de données
 * qui ouvre un fichier local ou une URL parce que le document le lui demande
 * est une faille, pas une fonctionnalité.
 */

export class DataError extends Error {
  constructor(
    message: string,
    readonly line?: number,
    readonly column?: number,
  ) {
    super(message);
    this.name = "DataError";
  }
}

export type Indentation = "2" | "4" | "tab";

export function indentUnit(indentation: Indentation): string {
  return indentation === "tab" ? "\t" : " ".repeat(Number(indentation));
}

/* ------------------------------------------------------------------------ */
/* JSON                                                                      */
/* ------------------------------------------------------------------------ */

/**
 * Localise une erreur de syntaxe JSON, **sans dépendre du message du moteur**.
 *
 * V8, JavaScriptCore et SpiderMonkey formulent leurs erreurs différemment, et
 * V8 a changé son format en cours de route : tantôt « at position 42 », tantôt
 * un extrait entre guillemets sans position. Se raccrocher à ces phrases, c'est
 * afficher « ligne inconnue » un jour de mise à jour du moteur.
 *
 * On réanalyse donc le document nous-mêmes avec un scanner minimal, qui
 * s'arrête au premier caractère fautif et rend son décalage exact.
 */
function findJsonError(source: string): { index: number; message: string } {
  let i = 0;

  const skipSpace = () => {
    while (i < source.length && " \t\n\r".includes(source[i])) i += 1;
  };

  const fail = (message: string): never => {
    throw { index: i, message } as { index: number; message: string };
  };

  const literal = (word: string) => {
    if (source.startsWith(word, i)) {
      i += word.length;
      return true;
    }
    return false;
  };

  const parseString = () => {
    i += 1; // guillemet ouvrant
    while (i < source.length) {
      const char = source[i];
      if (char === '"') {
        i += 1;
        return;
      }
      if (char === "\\") {
        i += 2;
        continue;
      }
      if (char === "\n") fail("Chaîne non terminée avant la fin de la ligne.");
      i += 1;
    }
    fail("Chaîne non terminée avant la fin du document.");
  };

  const parseNumber = () => {
    const start = i;
    if (source[i] === "-") i += 1;
    while (i < source.length && /[0-9]/.test(source[i])) i += 1;
    if (source[i] === ".") {
      i += 1;
      while (i < source.length && /[0-9]/.test(source[i])) i += 1;
    }
    if (source[i] === "e" || source[i] === "E") {
      i += 1;
      if (source[i] === "+" || source[i] === "-") i += 1;
      while (i < source.length && /[0-9]/.test(source[i])) i += 1;
    }
    if (i === start) fail("Nombre attendu.");
  };

  const parseValue = () => {
    skipSpace();
    if (i >= source.length) fail("Document interrompu : une valeur était attendue.");
    const char = source[i];
    if (char === '"') return parseString();
    if (char === "{") return parseObject();
    if (char === "[") return parseArray();
    if (char === "-" || /[0-9]/.test(char)) return parseNumber();
    if (literal("true") || literal("false") || literal("null")) return;
    fail(`Valeur attendue, trouvé « ${char} ».`);
  };

  const parseObject = () => {
    i += 1; // accolade ouvrante
    skipSpace();
    if (source[i] === "}") {
      i += 1;
      return;
    }
    for (;;) {
      skipSpace();
      if (source[i] !== '"') fail("Nom de propriété attendu, entre guillemets doubles.");
      parseString();
      skipSpace();
      if (source[i] !== ":") fail("Deux-points attendus après le nom de la propriété.");
      i += 1;
      parseValue();
      skipSpace();
      if (source[i] === ",") {
        i += 1;
        skipSpace();
        // Une virgule finale est refusée par la norme JSON, et c'est l'erreur
        // la plus fréquente : elle mérite un message explicite.
        if (source[i] === "}") fail("Virgule en trop avant l'accolade fermante.");
        continue;
      }
      if (source[i] === "}") {
        i += 1;
        return;
      }
      fail("Virgule ou accolade fermante attendue.");
    }
  };

  const parseArray = () => {
    i += 1; // crochet ouvrant
    skipSpace();
    if (source[i] === "]") {
      i += 1;
      return;
    }
    for (;;) {
      parseValue();
      skipSpace();
      if (source[i] === ",") {
        i += 1;
        skipSpace();
        if (source[i] === "]") fail("Virgule en trop avant le crochet fermant.");
        continue;
      }
      if (source[i] === "]") {
        i += 1;
        return;
      }
      fail("Virgule ou crochet fermant attendu.");
    }
  };

  try {
    parseValue();
    skipSpace();
    if (i < source.length) fail("Contenu en trop après la fin du document.");
  } catch (failure) {
    const located = failure as { index?: number; message?: string };
    if (typeof located.index === "number" && typeof located.message === "string") {
      return { index: Math.min(located.index, source.length), message: located.message };
    }
    /* c8 ignore next 2 — remonte une erreur inattendue plutôt que de l'avaler. */
    throw failure;
  }
  // Le scanner n'a rien trouvé : on rend la fin du document, faute de mieux.
  return { index: source.length, message: "JSON invalide." };
}

function locateJsonError(source: string): DataError {
  const { index, message } = findJsonError(source);
  const before = source.slice(0, index);
  const line = before.split("\n").length;
  const column = index - before.lastIndexOf("\n");
  return new DataError(`${message} (ligne ${line}, colonne ${column})`, line, column);
}

export function parseJson(source: string): unknown {
  if (source.trim().length === 0) throw new DataError("Le document est vide.");
  try {
    return JSON.parse(source);
  } catch {
    throw locateJsonError(source);
  }
}

/** Tri récursif des clés d'objet, en laissant l'ordre des tableaux intact. */
export function sortJsonKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonKeys);
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    entries.sort(([a], [b]) => a.localeCompare(b, "en"));
    return Object.fromEntries(entries.map(([key, item]) => [key, sortJsonKeys(item)]));
  }
  return value;
}

export interface JsonFormatOptions {
  indentation?: Indentation;
  sortKeys?: boolean;
}

export function formatJson(source: string, options: JsonFormatOptions = {}): string {
  const parsed = parseJson(source);
  const value = options.sortKeys ? sortJsonKeys(parsed) : parsed;
  return JSON.stringify(value, null, indentUnit(options.indentation ?? "2"));
}

export function minifyJson(source: string, options: { sortKeys?: boolean } = {}): string {
  const parsed = parseJson(source);
  return JSON.stringify(options.sortKeys ? sortJsonKeys(parsed) : parsed);
}

export interface JsonStats {
  objects: number;
  arrays: number;
  values: number;
  maxDepth: number;
}

/** Petit portrait du document, utile pour vérifier qu'on a bien collé le bon. */
export function inspectJson(value: unknown, depth = 1): JsonStats {
  const stats: JsonStats = { objects: 0, arrays: 0, values: 0, maxDepth: depth };
  const walk = (node: unknown, level: number) => {
    stats.maxDepth = Math.max(stats.maxDepth, level);
    if (Array.isArray(node)) {
      stats.arrays += 1;
      for (const item of node) walk(item, level + 1);
      return;
    }
    if (node !== null && typeof node === "object") {
      stats.objects += 1;
      for (const item of Object.values(node as Record<string, unknown>)) walk(item, level + 1);
      return;
    }
    stats.values += 1;
  };
  walk(value, depth);
  return stats;
}

/* ------------------------------------------------------------------------ */
/* XML                                                                       */
/* ------------------------------------------------------------------------ */

/**
 * Une déclaration de type de document peut définir des entités qui pointent
 * vers un fichier local ou une URL : c'est l'attaque XXE. FourTout refuse donc
 * tout `<!DOCTYPE` contenant une déclaration d'entité, au lieu d'espérer que
 * le parseur du moteur soit configuré prudemment.
 */
const DOCTYPE_PATTERN = /<!DOCTYPE[^>]*(\[[\s\S]*?\])?\s*>/i;
const ENTITY_PATTERN = /<!ENTITY\b/i;

export function assertNoExternalEntities(source: string): void {
  const doctype = DOCTYPE_PATTERN.exec(source);
  if (!doctype) return;
  if (ENTITY_PATTERN.test(doctype[0])) {
    throw new DataError(
      "Ce document déclare des entités XML. FourTout les refuse : une entité peut " +
        "désigner un fichier local ou une adresse réseau (attaque XXE). Retirez la " +
        "déclaration <!DOCTYPE> pour formater le document.",
    );
  }
  if (/SYSTEM|PUBLIC/i.test(doctype[0])) {
    throw new DataError(
      "Ce document référence une DTD externe. FourTout ne va jamais la chercher : " +
        "retirez la déclaration <!DOCTYPE> pour formater le document.",
    );
  }
}

interface XmlNode {
  kind: "element" | "text" | "comment" | "instruction" | "cdata" | "doctype";
  text: string;
  selfClosing?: boolean;
  closing?: boolean;
}

/**
 * Découpe un document XML en jetons.
 *
 * Un formateur n'a pas besoin d'un arbre complet : il lui faut savoir où sont
 * les balises et le texte. Un tokeniseur explicite évite d'embarquer un
 * parseur DOM et garde le contrôle total sur ce qui est interprété.
 */
function tokenizeXml(source: string): XmlNode[] {
  const nodes: XmlNode[] = [];
  let index = 0;
  while (index < source.length) {
    const next = source.indexOf("<", index);
    if (next === -1) {
      pushText(nodes, source.slice(index));
      break;
    }
    if (next > index) pushText(nodes, source.slice(index, next));

    if (source.startsWith("<!--", next)) {
      const end = source.indexOf("-->", next);
      if (end === -1) throw new DataError("Commentaire non refermé.");
      nodes.push({ kind: "comment", text: source.slice(next, end + 3) });
      index = end + 3;
      continue;
    }
    if (source.startsWith("<![CDATA[", next)) {
      const end = source.indexOf("]]>", next);
      if (end === -1) throw new DataError("Section CDATA non refermée.");
      nodes.push({ kind: "cdata", text: source.slice(next, end + 3) });
      index = end + 3;
      continue;
    }
    if (source.startsWith("<!", next)) {
      const end = source.indexOf(">", next);
      if (end === -1) throw new DataError("Déclaration non refermée.");
      nodes.push({ kind: "doctype", text: source.slice(next, end + 1) });
      index = end + 1;
      continue;
    }
    if (source.startsWith("<?", next)) {
      const end = source.indexOf("?>", next);
      if (end === -1) throw new DataError("Instruction de traitement non refermée.");
      nodes.push({ kind: "instruction", text: source.slice(next, end + 2) });
      index = end + 2;
      continue;
    }

    const end = findTagEnd(source, next);
    if (end === -1) throw new DataError("Balise non refermée.");
    const raw = source.slice(next, end + 1);
    nodes.push({
      kind: "element",
      text: raw,
      selfClosing: /\/>$/.test(raw),
      closing: raw.startsWith("</"),
    });
    index = end + 1;
  }
  return nodes;
}

/** Cherche le `>` fermant en ignorant ceux qui vivent dans une valeur d'attribut. */
function findTagEnd(source: string, start: number): number {
  let quote: string | undefined;
  for (let i = start + 1; i < source.length; i += 1) {
    const char = source[i];
    if (quote) {
      if (char === quote) quote = undefined;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === ">") return i;
  }
  return -1;
}

function pushText(nodes: XmlNode[], text: string): void {
  if (text.trim().length === 0) return;
  nodes.push({ kind: "text", text: text.trim() });
}

/** Vérifie que chaque balise ouvrante trouve sa fermante, dans le bon ordre. */
export function validateXml(source: string): void {
  assertNoExternalEntities(source);
  const nodes = tokenizeXml(source);
  const stack: { name: string }[] = [];
  let roots = 0;
  for (const node of nodes) {
    if (node.kind !== "element") continue;
    const name = tagName(node.text);
    if (node.closing) {
      const open = stack.pop();
      if (!open) throw new DataError(`Balise fermante isolée : </${name}>`);
      if (open.name !== name) {
        throw new DataError(`Balise mal imbriquée : </${name}> ferme <${open.name}>.`);
      }
      if (stack.length === 0) roots += 1;
      continue;
    }
    if (node.selfClosing) {
      if (stack.length === 0) roots += 1;
      continue;
    }
    stack.push({ name });
  }
  if (stack.length > 0) {
    throw new DataError(`Balise non fermée : <${stack[stack.length - 1].name}>`);
  }
  if (roots === 0) throw new DataError("Aucun élément racine : le document n'est pas du XML.");
  if (roots > 1) throw new DataError(`Le document a ${roots} racines ; le XML n'en accepte qu'une.`);
}

function tagName(raw: string): string {
  return /^<\/?\s*([^\s/>]+)/.exec(raw)?.[1] ?? "";
}

export function formatXml(source: string, indentation: Indentation = "2"): string {
  validateXml(source);
  const unit = indentUnit(indentation);
  const nodes = tokenizeXml(source);
  const lines: string[] = [];
  let depth = 0;

  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];
    if (node.kind === "element" && node.closing) depth = Math.max(0, depth - 1);

    // Un élément qui ne contient qu'un texte court tient sur une seule ligne :
    // c'est ainsi que le XML se lit, pas en éclatant chaque valeur sur trois.
    if (node.kind === "element" && !node.closing && !node.selfClosing) {
      const text = nodes[i + 1];
      const close = nodes[i + 2];
      if (
        text?.kind === "text" &&
        close?.kind === "element" &&
        close.closing &&
        !text.text.includes("\n")
      ) {
        lines.push(unit.repeat(depth) + node.text + text.text + close.text);
        i += 2;
        continue;
      }
    }

    lines.push(unit.repeat(depth) + node.text);
    if (node.kind === "element" && !node.closing && !node.selfClosing) depth += 1;
  }
  return lines.join("\n");
}

export function minifyXml(source: string): string {
  validateXml(source);
  return tokenizeXml(source)
    .filter((node) => node.kind !== "comment")
    .map((node) => node.text)
    .join("");
}
