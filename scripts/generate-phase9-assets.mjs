#!/usr/bin/env node
/**
 * Fixtures de la phase 9 : dossiers, recherche, espace disque, inspection,
 * hexadécimal, sauvegarde, manifestes d'empreintes et archives.
 *
 * Mêmes contraintes que les autres générateurs : aucun téléchargement, aucune
 * dépendance, et un contenu **déterministe** — deux exécutions produisent les
 * mêmes octets, donc les mêmes empreintes. C'est ce qui permet aux tests de
 * vérifier un SHA-256 attendu plutôt qu'un « ça a l'air correct ».
 *
 * Les archives ZIP, TAR, TAR.GZ et GZ sont écrites ici, par du code Node
 * indépendant des moteurs de FourTout : une archive produite par le moteur
 * qu'on veut éprouver ne prouverait pas grand-chose. Les formats 7z, XZ et
 * TAR.XZ, eux, n'ont pas d'écrivain en Node sans dépendance : ils sont produits
 * par `src-tauri/examples/phase9_fixtures.rs` (voir `pnpm test:assets`).
 *
 * Usage : `node scripts/generate-phase9-assets.mjs`
 */
import { createHash } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync, gzipSync } from "node:zlib";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "test-assets", "generated");

const written = [];
function write(relative, data) {
  const path = join(OUT, relative);
  mkdirSync(dirname(path), { recursive: true });
  const bytes = typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.from(data);
  writeFileSync(path, bytes);
  written.push([relative, bytes.length]);
  return bytes;
}

function fresh(relative) {
  rmSync(join(OUT, relative), { recursive: true, force: true });
  mkdirSync(join(OUT, relative), { recursive: true });
}

/** Octets reproductibles : même graine, mêmes octets, sur toutes les machines. */
function deterministicBytes(length, seed = 1) {
  const bytes = Buffer.alloc(length);
  let state = (seed * 2654435761) >>> 0;
  for (let index = 0; index < length; index += 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    bytes[index] = (state >>> 16) & 0xff;
  }
  return bytes;
}

const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

/* ============================================================ 1. COMPARAISON
 *
 * Les cinq cas que la comparaison doit savoir distinguer, dont celui qui piège
 * tous les comparateurs paresseux : même taille, contenu différent.
 */
fresh("folder-compare-left");
fresh("folder-compare-right");

const SAME = "Ce fichier est identique des deux côtés.\n";
write("folder-compare-left/same.txt", SAME);
write("folder-compare-right/same.txt", SAME);

// Même longueur exacte, un caractère différent : invisible en mode rapide.
write("folder-compare-left/changed.txt", "Version de GAUCHE, meme longueur.\n");
write("folder-compare-right/changed.txt", "Version de DROITE, meme longueur.\n");

write("folder-compare-left/only-left.txt", "Présent uniquement à gauche.\n");
write("folder-compare-right/only-right.txt", "Présent uniquement à droite.\n");

const NESTED_SAME = deterministicBytes(4096, 11);
write("folder-compare-left/nested/same.bin", NESTED_SAME);
write("folder-compare-right/nested/same.bin", NESTED_SAME);

// Même taille, octets différents : deuxième piège, en binaire cette fois.
write("folder-compare-left/nested/same-size.bin", deterministicBytes(2048, 21));
write("folder-compare-right/nested/same-size.bin", deterministicBytes(2048, 22));

// Tailles différentes : conclu sans lire un octet.
write("folder-compare-left/nested/changed-size.bin", deterministicBytes(1024, 31));
write("folder-compare-right/nested/changed-size.bin", deterministicBytes(4096, 31));

// Accents et espaces des deux côtés : la clé de rapprochement doit tenir.
write("folder-compare-left/dossier accentué/fichier é à ü.txt", "Unicode.\n");
write("folder-compare-right/dossier accentué/fichier é à ü.txt", "Unicode.\n");

/* ============================================================== 2. SYNC
 *
 * Une source, et deux destinations distinctes : la mise à jour et le miroir se
 * testent séparément, sinon le premier essai détruit la fixture du second.
 */
fresh("sync-source");
for (const destination of ["sync-destination-update", "sync-destination-mirror"]) {
  fresh(destination);
}

