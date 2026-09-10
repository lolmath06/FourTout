#!/usr/bin/env node
/**
 * Fixtures documentaires de `test-assets/generated/` — phase 8.
 *
 * Scans, photos de documents, tableaux PDF, documents à comparer et fichiers
 * d'encodage. Objectif inchangé : aucun essai, manuel ou automatique, ne doit
 * demander de fabriquer quoi que ce soit à la main.
 *
 * Tout est produit localement avec les bibliothèques déjà présentes
 * (`@cantoo/pdf-lib`, `@napi-rs/canvas`) : aucun téléchargement, aucune
 * dépendance supplémentaire.
 *
 * Lancé par `pnpm test:assets`.
 */
import { deflateRawSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, StandardFonts, rgb } from "@cantoo/pdf-lib";
import { createCanvas } from "@napi-rs/canvas";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "test-assets", "generated");
mkdirSync(OUT, { recursive: true });
mkdirSync(join(OUT, "scan-pages"), { recursive: true });

const written = [];
/**
 * `segments` est passé en morceaux plutôt qu'en chemin déjà assemblé : c'est
 * `join` qui choisit le séparateur, et la fixture se génère donc à l'identique
 * sous Windows comme sous Linux.
 */
function write(name, bytes, ...segments) {
  writeFileSync(join(OUT, ...segments, name), bytes);
  written.push([[...segments, name].join("/"), bytes.length]);
}

/**
 * Police de rendu des pages-images. La liste de repli garantit un résultat
 * lisible aussi bien sur une machine de développement Fedora que sur un
 * exécuteur d'intégration continue nu.
 */
const FONT_STACK = '"Cantarell", "DejaVu Sans", "Liberation Sans", sans-serif';

/* ===================================================== pages-images (scans) */

/**
 * Dessine une page de texte **en pixels uniquement** : aucune couche texte, ce
 * qui est exactement la situation d'un document numérisé.
 */
function renderTextPage(lines, options = {}) {
  const width = options.width ?? 1240; // A4 à 150 ppp
  const height = options.height ?? 1754;
  const size = options.fontSize ?? 44;
  const ink = options.ink ?? "#101010";
  const paper = options.paper ?? "#ffffff";

  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  context.fillStyle = paper;
  context.fillRect(0, 0, width, height);
  context.fillStyle = ink;
  context.textBaseline = "top";

  let y = options.marginTop ?? 120;
  for (const line of lines) {
    const bold = line.startsWith("**");
    const text = bold ? line.slice(2) : line;
    context.font = `${bold ? "bold " : ""}${bold ? size + 8 : size}px ${FONT_STACK}`;
    context.fillText(text, options.marginLeft ?? 110, y);
    y += (bold ? size + 8 : size) * 1.75;
  }
  return canvas;
}

/** Applique une homographie inverse : la page devient une photo prise en biais. */
function warpToQuad(source, quad, output) {
  const canvas = createCanvas(output.width, output.height);
  const context = canvas.getContext("2d");
  // Fond sombre : c'est ce qui rend les quatre coins de la feuille repérables.
  context.fillStyle = "#2a2b30";
  context.fillRect(0, 0, output.width, output.height);
  const target = context.getImageData(0, 0, output.width, output.height);

  const sourceContext = source.getContext("2d");
  const pixels = sourceContext.getImageData(0, 0, source.width, source.height);

  // Homographie envoyant le rectangle source sur le quadrilatère de sortie,
  // puis parcours inverse pour remplir chaque pixel de destination.
  const h = homography(
    [
      { x: quad[0].x, y: quad[0].y },
      { x: quad[1].x, y: quad[1].y },
      { x: quad[2].x, y: quad[2].y },
      { x: quad[3].x, y: quad[3].y },
    ],
    [
      { x: 0, y: 0 },
      { x: source.width, y: 0 },
      { x: source.width, y: source.height },
      { x: 0, y: source.height },
    ],
  );

  for (let y = 0; y < output.height; y += 1) {
    for (let x = 0; x < output.width; x += 1) {
      const w = h[6] * x + h[7] * y + 1;
      const sx = (h[0] * x + h[1] * y + h[2]) / w;
      const sy = (h[3] * x + h[4] * y + h[5]) / w;
      if (sx < 0 || sy < 0 || sx >= source.width - 1 || sy >= source.height - 1) continue;
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const from = (y0 * source.width + x0) * 4;
      const to = (y * output.width + x) * 4;
      target.data[to] = pixels.data[from];
      target.data[to + 1] = pixels.data[from + 1];
      target.data[to + 2] = pixels.data[from + 2];
      target.data[to + 3] = 255;
    }
  }

  context.putImageData(target, 0, 0);
  return canvas;
}

