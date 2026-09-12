#!/usr/bin/env node
/**
 * Contrat des fixtures de la phase 9.
 *
 * Ce script ne décide de rien : il **observe** ce qui est réellement sur le
 * disque après génération, et écrit ce constat dans
 * `test-assets/generated/CONTRAT.json`, doublé d'un résumé lisible.
 *
 * Il existe parce qu'un rapport de recette manuelle avait dérivé des fixtures :
 * il annonçait quatre fichiers `.txt` là où il y en avait six. Désormais, les
 * valeurs attendues ne se recopient plus — elles se lisent ici, et
 * `src-tauri/tests/phase9.rs` vérifie que les moteurs sont d'accord avec elles.
 *
 * Usage : `pnpm fixtures:contract` (inclus dans `pnpm test:assets`)
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "test-assets", "generated");

/** Chemins relatifs de tous les fichiers d'une arborescence, triés, en `/`. */
function walk(root) {
  const found = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) found.push(relative(root, full).split(/[\\/]/).join("/"));
    }
  };
  visit(root);
  return found.sort();
}

function directoriesOf(root) {
  const found = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const full = join(directory, entry.name);
      found.push(relative(root, full).split(/[\\/]/).join("/"));
      visit(full);
    }
  };
  visit(root);
  return found.sort();
}

const bytesOf = (root, relative) => readFileSync(join(root, relative));
const sizeOf = (root, relative) => statSync(join(root, relative)).size;
const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

/**
 * Décode un fichier comme le ferait le moteur de recherche : marque d'ordre
 * des octets d'abord, motif UTF-16 ensuite, UTF-8 sinon, et repli sur un
 * encodage à un octet.
 */
function decode(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return bytes.subarray(3).toString("utf8");
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return bytes.subarray(2).toString("utf16le");
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    const swapped = Buffer.from(bytes.subarray(2));
    swapped.swap16();
    return swapped.toString("utf16le");
  }
  // UTF-16 sans marque : un octet sur deux est nul, toujours du même côté.
  const limit = Math.min(bytes.length, 4096);
  let even = 0;
  let odd = 0;
  for (let index = 0; index < limit; index += 1) {
    if (bytes[index] === 0) (index % 2 === 0 ? (even += 1) : (odd += 1));
  }
  if (limit >= 4 && (even + odd) / limit > 0.2) {
    if (odd > even * 4) return bytes.toString("utf16le");
    if (even > odd * 4) {
      const swapped = Buffer.from(bytes);
      swapped.swap16();
      return swapped.toString("utf16le");
    }
    return ""; // octets nuls dispersés : ce n'est pas du texte
  }
  // Proportion d'octets de contrôle : au-delà, ce n'est pas du texte.
  let control = 0;
  for (let index = 0; index < limit; index += 1) {
    const byte = bytes[index];
    const printable = byte >= 0x20 || byte === 9 || byte === 10 || byte === 13 || byte === 12;
    if (!printable || byte === 0x7f) control += 1;
  }
  if (limit > 0 && control / limit > 0.05) return "";
  const utf8 = bytes.toString("utf8");
  return utf8.includes("�") ? bytes.toString("latin1") : utf8;
}

const contains = (root, relative, needle) =>
  decode(bytesOf(root, relative)).toLowerCase().includes(needle.toLowerCase());

/* ------------------------------------------------------------- collecte */

const searchRoot = join(OUT, "search-tree");
const searchFiles = walk(searchRoot);

const compareLeft = join(OUT, "folder-compare-left");
const compareRight = join(OUT, "folder-compare-right");
const leftFiles = walk(compareLeft);
const rightFiles = walk(compareRight);
const inBoth = leftFiles.filter((entry) => rightFiles.includes(entry));

const syncSource = join(OUT, "sync-source");
const syncUpdate = join(OUT, "sync-destination-update");
const syncMirror = join(OUT, "sync-destination-mirror");
const sourceFiles = walk(syncSource);
const updateFiles = walk(syncUpdate);

const spaceRoot = join(OUT, "space-analysis");
const spaceFiles = walk(spaceRoot);

const backupRoot = join(OUT, "backup-source");
const checksumRoot = join(OUT, "checksum-set");
const archiveRoot = join(OUT, "archive-sample");

