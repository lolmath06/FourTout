#!/usr/bin/env node
/**
 * Fixtures de la phase 12 : fichiers sains, puis abîmés **programmatiquement**.
 *
 * Aucune de ces corruptions n'est un binaire opaque déposé à la main : chacune
 * est une transformation décrite ici, appliquée à un fichier sain écrit juste
 * au-dessus. On peut donc dire exactement ce qui manque dans chaque fichier, ce
 * qui est la condition pour que le diagnostic attendu ne soit pas une devinette.
 *
 * Les écrivains employés sont **indépendants de FourTout** : le ZIP est
 * assemblé octet par octet avec `zlib`, les PDF sont écrits à la main, les
 * images passent par `@napi-rs/canvas`. Une fixture produite par le moteur
 * qu'elle doit éprouver ne prouverait rien.
 *
 * Usage : `node scripts/generate-phase12-assets.mjs`
 */
import { deflateRawSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas } from "@napi-rs/canvas";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "test-assets", "generated");
mkdirSync(OUT, { recursive: true });

const write = (name, bytes) => {
  writeFileSync(join(OUT, name), bytes);
  return name;
};

/* ------------------------------------------------------------------- ZIP */

/** Table CRC-32, calculée une fois. */
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff];
  return (crc ^ -1) >>> 0;
}

/**
 * Assemble une archive ZIP à la main.
 *
 * `store: true` écrit l'entrée sans compression : c'est ce qui permet de
 * l'abîmer ensuite d'une façon parfaitement prévisible — un octet retourné dans
 * des données stockées produit une somme de contrôle fausse, là où le même
 * geste dans un flux compressé produit tantôt une erreur de décompression,
 * tantôt autre chose.
 */
function buildZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const raw = Buffer.from(entry.content, "utf8");
    const data = entry.store ? raw : deflateRawSync(raw, { level: 9 });
    const method = entry.store ? 0 : 8;
    const crc = crc32(raw);

    const header = Buffer.alloc(30);
    header.write("PK\x03\x04", 0, "latin1");
    header.writeUInt16LE(20, 4); // version nécessaire
    header.writeUInt16LE(0, 6); // drapeaux
    header.writeUInt16LE(method, 8);
    header.writeUInt16LE(0, 10); // heure
    header.writeUInt16LE(0x21, 12); // date : 1 janvier 1980, fixe
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(raw.length, 22);
    header.writeUInt16LE(name.length, 26);
    header.writeUInt16LE(0, 28);

    const central = Buffer.alloc(46);
    central.write("PK\x01\x02", 0, "latin1");
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);

    locals.push(header, name, data);
    centrals.push(Buffer.concat([central, name]));
    offset += header.length + name.length + data.length;
  }

  const localPart = Buffer.concat(locals);
  const centralPart = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.write("PK\x05\x06", 0, "latin1");
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralPart.length, 12);
  eocd.writeUInt32LE(localPart.length, 16);

  return {
    bytes: Buffer.concat([localPart, centralPart, eocd]),
    centralOffset: localPart.length,
    centralLength: centralPart.length,
  };
}

const ZIP_ENTRIES = [
  { name: "alpha.txt", content: "Première entrée, en clair.\n" },
  { name: "nested/bravo.txt", content: "Deuxième entrée, dans un sous-dossier.\n" },
  { name: "unicode/été.txt", content: "Troisième entrée : accents, été, çà et là.\n" },
  // Stockée sans compression, pour que sa corruption soit parfaitement prévisible.
  { name: "binary.bin", content: "0123456789".repeat(24), store: true },
];

const healthyZip = buildZip(ZIP_ENTRIES);
const files = [write("zip-healthy.zip", healthyZip.bytes)];

// 1. Répertoire central absent : le fichier est coupé juste avant lui. Les
//    en-têtes locaux et toutes les données restent intacts.
files.push(
  write("zip-central-directory-missing.zip", healthyZip.bytes.subarray(0, healthyZip.centralOffset)),
);

// 2. Répertoire central abîmé : la signature de sa deuxième entrée est
//    remplacée. La fin d'archive reste présente et annonce toujours quatre
//    entrées.
{
  const broken = Buffer.from(healthyZip.bytes);
  const secondCentral = healthyZip.centralOffset + 46 + Buffer.byteLength("alpha.txt", "utf8");
  broken.write("XXXX", secondCentral, "latin1");
  files.push(write("zip-central-directory-corrupt.zip", broken));
}

// 3. Une entrée abîmée : un octet retourné au milieu des données *stockées* de
//    `binary.bin`. Somme de contrôle fausse, garantie, et les trois autres
//    entrées restent parfaitement lisibles.
{
  const broken = Buffer.from(healthyZip.bytes);
  const before = ZIP_ENTRIES.slice(0, 3).reduce(
    (total, entry) =>
      total +
      30 +
      Buffer.byteLength(entry.name, "utf8") +
      deflateRawSync(Buffer.from(entry.content, "utf8"), { level: 9 }).length,
    0,
  );
  const dataStart = before + 30 + Buffer.byteLength("binary.bin", "utf8");
  broken[dataStart + 10] ^= 0xff;
  files.push(write("zip-one-entry-corrupt.zip", broken));
}

// 4. Archive tronquée : coupée au milieu des données de la dernière entrée.
files.push(write("zip-truncated.zip", healthyZip.bytes.subarray(0, healthyZip.centralOffset - 40)));

// 5. Données parasites après la fin : archive saine, puis des octets en trop.
files.push(
  write(
    "zip-trailing-garbage.zip",
    Buffer.concat([healthyZip.bytes, Buffer.from("OCTETS AJOUTES PAR ERREUR", "utf8")]),
  ),
);