/** Résout l'homographie `from → to` (huit coefficients, le neuvième vaut 1). */
function homography(from, to) {
  const matrix = [];
  const vector = [];
  for (let index = 0; index < 4; index += 1) {
    const { x, y } = from[index];
    const { x: u, y: v } = to[index];
    matrix.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    vector.push(u);
    matrix.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    vector.push(v);
  }
  const rows = matrix.map((row, index) => [...row, vector[index]]);
  for (let column = 0; column < 8; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < 8; row += 1) {
      if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row;
    }
    [rows[column], rows[pivot]] = [rows[pivot], rows[column]];
    for (let row = 0; row < 8; row += 1) {
      if (row === column) continue;
      const factor = rows[row][column] / rows[column][column];
      for (let k = column; k <= 8; k += 1) rows[row][k] -= factor * rows[column][k];
    }
  }
  return rows.map((row, index) => row[8] / row[index]);
}

/* ------------------------------------------------- PDF scanné, deux pages */

/** Phrases attendues par les tests automatiques ET par les essais manuels. */
export const SCANNED_PAGE_ONE = [
  "**Facture numero 2026-042",
  "Editee a Geneve le 3 mars.",
  "Montant total : 128,50 euros.",
  "Client : Societe Dupont.",
];
export const SCANNED_PAGE_TWO = [
  "**Second scanned page",
  "Invoice number 2026-042.",
  "Thank you for your business.",
  "Reference: FR-2026-042.",
];

/**
 * Page accentuée, isolée des deux ci-dessus : les accents sont testés sur des
 * mots simples et bien détachés, pour que l'assertion porte sur le traitement
 * des accents et non sur la difficulté de l'OCR.
 */
export const SCANNED_ACCENTS = [
  "**Résumé du dossier",
  "Éditée à Genève, très tôt.",
  "Coût : 128,50 euros où ça.",
  "L'apostrophe et le çà.",
];

async function buildScannedPdf(pages) {
  const document = await PDFDocument.create();
  for (const lines of pages) {
    const canvas = renderTextPage(lines);
    const png = await document.embedPng(canvas.toBuffer("image/png"));
    // La page épouse l'image à 150 ppp : 1240 px → 595 pt (A4).
    const page = document.addPage([png.width * 0.48, png.height * 0.48]);
    page.drawImage(png, { x: 0, y: 0, width: png.width * 0.48, height: png.height * 0.48 });
  }
  return document.save();
}

write("scanned-two-page.pdf", await buildScannedPdf([SCANNED_PAGE_ONE, SCANNED_PAGE_TWO]));
write("scanned-accents.pdf", await buildScannedPdf([SCANNED_ACCENTS]));

/* --------------------------------------------------- photo en perspective */

/**
 * Coins exacts de la feuille dans `scan-perspective.jpg`, dans l'ordre
 * haut-gauche, haut-droite, bas-droite, bas-gauche. Publiés dans un fichier
 * annexe pour que les tests — et l'essai manuel — n'aient pas à les deviner.
 */
export const PERSPECTIVE_QUAD = [
  { x: 210, y: 150 },
  { x: 1010, y: 265 },
  { x: 930, y: 1180 },
  { x: 145, y: 1010 },
];