const contract = {
  genereLe: new Date().toISOString().slice(0, 10),
  avertissement:
    "Fichier dérivé du disque, pas écrit à la main. Toute valeur attendue d'un test ou d'une recette doit venir d'ici.",

  rechercheArborescence: {
    fichiers: searchFiles.length,
    fichiersTxt: searchFiles.filter((entry) => entry.endsWith(".txt")).length,
    listeTxt: searchFiles.filter((entry) => entry.endsWith(".txt")),
    contenantFourTout: searchFiles.filter((entry) => contains(searchRoot, entry, "FourTout")),
    contenantFourToutSensibleCasse: searchFiles.filter((entry) =>
      decode(bytesOf(searchRoot, entry)).includes("FourTout"),
    ),
    // Ce binaire contient le mot, et ne doit jamais ressortir d'une recherche
    // de contenu : c'est le piège que la fixture existe pour tendre.
    piegeBinaire: "piege-binaire.bin",
    fichiersAuMoins1Mio: searchFiles.filter((entry) => sizeOf(searchRoot, entry) >= 1024 * 1024),
    extensions: [...new Set(searchFiles.map((entry) => entry.split(".").pop()))].sort(),
  },

  comparaisonDossiers: {
    fichiersGauche: leftFiles.length,
    fichiersDroite: rightFiles.length,
    gaucheUniquement: leftFiles.filter((entry) => !rightFiles.includes(entry)),
    droiteUniquement: rightFiles.filter((entry) => !leftFiles.includes(entry)),
    identiques: inBoth.filter(
      (entry) => sha256(bytesOf(compareLeft, entry)) === sha256(bytesOf(compareRight, entry)),
    ),
    differents: inBoth.filter(
      (entry) => sha256(bytesOf(compareLeft, entry)) !== sha256(bytesOf(compareRight, entry)),
    ),
    // Ceux que le mode rapide ne peut pas voir : même taille, contenu différent.
    differentsMemeTaille: inBoth.filter(
      (entry) =>
        sizeOf(compareLeft, entry) === sizeOf(compareRight, entry) &&
        sha256(bytesOf(compareLeft, entry)) !== sha256(bytesOf(compareRight, entry)),
    ),
    octetsRelusEnModeFiable: inBoth
      .filter((entry) => sizeOf(compareLeft, entry) === sizeOf(compareRight, entry))
      .reduce((sum, entry) => sum + sizeOf(compareLeft, entry) * 2, 0),
  },

  synchronisation: {
    fichiersSource: sourceFiles.length,
    dossiersSource: directoriesOf(syncSource),
    aCopier: sourceFiles.filter((entry) => !updateFiles.includes(entry)),
    aRemplacer: sourceFiles.filter(
      (entry) =>
        updateFiles.includes(entry) &&
        sha256(bytesOf(syncSource, entry)) !== sha256(bytesOf(syncUpdate, entry)),
    ),
    inchanges: sourceFiles.filter(
      (entry) =>
        updateFiles.includes(entry) &&
        sha256(bytesOf(syncSource, entry)) === sha256(bytesOf(syncUpdate, entry)),
    ),
    dossiersACreer: directoriesOf(syncSource).filter(
      (entry) => !directoriesOf(syncUpdate).includes(entry),
    ),
    octetsAEcrire: sourceFiles
      .filter(
        (entry) =>
          !updateFiles.includes(entry) ||
          sha256(bytesOf(syncSource, entry)) !== sha256(bytesOf(syncUpdate, entry)),
      )
      .reduce((sum, entry) => sum + sizeOf(syncSource, entry), 0),
    aSupprimerEnMiroir: [
      ...walk(syncMirror).filter((entry) => !sourceFiles.includes(entry)),
      ...directoriesOf(syncMirror).filter(
        (entry) => !directoriesOf(syncSource).includes(entry),
      ),
    ].sort(),
  },

  analyseEspace: {
    fichiers: spaceFiles.length,
    dossiers: directoriesOf(spaceRoot).length,
    octetsTotal: spaceFiles.reduce((sum, entry) => sum + sizeOf(spaceRoot, entry), 0),
    plusGrosFichier: spaceFiles
      .map((entry) => ({ entry, size: sizeOf(spaceRoot, entry) }))
      .sort((a, b) => b.size - a.size)[0],
  },

  sauvegarde: {
    fichiers: walk(backupRoot).length,
    dossiers: directoriesOf(backupRoot).length,
    octets: walk(backupRoot).reduce((sum, entry) => sum + sizeOf(backupRoot, entry), 0),
  },

  checksums: {
    fichiers: walk(checksumRoot).length,
    liste: walk(checksumRoot),
  },

  archive: {
    fichiers: walk(archiveRoot).length,
    entrees: walk(archiveRoot).map((entry) => `archive-sample/${entry}`),
  },

  inspection: {
    // Chaque fixture, et ce que la reconnaissance par signature doit en dire.
    attendus: {
      "inspect/wrong-extension.jpg": { typeReel: "png", extensionCoherente: false },
      "inspect/wrong-extension.png": { typeReel: "jpg", extensionCoherente: false },
      "inspect/vraie-image.png": { typeReel: "png", extensionCoherente: true },
      "inspect/vraie-photo.jpg": { typeReel: "jpg", extensionCoherente: true },
      "inspect/encoding-utf16le.txt": { typeReel: "utf16le", extensionCoherente: true },
      "inspect/encoding-utf16be.txt": { typeReel: "utf16be", extensionCoherente: true },
      "inspect/encoding-utf8-bom.txt": { typeReel: "utf8bom", extensionCoherente: true },
      "inspect/sample.mp3": { typeReel: "mp3", extensionCoherente: true },
      "inspect/faux-mp3.bin": { typeReel: "inconnu", extensionCoherente: true },
      "inspect/sample.sqlite": { typeReel: "sqlite", extensionCoherente: true },
      "inspect/sample.pdf": { typeReel: "pdf", extensionCoherente: true },
      "inspect/entete-pe.exe": { typeReel: "exe", extensionCoherente: true },
    },
  },
};