/* ------------------------------------------------------------------- PDF */

/** Écrit un PDF minimal mais réel, de deux pages, avec sa table de références. */
function buildPdf() {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 5 0 R >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>",
    null, // flux de contenu, écrit à part
  ];
  const stream = "BT /F1 12 Tf 20 100 Td (FourTout) Tj ET";

  let pdf = Buffer.from("%PDF-1.4\n", "latin1");
  const offsets = [];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    const text =
      body === null
        ? `${index + 1} 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`
        : `${index + 1} 0 obj\n${body}\nendobj\n`;
    pdf = Buffer.concat([pdf, Buffer.from(text, "latin1")]);
  });

  const xrefOffset = pdf.length;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) xref += `${String(offset).padStart(10, "0")} 00000 n \n`;
  xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return { bytes: Buffer.concat([pdf, Buffer.from(xref, "latin1")]), xrefOffset, bodyEnd: xrefOffset };
}

const healthyPdf = buildPdf();
files.push(write("pdf-healthy.pdf", healthyPdf.bytes));

// 1. `startxref` faux : la valeur est remplacée par un décalage qui ne pointe
//    sur rien. La table, elle, est toujours là — la correction est prouvable.
{
  const text = healthyPdf.bytes.toString("latin1");
  const wrong = text.replace(
    `startxref\n${healthyPdf.xrefOffset}\n`,
    `startxref\n${healthyPdf.xrefOffset + 4096}\n`,
  );
  files.push(write("pdf-wrong-startxref.pdf", Buffer.from(wrong, "latin1")));
}

// 2. Données parasites après `%%EOF`.
files.push(
  write(
    "pdf-trailing-garbage.pdf",
    Buffer.concat([healthyPdf.bytes, Buffer.from("<html>page d'erreur d'un serveur</html>", "latin1")]),
  ),
);

// 3. `%%EOF` absent : le document est coupé juste avant.
{
  const text = healthyPdf.bytes.toString("latin1");
  files.push(write("pdf-missing-eof.pdf", Buffer.from(text.replace("%%EOF\n", ""), "latin1")));
}

// 4. Table de références entièrement absente, objets intacts : c'est le cas que
//    la reconstruction sait traiter.
files.push(write("pdf-broken-xref-recoverable.pdf", healthyPdf.bytes.subarray(0, healthyPdf.bodyEnd)));

// 5. Document tronqué en plein milieu d'un objet : la coupure tombe dans le
//    dictionnaire de la première page, si bien que les deux derniers objets —
//    dont le flux de contenu — n'existent tout simplement plus. Rien de fiable
//    ne peut en être reconstruit.
{
  const text = healthyPdf.bytes.toString("latin1");
  const cut = text.indexOf("3 0 obj") + 30;
  files.push(write("pdf-truncated-stream.pdf", healthyPdf.bytes.subarray(0, cut)));
}

/* ---------------------------------------------------------------- images */

function drawing(width, height) {
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  // Motif déterministe : deux aplats et une diagonale.
  context.fillStyle = "#1d4ed8";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#f59e0b";
  context.fillRect(0, 0, width / 2, height / 2);
  context.strokeStyle = "#ffffff";
  context.lineWidth = 4;
  context.beginPath();
  context.moveTo(0, 0);
  context.lineTo(width, height);
  context.stroke();
  return canvas;
}

const canvas = drawing(64, 48);
const healthyPng = canvas.toBuffer("image/png");
const healthyJpeg = canvas.toBuffer("image/jpeg", { quality: 0.9 });

files.push(write("image-healthy.png", healthyPng));
files.push(write("image-healthy.jpg", healthyJpeg));

// 1. Extension mensongère : contenu PNG, nom en .jpg.
files.push(write("image-wrong-extension.jpg", healthyPng));

// 2. Données parasites après IEND / EOI.
files.push(
  write("image-png-trailing-garbage.png", Buffer.concat([healthyPng, Buffer.from("PARASITE")])),
);
files.push(
  write("image-jpeg-trailing-garbage.jpg", Buffer.concat([healthyJpeg, Buffer.from("PARASITE")])),
);

// 3. Somme de contrôle fausse sur un bloc auxiliaire : on insère un bloc `tEXt`
//    dont le CRC est délibérément faux. Les pixels ne sont pas touchés.
{
  const payload = Buffer.from("Comment\0fixture", "latin1");
  const chunk = Buffer.alloc(12 + payload.length);
  chunk.writeUInt32BE(payload.length, 0);
  chunk.write("tEXt", 4, "latin1");
  payload.copy(chunk, 8);
  chunk.writeUInt32BE(0xdeadbeef, 8 + payload.length); // CRC volontairement faux
  // Après la signature (8 octets) et le bloc IHDR (25 octets).
  const at = 8 + 25;
  files.push(
    write(
      "image-png-bad-crc.png",
      Buffer.concat([healthyPng.subarray(0, at), chunk, healthyPng.subarray(at)]),
    ),
  );
}

// 4. Images tronquées : coupées au milieu des données.
files.push(write("image-png-truncated.png", healthyPng.subarray(0, Math.floor(healthyPng.length * 0.6))));
files.push(
  write("image-jpeg-truncated.jpg", healthyJpeg.subarray(0, Math.floor(healthyJpeg.length * 0.6))),
);

// 5. JPEG sans son marqueur de fin : les données d'image sont complètes, seuls
//    les deux derniers octets manquent.
files.push(write("image-jpeg-missing-eoi.jpg", healthyJpeg.subarray(0, healthyJpeg.length - 2)));

console.log(`Fixtures phase 12 écrites : ${files.length} fichiers.`);
