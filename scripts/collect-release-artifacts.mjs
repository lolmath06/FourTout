/**
 * Rassemble les paquets d'une publication, et refuse de deviner.
 *
 * Ce script existe parce que la version précédente de cette étape choisissait
 * ses fichiers avec `find … | head -1`. Tant que le dossier de construction ne
 * contient qu'une version, cela fonctionne. Dès qu'il en contient deux — une
 * construction locale répétée, un cache d'intégration continue restauré — le
 * premier résultat de `find` n'est pas défini par le système de fichiers, et un
 * paquet 0.1.0 pouvait être recopié sous le nom 1.0.0. Le fichier téléchargé
 * aurait alors menti sur son contenu, sans qu'aucune étape n'échoue.
 *
 * La règle appliquée ici est donc l'inverse d'une préférence : pour chaque
 * format, il doit exister **exactement un** paquet portant la version demandée.
 * Zéro est une erreur, deux aussi. Rien n'est départagé par la date, la taille
 * ou l'ordre de parcours — un tri qui choisit est un tri qui peut se tromper en
 * silence.
 */

import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";

/** Formats attendus par système, et le nom sous lequel ils sont publiés. */
const FORMATS = {
  Linux: [
    { label: "RPM", suffix: ".rpm", publicName: (v) => `FourTout-${v}-Fedora-x86_64.rpm` },
    { label: "DEB", suffix: ".deb", publicName: (v) => `FourTout-${v}-Linux-amd64.deb` },
    {
      label: "AppImage",
      suffix: ".appimage",
      publicName: (v) => `FourTout-${v}-Linux-x86_64.AppImage`,
    },
  ],
  Windows: [
    {
      label: "Installeur NSIS",
      suffix: "-setup.exe",
      publicName: (v) => `FourTout-${v}-Windows-x64-Setup.exe`,
    },
    { label: "MSI", suffix: ".msi", publicName: (v) => `FourTout-${v}-Windows-x64.msi` },
  ],
};

/**
 * Le nom de fichier porte-t-il **cette** version, et pas une autre ?
 *
 * La version doit y apparaître entourée de séparateurs : ni un chiffre, ni une
 * lettre, ni un point ne peuvent la prolonger. C'est ce qui distingue `1.0.0`
 * de `1.0.0.1` et de `11.0.0`, que la simple présence de la sous-chaîne
 * confondrait. Les conventions de nommage de l'empaqueteur diffèrent d'un
 * format à l'autre — `FourTout-1.0.0-1.x86_64.rpm`, `FourTout_1.0.0_amd64.deb` —
 * et changent avec ses versions : on vérifie la version, pas le gabarit complet.
 */
export function carriesVersion(fileName, version) {
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^0-9A-Za-z.])${escaped}([^0-9A-Za-z.]|$)`).test(fileName);
}

/** Tous les fichiers d'une arborescence, dans un ordre stable. */
function filesUnder(directory) {
  if (!existsSync(directory)) return [];
  const found = [];
  const walk = (path) => {
    for (const entry of readdirSync(path).sort()) {
      const full = join(path, entry);
      if (statSync(full).isDirectory()) walk(full);
      else found.push(full);
    }
  };
  walk(directory);
  return found.sort();
}

/**
 * L'unique paquet d'un format, pour une version donnée.
 *
 * Échoue en nommant ce qui a été écarté : un dossier qui ne contient que du
 * 0.1.0 alors qu'on publie 1.0.0 est un symptôme lisible, pas un mystère.
 */
function resolveOne(candidates, format, version) {
  const ofFormat = candidates.filter((path) =>
    basename(path).toLowerCase().endsWith(format.suffix),
  );
  const matching = ofFormat.filter((path) => carriesVersion(basename(path), version));

  if (matching.length === 1) return matching[0];

  if (matching.length === 0) {
    const others = ofFormat.map((path) => basename(path));
    throw new Error(
      `${format.label} : aucun paquet en version ${version}.` +
        (others.length
          ? ` Paquets de ce format présents, tous d'une autre version : ${others.join(", ")}.` +
            " Le dossier de construction contient une version périmée : reconstruisez avant de publier."
          : " Aucun paquet de ce format n'a été construit."),
    );
  }

  throw new Error(
    `${format.label} : ${matching.length} paquets portent la version ${version} ` +
      `(${matching.map((path) => basename(path)).join(", ")}). ` +
      "Il n'y a aucune raison valable d'en préférer un : la collecte s'arrête plutôt " +
      "que de trancher au hasard.",
  );
}

