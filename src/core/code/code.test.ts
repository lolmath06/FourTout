import { describe, expect, it } from "vitest";
import {
  DataError,
  formatJson,
  formatXml,
  inspectJson,
  minifyJson,
  minifyXml,
  parseJson,
  sortJsonKeys,
  validateXml,
} from "./data";
import { formatYaml, jsonToYaml, parseYaml, yamlToJson } from "./yaml";
import { compactSql, formatSql, DEFAULT_SQL_SETTINGS } from "./sql";
import {
  baseViews,
  decodeJwt,
  describeTimestamp,
  formatInBase,
  generateUuids,
  groupDigits,
  guessTimestampUnit,
  JwtError,
  parseInBase,
  uuidV4,
  uuidV7,
  uuidVersionOf,
} from "./tokens";
import { compileRegex, MAX_MATCHES, RegexError, replaceAll, runRegex, TIME_BUDGET_MS } from "./regex";
import { buildCron, CronError, explainCron, splitCron } from "./cron";
import { detectLanguage, formatWeb, languageForExtension, minifyWeb } from "./web";
import { HEAVY_TIMEOUT } from "@/test/timeouts";

/* ------------------------------------------------------------------------ */

describe("JSON", () => {
  it("formate et minifie sans altérer les données", () => {
    const source = '{"b":1,"a":[1,2,{"c":true}]}';
    const formatted = formatJson(source, { indentation: "2" });
    expect(formatted).toContain('\n  "b": 1');
    expect(JSON.parse(formatted)).toEqual(JSON.parse(source));
    expect(minifyJson(formatted)).toBe(source);
  });

  it("respecte l'indentation demandée", () => {
    expect(formatJson('{"a":1}', { indentation: "4" })).toBe('{\n    "a": 1\n}');
    expect(formatJson('{"a":1}', { indentation: "tab" })).toBe('{\n\t"a": 1\n}');
  });

  it("trie les clés sans toucher à l'ordre des tableaux", () => {
    const sorted = sortJsonKeys({ b: 1, a: { d: 1, c: [3, 1, 2] } });
    expect(JSON.stringify(sorted)).toBe('{"a":{"c":[3,1,2],"d":1},"b":1}');
  });

  it("situe l'erreur de syntaxe", () => {
    try {
      parseJson('{\n  "a": 1,\n  "b": ,\n}');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(DataError);
      expect((error as DataError).line).toBe(3);
      expect((error as DataError).message).toMatch(/ligne 3, colonne \d+/);
    }
  });

  it("refuse un document vide plutôt que de renvoyer undefined", () => {
    expect(() => parseJson("   ")).toThrow(/vide/);
  });

  it("conserve l'UTF-8, émojis compris", () => {
    const source = '{"ville":"Besançon","emoji":"🛠️"}';
    expect(JSON.parse(formatJson(source))).toEqual({ ville: "Besançon", emoji: "🛠️" });
  });

  it("décrit la structure du document", () => {
    const stats = inspectJson(parseJson('{"a":[1,2],"b":{"c":1}}'));
    expect(stats.objects).toBe(2);
    expect(stats.arrays).toBe(1);
    expect(stats.values).toBe(3);
    expect(stats.maxDepth).toBe(3);
  });
});

/* ------------------------------------------------------------------------ */

describe("YAML", () => {
  it("convertit dans les deux sens sans perte", () => {
    const json = '{"nom":"FourTout","outils":["pdf","image"],"local":true,"version":2}';
    const yaml = jsonToYaml(json);
    expect(yaml).toContain("nom: FourTout");
    expect(JSON.parse(yamlToJson(yaml))).toEqual(JSON.parse(json));
  });

  it("formate un YAML mal indenté", () => {
    const formatted = formatYaml("a:    1\nb:\n     - 1\n     - 2");
    expect(formatted).toBe("a: 1\nb:\n  - 1\n  - 2\n");
  });

  it("n'instancie jamais un objet à partir d'un tag", () => {
    // Le schéma core ne connaît que des types de données. Un tag exécutable
    // doit faire échouer la lecture, pas produire un objet.
    expect(() => parseYaml("!!js/function 'function () { return 1 }'")).toThrow();
    expect(() => parseYaml("!!python/object:os.system ['ls']")).toThrow();
  });

  it("lit les types du schéma core, et eux seuls", () => {
    expect(parseYaml("a: 1\nb: true\nc: null\nd: 1.5\ne: texte")).toEqual({
      a: 1,
      b: true,
      c: null,
      d: 1.5,
      e: "texte",
    });
  });

  it("signale une erreur de syntaxe", () => {
    expect(() => parseYaml("a:\n  - 1\n - 2")).toThrow(DataError);
  });
});

