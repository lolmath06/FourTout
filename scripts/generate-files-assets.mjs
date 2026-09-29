#!/usr/bin/env node
/**
 * Fixtures de la phase 6 : texte, documents, archives, doublons, découpage,
 * renommage et arborescence.
 *
 * Mêmes contraintes que les autres générateurs : aucun téléchargement, aucune
 * dépendance, et un contenu **déterministe** — deux exécutions produisent des
 * octets identiques, donc des empreintes identiques. C'est ce qui permet aux
 * tests de vérifier un SHA-256 attendu plutôt qu'un « ça a l'air correct ».
 *
 * Usage : `pnpm test:assets`
 */
import { deflateRawSync, gzipSync } from "node:zlib";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "test-assets", "generated");

mkdirSync(OUT, { recursive: true });

const written = [];
function write(relative, data) {
  const path = join(OUT, relative);
  mkdirSync(dirname(path), { recursive: true });
  const bytes = typeof data === "string" ? Buffer.from(data, "utf8") : data;
  writeFileSync(path, bytes);
  written.push([relative, bytes.length]);
  return bytes;
}

/* ------------------------------------------------------------------ texte */

// Espaces multiples, espaces de bord, lignes vides en série, espace insécable,
// caractère de largeur nulle, guillemets et tirets typographiques, CRLF mêlé.
write(
  "text-dirty.txt",
  "   Texte   copié   depuis   une   page   web   \r\n" +
    "\r\n" +
    "\r\n" +
    "  Deuxième    paragraphe avec 100 % d'espaces insécables.  \n" +
    "Un mot cou​pé par une largeur nulle.\n" +
    "\n" +
    "\n" +
    "\n" +
    "L’été — c’est « chaud »   \n",
);

write(
  "text-duplicates.txt",
  ["pomme", "poire", "Pomme", "banane", "  poire  ", "", "cerise", "banane", "POMME", "kiwi"].join("\n") + "\n",
);

write(
  "text-sort.txt",
  ["banane", "12 pommes", "Cerise", "3 poires", "abricot", "100 fraises", "", "Ébène", "zèbre"].join("\n") + "\n",
);

write(
  "text-a.txt",
  [
    "# Rapport FourTout",
    "",
    "Première ligne identique.",
    "Ligne qui sera modifiée : version un.",
    "Ligne qui sera supprimée.",
    "Dernière ligne identique.",
  ].join("\n") + "\n",
);

write(
  "text-b.txt",
  [
    "# Rapport FourTout",
    "",
    "Première ligne identique.",
    "Ligne qui sera modifiée : version deux.",
    "Dernière ligne identique.",
    "Ligne ajoutée à la fin.",
  ].join("\n") + "\n",
);

write(
  "sample.md",
  `# Titre principal

Un paragraphe avec du **gras**, de l'*italique*, du \`code\` et un [lien](https://example.com).

## Liste à puces

- premier point
- second point
  - sous-point imbriqué

## Liste numérotée

1. étape une
2. étape deux

> Une citation sur une ligne.

| Colonne A | Colonne B |
| --- | --- |
| 1 | deux |

\`\`\`js
const fourtout = "local";
\`\`\`

---

Fin du document, avec des accents : éàçùô.
`,
);

// Contient volontairement un script et un style : l'aperçu doit les retirer.
write(
  "sample.html",
  `<h1>Titre HTML</h1>
<p>Un paragraphe <strong>important</strong> et <em>penché</em>.</p>
<ul><li>un</li><li>deux</li></ul>
<ol><li>premier</li><li>second</li></ol>
<blockquote>Citation</blockquote>
<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>
<p><a href="https://example.com">lien légitime</a></p>
<p><a href="javascript:alert('xss')">lien piégé</a></p>
<script>alert('xss')</script>
<style>body { display: none; }</style>
<iframe src="https://example.com"></iframe>
`,
);

/* ------------------------------------------------------- fins de ligne */

