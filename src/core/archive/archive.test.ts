// @vitest-environment node
import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { createZip, crc32 } from "./zip";
import { inflateRaw, InflateError } from "./inflate";
import { looksLikeZip, readZip, readZipEntry, ZipReadError } from "./unzip";

/**
 * Le décompresseur est écrit à la main : on le confronte donc au compresseur
 * de référence de Node, sur des données choisies pour couvrir les trois formes
 * de blocs DEFLATE (stocké, Huffman fixe, Huffman dynamique).
 */
describe("inflate", () => {
  const roundTrip = (text: string) => {
    const bytes = new TextEncoder().encode(text);
    const compressed = new Uint8Array(deflateRawSync(Buffer.from(bytes)));
    return new TextDecoder().decode(inflateRaw(compressed, bytes.length));
  };

  it("restitue un texte court", () => {
    expect(roundTrip("Bonjour")).toBe("Bonjour");
  });

  it("restitue un texte accentué", () => {
    const text = "Facture éditée à Genève — coût : 128,50 € ; l'apostrophe aussi.";
    expect(roundTrip(text)).toBe(text);
  });

  it("restitue un texte très répétitif (références arrière)", () => {
    const text = "abcabcabc".repeat(5000);
    expect(roundTrip(text)).toBe(text);
  });

  it("restitue un contenu XML réaliste", () => {
    const xml = `<?xml version="1.0"?><w:document>${"<w:p><w:r><w:t>Paragraphe éàç</w:t></w:r></w:p>".repeat(300)}</w:document>`;
    expect(roundTrip(xml)).toBe(xml);
  });

  it("restitue des octets aléatoires (blocs peu compressibles)", () => {
    const bytes = new Uint8Array(20_000);
    let state = 12345;
    for (let i = 0; i < bytes.length; i += 1) {
      state = (state * 1103515245 + 12345) & 0x7fffffff;
      bytes[i] = state & 0xff;
    }
    const compressed = new Uint8Array(deflateRawSync(Buffer.from(bytes)));
    expect([...inflateRaw(compressed, bytes.length)]).toEqual([...bytes]);
  });

  it("restitue un flux vide", () => {
    const compressed = new Uint8Array(deflateRawSync(Buffer.alloc(0)));
    expect(inflateRaw(compressed).length).toBe(0);
  });

  it("refuse un flux tronqué au lieu de renvoyer des octets faux", () => {
    const compressed = new Uint8Array(deflateRawSync(Buffer.from("Bonjour le monde".repeat(50))));
    expect(() => inflateRaw(compressed.subarray(0, 5))).toThrow(InflateError);
  });
});

describe("lecture d'archives ZIP", () => {
  it("reconnaît une signature d'archive", () => {
    expect(looksLikeZip(createZip([{ name: "a.txt", bytes: new Uint8Array([1]) }]))).toBe(true);
    expect(looksLikeZip(new TextEncoder().encode("Bonjour"))).toBe(false);
  });

  it("relit une archive écrite par FourTout (entrées stockées)", () => {
    const contents = {
      "note.txt": "Première ligne\nDeuxième ligne, accentuée : éàç.",
      "dossier/second.txt": "Autre contenu",
    };
    const archive = createZip(
      Object.entries(contents).map(([name, text]) => ({
        name,
        bytes: new TextEncoder().encode(text),
      })),
    );

    const entries = readZip(archive);
    expect(entries.map((entry) => entry.name)).toEqual(Object.keys(contents));
    for (const entry of entries) {
      expect(entry.method).toBe(0);
      expect(new TextDecoder().decode(entry.read())).toBe(
        contents[entry.name as keyof typeof contents],
      );
    }
  });

  it("relit une archive compressée (deflate), comme un vrai .docx", () => {
    const text = "<w:t>Contenu répété</w:t>".repeat(400);
    const archive = buildDeflatedZip([{ name: "word/document.xml", text }]);
    expect(readZip(archive)[0].method).toBe(8);
    expect(new TextDecoder().decode(readZipEntry(readZip(archive), "word/document.xml")!)).toBe(text);
  });

  it("ne trouve pas une entrée absente", () => {
    const archive = createZip([{ name: "a.txt", bytes: new Uint8Array([65]) }]);
    expect(readZipEntry(readZip(archive), "word/document.xml")).toBeUndefined();
  });

  it("refuse un fichier qui n'est pas une archive", () => {
    expect(() => readZip(new TextEncoder().encode("Ceci n'est pas une archive du tout."))).toThrow(
      ZipReadError,
    );
  });

  it("détecte une entrée corrompue par son empreinte", () => {
    const archive = buildDeflatedZip([{ name: "a.txt", text: "Bonjour le monde entier" }], {
      corruptCrc: true,
    });
    expect(() => readZip(archive)[0].read()).toThrow(/endommag/i);
  });
});

/** Construit une archive compressée, comme le fait un traitement de texte. */
function buildDeflatedZip(
  files: { name: string; text: string }[],
  { corruptCrc = false } = {},
): Uint8Array {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const data = Buffer.from(file.text, "utf8");
    const deflated = deflateRawSync(data);
    const crc = corruptCrc ? (crc32(data) ^ 0xff) >>> 0 : crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
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
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(bodyBytes.length, 16);

  return new Uint8Array(Buffer.concat([bodyBytes, centralBytes, end]));
}