/* ------------------------------------------------------------------------ */

describe("XML", () => {
  it("formate en respectant l'imbrication", () => {
    const formatted = formatXml("<a><b>1</b><c><d/></c></a>");
    expect(formatted).toBe("<a>\n  <b>1</b>\n  <c>\n    <d/>\n  </c>\n</a>");
  });

  it("minifie sans perdre le contenu", () => {
    expect(minifyXml("<a>\n  <b>1</b>\n  <!-- note -->\n</a>")).toBe("<a><b>1</b></a>");
  });

  it("détecte les balises mal imbriquées ou non fermées", () => {
    expect(() => validateXml("<a><b></a></b>")).toThrow(/mal imbriquée/);
    expect(() => validateXml("<a><b></a>")).toThrow(/mal imbriquée|non fermée/);
    expect(() => validateXml("<a>")).toThrow(/non fermée/);
    expect(() => validateXml("</a>")).toThrow(/isolée/);
    expect(() => validateXml("<a/><b/>")).toThrow(/racines/);
  });

  it("refuse toute déclaration d'entité (XXE)", () => {
    const xxe =
      '<?xml version="1.0"?>\n' +
      '<!DOCTYPE foo [ <!ENTITY xxe SYSTEM "file:///etc/passwd"> ]>\n' +
      "<foo>&xxe;</foo>";
    expect(() => validateXml(xxe)).toThrow(/entités XML/);
    expect(() => formatXml(xxe)).toThrow(/XXE/);
  });

  it("ne résout aucune ressource extérieure en analysant une charge XXE", async () => {
    // Un vrai fichier, avec un contenu reconnaissable : si l'analyseur résolvait
    // l'entité, ce texte apparaîtrait dans la sortie.
    const { mkdtempSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "ft-xxe-"));
    const secret = join(dir, "secret.txt");
    writeFileSync(secret, "SENTINELLE-XXE-NE-DOIT-JAMAIS-APPARAITRE");

    const payloads = [
      `<?xml version="1.0"?><!DOCTYPE r [ <!ENTITY x SYSTEM "file://${secret}"> ]><r>&x;</r>`,
      '<?xml version="1.0"?><!DOCTYPE r [ <!ENTITY x SYSTEM "file:///etc/passwd"> ]><r>&x;</r>',
      '<?xml version="1.0"?><!DOCTYPE r [ <!ENTITY % p SYSTEM "http://exemple.test/e.dtd"> %p; ]><r/>',
      '<?xml version="1.0"?><!DOCTYPE r SYSTEM "http://exemple.test/r.dtd"><r/>',
    ];

    // Aucune requête réseau ne doit partir, sous aucune forme.
    const calls: string[] = [];
    const realFetch = globalThis.fetch;
    const realXhr = globalThis.XMLHttpRequest;
    globalThis.fetch = ((input: unknown) => {
      calls.push(String(input));
      throw new Error("aucune requête ne devait partir");
    }) as typeof fetch;
    // @ts-expect-error remplacement volontaire le temps du test
    globalThis.XMLHttpRequest = class {
      open(_method: string, url: string) {
        calls.push(url);
        throw new Error("aucune requête ne devait partir");
      }
    };

    try {
      for (const payload of payloads) {
        // Chaque fonction publique est éprouvée : il suffirait qu'une seule
        // laisse passer la charge.
        for (const run of [
          () => validateXml(payload),
          () => formatXml(payload),
          () => minifyXml(payload),
        ]) {
          let output = "";
          try {
            output = String(run() ?? "");
          } catch {
            // Refus attendu : c'est le comportement voulu.
          }
          expect(output).not.toContain("SENTINELLE-XXE-NE-DOIT-JAMAIS-APPARAITRE");
          expect(output).not.toContain("root:");
          expect(output).not.toMatch(/\/bin\/(ba)?sh/);
        }
      }
    } finally {
      globalThis.fetch = realFetch;
      globalThis.XMLHttpRequest = realXhr;
    }

    expect(calls, `des ressources externes ont été demandées : ${calls.join(", ")}`).toEqual([]);
  });

  it("refuse une DTD externe", () => {
    const external = '<!DOCTYPE note SYSTEM "http://exemple.test/note.dtd"><note/>';
    expect(() => validateXml(external)).toThrow(/DTD externe/);
  });

  it("ne se laisse pas tromper par un chevron dans un attribut", () => {
    expect(() => validateXml('<a titre="1 > 0"><b/></a>')).not.toThrow();
    expect(minifyXml('<a titre="1 > 0"><b/></a>')).toBe('<a titre="1 > 0"><b/></a>');
  });

  it("préserve les sections CDATA", () => {
    const source = "<a><![CDATA[ <b> pas une balise ]]></a>";
    expect(minifyXml(source)).toContain("<![CDATA[ <b> pas une balise ]]>");
  });
});

