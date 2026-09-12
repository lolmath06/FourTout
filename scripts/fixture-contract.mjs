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
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, loadImage } from "@napi-rs/canvas";

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


/* --------------------------------------------------- phase 10 : images et média */

/**
 * Deuxième implémentation, volontairement.
 *
 * Les valeurs de comparaison d'images ci-dessous sont recalculées ici, en dehors
 * du moteur de FourTout et sans partager une ligne de code avec lui. Un test qui
 * comparerait le moteur à lui-même ne prouverait rien ; celui-ci compare deux
 * calculs indépendants du même énoncé.
 */
async function pixelsOf(name) {
  const image = await loadImage(join(OUT, name));
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0);
  const { data } = context.getImageData(0, 0, image.width, image.height);
  return { width: image.width, height: image.height, data };
}

/** Écart de Tchebychev par pixel, sur trois canaux ou quatre. */
function diffStats(a, b, includeAlpha = false) {
  const channels = includeAlpha ? 4 : 3;
  const count = a.width * a.height;
  let different = 0;
  let maxDifference = 0;
  let squares = 0;
  let changedAt;
  for (let p = 0; p < count; p += 1) {
    const i = p * 4;
    let pixelMax = 0;
    for (let c = 0; c < channels; c += 1) {
      const delta = a.data[i + c] - b.data[i + c];
      squares += delta * delta;
      const magnitude = Math.abs(delta);
      if (magnitude > pixelMax) pixelMax = magnitude;
    }
    if (pixelMax > 0) {
      different += 1;
      changedAt ??= { x: p % a.width, y: Math.floor(p / a.width) };
    }
    if (pixelMax > maxDifference) maxDifference = pixelMax;
  }
  const mse = squares / (count * channels);
  return {
    pixels: count,
    pixelsDifferents: different,
    ecartMaximal: maxDifference,
    eqm: Number(mse.toFixed(6)),
    psnr: mse === 0 ? null : Number((10 * Math.log10((255 * 255) / mse)).toFixed(3)),
    premierPixelChange: changedAt,
  };
}

/** SSIM par blocs disjoints de 8 × 8 sur la luminance BT.601 — même énoncé que le moteur. */
function ssimOf(a, b) {
  const C1 = (0.01 * 255) ** 2;
  const C2 = (0.03 * 255) ** 2;
  const block = 8;
  const blocksX = Math.floor(a.width / block);
  const blocksY = Math.floor(a.height / block);
  const luma = (data, i) => 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  let total = 0;
  let blocks = 0;
  for (let by = 0; by < blocksY; by += 1) {
    for (let bx = 0; bx < blocksX; bx += 1) {
      const values = [];
      for (let y = 0; y < block; y += 1) {
        for (let x = 0; x < block; x += 1) {
          const i = ((by * block + y) * a.width + bx * block + x) * 4;
          values.push([luma(a.data, i), luma(b.data, i)]);
        }
      }
      const n = values.length;
      const meanA = values.reduce((sum, [va]) => sum + va, 0) / n;
      const meanB = values.reduce((sum, [, vb]) => sum + vb, 0) / n;
      const varA = values.reduce((sum, [va]) => sum + (va - meanA) ** 2, 0) / n;
      const varB = values.reduce((sum, [, vb]) => sum + (vb - meanB) ** 2, 0) / n;
      const cov = values.reduce((sum, [va, vb]) => sum + (va - meanA) * (vb - meanB), 0) / n;
      const numerator = (2 * meanA * meanB + C1) * (2 * cov + C2);
      const denominator = (meanA ** 2 + meanB ** 2 + C1) * (varA + varB + C2);
      total += denominator === 0 ? 1 : numerator / denominator;
      blocks += 1;
    }
  }
  return blocks === 0 ? 1 : Number((total / blocks).toFixed(6));
}

