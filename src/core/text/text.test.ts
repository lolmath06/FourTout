import { describe, expect, it } from "vitest";
import { cleanText, DEFAULT_CLEAN_OPTIONS, measureText } from "./clean";
import {
  convertLineEndings,
  DEFAULT_DEDUPE_OPTIONS,
  deduplicateLines,
  detectLineEndings,
  sortLines,
  splitLines,
} from "./lines";
import { countMatches, DEFAULT_REPLACE_OPTIONS, findReplace } from "./replace";
import { diffLines, diffWords, toUnifiedDiff } from "./diff";
import { markdownToHtml } from "./markdown";
import { htmlToMarkdown, htmlToText, sanitizeHtml } from "./html";
import { decodeUrlText, encodeUrlText, parseUrlParts } from "./url";
import { describeShape, normalizeUnicode } from "./unicode";
import { generateLorem, seededRandom } from "./lorem";
import { computeStatistics, formatDuration } from "./stats";
import { extractEmails, extractNumbers, extractUrls } from "./extract";

/* ------------------------------------------------------------ nettoyage */

describe("nettoyage d'un texte", () => {
  const options = { ...DEFAULT_CLEAN_OPTIONS };

  it("réduit les espaces multiples et rogne les lignes", () => {
    const result = cleanText("  a   b  \n   c   ", options);
    expect(result.text).toBe("a b\nc");
  });

  it("réduit les lignes vides consécutives à une seule", () => {
    const result = cleanText("a\n\n\n\nb", options);
    expect(result.text).toBe("a\n\nb");
  });

  it("supprime toutes les lignes vides quand on le demande", () => {
    const result = cleanText("a\n\nb\n\n\nc", { ...options, removeBlankLines: true });
    expect(result.text).toBe("a\nb\nc");
  });

  it("ne transforme rien sans option cochée", () => {
    const source = "  a   b  \n\n\n  c  ";
    const inert = {
      ...DEFAULT_CLEAN_OPTIONS,
      collapseSpaces: false,
      trimLines: false,
      collapseBlankLines: false,
      trimDocument: false,
      removeInvisible: false,
    };
    expect(cleanText(source, inert).text).toBe(source);
  });

  it("normalise apostrophes et tirets à la demande", () => {
    const source = "L’été — c’est « chaud »";
    const result = cleanText(source, { ...options, normalizeQuotes: true, normalizeDashes: true });
    expect(result.text).toBe('L\'été - c\'est "chaud"');
  });

  it("retire les caractères invisibles et ramène les espaces insécables", () => {
    // Largeur nulle : supprimée. Espace insécable : ramenée à une espace ordinaire.
    expect(cleanText("a\u200bb", options).text).toBe("ab");
    expect(cleanText("100\u00a0%", options).text).toBe("100 %");
    expect(cleanText("\ufefftexte", options).text).toBe("texte");
  });

  it("rend les mesures avant et après", () => {
    const result = cleanText("  a   b  \n\n\nc  ", options);
    expect(result.before.characters).toBeGreaterThan(result.after.characters);
    expect(result.before.lines).toBe(4);
    expect(result.after.lines).toBe(3);
  });

  it("convertit les fins de ligne quand on le demande", () => {
    expect(cleanText("a\nb", { ...options, lineEndings: "crlf" }).text).toBe("a\r\nb");
  });
});

describe("mesure d'un texte", () => {
  it("compte lignes, mots et caractères", () => {
    expect(measureText("un deux\ntrois")).toEqual({ characters: 13, lines: 2, words: 3 });
    expect(measureText("")).toEqual({ characters: 0, lines: 0, words: 0 });
  });
});

/* --------------------------------------------------------------- lignes */

describe("découpage et recomposition", () => {
  it("préserve un saut de ligne final", () => {
    const source = splitLines("a\nb\n");
    expect(source.lines).toEqual(["a", "b"]);
    expect(source.trailingNewline).toBe(true);
  });

  it("reconnaît les trois conventions", () => {
    expect(detectLineEndings("a\r\nb\r\n").dominant).toBe("crlf");
    expect(detectLineEndings("a\nb\n").dominant).toBe("lf");
    expect(detectLineEndings("a\rb\r").dominant).toBe("cr");
    expect(detectLineEndings("a\r\nb\nc").mixed).toBe(true);
    expect(detectLineEndings("a\nb\n").mixed).toBe(false);
  });

  it("convertit sans perdre de ligne", () => {
    expect(convertLineEndings("a\r\nb\nc\r", "lf")).toBe("a\nb\nc\n");
    expect(convertLineEndings("a\nb", "crlf")).toBe("a\r\nb");
    expect(detectLineEndings(convertLineEndings("a\r\nb\nc", "crlf")).mixed).toBe(false);
  });
});