/* ------------------------------------------------------------------------ */

describe("SQL", () => {
  it("met en forme une requête compacte", () => {
    const formatted = formatSql(
      "select a,b from t join u on t.id=u.id where a>1 order by b",
      DEFAULT_SQL_SETTINGS,
    );
    expect(formatted).toContain("SELECT");
    expect(formatted).toContain("FROM");
    expect(formatted).toContain("JOIN");
    expect(formatted.split("\n").length).toBeGreaterThan(4);
  });

  it("gère WITH, CASE, INSERT, UPDATE et DELETE", () => {
    const queries = [
      "with x as (select 1 as n) select * from x",
      "select case when a > 1 then 'grand' else 'petit' end as taille from t",
      "insert into t (a, b) values (1, 2)",
      "update t set a = 1 where b = 2",
      "delete from t where a = 1",
      "create table t (id int primary key, nom text)",
    ];
    for (const query of queries) {
      expect(() => formatSql(query, DEFAULT_SQL_SETTINGS)).not.toThrow();
    }
  });

  it("respecte la casse des mots-clés demandée", () => {
    expect(formatSql("SELECT 1", { ...DEFAULT_SQL_SETTINGS, keywordCase: "lower" })).toContain(
      "select",
    );
  });

  it("compacte sans laisser un commentaire avaler la requête", () => {
    expect(compactSql("SELECT 1 -- note\nFROM t")).toBe("SELECT 1 FROM t");
    expect(compactSql("SELECT /* bloc */ 1\n  FROM t")).toBe("SELECT 1 FROM t");
  });

  it("refuse une entrée vide", () => {
    expect(() => formatSql("  ", DEFAULT_SQL_SETTINGS)).toThrow(/Aucune requête/);
  });
});

/* ------------------------------------------------------------------------ */