const reference = await pixelsOf("image-reference.png");
const identical = await pixelsOf("image-identical.png");
const onePixel = await pixelsOf("image-one-pixel.png");
const smallNoise = await pixelsOf("image-small-noise.png");
const heavyChange = await pixelsOf("image-heavy-change.png");
const alphaChange = await pixelsOf("image-alpha-change.png");
const differentSize = await pixelsOf("image-different-size.png");
const colorKnown = await pixelsOf("color-known.png");

const onePixelStats = diffStats(reference, onePixel);
const alphaStats = diffStats(reference, alphaChange, true);

/** Couleur exacte d'un pixel de `color-known.png`, en hexadécimal. */
function hexAt(pixels, x, y) {
  const i = (y * pixels.width + x) * 4;
  return `#${[0, 1, 2].map((c) => pixels.data[i + c].toString(16).padStart(2, "0")).join("")}`;
}

/** Rapport de contraste WCAG entre deux couleurs `#rrggbb`. */
function contrast(hexA, hexB) {
  const luminance = (hex) => {
    const parts = [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255);
    const [r, g, b] = parts.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const la = luminance(hexA);
  const lb = luminance(hexB);
  return Number(((Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)).toFixed(4));
}

/** Compte les blocs d'un fichier de sous-titres, sans rien interpréter de plus. */
function subtitleBlocks(name) {
  const text = readFileSync(join(OUT, name), "utf8").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  return text.split(/\n{2,}/).filter((block) => block.includes("-->")).length;
}

const ffprobe = (() => {
  try {
    return execFileSync("sh", ["-c", "command -v ffprobe"]).toString().trim() || null;
  } catch {
    return null;
  }
})();

/** Ce que ffprobe dit du premier flux d'un type donné — valeurs stables seulement. */
function probeStream(name, selector) {
  if (!ffprobe || !existsSync(join(OUT, name))) return null;
  const result = spawnSync(
    ffprobe,
    ["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", "-select_streams", selector, join(OUT, name)],
    { encoding: "utf8" },
  );
  if (result.status !== 0) return null;
  try {
    const data = JSON.parse(result.stdout);
    const stream = data.streams?.[0];
    if (!stream) return null;
    return { stream, format: data.format ?? {} };
  } catch {
    return null;
  }
}

function audioFixture(name) {
  const probed = probeStream(name, "a:0");
  if (!probed) return null;
  return {
    canaux: probed.stream.channels ?? null,
    dispositionCanaux: probed.stream.channel_layout ?? null,
    frequenceHz: Number(probed.stream.sample_rate ?? 0),
    dureeSecondes: Number(Number(probed.format.duration ?? 0).toFixed(2)),
  };
}

function videoFixture(name) {
  const probed = probeStream(name, "v:0");
  if (!probed) return null;
  return {
    cadenceReelle: probed.stream.r_frame_rate ?? null,
    cadenceMoyenne: probed.stream.avg_frame_rate ?? null,
    largeur: probed.stream.width ?? null,
    hauteur: probed.stream.height ?? null,
    images: probed.stream.nb_frames ? Number(probed.stream.nb_frames) : null,
    dureeSecondes: Number(Number(probed.format.duration ?? 0).toFixed(2)),
  };
}

function audioTags(name) {
  const probed = probeStream(name, "a:0");
  if (!probed) return null;
  const tags = probed.format.tags ?? {};
  const wanted = ["title", "artist", "album", "date", "genre", "track"];
  return Object.fromEntries(wanted.filter((key) => tags[key]).map((key) => [key, String(tags[key])]));
}

/** Géométrie attendue de la planche-contact de recette (5 images, 2 colonnes). */
const CONTACT_SETTINGS = { colonnes: 2, largeurVignette: 120, espacement: 12, marge: 24, hauteurLegende: 22 };
const contactRows = Math.ceil(5 / CONTACT_SETTINGS.colonnes);

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

  comparaisonImages: {
    largeur: reference.width,
    hauteur: reference.height,
    pixels: reference.width * reference.height,
    tailleDifferente: { largeur: differentSize.width, hauteur: differentSize.height },
    identique: diffStats(reference, identical),
    unPixel: {
      ...onePixelStats.premierPixelChange,
      ecart: onePixelStats.ecartMaximal,
      pixelsDifferents: onePixelStats.pixelsDifferents,
      psnr: onePixelStats.psnr,
      ssim: ssimOf(reference, onePixel),
    },
    alpha: {
      pixels: alphaStats.pixelsDifferents,
      ecart: alphaStats.ecartMaximal,
      pixelsSansAlpha: diffStats(reference, alphaChange, false).pixelsDifferents,
    },
    petitBruit: { ...diffStats(reference, smallNoise), ssim: ssimOf(reference, smallNoise) },
    grosseModification: { ...diffStats(reference, heavyChange), ssim: ssimOf(reference, heavyChange) },
  },

  plancheContact: {
    images: 5,
    reglages: CONTACT_SETTINGS,
    lignes: contactRows,
    // marges + colonnes × vignette + espacements intérieurs
    largeur:
      CONTACT_SETTINGS.marge * 2 +
      CONTACT_SETTINGS.colonnes * CONTACT_SETTINGS.largeurVignette +
      (CONTACT_SETTINGS.colonnes - 1) * CONTACT_SETTINGS.espacement,
    hauteurAvecLegendes:
      CONTACT_SETTINGS.marge * 2 +
      contactRows * (CONTACT_SETTINGS.largeurVignette + CONTACT_SETTINGS.hauteurLegende) +
      (contactRows - 1) * CONTACT_SETTINGS.espacement,
    hauteurSansLegendes:
      CONTACT_SETTINGS.marge * 2 +
      contactRows * CONTACT_SETTINGS.largeurVignette +
      (contactRows - 1) * CONTACT_SETTINGS.espacement,
  },

  couleurs: {
    imageTaille: { largeur: colorKnown.width, hauteur: colorKnown.height },
    quadrants: [
      { x: 5, y: 5, hex: hexAt(colorKnown, 5, 5) },
      { x: 25, y: 5, hex: hexAt(colorKnown, 25, 5) },
      { x: 5, y: 25, hex: hexAt(colorKnown, 5, 25) },
      { x: 25, y: 25, hex: hexAt(colorKnown, 25, 25) },
    ],
    contrastes: {
      noirSurBlanc: contrast("#000000", "#ffffff"),
      identique: contrast("#777777", "#777777"),
      rougeSurBlanc: contrast("#ff0000", "#ffffff"),
    },
  },

  sousTitres: {
    "subtitle-sample.srt": { repliques: subtitleBlocks("subtitle-sample.srt") },
    "subtitle-sample.vtt": { repliques: subtitleBlocks("subtitle-sample.vtt") },
    "subtitle-offset.srt": { repliques: subtitleBlocks("subtitle-offset.srt"), decalageMs: 2500 },
    "subtitle-overlap.srt": { repliques: subtitleBlocks("subtitle-overlap.srt"), chevauchements: 2 },
    "subtitle-broken.srt": { blocs: subtitleBlocks("subtitle-broken.srt") },
    "subtitle-second.srt": { repliques: subtitleBlocks("subtitle-second.srt") },
  },

  mediaPhase10: {
    "audio-mono.wav": audioFixture("audio-mono.wav"),
    "audio-stereo-distinct.wav": audioFixture("audio-stereo-distinct.wav"),
    "audio-multichannel.wav": audioFixture("audio-multichannel.wav"),
    "audio-tagged.mp3": { ...audioFixture("audio-tagged.mp3"), etiquettes: audioTags("audio-tagged.mp3") },
    "video-24fps.mp4": videoFixture("video-24fps.mp4"),
    "video-30fps.mp4": videoFixture("video-30fps.mp4"),
    "video-vfr.mp4": videoFixture("video-vfr.mp4"),
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