{
  const flat = renderTextPage(
    [
      "**Document photographie",
      "Ligne de reference numero un.",
      "Ligne de reference numero deux.",
      "Coins a redresser.",
    ],
    { width: 900, height: 1200, fontSize: 46, marginLeft: 70, marginTop: 90 },
  );
  const photo = warpToQuad(flat, PERSPECTIVE_QUAD, { width: 1200, height: 1350 });
  write("scan-perspective.jpg", photo.toBuffer("image/jpeg", 92));
  write(
    "scan-perspective.json",
    Buffer.from(
      `${JSON.stringify(
        {
          image: "scan-perspective.jpg",
          width: 1200,
          height: 1350,
          corners: {
            topLeft: PERSPECTIVE_QUAD[0],
            topRight: PERSPECTIVE_QUAD[1],
            bottomRight: PERSPECTIVE_QUAD[2],
            bottomLeft: PERSPECTIVE_QUAD[3],
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    ),
  );
}

/* ------------------------------------------------------------ scan penché */

/** Inclinaison exacte, en degrés, de `scan-skewed.jpg`. Mesurable par le test. */
export const SKEW_DEGREES = 3.2;

{
  const flat = renderTextPage([
    "**Scan legerement penche",
    "Premiere ligne de texte.",
    "Deuxieme ligne de texte.",
    "Troisieme ligne de texte.",
    "Quatrieme ligne de texte.",
    "Cinquieme ligne de texte.",
  ]);
  const radians = (SKEW_DEGREES * Math.PI) / 180;
  const canvas = createCanvas(flat.width, flat.height);
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate(radians);
  context.drawImage(flat, -flat.width / 2, -flat.height / 2);
  write("scan-skewed.jpg", canvas.toBuffer("image/jpeg", 92));
}

/* ------------------------------------------------------ scan peu contraste */

write(
  "scan-low-contrast.jpg",
  renderTextPage(
    [
      "**Scan peu contraste",
      "Texte gris sur fond gris.",
      "Le nettoyage doit le rendre net.",
      "Ligne de controle finale.",
    ],
    { ink: "#8a8a8a", paper: "#d8d6cf" },
  ).toBuffer("image/jpeg", 92),
);

/* ---------------------------------------------------- lot de pages à relier */

const SCAN_PAGE_TEXTS = [
  ["**Page un", "Contenu de la premiere page.", "A relier en PDF."],
  ["**Page deux", "Contenu de la deuxieme page.", "Ordre a verifier."],
  ["**Page trois", "Contenu de la troisieme page.", "Derniere page du lot."],
];

SCAN_PAGE_TEXTS.forEach((lines, index) => {
  write(
    `page-0${index + 1}.jpg`,
    renderTextPage(lines, { width: 900, height: 1270 }).toBuffer("image/jpeg", 88),
    "scan-pages",
  );
});

/* ============================================================= tableaux PDF */

/** Contenu commun aux deux fixtures : mêmes valeurs, présentations opposées. */
export const TABLE_ROWS = [
  ["Référence", "Désignation", "Quantité", "Prix unitaire"],
  ["FR-001", "Câble tressé", "12", "4,50"],
  ["FR-002", "Boîtier alu", "3", "18,90"],
  ["FR-003", "Vis à tête plate", "250", "0,07"],
  ["FR-004", "Écrou hexagonal", "250", "0,05"],
];

/** Abscisses des colonnes, en points. Les gouttières sont franches. */
const TABLE_COLUMNS = [56, 170, 360, 460];
const TABLE_TOP = 700;
const ROW_HEIGHT = 34;

async function buildTablePdf({ grid }) {
  const document = await PDFDocument.create();
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const page = document.addPage([595.28, 841.89]);

  page.drawText(grid ? "Tableau avec grille" : "Tableau sans bordures", {
    x: 56,
    y: 780,
    size: 16,
    font: bold,
  });

  TABLE_ROWS.forEach((row, rowIndex) => {
    const y = TABLE_TOP - rowIndex * ROW_HEIGHT;
    row.forEach((cell, columnIndex) => {
      page.drawText(cell, {
        x: TABLE_COLUMNS[columnIndex],
        y,
        size: 11,
        font: rowIndex === 0 ? bold : regular,
      });
    });
  });

  if (grid) {
    const right = 560;
    const bottom = TABLE_TOP - (TABLE_ROWS.length - 1) * ROW_HEIGHT - 10;
    const top = TABLE_TOP + 22;
    const line = { thickness: 0.8, color: rgb(0.2, 0.2, 0.2) };
    for (let index = 0; index <= TABLE_ROWS.length; index += 1) {
      const y = top - index * ROW_HEIGHT;
      if (y < bottom) break;
      page.drawLine({ start: { x: 46, y }, end: { x: right, y }, ...line });
    }
    page.drawLine({ start: { x: 46, y: bottom }, end: { x: right, y: bottom }, ...line });
    for (const x of [46, 160, 350, 450, right]) {
      page.drawLine({ start: { x, y: top }, end: { x, y: bottom }, ...line });
    }
  }

  return document.save();
}

write("table-grid.pdf", await buildTablePdf({ grid: true }));
write("table-columns.pdf", await buildTablePdf({ grid: false }));

/* ======================================================= documents comparés */

/** Phrases communes et phrases divergentes, connues des tests. */
export const COMPARE_COMMON = [
  "Contrat de prestation, version de référence.",
  "Article premier : objet du contrat.",
  "Article deux : durée de la prestation.",
];
export const COMPARE_ONLY_A = "Le montant est fixé à 1 200 euros.";
export const COMPARE_ONLY_B = "Le montant est fixé à 1 450 euros.";

async function buildComparePdf(unique) {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const page = document.addPage([595.28, 841.89]);
  [...COMPARE_COMMON, unique, "Fait à Genève, le 3 mars 2026."].forEach((line, index) => {
    page.drawText(line, { x: 56, y: 760 - index * 28, size: 12, font });
  });
  return document.save();
}

write("compare-a.pdf", await buildComparePdf(COMPARE_ONLY_A));
write("compare-b.pdf", await buildComparePdf(COMPARE_ONLY_B));

/* ------------------------------------------------------------------- DOCX */

/** CRC-32, pour l'archive ZIP du .docx. */
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Archive ZIP compressée (deflate), comme en produit un traitement de texte. */
function buildZip(entries) {
  const parts = [];
  const central = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const data = Buffer.from(entry.data, "utf8");
    const deflated = deflateRawSync(data);
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0x21, 12); // date figée : fixture reproductible
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
    header.writeUInt16LE(8, 10);
    header.writeUInt16LE(0x21, 14);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(deflated.length, 20);
    header.writeUInt32LE(data.length, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt32LE(offset, 42);
    central.push(header, name);
    offset += local.length + name.length + deflated.length;
  }

  const centralBytes = Buffer.concat(central);
  const bodyBytes = Buffer.concat(parts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(bodyBytes.length, 16);
  return Buffer.concat([bodyBytes, centralBytes, end]);
}

{
  const paragraphs = [...COMPARE_COMMON, COMPARE_ONLY_B, "Fait à Genève, le 3 mars 2026."]
    .map((line) => `<w:p><w:r><w:t xml:space="preserve">${line.replace(/&/g, "&amp;")}</w:t></w:r></w:p>`)
    .join("");

  write(
    "compare.docx",
    buildZip([
      {
        name: "[Content_Types].xml",
        data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
      },
      {
        name: "_rels/.rels",
        data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
      },
      {
        name: "word/document.xml",
        data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}</w:body></w:document>`,
      },
    ]),
  );
}