write("sync-source/nouveau.txt", "Fichier absent de la destination.\n");
write("sync-source/modifie.txt", "Version SOURCE, plus longue que la destination.\n");
write("sync-source/identique.txt", "Ce fichier ne doit pas être recopié.\n");
write("sync-source/sous-dossier/imbriqué.txt", "Dans un sous-dossier.\n");
write("sync-source/sous-dossier/nom avec espaces.txt", "Espaces dans le nom.\n");
write("sync-source/accents éàü çñ.txt", "Nom de fichier accentué.\n");
write("sync-source/données.bin", deterministicBytes(8192, 41));

for (const destination of ["sync-destination-update", "sync-destination-mirror"]) {
  write(`${destination}/modifie.txt`, "Vieille version.\n");
  write(`${destination}/identique.txt`, "Ce fichier ne doit pas être recopié.\n");
  write(`${destination}/en-trop.txt`, "Seulement dans la destination.\n");
  write(`${destination}/dossier-en-trop/orphelin.txt`, "Sous-dossier absent de la source.\n");
}

/* ============================================================ 3. RECHERCHE */
fresh("search-tree");

write(
  "search-tree/notes.txt",
  "FourTout range les fichiers.\nDeuxième ligne, sans le mot cherché.\nEncore FourTout.\n",
);
write("search-tree/facture-2024.md", "# Facture 2024\n\nMontant : 1 240 EUR\nÉmis par FourTout.\n");
write("search-tree/invoice-2023.md", "# Invoice 2023\n\nAmount: 980 EUR\n");
write(
  "search-tree/inventaire.csv",
  "reference;designation;quantite\nA-01;Vis PROMETHEUS;120\nA-02;Écrou;340\n",
);
write(
  "search-tree/config.json",
  JSON.stringify({ application: "FourTout", phase: 9, prometheus: false }, null, 2) + "\n",
);
write("search-tree/sous-dossier/rapport accentué.txt", "Une facture détaillée, en français.\n");
write("search-tree/sous-dossier/profond/tout-en-bas.txt", "PROMETHEUS n'est pas encore là.\n");
write("search-tree/sous-dossier/gros.bin", deterministicBytes(3 * 1024 * 1024, 51));
write("search-tree/petit.bin", deterministicBytes(64, 52));

// Binaire contenant le mot cherché : il ne doit JAMAIS ressortir d'une
// recherche de contenu — c'est tout l'intérêt de la détection texte/binaire.
write(
  "search-tree/piege-binaire.bin",
  Buffer.concat([
    Buffer.from([0x00, 0x01, 0x02, 0x1b, 0x7f, 0x00]),
    Buffer.from("FourTout", "utf8"),
    Buffer.from([0x00, 0x01, 0x02, 0x1b, 0x7f, 0x00]),
  ]),
);

// Trois encodages, le même mot : la recherche doit les trouver tous les trois.
const utf16le = Buffer.alloc("FourTout en UTF-16".length * 2);
for (const [index, code] of [..."FourTout en UTF-16"].entries()) {
  utf16le.writeUInt16LE(code.charCodeAt(0), index * 2);
}
write("search-tree/encodages/utf16le.txt", utf16le);
write("search-tree/encodages/utf8-bom.txt", Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("FourTout en UTF-8 avec BOM.\n", "utf8")]));
write(
  "search-tree/encodages/windows-1252.txt",
  Buffer.from([
    ...Buffer.from("Une facture cr", "latin1"),
    0xe9, 0xe9, // ée
    ...Buffer.from("e l", "latin1"),
    0x92, // apostrophe typographique de Windows-1252
    ...Buffer.from("an dernier par FourTout.\n", "latin1"),
  ]),
);

/* ====================================================== 4. ANALYSE D'ESPACE
 *
 * Tailles rondes et connues : le total doit se vérifier à l'octet près.
 */
