import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Gardes structurelles du produit.
 *
 * Ces tests ne vérifient pas un comportement : ils vérifient une **propriété du
 * code**, que rien d'autre ne peut voir. Un objet binaire jamais libéré ne fait
 * échouer aucun test fonctionnel ; un chemin personnel codé en dur fonctionne
 * parfaitement sur la machine qui l'a écrit ; un message de débogage oublié
 * s'affiche dans une console que personne ne regarde pendant les tests.
 *
 * Chacun de ces tests a trouvé quelque chose lors de la passe de durcissement.
 */
const ROOT = process.cwd();

function sourceFiles(directory: string, extensions: string[]): string[] {
  const found: string[] = [];
  const walk = (path: string) => {
    for (const entry of readdirSync(path)) {
      const full = join(path, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (extensions.some((extension) => entry.endsWith(extension))) {
        found.push(full);
      }
    }
  };
  walk(join(ROOT, directory));
  return found;
}

const RUNTIME_TS = sourceFiles("src", [".ts", ".tsx"]).filter(
  (path) => !path.includes(".test."),
);

describe("gardes structurelles de l'interface", () => {
  it("libère chaque objet binaire qu'elle crée", () => {
    // Un `URL.createObjectURL` sans révocation retient son contenu jusqu'à la
    // fermeture de la fenêtre. Sur un outil qui rend une image par page, cela
    // se compte en centaines de mégaoctets.
    const leaking = RUNTIME_TS.filter((path) => {
      const text = readFileSync(path, "utf8");
      return text.includes("createObjectURL") && !text.includes("revokeObjectURL");
    }).map((path) => path.replace(`${ROOT}/`, ""));

    expect(leaking, "fichiers qui créent une URL d'objet sans jamais la libérer").toEqual([]);
  });

  it("n'emploie ni « as any » ni suppression de vérification de types", () => {
    const unsafe = RUNTIME_TS.filter((path) => {
      const text = readFileSync(path, "utf8");
      return /\bas any\b/.test(text) || text.includes("@ts-ignore") || text.includes("@ts-expect-error");
    }).map((path) => path.replace(`${ROOT}/`, ""));

    expect(unsafe).toEqual([]);
  });

  it("ne laisse aucun chemin personnel dans le code livré", () => {
    // Ces chemins existent légitimement dans les tests, les scripts et la
    // documentation de développement — jamais dans ce que l'utilisateur exécute.
    const personal = RUNTIME_TS.filter((path) => {
      const text = readFileSync(path, "utf8");
      // Les commentaires qui *illustrent* un chemin multiplateforme sont
      // écrits avec des points de suspension : ils ne désignent aucune machine.
      return /\/home\/matheo|Documents\/FourTout/.test(text);
    }).map((path) => path.replace(`${ROOT}/`, ""));

    expect(personal).toEqual([]);
  });

  it("ne laisse aucune trace de débogage dans le code livré", () => {
    // Le formateur de code affiche un exemple JavaScript qui contient, lui, un
    // `console.log` : c'est le contenu montré à l'utilisateur, pas une trace
    // oubliée. C'est la seule exception, et elle est nommée.
    const SAMPLE_CODE = "src/tools/impl/dev/CodeFormatTools.tsx";

    const noisy = RUNTIME_TS.filter((path) => {
      if (path.endsWith(SAMPLE_CODE)) return false;
      const text = readFileSync(path, "utf8");
      // `console.error` et `console.warn` restent permis : ils servent au
      // support. Seules les traces de mise au point sont proscrites.
      return /^\s*console\.(log|debug|trace)\(/m.test(text);
    }).map((path) => path.replace(`${ROOT}/`, ""));

    expect(noisy).toEqual([]);
  });

  it("ne laisse aucun marqueur de travail inachevé", () => {
    const pending = RUNTIME_TS.filter((path) =>
      /\bTODO\b|\bFIXME\b|\bXXX\b|\bHACK\b/.test(readFileSync(path, "utf8")),
    ).map((path) => path.replace(`${ROOT}/`, ""));

    expect(pending).toEqual([]);
  });
});

describe("gardes structurelles du moteur natif", () => {
  const RUNTIME_RS = sourceFiles("src-tauri/src", [".rs"]);

  /** Retire les blocs de test avant d'inspecter le code livré. */
  const runtimeOf = (path: string) => {
    const text = readFileSync(path, "utf8");
    const at = text.indexOf("#[cfg(test)]");
    return at === -1 ? text : text.slice(0, at);
  };

  it("ne construit jamais de commande système par concaténation", () => {
    // Toute commande externe passe des arguments séparés. Un interpréteur de
    // commandes dans la boucle rouvrirait la porte à l'injection.
    const shelling = RUNTIME_RS.filter((path) =>
      /Command::new\(\s*"(sh|bash|cmd|cmd\.exe)"/.test(runtimeOf(path)) ||
      /Invoke-Expression|\biex\b/.test(runtimeOf(path)),
    ).map((path) => path.replace(`${ROOT}/`, ""));

    expect(shelling).toEqual([]);
  });

  it("ne laisse aucune trace de débogage dans le moteur livré", () => {
    const noisy = RUNTIME_RS.filter((path) => /\bdbg!\(|\bprintln!\(/.test(runtimeOf(path)))
      .map((path) => path.replace(`${ROOT}/`, ""));

    expect(noisy).toEqual([]);
  });

  it("ne laisse aucun marqueur de travail inachevé", () => {
    const pending = RUNTIME_RS.filter((path) => /\bTODO\b|\bFIXME\b|\bXXX\b|\bHACK\b/.test(runtimeOf(path)))
      .map((path) => path.replace(`${ROOT}/`, ""));

    expect(pending).toEqual([]);
  });
});