/* --------------------------------------------------------- texte à comparer */

write(
  "compare-a.txt",
  Buffer.from(`${[...COMPARE_COMMON, COMPARE_ONLY_A, "Fait à Genève, le 3 mars 2026."].join("\n")}\n`, "utf8"),
);
write(
  "compare-b.txt",
  Buffer.from(`${[...COMPARE_COMMON, COMPARE_ONLY_B, "Fait à Genève, le 3 mars 2026."].join("\n")}\n`, "utf8"),
);

/* ============================================================== encodages */

/**
 * Même texte dans tous les encodages : la conversion est réussie si, et
 * seulement si, tous redonnent exactement cette chaîne.
 */
export const ENCODING_SAMPLE =
  "Été à Genève : coût 12,50 €.\nL'accent aigu, le tréma ë et le ç.\nFin du fichier.\n";

/** Variante Latin-1 : le signe € n'y existe pas, on l'écarte. */
const LATIN1_SAMPLE = ENCODING_SAMPLE.replace(" €", " euros");

function encodeSingleByte(text, { cp1252 }) {
  const CP1252_HIGH = {
    0x20ac: 0x80, 0x201a: 0x82, 0x192: 0x83, 0x201e: 0x84, 0x2026: 0x85,
    0x2020: 0x86, 0x2021: 0x87, 0x2c6: 0x88, 0x2030: 0x89, 0x160: 0x8a,
    0x2039: 0x8b, 0x152: 0x8c, 0x17d: 0x8e, 0x2018: 0x91, 0x2019: 0x92,
    0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
    0x2dc: 0x98, 0x2122: 0x99, 0x161: 0x9a, 0x203a: 0x9b, 0x153: 0x9c,
    0x17e: 0x9e, 0x178: 0x9f,
  };
  const out = [];
  for (const character of text) {
    const code = character.codePointAt(0);
    if (code <= 0xff) out.push(code);
    else if (cp1252 && CP1252_HIGH[code] !== undefined) out.push(CP1252_HIGH[code]);
    else throw new Error(`Caractère hors encodage dans la fixture : ${character}`);
  }
  return Buffer.from(out);
}

