/**
 * Formatage et minification du code web : HTML, CSS, JavaScript.
 *
 * Deux cartes du catalogue (« Formater » et « Minifier ») s'appuient sur ce
 * seul module : même détection de langage, mêmes moteurs, mêmes limites.
 *
 * Les moteurs sont chargés **à la demande** : Prettier et Terser pèsent plus
 * lourd que le reste de l'application réunie, et il serait absurde de les
 * télécharger pour ouvrir un convertisseur de longueurs.
 *
 * Rien n'est jamais exécuté : ni `eval`, ni `new Function`, ni chargement
 * d'une ressource référencée par le document. Un minificateur qui exécute le
 * code qu'on lui donne n'est pas un outil, c'est une faille.
 */

export type WebLanguage = "html" | "css" | "js" | "json";

export class WebFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebFormatError";
  }
}

export const LANGUAGE_LABELS: Record<WebLanguage, string> = {
  html: "HTML",
  css: "CSS",
  js: "JavaScript",
  json: "JSON",
};

/** Extensions reconnues, pour le dépôt de fichier. */
export const LANGUAGE_EXTENSIONS: Record<WebLanguage, string[]> = {
  html: ["html", "htm", "xhtml", "vue", "svg"],
  css: ["css", "scss", "less"],
  js: ["js", "mjs", "cjs", "jsx", "ts", "tsx"],
  json: ["json", "jsonc", "webmanifest"],
};

export function languageForExtension(extension: string): WebLanguage | undefined {
  const lower = extension.toLowerCase().replace(/^\./, "");
  for (const [language, extensions] of Object.entries(LANGUAGE_EXTENSIONS)) {
    if (extensions.includes(lower)) return language as WebLanguage;
  }
  return undefined;
}

/**
 * Devine le langage d'un fragment collé.
 *
 * Une heuristique, pas une science : l'utilisateur peut toujours corriger.
 * L'ordre des tests compte — du plus discriminant au plus vague.
 */