writeFileSync(join(OUT, "CONTRAT.json"), JSON.stringify(contract, null, 2) + "\n");

/* ------------------------------------------------------------- résumé */

const c = contract;
const lines = [
  "Contrat des fixtures phase 9 — valeurs dérivées du disque",
  "",
  `  search-tree            : ${c.rechercheArborescence.fichiers} fichiers, dont ${c.rechercheArborescence.fichiersTxt} en .txt`,
  `    contenant « FourTout »: ${c.rechercheArborescence.contenantFourTout.length} → ${c.rechercheArborescence.contenantFourTout.join(", ")}`,
  `    ≥ 1 Mio              : ${c.rechercheArborescence.fichiersAuMoins1Mio.join(", ") || "aucun"}`,
  "",
  `  folder-compare         : ${c.comparaisonDossiers.identiques.length} identiques, ${c.comparaisonDossiers.differents.length} différents,`,
  `                           ${c.comparaisonDossiers.gaucheUniquement.length} à gauche seulement, ${c.comparaisonDossiers.droiteUniquement.length} à droite seulement`,
  `    invisibles en rapide : ${c.comparaisonDossiers.differentsMemeTaille.join(", ")}`,
  `    octets relus (fiable): ${c.comparaisonDossiers.octetsRelusEnModeFiable}`,
  "",
  `  sync (mise à jour)     : ${c.synchronisation.aCopier.length} à copier, ${c.synchronisation.aRemplacer.length} à remplacer,`,
  `                           ${c.synchronisation.inchanges.length} inchangé(s), ${c.synchronisation.dossiersACreer.length} dossier(s) à créer`,
  `                           → ${c.synchronisation.aCopier.length + c.synchronisation.aRemplacer.length + c.synchronisation.dossiersACreer.length} opérations, ${c.synchronisation.octetsAEcrire} octets`,
  `  sync (miroir)          : ${c.synchronisation.aSupprimerEnMiroir.length} suppression(s)`,
  "",
  `  space-analysis         : ${c.analyseEspace.fichiers} fichiers, ${c.analyseEspace.dossiers} dossiers, ${c.analyseEspace.octetsTotal} octets`,
  `  backup-source          : ${c.sauvegarde.fichiers} fichiers, ${c.sauvegarde.dossiers} dossiers`,
  `  checksum-set           : ${c.checksums.fichiers} fichiers`,
  `  archive-sample         : ${c.archive.fichiers} entrées`,
  "",
  `  Écrit dans test-assets/generated/CONTRAT.json`,
];
console.log(lines.join("\n"));