function encodeUtf16(text, littleEndian) {
  const bytes = Buffer.alloc((text.length + 1) * 2);
  bytes[littleEndian ? 0 : 1] = 0xff;
  bytes[littleEndian ? 1 : 0] = 0xfe;
  if (!littleEndian) {
    bytes[0] = 0xfe;
    bytes[1] = 0xff;
  }
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (littleEndian) bytes.writeUInt16LE(code, 2 + index * 2);
    else bytes.writeUInt16BE(code, 2 + index * 2);
  }
  return bytes;
}

write("encoding-utf8.txt", Buffer.from(ENCODING_SAMPLE, "utf8"));
write(
  "encoding-utf8-bom.txt",
  Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(ENCODING_SAMPLE, "utf8")]),
);
write("encoding-utf16le.txt", encodeUtf16(ENCODING_SAMPLE, true));
write("encoding-utf16be.txt", encodeUtf16(ENCODING_SAMPLE, false));
write("encoding-win1252.txt", encodeSingleByte(ENCODING_SAMPLE, { cp1252: true }));
write("encoding-latin1.txt", encodeSingleByte(LATIN1_SAMPLE, { cp1252: false }));

// Fichier Windows : mêmes accents, fins de ligne CRLF.
write(
  "encoding-win1252-crlf.txt",
  encodeSingleByte(ENCODING_SAMPLE.replace(/\n/g, "\r\n"), { cp1252: true }),
);

/**
 * Contient des caractères qu'aucun encodage sur un octet ne sait écrire :
 * convertir ce fichier vers Windows-1252 doit être **refusé**, pas silencieux.
 */
write(
  "encoding-unrepresentable.txt",
  Buffer.from("Flèche → et idéogramme 中 et emoji 😀.\nLe reste est ordinaire.\n", "utf8"),
);

/* -------------------------------------------------------------------------- */

const total = written.reduce((sum, [, size]) => sum + size, 0);
console.log(`${written.length} fixtures documentaires écrites (${Math.round(total / 1024)} Ko).`);
for (const [name, size] of written) console.log(`  ${name} — ${size} o`);