export function detectLanguage(source: string): WebLanguage {
  const text = source.trim();
  if (text.length === 0) return "js";
  if (/^\s*[[{]/.test(text) && !/\bfunction\b|=>|;\s*$/.test(text)) {
    try {
      JSON.parse(text);
      return "json";
    } catch {
      /* pas du JSON : on continue les autres hypothèses. */
    }
  }
  if (/^\s*<(!doctype|html|\?xml|[a-z][a-z0-9-]*[\s>/])/i.test(text)) return "html";
  if (/@media|@import|@font-face/i.test(text)) return "css";
  // Une règle CSS : un sélecteur, une accolade, des `propriété: valeur;`.
  if (/^[^{};]*\{[^{}]*[a-z-]+\s*:[^{}]*\}/s.test(text) && !/\b(function|const|let|var|=>)\b/.test(text)) {
    return "css";
  }
  return "js";
}

export type IndentStyle = "2" | "4" | "tab";

export interface FormatOptions {
  indentation?: IndentStyle;
  printWidth?: number;
}

/* ------------------------------------------------------------------------ */
/* Formatage (Prettier)                                                      */
/* ------------------------------------------------------------------------ */

const PRETTIER_PARSER: Record<WebLanguage, string> = {
  html: "html",
  css: "css",
  js: "babel",
  json: "json",
};

export async function formatWeb(
  source: string,
  language: WebLanguage,
  options: FormatOptions = {},
): Promise<string> {
  if (source.trim().length === 0) throw new WebFormatError("Rien à formater.");
  const [prettier, html, postcss, babel, estree] = await Promise.all([
    import("prettier/standalone"),
    import("prettier/plugins/html"),
    import("prettier/plugins/postcss"),
    import("prettier/plugins/babel"),
    import("prettier/plugins/estree"),
  ]);

  const indentation = options.indentation ?? "2";
  try {
    return await prettier.format(source, {
      parser: PRETTIER_PARSER[language],
      plugins: [html.default ?? html, postcss.default ?? postcss, babel.default ?? babel, estree.default ?? estree],
      useTabs: indentation === "tab",
      tabWidth: indentation === "tab" ? 2 : Number(indentation),
      printWidth: options.printWidth ?? 100,
    });
  } catch (error) {
    throw new WebFormatError(cleanEngineMessage(error, language));
  }
}

/* ------------------------------------------------------------------------ */
/* Minification                                                              */
/* ------------------------------------------------------------------------ */

export interface MinifyResult {
  code: string;
  originalBytes: number;
  minifiedBytes: number;
  /** Réduction en pourcentage, entre 0 et 100. */
  savedPercent: number;
}

const encoder = new TextEncoder();

function measure(original: string, minified: string): MinifyResult {
  const originalBytes = encoder.encode(original).length;
  const minifiedBytes = encoder.encode(minified).length;
  return {
    code: minified,
    originalBytes,
    minifiedBytes,
    savedPercent: originalBytes === 0 ? 0 : ((originalBytes - minifiedBytes) / originalBytes) * 100,
  };
}

async function minifyJs(source: string): Promise<string> {
  const { minify } = await import("terser");
  const result = await minify(source, {
    // Le but est de réduire la taille sans changer le comportement : on ne
    // touche donc ni aux noms exportés, ni aux propriétés d'objet.
    mangle: { toplevel: false },
    compress: { drop_console: false, drop_debugger: false },
    format: { comments: false },
  });
  if (typeof result.code !== "string") {
    throw new WebFormatError("Le moteur n'a produit aucun résultat.");
  }
  return result.code;
}

async function minifyCssSource(source: string): Promise<string> {
  const { minify } = await import("csso");
  // `restructure: false` : le regroupement de règles peut changer l'ordre de
  // la cascade sur des feuilles écrites à la main. On reste conservateur.
  return minify(source, { restructure: false }).css;
}

/**
 * Marqueurs de gabarit serveur. Leur présence suffit à interdire toute
 * réécriture : c'est le seul moyen sûr de ne pas casser un template qui se
 * trouve être du JavaScript valide.
 */
const TEMPLATE_MARKERS = /\{\{|\{%|<%|<\?(php|=)/;

/** Éléments dont le contenu est du texte brut : leur intérieur est intouchable. */
const RAW_TEXT_ELEMENTS = new Set(["pre", "textarea", "script", "style"]);

/**
 * Minification HTML, volontairement conservatrice.
 *
 * Ce qui est fait : suppression des commentaires (sauf les commentaires
 * conditionnels), réduction des suites d'espaces **entre** les balises, et
 * minification des blocs `<style>` et `<script>` en ligne.
 *
 * Ce qui n'est **pas** fait : supprimer complètement les espaces entre deux
 * éléments, retirer des balises fermantes optionnelles, ou déqualifier des
 * attributs. Ces optimisations changent le rendu des éléments en ligne ou le
 * comportement de certains navigateurs ; le gain ne vaut pas le risque.
 */
async function minifyHtml(source: string): Promise<string> {
  const output: string[] = [];
  let index = 0;

  while (index < source.length) {
    const next = source.indexOf("<", index);
    if (next === -1) {
      output.push(collapseWhitespace(source.slice(index)));
      break;
    }
    if (next > index) output.push(collapseWhitespace(source.slice(index, next)));

    if (source.startsWith("<!--", next)) {
      const end = source.indexOf("-->", next);
      const comment = source.slice(next, end === -1 ? source.length : end + 3);
      // Les commentaires conditionnels d'Internet Explorer sont du code.
      if (/^<!--\[if\s/i.test(comment)) output.push(comment);
      index = end === -1 ? source.length : end + 3;
      continue;
    }

    const tagEnd = findTagEnd(source, next);
    if (tagEnd === -1) {
      output.push(source.slice(next));
      break;
    }
    const tag = source.slice(next, tagEnd + 1);
    output.push(tag.replace(/\s+/g, " ").replace(/\s+>/, ">").replace(/\s+\/>/, "/>"));
    index = tagEnd + 1;

    const name = /^<\s*([a-z0-9-]+)/i.exec(tag)?.[1]?.toLowerCase();
    if (name && RAW_TEXT_ELEMENTS.has(name) && !tag.endsWith("/>")) {
      const closing = new RegExp(`</\\s*${name}\\s*>`, "i").exec(source.slice(index));
      const bodyEnd = closing ? index + (closing.index ?? 0) : source.length;
      const body = source.slice(index, bodyEnd);
      output.push(await minifyRawBlock(name, body, tag));
      if (closing) {
        output.push(closing[0]);
        index = bodyEnd + closing[0].length;
      } else {
        index = source.length;
      }
    }
  }
  return output.join("").trim();
}

async function minifyRawBlock(name: string, body: string, openingTag: string): Promise<string> {
  if (name === "style") {
    try {
      return await minifyCssSource(body);
    } catch {
      return body;
    }
  }
  if (name === "script") {
    const type = /type\s*=\s*["']?([^"'\s>]+)/i.exec(openingTag)?.[1]?.toLowerCase();
    const isJs =
      type === undefined ||
      type === "module" ||
      type === "text/javascript" ||
      type === "application/javascript";
    if (!isJs || body.trim().length === 0) return body;
    // Un gabarit de moteur de templates (Jinja, Twig, Handlebars, EJS…) peut
    // être du JavaScript **syntaxiquement valide** : `{{ x }}` s'analyse comme
    // un bloc contenant une expression, et le minificateur le réécrirait en
    // `x;`, détruisant le gabarit sans le moindre message d'erreur. On ne
    // touche donc pas à un script qui porte ces marqueurs.
    if (TEMPLATE_MARKERS.test(body)) return body;
    try {
      return await minifyJs(body);
    } catch {
      // Un script en ligne non analysable reste tel quel : mieux vaut ne rien
      // gagner que casser la page.
      return body;
    }
  }
  return body;
}

/**
 * Réduit les blancs sans jamais les supprimer complètement.
 *
 * `<span>a</span> <span>b</span>` doit garder son espace : le retirer colle
 * les deux mots à l'écran. On réduit donc à un seul espace, jamais à zéro.
 */
function collapseWhitespace(text: string): string {
  if (text.length === 0) return "";
  return text.replace(/[ \t\r\n]+/g, " ");
}

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

export async function minifyWeb(source: string, language: WebLanguage): Promise<MinifyResult> {
  if (source.trim().length === 0) throw new WebFormatError("Rien à minifier.");
  try {
    switch (language) {
      case "js":
        return measure(source, await minifyJs(source));
      case "css":
        return measure(source, await minifyCssSource(source));
      case "json":
        return measure(source, JSON.stringify(JSON.parse(source)));
      case "html":
        return measure(source, await minifyHtml(source));
    }
  } catch (error) {
    if (error instanceof WebFormatError) throw error;
    throw new WebFormatError(cleanEngineMessage(error, language));
  }
}

function cleanEngineMessage(error: unknown, language: WebLanguage): string {
  if (!(error instanceof Error)) return `Ce document n'a pas pu être traité comme du ${LANGUAGE_LABELS[language]}.`;
  const first = error.message.split("\n")[0];
  return `${LANGUAGE_LABELS[language]} : ${first}`;
}

/** Limite affichée : au-delà, le navigateur passe plus de temps à peindre qu'à minifier. */
export const MAX_SOURCE_BYTES = 4 * 1024 * 1024;

/** Note affichée par l'outil de minification HTML. */
export const HTML_MINIFY_NOTE =
  "La minification HTML reste volontairement conservatrice : les commentaires sont retirés, " +
  "les suites d'espaces réduites à un seul, les blocs <style> et <script> minifiés. Les espaces " +
  "entre éléments ne sont jamais supprimés complètement — cela changerait le rendu des " +
  "éléments en ligne.";