describe("JWT", () => {
  // Token de démonstration public de jwt.io : aucune donnée réelle, aucun
  // secret utile — la signature n'est de toute façon jamais vérifiée ici.
  const token =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." +
    "eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyLCJleHAiOjE1MTYyNDI2MjJ9." +
    "SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";

  it("décode l'en-tête et la charge utile", () => {
    const decoded = decodeJwt(token, new Date("2018-01-18T00:00:00Z"));
    expect(decoded.header).toEqual({ alg: "HS256", typ: "JWT" });
    expect(decoded.payload.sub).toBe("1234567890");
    expect(decoded.algorithm).toBe("HS256");
    expect(decoded.signature).toBe("SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c");
  });

  it("traduit les dates des claims standards", () => {
    const decoded = decodeJwt(token, new Date("2018-01-18T00:00:00Z"));
    const iat = decoded.claims.find((claim) => claim.name === "iat");
    expect(iat?.readable).toContain("2018");
    expect(iat?.description).toContain("émission");
  });

  it("signale un token expiré sans jamais parler de signature valide", () => {
    const decoded = decodeJwt(token, new Date("2030-01-01T00:00:00Z"));
    expect(decoded.usable).toBe(false);
    expect(decoded.warnings.join(" ")).toMatch(/expiré/);
    expect(decoded.warnings.join(" ")).not.toMatch(/signature (est )?valide/i);
  });

  it("signale l'algorithme « none »", () => {
    const header = btoa(JSON.stringify({ alg: "none", typ: "JWT" }));
    const payload = btoa(JSON.stringify({ sub: "1" }));
    const decoded = decodeJwt(`${header}.${payload}.x`);
    expect(decoded.warnings.join(" ")).toMatch(/n'est pas signé/);
  });

  it("accepte le préfixe Bearer collé depuis un en-tête HTTP", () => {
    expect(() => decodeJwt(`Bearer ${token}`)).not.toThrow();
  });

  it("refuse ce qui n'est pas un JWT", () => {
    expect(() => decodeJwt("pas.un.jwt")).toThrow(JwtError);
    expect(() => decodeJwt("a.b")).toThrow(/trois segments/);
    expect(() => decodeJwt("a..c")).toThrow(/vide/);
  });
});

/* ------------------------------------------------------------------------ */

describe("UUID", () => {
  it("produit mille v4 conformes, uniques et bien formés", () => {
    const list = generateUuids("v4", 1000);
    expect(list).toHaveLength(1000);
    // Unicité : une collision sur mille tirages trahirait un générateur cassé.
    expect(new Set(list).size).toBe(1000);
    for (const value of list) {
      // Format canonique, chiffre de version 4 et bits de variante RFC 4122
      // (le premier caractère du quatrième groupe vaut 8, 9, a ou b).
      expect(value).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      expect(uuidVersionOf(value)).toBe(4);
    }
  });

  it("échoue bruyamment plutôt que de se rabattre sur un hasard prévisible", () => {
    // Sans générateur cryptographique, un UUID adossé à `Math.random()` serait
    // devinable : le module doit refuser de produire quoi que ce soit.
    const real = globalThis.crypto;
    try {
      Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true });
      expect(() => uuidV4()).toThrow(/cryptographique/);
    } finally {
      Object.defineProperty(globalThis, "crypto", { value: real, configurable: true });
    }
    // Et une fois le générateur revenu, tout refonctionne.
    expect(uuidVersionOf(uuidV4())).toBe(4);
  });

  it("produit des v7 croissants dans le temps", () => {
    const early = uuidV7(1_700_000_000_000);
    const late = uuidV7(1_800_000_000_000);
    expect(uuidVersionOf(early)).toBe(7);
    expect(uuidVersionOf(late)).toBe(7);
    // Le tri lexicographique suit le tri chronologique : c'est tout l'intérêt.
    expect(early < late).toBe(true);
  });

  it("borne la quantité demandée", () => {
    expect(generateUuids("v4", 5000)).toHaveLength(1000);
    expect(generateUuids("v4", 0)).toHaveLength(1);
  });

  it("rejette une chaîne qui n'est pas un UUID", () => {
    expect(uuidVersionOf("pas-un-uuid")).toBeUndefined();
    expect(uuidVersionOf(uuidV4())).toBe(4);
  });
});

/* ------------------------------------------------------------------------ */

describe("timestamp Unix", () => {
  it("distingue secondes et millisecondes", () => {
    expect(guessTimestampUnit(1_700_000_000)).toBe("s");
    expect(guessTimestampUnit(1_700_000_000_000)).toBe("ms");
  });

  it("décrit une date en local, UTC et ISO", () => {
    const view = describeTimestamp(1_700_000_000, "s", new Date("2023-11-14T22:13:20Z"));
    expect(view.iso).toBe("2023-11-14T22:13:20.000Z");
    expect(view.utc).toContain("2023");
    expect(view.relative).toBe("maintenant");
  });

  it("refuse un nombre qui ne correspond à aucune date", () => {
    expect(() => describeTimestamp(1e20, "ms")).toThrow(/aucune date/);
  });
});

/* ------------------------------------------------------------------------ */