/**
 * Ce qui sera publié, et d'où cela vient — sans rien copier.
 *
 * Toutes les résolutions sont tentées avant de lever : une construction à
 * laquelle il manque deux formats le dit en une fois.
 */
export function planRelease({ version, os, bundleDir }) {
  const formats = FORMATS[os];
  if (!formats) {
    throw new Error(`Système inconnu : ${os}. Attendu « Linux » ou « Windows ».`);
  }

  const candidates = filesUnder(bundleDir);
  const plan = [];
  const failures = [];

  for (const format of formats) {
    try {
      plan.push({ source: resolveOne(candidates, format, version), target: format.publicName(version) });
    } catch (error) {
      failures.push(error.message);
    }
  }

  if (failures.length) throw new Error(failures.join("\n"));
  return plan;
}

/**
 * L'exécutable Windows, pour la version portable.
 *
 * Cherché à la racine du dossier de construction et nulle part ailleurs, et
 * exigé unique : son nom dépend de la version de Tauri — nom du paquet Cargo ou
 * nom de produit — et il ne porte aucun numéro de version qui permettrait de le
 * départager.
 */
export function resolveExecutable(releaseDir) {
  const found = existsSync(releaseDir)
    ? readdirSync(releaseDir)
        .sort()
        .filter((entry) => {
          const full = join(releaseDir, entry);
          return statSync(full).isFile() && entry.toLowerCase() === "fourtout.exe";
        })
        .map((entry) => join(releaseDir, entry))
    : [];

  if (found.length === 1) return found[0];
  if (found.length === 0) {
    throw new Error(`Exécutable Windows introuvable dans ${releaseDir}.`);
  }
  throw new Error(`Plusieurs exécutables Windows dans ${releaseDir} : ${found.join(", ")}.`);
}

/** Copie le plan vers `outDir`, et rend la liste des noms publics écrits. */
export function writeRelease(plan, outDir) {
  mkdirSync(outDir, { recursive: true });
  for (const { source, target } of plan) copyFileSync(source, join(outDir, target));
  return plan.map(({ target }) => target);
}

/**
 * Prépare le dossier de la version portable : l'exécutable et ses ressources.
 *
 * Rend un avertissement lorsque les listes de mots manquent — leur absence
 * appauvrit la version portable sans l'empêcher de fonctionner, et ne justifie
 * donc pas d'interrompre la publication.
 */
export function stagePortable({ releaseDir, stageDir }) {
  const executable = resolveExecutable(releaseDir);
  const root = join(stageDir, "FourTout");
  mkdirSync(root, { recursive: true });
  copyFileSync(executable, join(root, "FourTout.exe"));

  const resources = join(releaseDir, "resources");
  if (!existsSync(resources)) {
    return { root, warning: "Aucun dossier resources/ à côté de l'exécutable : la version portable est livrée sans les listes de mots." };
  }
  cpSync(resources, join(root, "resources"), { recursive: true });
  return { root, warning: null };
}

function readArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index].replace(/^--/, "");
    options[key] = argv[index + 1];
  }
  return options;
}

function fail(message) {
  const prefix = process.env.GITHUB_ACTIONS === "true" ? "::error::" : "Erreur : ";
  for (const line of message.split("\n")) process.stderr.write(`${prefix}${line}\n`);
  process.exit(1);
}

// Exécution en ligne de commande. Les fonctions ci-dessus restent importables
// telles quelles : c'est sur elles que porte la suite de tests.
if (process.argv[1] && import.meta.url.endsWith(basename(process.argv[1]))) {
  const options = readArguments(process.argv.slice(2));
  const version = options.version;
  const os = options.os;
  const bundleDir = options["bundle-dir"] ?? "src-tauri/target/release/bundle";
  const releaseDir = options["release-dir"] ?? "src-tauri/target/release";
  const outDir = options.out ?? "artefacts";
  const stageDir = options.stage ?? "portable";

  if (!version || !os) fail("Usage : --version <x.y.z> --os <Linux|Windows> [--bundle-dir …] [--out …]");

  try {
    const written = writeRelease(planRelease({ version, os, bundleDir }), outDir);
    for (const name of written) process.stdout.write(`  ${name}\n`);

    if (os === "Windows") {
      const { root, warning } = stagePortable({ releaseDir, stageDir });
      if (warning) {
        const prefix = process.env.GITHUB_ACTIONS === "true" ? "::warning::" : "Attention : ";
        process.stderr.write(`${prefix}${warning}\n`);
      }
      process.stdout.write(`  version portable préparée dans ${root}\n`);
    }
  } catch (error) {
    fail(error.message);
  }
}
