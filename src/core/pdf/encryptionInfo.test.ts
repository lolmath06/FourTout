// @vitest-environment node
import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "@cantoo/pdf-lib";
import { readEncryptionInfo } from "./encryptionInfo";
import { buildSource } from "@/test/pdfFixtures";

async function encrypt(opts: Record<string, unknown>): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([200, 200]).drawText("x", { x: 20, y: 100, size: 12, font });
  const e = await PDFDocument.load(await doc.save());
  (e.encrypt as (o: Record<string, unknown>) => void)(opts);
  return e.save({ useObjectStreams: false });
}

describe("extraction des paramètres de chiffrement", () => {
  it("renvoie undefined pour un document non chiffré", async () => {
    const source = await buildSource("clair.pdf", { pageCount: 1 });
    expect(await readEncryptionInfo(source)).toBeUndefined();
  });

  it("reconnaît AES-256 (R6) et extrait /O, /U, /ID", async () => {
    const bytes = await encrypt({ userPassword: "topsecret", ownerPassword: "o" });
    const info = await readEncryptionInfo({ name: "p.pdf", bytes });

    expect(info?.handler).toBe("AES-256");
    expect(info?.revision).toBe(6);
    expect(info?.params.keyLength).toBe(32);
    expect(info?.params.o).toHaveLength(96); // 48 octets
    expect(info?.params.u).toHaveLength(96);
    expect(info?.params.id0).toHaveLength(32); // 16 octets
    expect(/^[0-9a-f]+$/.test(info!.params.o)).toBe(true);
  });

  it("reconnaît AES-128 (R4)", async () => {
    const bytes = await encrypt({ userPassword: "topsecret", ownerPassword: "o", algorithm: "AES-128" });
    const info = await readEncryptionInfo({ name: "p.pdf", bytes });
    expect(info?.handler).toBe("AES-128");
    expect(info?.revision).toBe(4);
    expect(info?.params.keyLength).toBe(16);
  });

  it("reconnaît RC4 (R3)", async () => {
    const bytes = await encrypt({
      userPassword: "topsecret",
      ownerPassword: "o",
      algorithm: "RC4-128",
      allowWeakCryptography: true,
    });
    const info = await readEncryptionInfo({ name: "p.pdf", bytes });
    expect(info?.handler).toBe("RC4");
    expect(info?.revision).toBe(3);
  });

  it("rejette un fichier qui n'est pas un PDF", async () => {
    await expect(
      readEncryptionInfo({ name: "x.pdf", bytes: new TextEncoder().encode("bonjour") }),
    ).rejects.toMatchObject({ code: "not-a-pdf" });
  });

  it("émet exactement les clés camelCase attendues par le moteur natif", async () => {
    // Contrat IPC : ces clés doivent correspondre au DTO Rust (rename_all camelCase).
    const bytes = await encrypt({ userPassword: "topsecret", ownerPassword: "o", algorithm: "AES-128" });
    const info = await readEncryptionInfo({ name: "p.pdf", bytes });
    expect(Object.keys(info!.params).sort()).toEqual(
      ["encryptMetadata", "id0", "keyLength", "o", "p", "revision", "u"],
    );
    expect(typeof info!.params.keyLength).toBe("number");
    expect(typeof info!.params.encryptMetadata).toBe("boolean");
  });
});