const LINE_ENDING_BODY = ["Première ligne", "Deuxième ligne", "Troisième ligne avec accents éàç"];
write("line-endings-lf.txt", LINE_ENDING_BODY.join("\n") + "\n");
write("line-endings-crlf.txt", LINE_ENDING_BODY.join("\r\n") + "\r\n");
write("line-endings-mixed.txt", "Ligne LF\nLigne CRLF\r\nLigne CR\rFin\n");

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

/** Écrit une archive ZIP (méthode « deflate » ou « stocké »). */
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
    local.writeUInt16LE(0x0800, 6); // noms UTF-8
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10); // heure
    local.writeUInt16LE(0x21, 12); // date : 1980-01-01, pour rester déterministe
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
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
    header.writeUInt32LE(0, 38); // attributs externes
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

/** En-tête ustar de 512 octets. */
function tarHeader(name, size) {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, "utf8");
  header.write("000644 \0", 100, 8, "ascii"); // mode
  header.write("000000 \0", 108, 8, "ascii"); // uid
  header.write("000000 \0", 116, 8, "ascii"); // gid
  header.write(size.toString(8).padStart(11, "0") + " ", 124, 12, "ascii");
  header.write("00000000000 ", 136, 12, "ascii"); // mtime figé : fixtures déterministes
  header.write("        ", 148, 8, "ascii"); // somme de contrôle, calculée ensuite
  header.write("0", 156, 1, "ascii"); // fichier ordinaire
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
  parts.push(Buffer.alloc(1024)); // deux blocs vides de fin
  return Buffer.concat(parts);
}

/* ------------------------------------------------- dossier à archiver */

const ARCHIVE_ENTRIES = [
  { name: "archive-source/a.txt", data: "Fichier A — racine de l'archive.\n" },
  { name: "archive-source/nested/b.txt", data: "Fichier B — dans un sous-dossier.\n" },
  { name: "archive-source/unicode-é.txt", data: "Nom de fichier accentué : é à ç.\n" },
];

for (const entry of ARCHIVE_ENTRIES) write(entry.name, entry.data);

write("sample.zip", buildZip(ARCHIVE_ENTRIES));
write("sample.tar", buildTar(ARCHIVE_ENTRIES));
write("sample.tar.gz", gzipSync(buildTar(ARCHIVE_ENTRIES), { level: 9, mtime: 0 }));

// Archive piégée : deux entrées sortiraient du dossier de destination.
// Elle sert à vérifier de visu que FourTout les refuse et les liste.
write(
  "evil-zip-slip.zip",
  buildZip([
    { name: "sain.txt", data: "Ce fichier doit être extrait normalement.\n" },
    { name: "../../evil.txt", data: "Ce fichier ne doit JAMAIS être écrit.\n" },
    { name: "/tmp/evil-absolu.txt", data: "Chemin absolu : doit être refusé.\n" },
  ]),
);

/* -------------------------------------------------------------- DOCX */