fresh("space-analysis");
write("space-analysis/large.bin", deterministicBytes(5 * 1024 * 1024, 61)); // 5 MiB
write("space-analysis/medium.bin", deterministicBytes(2 * 1024 * 1024, 62)); // 2 MiB
write("space-analysis/small.bin", deterministicBytes(64 * 1024, 63)); // 64 KiB
write("space-analysis/documents/rapport.txt", deterministicBytes(1024 * 1024, 64)); // 1 MiB
write("space-analysis/documents/annexe.txt", deterministicBytes(512 * 1024, 65)); // 512 KiB
write("space-analysis/images/photo.jpg", deterministicBytes(1536 * 1024, 66)); // 1,5 MiB
write("space-analysis/images/vignettes/mini.png", deterministicBytes(32 * 1024, 67)); // 32 KiB
// Total attendu : 5 + 2 + 1 + 1,5 Mio + 64 + 512 + 32 Kio = 10 460 160 octets.

/* ======================================================== 5. INSPECTION */
fresh("inspect");

// Un vrai PNG (1×1, noir) renommé en .jpg : le cas d'école de l'extension
// trompeuse. Les octets sont ceux d'un PNG minimal valide.
const PNG_1x1 = Buffer.from(
  "89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4890000000A4944415478DA6300010000050001" +
    "0D0A2DB40000000049454E44AE426082",
  "hex",
);
write("inspect/wrong-extension.jpg", PNG_1x1);
write("inspect/vraie-image.png", PNG_1x1);

// UTF-16 LE avec BOM, et fins de ligne CRLF : trois choses à détecter.
const utf16Text = "Première ligne.\r\nDeuxième ligne accentuée : é à ü.\r\n";
const utf16Buffer = Buffer.alloc(2 + utf16Text.length * 2);
utf16Buffer.writeUInt16LE(0xfeff, 0);
for (const [index, character] of [...utf16Text].entries()) {
  utf16Buffer.writeUInt16LE(character.charCodeAt(0), 2 + index * 2);
}
write("inspect/encoding-utf16le.txt", utf16Buffer);

// En-tête SQLite valide, suivi d'une page vide : reconnu par signature.
const sqlite = Buffer.alloc(1024);
sqlite.write("SQLite format 3\0", 0, "latin1");
sqlite.writeUInt16BE(512, 16); // taille de page
sqlite[18] = 1;
sqlite[19] = 1;
write("inspect/sample.sqlite", sqlite);

// En-tête PE (« MZ ») **non exécutable** : juste de quoi éprouver la
// reconnaissance de signature, sans produire quoi que ce soit d'exécutable.
const pe = Buffer.alloc(256);
pe.write("MZ", 0, "latin1");
pe.write("Ce fichier n'est pas un programme : en-tete PE de demonstration.", 8, "latin1");
write("inspect/entete-pe.exe", pe);

// PDF minimal valide, d'une page vide.
const PDF = [
  "%PDF-1.4",
  "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj",
  "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj",
  "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj",
  "trailer<</Root 1 0 R>>",
  "%%EOF",
  "",
].join("\n");
write("inspect/sample.pdf", PDF);

/* ================================================== 6. HEXADÉCIMAL */
const hexPattern = Buffer.concat([
  Buffer.from(Array.from({ length: 256 }, (_, index) => index)), // 00..FF
  Buffer.from("FourTout", "utf8"), // à l'offset 0x100
  Buffer.from([0xde, 0xad, 0xbe, 0xef]), // à l'offset 0x108
  Buffer.alloc(1000, 0x5a), // remplissage « Z »
  Buffer.from("FIN", "utf8"),
]);
write("hex-pattern.bin", hexPattern);

/* ==================================================== 7. SAUVEGARDE */
fresh("backup-source");
write("backup-source/notes.txt", "Des notes à sauvegarder.\n");
write("backup-source/vide.txt", "");
write("backup-source/binaire.bin", Buffer.from(Array.from({ length: 256 }, (_, i) => i)));
write("backup-source/sous-dossier/accentué é à ü.txt", "Contenu accentué.\n");
write("backup-source/sous-dossier/profond/tout-en-bas.md", "# Niveau trois\n");