describe("suppression des doublons", () => {
  const source = "pomme\npoire\nPomme\nbanane\npoire\n\ncerise\nbanane";

  it("ignore la casse par défaut", () => {
    const result = deduplicateLines(source, DEFAULT_DEDUPE_OPTIONS);
    expect(result.linesBefore).toBe(8);
    expect(result.removed).toBe(3);
    expect(result.text.split("\n")).toEqual(["pomme", "poire", "banane", "", "cerise"]);
  });

  it("distingue la casse à la demande", () => {
    const result = deduplicateLines(source, { ...DEFAULT_DEDUPE_OPTIONS, caseSensitive: true });
    expect(result.removed).toBe(2);
    expect(result.text).toContain("Pomme");
  });

  it("peut conserver la dernière occurrence", () => {
    const result = deduplicateLines("a\nb\na", { ...DEFAULT_DEDUPE_OPTIONS, keep: "last" });
    expect(result.text).toBe("b\na");
  });

  it("compare sans les espaces de bord quand on le demande", () => {
    expect(deduplicateLines("a\n  a  ", DEFAULT_DEDUPE_OPTIONS).removed).toBe(1);
    expect(
      deduplicateLines("a\n  a  ", { ...DEFAULT_DEDUPE_OPTIONS, trimComparison: false }).removed,
    ).toBe(0);
  });
});