const DOCUMENT_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Rapport FourTout</w:t></w:r></w:p>
<w:p><w:r><w:t xml:space="preserve">Un paragraphe avec du </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>gras</w:t></w:r><w:r><w:t xml:space="preserve"> et de l'</w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>italique</w:t></w:r><w:r><w:t>.</w:t></w:r></w:p>
<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Sous-titre</w:t></w:r></w:p>
<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Premier point de la liste</w:t></w:r></w:p>
<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Second point de la liste</w:t></w:r></w:p>
<w:tbl>
<w:tr><w:tc><w:p><w:r><w:t>Colonne A</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Colonne B</w:t></w:r></w:p></w:tc></w:tr>
<w:tr><w:tc><w:p><w:r><w:t>1</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>deux</w:t></w:r></w:p></w:tc></w:tr>
</w:tbl>
<w:p><w:r><w:t>Dernier paragraphe, avec des accents : éàçùô et une esperluette &amp;.</w:t></w:r></w:p>
</w:body></w:document>`;

write(
  "sample.docx",
  buildZip([
    {
      name: "[Content_Types].xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`,
    },
    {
      name: "_rels/.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`,
    },
    { name: "word/document.xml", data: DOCUMENT_XML },
    {
      name: "docProps/core.xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"><dc:title>Rapport de test FourTout</dc:title><dc:creator>Equipe FourTout</dc:creator><dc:subject>Fixture de test</dc:subject><cp:keywords>fourtout;docx;test</cp:keywords><dcterms:created>2026-01-01T00:00:00Z</dcterms:created><dcterms:modified>2026-01-01T00:00:00Z</dcterms:modified><cp:lastModifiedBy>FourTout</cp:lastModifiedBy></cp:coreProperties>`,
    },
    {
      name: "docProps/app.xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>FourTout test-assets</Application><Pages>1</Pages><Words>42</Words></Properties>`,
    },
  ]),
);

/* ---------------------------------------------------------- doublons */

/** Octets reproductibles : même fixture, même empreinte, à chaque génération. */
function deterministicBytes(size, seed = 1) {
  const out = Buffer.alloc(size);
  let state = seed >>> 0 || 1;
  for (let i = 0; i < size; i += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    out[i] = state & 0xff;
  }
  return out;
}

rmSync(join(OUT, "duplicate-folder"), { recursive: true, force: true });
const DUPLICATE_CONTENT = deterministicBytes(64 * 1024, 7);
write("duplicate-folder/original.bin", DUPLICATE_CONTENT);
write("duplicate-folder/copy.bin", DUPLICATE_CONTENT);
write("duplicate-folder/nested/copy2.bin", DUPLICATE_CONTENT);
write("duplicate-folder/different.bin", deterministicBytes(64 * 1024, 99));
// Même taille, contenu différent : force le passage à l'empreinte complète.
write("duplicate-folder/same-size-different.bin", deterministicBytes(64 * 1024, 1234));
write("duplicate-folder/notes.txt", "Trois fichiers identiques, deux différents.\n");

/* ----------------------------------------------------- découpage */

// 2,5 Mo : assez pour produire cinq morceaux de 500 Ko et voir la progression,
// assez peu pour rester instantané et ne pas peser dans le dossier de test.
write("large-split.bin", deterministicBytes(2_500_000, 31));

/* ----------------------------------------------------- renommage */

rmSync(join(OUT, "rename-batch"), { recursive: true, force: true });
for (let index = 1; index <= 5; index += 1) {
  write(`rename-batch/IMG_${String(index).padStart(4, "0")}.JPG`, deterministicBytes(512, index));
}
write("rename-batch/Photo de vacances (été) n°6.JPEG", deterministicBytes(512, 6));

/* --------------------------------------------------- arborescence */

rmSync(join(OUT, "folder-tree"), { recursive: true, force: true });
write("folder-tree/package.json", '{\n  "name": "exemple"\n}\n');
write("folder-tree/README.md", "# Exemple\n");
write("folder-tree/.hidden-config", "caché\n");
write("folder-tree/src/main.ts", "export const x = 1;\n");
write("folder-tree/src/components/Button.tsx", "export function Button() {}\n");
write("folder-tree/src/components/deep/Nested.tsx", "export function Nested() {}\n");
write("folder-tree/src/components/deep/deeper/VeryDeep.tsx", "export const deep = true;\n");
write("folder-tree/node_modules/paquet/index.js", "module.exports = {};\n");
write("folder-tree/.git/config", "[core]\n");

/* ------------------------------------------------------------ bilan */

const total = written.reduce((sum, [, size]) => sum + size, 0);
console.log(`Fixtures Fichiers/Texte : ${written.length} fichiers, ${(total / 1024).toFixed(0)} Ko`);
for (const [name, size] of written) console.log(`  ${name} — ${size} o`);
