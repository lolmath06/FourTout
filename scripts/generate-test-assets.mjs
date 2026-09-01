#!/usr/bin/env node
/**
 * Génère les fixtures de `test-assets/generated/`.
 *
 * Contraintes volontaires :
 *  - aucun téléchargement : tous les octets sont produits ici ;
 *  - aucune dépendance supplémentaire : uniquement la bibliothèque standard ;
 *  - fichiers minuscules, et ignorés par Git, pour ne pas alourdir le dépôt.
 *
 * Usage : `pnpm test:assets`
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "test-assets", "generated");

mkdirSync(OUT, { recursive: true });

const written = [];
function write(name, data) {
  const path = join(OUT, name);
  writeFileSync(path, data);
  written.push([name, data.length]);
}

/* ------------------------------------------------------------------ texte */

write(
  "sample.txt",
  `FourTout — fichier de test
Deuxième ligne avec des accents : éàçùô.
Ligne dupliquée
Ligne dupliquée

Dernier paragraphe. Deux phrases ici ! Et une question ?
Contact : test@example.com — https://example.com/page?x=1
Nombres : 42, 3.14, -7
`,
);

write(
  "sample.json",
  JSON.stringify(
    {
      name: "FourTout",
      version: "0.1.0",
      local: true,
      categories: ["pdf", "images", "audio", "video"],
      nested: { accents: "éàç", nombre: 42, vide: null },
    },
    null,
    2,
  ) + "\n",
);

write(
  "sample.csv",
  `id,nom,categorie,taille_ko
1,rapport.pdf,pdf,128
2,photo.jpg,image,64
3,memo.txt,texte,1
4,"nom, avec virgule",divers,3
`,
);

/* ------------------------------------------------------------------- PNG */

/** CRC-32, requis par le format PNG. */
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

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** Petit PNG RVB avec un dégradé, écrit octet par octet. */
function makePng(width, height) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // profondeur
  ihdr[9] = 2; // couleur : RVB
  const raw = [];
  for (let y = 0; y < height; y += 1) {
    raw.push(0); // filtre « none »
    for (let x = 0; x < width; x += 1) {
      raw.push((x * 255) / (width - 1), (y * 255) / (height - 1), 128);
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(Buffer.from(raw))),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

write("sample.png", makePng(32, 32));

/* ------------------------------------------------------------------- JPEG */

/**
 * JPEG 8×8 gris uniforme, encodé à la main : un seul bloc, tables de
 * quantification et de Huffman minimales, coefficient DC nul.
 */
function makeJpeg() {
  const segment = (marker, payload) =>
    Buffer.concat([
      Buffer.from([0xff, marker]),
      (() => {
        const length = Buffer.alloc(2);
        length.writeUInt16BE(payload.length + 2);
        return length;
      })(),
      payload,
    ]);

  const quantization = segment(
    0xdb,
    Buffer.concat([Buffer.from([0x00]), Buffer.alloc(64, 16)]),
  );

  const frame = segment(
    0xc0,
    Buffer.from([0x08, 0x00, 0x08, 0x00, 0x08, 0x01, 0x01, 0x11, 0x00]),
  );

  // Table DC : un seul symbole (catégorie 0) codé sur 2 bits.
  const dcCounts = Buffer.alloc(16);
  dcCounts[1] = 1;
  const dcTable = segment(
    0xc4,
    Buffer.concat([Buffer.from([0x00]), dcCounts, Buffer.from([0x00])]),
  );

  // Table AC : un seul symbole (EOB) codé sur 2 bits.
  const acCounts = Buffer.alloc(16);
  acCounts[1] = 1;
  const acTable = segment(
    0xc4,
    Buffer.concat([Buffer.from([0x10]), acCounts, Buffer.from([0x00])]),
  );

  const scan = segment(0xda, Buffer.from([0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]));

  // DC = 0 (bits « 0 »), EOB (bits « 0 »), puis bourrage à 1.
  const entropy = Buffer.from([0b00111111]);

  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    segment(0xe0, Buffer.concat([Buffer.from("JFIF\0", "ascii"), Buffer.from([0x01, 0x02, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00])])),
    quantization,
    frame,
    dcTable,
    acTable,
    scan,
    entropy,
    Buffer.from([0xff, 0xd9]),
  ]);
}

write("sample.jpg", makeJpeg());

/* -------------------------------------------------------------------- PDF */

/** PDF 1.4 minimal, une page A5 avec du texte, table xref calculée. */
function makePdf() {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 420 595] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    null, // flux de contenu, construit plus bas
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];

  const stream =
    "BT /F1 18 Tf 60 500 Td (FourTout - fichier de test) Tj " +
    "0 -28 Td /F1 11 Tf (Page 1 - genere sans dependance externe.) Tj ET";
  objects[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;

  let pdf = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, "latin1");
}

write("sample.pdf", makePdf());

/* --------------------------------------------------------------- corrompu */

// Fichier délibérément invalide : utile pour tester la gestion d'erreur.
write("corrupted.pdf", Buffer.from("%PDF-1.4\nceci n'est pas un PDF valide\n", "latin1"));

console.log(`Fixtures générées dans test-assets/generated/ :`);
for (const [name, size] of written) {
  console.log(`  ${name.padEnd(18)} ${String(size).padStart(7)} octets`);
}