describe("bases numériques", () => {
  it("fait un aller-retour exact sur un très grand entier", () => {
    // 2^53 + 1 et au-delà : la zone où `parseInt` abîme silencieusement.
    const huge = "9007199254740993123456789";
    const value = parseInBase(huge, 10);
    expect(value.toString(10)).toBe(huge);
    expect(parseInBase(formatInBase(value, 16), 16).toString(10)).toBe(huge);
    expect(parseInBase(formatInBase(value, 2), 2).toString(10)).toBe(huge);
  });

  it("convertit entre les quatre bases usuelles", () => {
    const views = baseViews(parseInBase("255", 10));
    expect(views.binary).toBe("11111111");
    expect(views.octal).toBe("377");
    expect(views.hexadecimal).toBe("FF");
    expect(views.bits).toBe(8);
  });

  it("accepte les préfixes et séparateurs réellement collés", () => {
    expect(parseInBase("0xFF", 16)).toBe(255n);
    expect(parseInBase("0b1010", 2)).toBe(10n);
    expect(parseInBase("1_000_000", 10)).toBe(1_000_000n);
    expect(parseInBase("ff", 16)).toBe(255n);
  });

  it("gère les nombres négatifs", () => {
    expect(parseInBase("-42", 10)).toBe(-42n);
    expect(baseViews(-42n).hexadecimal).toBe("-2A");
  });

  it("refuse un chiffre hors base plutôt que de l'ignorer", () => {
    expect(() => parseInBase("12", 2)).toThrow(/n'est pas un chiffre valide en base 2/);
    expect(() => parseInBase("FF", 10)).toThrow(/base 10/);
    expect(() => parseInBase("1", 37)).toThrow(/entre 2 et 36/);
    expect(() => parseInBase("", 10)).toThrow(/Aucun nombre/);
  });

  it("groupe les chiffres pour la lecture", () => {
    expect(groupDigits("11111111", 4)).toBe("1111 1111");
    expect(groupDigits("101", 4)).toBe("101");
    expect(groupDigits("-11110000", 4)).toBe("-1111 0000");
  });
});

/* ------------------------------------------------------------------------ */

describe("expressions régulières", () => {
  it("liste les correspondances, leurs index et leurs groupes", () => {
    const run = runRegex("(\\w+)@(\\w+)\\.fr", "g", "a@b.fr et c@d.fr");
    expect(run.matches).toHaveLength(2);
    expect(run.matches[0].value).toBe("a@b.fr");
    expect(run.matches[0].index).toBe(0);
    expect(run.matches[0].groups.map((group) => group.value)).toEqual(["a", "b"]);
    expect(run.groupCount).toBe(2);
  });

  it("relève les groupes nommés", () => {
    const run = runRegex("(?<annee>\\d{4})-(?<mois>\\d{2})", "", "2026-03");
    expect(run.groupNames).toEqual(["annee", "mois"]);
    expect(run.matches[0].groups[0].name).toBe("annee");
  });

  it("ne compte pas les groupes non capturants ni les assertions arrière", () => {
    expect(runRegex("(?:a)(b)", "", "ab").groupCount).toBe(1);
    expect(runRegex("(?<=a)(b)", "", "ab").groupCount).toBe(1);
  });

  it("indique la ligne de chaque correspondance", () => {
    const run = runRegex("x", "g", "a\nb\nx");
    expect(run.matches[0].line).toBe(3);
  });

  it("ne boucle pas indéfiniment sur une correspondance vide", () => {
    const run = runRegex("a*", "g", "bbb");
    expect(run.matches.length).toBeLessThanOrEqual(5);
    expect(run.truncated).toBe(false);
  });

  it("borne le nombre de correspondances affichées", () => {
    const run = runRegex("a", "g", "a".repeat(5000));
    expect(run.matches).toHaveLength(1000);
    expect(run.truncated).toBe(true);
    expect(run.truncationReason).toMatch(/1000/);
  });

  it("refuse un sujet trop long au lieu de figer l'interface", () => {
    expect(() => runRegex("a", "g", "a".repeat(300_000))).toThrow(/dépasse/);
  });

  it("explique une expression invalide", () => {
    expect(() => compileRegex("(a", "")).toThrow(RegexError);
    expect(() => compileRegex("", "")).toThrow(/vide/);
  });

  it("remplace avec les références de groupes", () => {
    expect(replaceAll("(\\w+)@(\\w+)", "g", "a@b", "$2:$1")).toBe("b:a");
    expect(replaceAll("(?<n>\\d+)", "g", "n=42", "[$<n>]")).toBe("n=[42]");
  });
});

/* ------------------------------------------------------------------------ */

describe("cron", () => {
  const reference = new Date("2026-03-14T00:00:00");

  it("explique une expression en français", () => {
    const result = explainCron("0 9 * * 1-5", reference);
    expect(result.description).toMatch(/09:00/);
    expect(result.description).toMatch(/lundi/);
    expect(result.fields).toHaveLength(5);
    expect(result.fields[0]).toMatchObject({ key: "minute", value: "0" });
  });

  it("prédit les prochaines occurrences", () => {
    const result = explainCron("0 9 * * 1-5", reference);
    expect(result.occurrences).toHaveLength(5);
    // 14 mars 2026 est un samedi : la première occurrence est le lundi 16.
    expect(result.occurrences[0].getDay()).toBe(1);
    expect(result.occurrences[0].getHours()).toBe(9);
    for (let i = 1; i < result.occurrences.length; i += 1) {
      expect(result.occurrences[i].getTime()).toBeGreaterThan(result.occurrences[i - 1].getTime());
    }
  });

  it("avertit du piège des deux champs de jour", () => {
    const result = explainCron("0 0 1 * 1", reference);
    expect(result.warnings.join(" ")).toMatch(/OU l'autre/);
    expect(explainCron("0 0 1 * *", reference).warnings).toHaveLength(0);
  });

  it("refuse une expression qui n'a pas cinq champs", () => {
    expect(() => splitCron("* * * *")).toThrow(/cinq champs/);
    expect(() => splitCron("0 0 12 * * ?")).toThrow(/Quartz/);
    expect(() => splitCron("")).toThrow(/vide/);
  });

  it("refuse une valeur de champ invalide", () => {
    expect(() => explainCron("99 * * * *", reference)).toThrow(CronError);
  });

  it("assemble une expression depuis les champs", () => {
    expect(
      buildCron({ minute: "0", hour: "9", dayOfMonth: "", month: "*", dayOfWeek: "1-5" }),
    ).toBe("0 9 * * 1-5");
  });
});

/* ------------------------------------------------------------------------ */

describe("code web", () => {
  it("devine le langage d'un fragment collé", () => {
    expect(detectLanguage('{"a": 1}')).toBe("json");
    expect(detectLanguage("<!doctype html><html></html>")).toBe("html");
    expect(detectLanguage("<div>a</div>")).toBe("html");
    expect(detectLanguage("body { color: red; }")).toBe("css");
    expect(detectLanguage("@media (min-width: 10px) { a { color: red } }")).toBe("css");
    expect(detectLanguage("const a = () => 1;")).toBe("js");
  });

  it("associe une extension à un langage", () => {
    expect(languageForExtension("css")).toBe("css");
    expect(languageForExtension(".TS")).toBe("js");
    expect(languageForExtension("bin")).toBeUndefined();
  });

  it("formate le JavaScript, le CSS et le HTML", async () => {
    expect(await formatWeb("const a={b:1,c:2}", "js")).toBe("const a = { b: 1, c: 2 };\n");
    expect(await formatWeb("a{color:red}", "css")).toBe("a {\n  color: red;\n}\n");
    expect(await formatWeb("<p><b>a</b></p>", "html")).toContain("<p>");
  });

  it("respecte l'indentation demandée", async () => {
    expect(await formatWeb("if(a){b()}", "js", { indentation: "4" })).toContain("\n    b();");
    expect(await formatWeb("if(a){b()}", "js", { indentation: "tab" })).toContain("\n\tb();");
  });

  it("signale une erreur de syntaxe au lieu de renvoyer le code tel quel", async () => {
    await expect(formatWeb("const = ;", "js")).rejects.toThrow(/JavaScript/);
    await expect(formatWeb("  ", "js")).rejects.toThrow(/Rien à formater/);
  });

  it("minifie le JavaScript sans changer son comportement", async () => {
    const source =
      "function somme(a, b) {\n  // additionne\n  return a + b;\n}\nconsole.log(somme(1, 2));";
    const result = await minifyWeb(source, "js");
    expect(result.minifiedBytes).toBeLessThan(result.originalBytes);
    expect(result.savedPercent).toBeGreaterThan(0);
    expect(result.code).not.toContain("additionne");
    expect(result.code).toContain("function somme");

    // Le minifié doit rester du JavaScript **analysable**. On le vérifie en le
    // redonnant à l'analyseur du formateur : celui-ci lit la grammaire sans
    // jamais exécuter la moindre instruction du code de l'utilisateur.
    await expect(formatWeb(result.code, "js")).resolves.toContain("function somme");
  });

  it("laisse un JavaScript moderne syntaxiquement valide après minification", async () => {
    const source = [
      "class Compteur extends Base {",
      "  #total = 0n;",
      "  static from(values = []) { return new Compteur(...values); }",
      "  async *lire({ pas = 1, ...reste } = {}) {",
      "    for (const valeur of reste?.liste ?? []) yield valeur ** pas;",
      "  }",
      "  get total() { return this.#total ?? 0; }",
      "}",
      "const etiquette = `total : ${new Compteur().total}`;",
      "export default etiquette;",
    ].join("\n");

    const result = await minifyWeb(source, "js");
    expect(result.minifiedBytes).toBeLessThan(result.originalBytes);
    // Deuxième passage dans l'analyseur : une minification qui casserait la
    // syntaxe échouerait ici, et non chez l'utilisateur.
    await expect(formatWeb(result.code, "js")).resolves.toContain("class Compteur");
  });

  it("minifie le CSS", async () => {
    const result = await minifyWeb("a {\n  color : red ;\n}\n/* note */", "css");
    expect(result.code).toBe("a{color:red}");
  });

  it("minifie le HTML sans coller les éléments en ligne", async () => {
    const source = "<p>  <b>a</b>   <i>b</i>  </p>\n<!-- note -->";
    const result = await minifyWeb(source, "html");
    // L'espace entre <b> et <i> est réduit à un seul, jamais supprimé : sinon
    // « a » et « b » se toucheraient à l'écran.
    expect(result.code).toBe("<p> <b>a</b> <i>b</i> </p>");
    expect(result.code).not.toContain("note");
  });

  it("minifie les blocs style et script en ligne", async () => {
    const result = await minifyWeb(
      "<style>a {\n  color : red ;\n}</style><script>var a = 1;   var b = 2;</script>",
      "html",
    );
    expect(result.code).toContain("a{color:red}");
    expect(result.code).not.toContain("var a = 1;   var b = 2;");
  });

  it("préserve le contenu de pre et textarea", async () => {
    const result = await minifyWeb("<pre>  a\n  b</pre>", "html");
    expect(result.code).toBe("<pre>  a\n  b</pre>");
  });

  it("préserve les commentaires conditionnels", async () => {
    const result = await minifyWeb("<!--[if IE]><p>a</p><![endif]-->", "html");
    expect(result.code).toContain("<!--[if IE]>");
  });

  it("laisse intact un script en ligne non analysable plutôt que de casser la page", async () => {
    const result = await minifyWeb("<script>{{ variable_serveur }}</script>", "html");
    expect(result.code).toContain("{{ variable_serveur }}");
  });

  it("mesure le gain", async () => {
    const result = await minifyWeb('{\n  "a":   1\n}', "json");
    expect(result.code).toBe('{"a":1}');
    expect(result.savedPercent).toBeGreaterThan(30);
  });
});

/* ------------------------------------------------------------------------ */

describe("expressions régulières — protection réelle", () => {
  it(
    "le budget de temps ne prétend pas interrompre un exec catastrophique",
    () => {
      // Vingt-six caractères suffisent à dépasser le budget, et le coût double
      // à chaque caractère ajouté : borner la taille du sujet ne protège de
      // rien. Seule la mise à mort d'un fil séparé est une interruption.
      const subject = `${"a".repeat(26)}b`;
      const started = Date.now();
      runRegex("^(a+)+$", "", subject);
      const elapsed = Date.now() - started;
      expect(elapsed).toBeGreaterThan(TIME_BUDGET_MS);
    },
    HEAVY_TIMEOUT,
  );

  it("borne le nombre d'itérations d'une recherche globale coûteuse", () => {
    // Là, le budget joue son rôle : il est vérifié entre deux correspondances.
    const run = runRegex("a", "g", "a".repeat(150_000));
    expect(run.truncated).toBe(true);
    expect(run.matches.length).toBeLessThanOrEqual(MAX_MATCHES);
  });
});