/* ====================================================== 8. CHECKSUMS */
fresh("checksum-set");
const CHECKSUM_FILES = {
  "readme.txt": "Contenu du fichier readme.\n",
  "données.bin": deterministicBytes(2048, 71),
  "sous-dossier/rapport é à ü.txt": "Rapport accentué.\n",
  "avec espace.log": "Un nom de fichier avec des espaces.\n",
};
const digests = {};
for (const [name, content] of Object.entries(CHECKSUM_FILES)) {
  digests[name] = sha256(write(`checksum-set/${name}`, content));
}

const manifestLines = Object.entries(digests)
  .map(([name, digest]) => `${digest}  ${name}`)
  .join("\n");
write("checksums-valid.sha256", manifestLines + "\n");

// Une empreinte fausse, et une seule : la vérification doit la nommer.
write(
  "checksums-one-bad.sha256",
  Object.entries(digests)
    .map(([name, digest]) =>
      name === "readme.txt" ? `${"0".repeat(64)}  ${name}` : `${digest}  ${name}`,
    )
    .join("\n") + "\n",
);

// Une entrée qui désigne un fichier absent.
write(
  "checksums-missing.sha256",
  manifestLines + `\n${"a".repeat(64)}  disparu.txt\n`,
);

// Deux entrées hostiles : remontée de dossier et chemin absolu. Elles doivent
// être refusées et listées, jamais lues.
write(
  "checksums-traversal.sha256",
  manifestLines +
    `\n${"b".repeat(64)}  ../../etc/passwd\n${"c".repeat(64)}  /etc/shadow\n`,
);

/* ======================================================== 9. ARCHIVES */

/* --------------------------------------------------------------- ZIP */
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function buildZip(entries, { compress = true } = {}) {
  const parts = [];
  const central = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, "utf8");
    const deflated = compress ? deflateRawSync(data) : data;
    const method = compress ? 8 : 0;
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    parts.push(local, name, deflated);

    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0x0800, 8);
    header.writeUInt16LE(method, 10);
    header.writeUInt16LE(0, 12);
    header.writeUInt16LE(0x21, 14);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(deflated.length, 20);
    header.writeUInt32LE(data.length, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt32LE(offset, 42);
    central.push(header, name);

    offset += local.length + name.length + deflated.length;
  }

  const centralBuffer = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, centralBuffer, end]);
}

/* --------------------------------------------------------------- TAR */
function tarHeader(name, size) {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, "utf8");
  header.write("000644 \0", 100, 8, "ascii");
  header.write("000000 \0", 108, 8, "ascii");
  header.write("000000 \0", 116, 8, "ascii");
  header.write(size.toString(8).padStart(11, "0") + " ", 124, 12, "ascii");
  header.write("00000000000 ", 136, 12, "ascii");
  header.write("        ", 148, 8, "ascii");
  header.write("0", 156, 1, "ascii");
  header.write("ustar\0" + "00", 257, 8, "ascii");
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8, "ascii");
  return header;
}

function buildTar(entries) {
  const parts = [];
  for (const entry of entries) {
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, "utf8");
    parts.push(tarHeader(entry.name, data.length), data);
    const padding = (512 - (data.length % 512)) % 512;
    if (padding > 0) parts.push(Buffer.alloc(padding));
  }
  parts.push(Buffer.alloc(1024));
  return Buffer.concat(parts);
}

/**
 * Contenu commun à toutes les archives de la phase 9. Il porte volontairement
 * un fichier assez gros : un bit retourné au milieu d'une archive minuscule
 * tomberait dans un en-tête, et produirait « illisible » plutôt que
 * « corrompue ».
 */
const ARCHIVE_ENTRIES = [
  { name: "archive-sample/a.txt", data: "Fichier A — racine de l'archive.\n" },
  { name: "archive-sample/nested/b.txt", data: "Fichier B — dans un sous-dossier.\n" },
  { name: "archive-sample/unicode é à ü.txt", data: "Nom de fichier accentué.\n" },
  { name: "archive-sample/data.bin", data: deterministicBytes(200 * 1024, 81) },
];

// Le dossier d'origine, pour comparer octet par octet après extraction.
fresh("archive-sample");
for (const entry of ARCHIVE_ENTRIES) write(entry.name, entry.data);

const zip = write("archive-sample.zip", buildZip(ARCHIVE_ENTRIES));
const tar = write("archive-sample.tar", buildTar(ARCHIVE_ENTRIES));
write("archive-sample.tar.gz", gzipSync(tar, { level: 9, mtime: 0 }));