describe("tri de lignes", () => {
  const options = { caseSensitive: false, keepBlank: false, mode: "alpha-asc" as const };
  const source = "banane\n12 pommes\nCerise\n3 poires\nabricot\n100 fraises";

  it("trie de A à Z sans tenir compte de la casse", () => {
    expect(sortLines(source, options).text.split("\n")[0]).toBe("100 fraises");
    expect(sortLines("b\nA\na", options).text.split("\n")).toEqual(["A", "a", "b"]);
  });

  it("trie de Z à A", () => {
    const lines = sortLines(source, { ...options, mode: "alpha-desc" }).text.split("\n");
    expect(lines[0]).toBe("Cerise");
  });

  it("trie numériquement, les lignes sans nombre à la fin", () => {
    const lines = sortLines(source, { ...options, mode: "numeric-asc" }).text.split("\n");
    expect(lines.slice(0, 3)).toEqual(["3 poires", "12 pommes", "100 fraises"]);
    expect(lines.slice(3)).toEqual(["banane", "Cerise", "abricot"]);
  });

  it("trie par longueur et inverse l'ordre", () => {
    expect(sortLines("aaa\na\naa", { ...options, mode: "length-asc" }).text).toBe("a\naa\naaa");
    expect(sortLines("a\nb\nc", { ...options, mode: "reverse" }).text).toBe("c\nb\na");
  });

  it("mélange de façon reproductible avec un tirage injecté", () => {
    const shuffled = sortLines("a\nb\nc\nd", { ...options, mode: "shuffle" }, seededRandom(42));
    expect(shuffled.text.split("\n").sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("retire ou conserve les lignes vides selon l'option", () => {
    expect(sortLines("b\n\na", options).linesAfter).toBe(2);
    expect(sortLines("b\n\na", { ...options, keepBlank: true }).linesAfter).toBe(3);
  });
});

/* ------------------------------------------------- rechercher/remplacer */

describe("rechercher et remplacer", () => {
  const base = { ...DEFAULT_REPLACE_OPTIONS, search: "chat", replacement: "chien" };
  const source = "Le chat dort. Le chaton joue. CHAT majuscule.";

  it("compte et remplace toutes les occurrences", () => {
    expect(countMatches(source, base).count).toBe(3);
    expect(findReplace(source, base).text).toBe("Le chien dort. Le chienon joue. chien majuscule.");
  });

  it("respecte la casse à la demande", () => {
    const result = findReplace(source, { ...base, caseSensitive: true });
    expect(result.count).toBe(2);
    expect(result.text).toContain("CHAT majuscule");
  });

  it("limite aux mots entiers", () => {
    const result = findReplace(source, { ...base, wholeWord: true });
    expect(result.count).toBe(2);
    expect(result.text).toContain("chaton");
  });

  it("ne remplace que la première occurrence si demandé", () => {
    const result = findReplace(source, { ...base, all: false });
    expect(result.count).toBe(1);
    expect(result.text).toContain("chaton joue");
  });

  it("gère les groupes capturés en mode expression régulière", () => {
    const result = findReplace("2026-09-05", {
      ...DEFAULT_REPLACE_OPTIONS,
      regex: true,
      search: "(\\d{4})-(\\d{2})-(\\d{2})",
      replacement: "$3/$2/$1",
    });
    expect(result.text).toBe("05/09/2026");
  });

  it("laisse « $ » littéral hors mode expression régulière", () => {
    const result = findReplace("prix", { ...DEFAULT_REPLACE_OPTIONS, search: "prix", replacement: "10 $" });
    expect(result.text).toBe("10 $");
  });

  it("renvoie un message clair pour une regex invalide, sans rien casser", () => {
    const result = findReplace("texte", {
      ...DEFAULT_REPLACE_OPTIONS,
      regex: true,
      search: "([a-z",
      replacement: "x",
    });
    expect(result.error).toMatch(/invalide/i);
    expect(result.text).toBe("texte");
    expect(result.count).toBe(0);
  });

  it("trouve un accent avec « mot entier »", () => {
    const result = findReplace("été chaud", {
      ...DEFAULT_REPLACE_OPTIONS,
      search: "été",
      replacement: "hiver",
      wholeWord: true,
    });
    expect(result.text).toBe("hiver chaud");
  });
});

/* ------------------------------------------------------------------ diff */

describe("comparaison de deux textes", () => {
  it("reconnaît deux textes identiques", () => {
    const result = diffLines("a\nb\nc", "a\nb\nc");
    expect(result.identical).toBe(true);
    expect(result.stats).toMatchObject({ added: 0, removed: 0, modified: 0, unchanged: 3 });
  });

  it("distingue ajout, suppression et modification", () => {
    const result = diffLines("un\ndeux\ntrois", "un\nDEUX modifié\ntrois\nquatre");
    expect(result.stats.modified).toBe(1);
    expect(result.stats.added).toBe(1);
    expect(result.stats.removed).toBe(0);
    expect(result.stats.unchanged).toBe(2);
  });

  it("compte une suppression pure", () => {
    const result = diffLines("a\nb\nc", "a\nc");
    expect(result.stats.removed).toBe(1);
    expect(result.stats.added).toBe(0);
  });

  it("met en évidence les mots changés", () => {
    const words = diffWords("le chat dort", "le chien dort");
    expect(words.left.filter((part) => part.changed).map((part) => part.text)).toEqual(["chat"]);
    expect(words.right.filter((part) => part.changed).map((part) => part.text)).toEqual(["chien"]);
  });

  it("produit un diff unifié lisible", () => {
    const unified = toUnifiedDiff(diffLines("a\nb", "a\nc"));
    expect(unified).toContain("-b");
    expect(unified).toContain("+c");
    expect(unified).toContain(" a");
  });
});

/* ------------------------------------------------------ Markdown / HTML */

describe("Markdown vers HTML", () => {
  it("rend titres, emphase, listes et liens", () => {
    const html = markdownToHtml("# Titre\n\nUn **gras** et un *italique*.\n\n- un\n- deux\n");
    expect(html).toContain("<h1>Titre</h1>");
    expect(html).toContain("<strong>gras</strong>");
    expect(html).toContain("<em>italique</em>");
    expect(html).toContain("<ul><li>un</li><li>deux</li></ul>");
  });

  it("rend les listes numérotées et imbriquées", () => {
    const html = markdownToHtml("1. un\n2. deux\n");
    expect(html).toContain("<ol><li>un</li><li>deux</li></ol>");
    expect(markdownToHtml("- un\n  - imbriqué\n")).toContain("<ul><li>un<ul><li>imbriqué</li></ul></li></ul>");
  });

  it("rend code en ligne, blocs de code et citations", () => {
    expect(markdownToHtml("Voici `du code`.")).toContain("<code>du code</code>");
    expect(markdownToHtml("```js\nconst x = 1;\n```")).toContain(
      '<pre><code class="language-js">const x = 1;</code></pre>',
    );
    expect(markdownToHtml("> citation")).toContain("<blockquote><p>citation</p></blockquote>");
  });

  it("rend un tableau", () => {
    const html = markdownToHtml("| A | B |\n| --- | --- |\n| 1 | 2 |");
    expect(html).toContain("<th>A</th>");
    expect(html).toContain("<td>2</td>");
  });

  it("rend les liens sûrs et laisse les autres en texte", () => {
    expect(markdownToHtml("[lien](https://example.com)")).toContain('<a href="https://example.com">lien</a>');
    expect(markdownToHtml("[piège](javascript:alert(1))")).not.toContain("<a ");
  });

  it("n'exécute jamais le HTML brut du Markdown", () => {
    const html = markdownToHtml("Avant <script>alert('x')</script> après");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("assainissement du HTML", () => {
  it("supprime scripts, styles et cadres", () => {
    const html = sanitizeHtml(
      "<p>ok</p><script>alert(1)</script><style>p{}</style><iframe src='x'></iframe>",
    );
    expect(html).toBe("<p>ok</p>");
  });

  it("supprime les gestionnaires d'événements et les URL actives", () => {
    const html = sanitizeHtml('<a href="javascript:alert(1)" onclick="alert(2)">clic</a>');
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("onclick");
    expect(html).toContain("clic");
  });

  it("conserve la mise en forme légitime", () => {
    const html = sanitizeHtml('<h2>Titre</h2><p><strong>gras</strong></p><a href="https://ok.test">lien</a>');
    expect(html).toContain("<h2>Titre</h2>");
    expect(html).toContain("<strong>gras</strong>");
    expect(html).toContain('href="https://ok.test"');
  });

  it("garde le contenu des balises inconnues", () => {
    expect(sanitizeHtml("<custom-tag>texte</custom-tag>")).toBe("texte");
  });
});

describe("HTML vers texte et Markdown", () => {
  const html = "<h1>Titre</h1><p>Un <strong>paragraphe</strong>.</p><ul><li>un</li><li>deux</li></ul>";

  it("retire les balises en gardant la structure", () => {
    const text = htmlToText(html);
    expect(text).toContain("Titre");
    expect(text).toContain("Un paragraphe.");
    expect(text).toContain("- un");
    expect(text).not.toContain("<");
  });

  it("ignore le contenu des scripts et des styles", () => {
    expect(htmlToText("<p>ok</p><script>secret()</script>")).not.toContain("secret");
  });

  it("reconstruit un Markdown équivalent", () => {
    const markdown = htmlToMarkdown(html);
    expect(markdown).toContain("# Titre");
    expect(markdown).toContain("**paragraphe**");
    expect(markdown).toContain("- un");
  });

  it("fait l'aller-retour Markdown → HTML → Markdown", () => {
    const source = "# Titre\n\nUn **gras** et un [lien](https://example.com).\n\n- un\n- deux";
    const back = htmlToMarkdown(markdownToHtml(source));
    expect(back).toContain("# Titre");
    expect(back).toContain("**gras**");
    expect(back).toContain("[lien](https://example.com)");
    expect(back).toContain("- deux");
  });
});

/* -------------------------------------------------------------------- URL */

describe("encodage d'URL", () => {
  it("encode une valeur et une URL complète", () => {
    expect(encodeUrlText("café & thé", "component").text).toBe("caf%C3%A9%20%26%20th%C3%A9");
    expect(encodeUrlText("https://ex.test/a b", "uri").text).toBe("https://ex.test/a%20b");
    expect(encodeUrlText("a b", "query").text).toBe("a+b");
  });

  it("décode et fait l'aller-retour", () => {
    const source = "Où est le café ? 100 %";
    expect(decodeUrlText(encodeUrlText(source, "component").text, "component").text).toBe(source);
  });

  it("explique un pourcentage invalide au lieu de planter", () => {
    const result = decodeUrlText("caf%E9%zz", "component");
    expect(result.error).toMatch(/invalide/i);
    expect(result.text).toBe("");
  });

  it("décompose une URL", () => {
    const parts = parseUrlParts("https://ex.test/a/b?x=1&y=deux#frag");
    expect(parts).toMatchObject({ protocol: "https", host: "ex.test", path: "/a/b", hash: "#frag" });
    expect(parts?.params).toEqual([
      { key: "x", value: "1" },
      { key: "y", value: "deux" },
    ]);
    expect(parseUrlParts("pas une url")).toBeNull();
  });
});

/* ---------------------------------------------------------------- Unicode */

describe("normalisation Unicode", () => {
  // Le même mot, écrit de deux façons : « é » en un point de code (NFC), puis
  // « e » suivi d'un accent combinant (NFD). Visuellement identiques.
  const composed: string = "caf\u00e9";
  const decomposed: string = "cafe\u0301";

  it("réunit deux écritures d'un même mot", () => {
    expect(composed === decomposed).toBe(false);
    expect(normalizeUnicode(decomposed, "NFC").text).toBe(composed);
    expect(normalizeUnicode(composed, "NFD").text).toBe(decomposed);
  });

  it("rend les tailles avant et après", () => {
    const result = normalizeUnicode(decomposed, "NFC");
    expect(result.before.units).toBe(5);
    expect(result.after.units).toBe(4);
    expect(result.changed).toBe(true);
  });

  it("signale un texte déjà normalisé", () => {
    expect(normalizeUnicode(composed, "NFC").alreadyNormalized).toBe(true);
  });

  it("applique la compatibilité avec NFKC", () => {
    expect(normalizeUnicode("\ufb01n", "NFKC").text).toBe("fin");
  });

  it("mesure points de code et octets", () => {
    const shape = describeShape("\u00e9\u{1f600}");
    expect(shape.codePoints).toBe(2);
    expect(shape.units).toBe(3);
    expect(shape.bytes).toBe(6);
  });
});

/* -------------------------------------------------- statistiques et divers */

describe("statistiques de texte", () => {
  it("compte mots, phrases et paragraphes", () => {
    const stats = computeStatistics("Bonjour le monde. Ça va ?\n\nDeuxième paragraphe.");
    expect(stats.words).toBe(8);
    expect(stats.sentences).toBe(3);
    expect(stats.paragraphs).toBe(2);
  });

  it("estime les durées de lecture et de parole", () => {
    const stats = computeStatistics("mot ".repeat(400));
    expect(formatDuration(stats.readingSeconds)).toBe("2 min");
    expect(stats.speakingSeconds).toBeGreaterThan(stats.readingSeconds);
  });

  it("rend des indices de lisibilité bornés", () => {
    const easy = computeStatistics("Le chat dort. Il est là. Tout va bien.");
    const hard = computeStatistics(
      "L'incommensurable complexité épistémologique caractérisant intrinsèquement les phénomènes sociolinguistiques contemporains nécessite invariablement une approche méthodologique pluridisciplinaire.",
    );
    expect(easy.readabilityFr).toBeGreaterThan(hard.readabilityFr);
    expect(hard.readabilityFr).toBeGreaterThanOrEqual(0);
    expect(easy.readabilityFr).toBeLessThanOrEqual(100);
  });

  it("gère un texte vide", () => {
    expect(computeStatistics("")).toMatchObject({ words: 0, characters: 0, readingSeconds: 0 });
  });
});

describe("extraction", () => {
  const source = `Contact : Marie@Example.com ou support@fourtout.test
Doc : https://example.com/docs?x=1 et www.example.org/page
Montants : 1 250,50 puis 42 et -7.5
Doublon : support@fourtout.test`;

  it("extrait les URL sans doublon", () => {
    const result = extractUrls(source);
    expect(result.values).toEqual(["https://example.com/docs?x=1", "www.example.org/page"]);
  });

  it("extrait les e-mails en minuscules, sans doublon", () => {
    const result = extractEmails(source);
    expect(result.values).toEqual(["marie@example.com", "support@fourtout.test"]);
    expect(result.duplicates).toBe(1);
  });

  it("extrait les nombres et en calcule la somme", () => {
    const result = extractNumbers("10 puis 32 et -2");
    expect(result.values).toEqual(["10", "32", "-2"]);
    expect(result.sum).toBe(40);
    expect(result.min).toBe(-2);
    expect(result.max).toBe(32);
  });
});

describe("Lorem Ipsum", () => {
  it("produit le nombre de paragraphes demandé", () => {
    const text = generateLorem({ unit: "paragraphs", count: 3, startWithLorem: true }, seededRandom(7));
    expect(text.split("\n\n")).toHaveLength(3);
    expect(text.startsWith("Lorem ipsum dolor sit amet")).toBe(true);
  });

  it("produit le nombre de mots demandé", () => {
    const text = generateLorem({ unit: "words", count: 12, startWithLorem: false }, seededRandom(7));
    expect(text.replace(/\.$/, "").split(" ")).toHaveLength(12);
  });

  it("est reproductible avec un tirage injecté", () => {
    const options = { unit: "sentences" as const, count: 4, startWithLorem: false };
    expect(generateLorem(options, seededRandom(1))).toBe(generateLorem(options, seededRandom(1)));
  });
});