// `.gz` d'un fichier **seul** : ce n'est pas une archive, et la fixture existe
// précisément pour que la différence puisse être montrée.
const LONE = Buffer.from(
  "Ce fichier est compressé seul, sans arborescence.\n".repeat(500),
  "utf8",
);
write("lone-file.txt", LONE);
write("lone-file.txt.gz", gzipSync(LONE, { level: 9, mtime: 0 }));

/* ------------------------------------------------ archives abîmées */

/** Retourne des bits au milieu, là où se trouvent les données. */
function corrupt(buffer) {
  const copy = Buffer.from(buffer);
  const middle = Math.floor(copy.length / 2);
  copy[middle] ^= 0xff;
  copy[middle + 1] ^= 0x0f;
  copy[middle + 2] ^= 0xf0;
  return copy;
}

const truncate = (buffer) => Buffer.from(buffer.subarray(0, Math.floor(buffer.length * 0.6)));

write("archive-corrupt.zip", corrupt(zip));
write("archive-truncated.zip", truncate(zip));
write("archive-corrupt.tar", corrupt(tar));
write("archive-truncated.tar", truncate(tar));
const targz = gzipSync(tar, { level: 9, mtime: 0 });
write("archive-corrupt.tar.gz", corrupt(targz));
write("archive-truncated.tar.gz", truncate(targz));
write("lone-file-truncated.txt.gz", truncate(gzipSync(LONE, { level: 9, mtime: 0 })));
write("lone-file-corrupt.txt.gz", corrupt(gzipSync(LONE, { level: 9, mtime: 0 })));

/* ------------------------------------------- archives piégées (traversée) */
write(
  "archive-traversal.zip",
  buildZip([
    { name: "../../evade-zip.txt", data: "Ce fichier ne doit jamais être écrit.\n" },
    { name: "/etc/evade-absolu.txt", data: "Chemin absolu : refusé.\n" },
    { name: "sain.txt", data: "Cette entrée-là est légitime.\n" },
  ]),
);
write(
  "archive-traversal.tar",
  buildTar([
    { name: "../../evade-tar.txt", data: "Ce fichier ne doit jamais être écrit.\n" },
    { name: "/etc/evade-absolu.txt", data: "Chemin absolu : refusé.\n" },
    { name: "sain.txt", data: "Cette entrée-là est légitime.\n" },
  ]),
);

/* ------------------------------------------------- archive « bombe » */
// 128 Mio de zéros tiennent en quelques centaines d'octets une fois
// compressés : le taux déclenche l'avertissement sans produire de fixture
// volumineuse. L'archive écrite pèse moins de 200 Ko.
write(
  "archive-bombe.zip",
  buildZip([{ name: "zeros.bin", data: Buffer.alloc(128 * 1024 * 1024) }]),
);

/* ==================================================== 10. PERFORMANCE
 *
 * Cinq mille petits fichiers : de quoi mesurer la recherche, la comparaison,
 * l'analyse d'espace et le manifeste sans occuper plus de quelques mégaoctets.
 */
fresh("perf-tree");
let perfBytes = 0;
for (let index = 0; index < 5000; index += 1) {
  const folder = `lot-${String(Math.floor(index / 250)).padStart(2, "0")}`;
  const content =
    index % 100 === 0
      ? `Fichier ${index} — contient le mot FourTout.\n`
      : `Fichier ${index} — contenu ordinaire.\n`;
  const path = join(OUT, "perf-tree", folder, `fichier-${String(index).padStart(4, "0")}.txt`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  perfBytes += Buffer.byteLength(content);
}
written.push(["perf-tree/ (5 000 fichiers)", perfBytes]);

/* ------------------------------------------------------------ bilan */
const total = written.reduce((sum, [, size]) => sum + size, 0);
console.log(
  `Fixtures phase 9 : ${written.length} entrées, ${(total / (1024 * 1024)).toFixed(1)} Mo`,
);
console.log(
  "  (7z, XZ et TAR.XZ sont produits par `cargo run --example phase9_fixtures`)",
);
