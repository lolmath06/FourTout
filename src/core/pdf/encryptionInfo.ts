import { PDFArray, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFString } from "@cantoo/pdf-lib";
import { looksLikePdf } from "./document";
import { PdfError, toPdfError } from "./errors";
import type { PdfSource } from "./types";

/**
 * Extraction des paramètres de chiffrement d'un PDF.
 *
 * C'est la seule partie de la récupération de mot de passe qui a besoin de
 * comprendre la structure du PDF : elle lit une fois le dictionnaire /Encrypt
 * et le transmet, sous forme d'octets bruts, au moteur natif. Celui-ci n'a donc
 * pas besoin d'analyser le document.
 */

export type EncryptionHandler = "AES-256" | "AES-128" | "RC4" | "inconnu";

/** Paramètres passés tels quels à la commande native (octets en hexadécimal). */
export interface EncryptionParamsDto {
  revision: number;
  keyLength: number;
  o: string;
  u: string;
  p: number;
  id0: string;
  encryptMetadata: boolean;
}

export interface EncryptionInfo {
  handler: EncryptionHandler;
  revision: number;
  /** Libellé lisible, pour l'interface. */
  label: string;
  params: EncryptionParamsDto;
}

function toHex(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

function stringBytes(value: unknown): Uint8Array | undefined {
  if (value instanceof PDFHexString || value instanceof PDFString) return value.asBytes();
  return undefined;
}

/**
 * Décrit le chiffrement d'un document protégé, ou renvoie `undefined` s'il ne
 * l'est pas. Lève une `PdfError` si le fichier n'est pas un PDF exploitable.
 */
export async function readEncryptionInfo(source: PdfSource): Promise<EncryptionInfo | undefined> {
  if (source.bytes.length === 0) throw new PdfError("corrupted", "Le fichier est vide.");
  if (!looksLikePdf(source.bytes)) throw new PdfError("not-a-pdf");

  let document: PDFDocument;
  try {
    document = await PDFDocument.load(source.bytes, {
      ignoreEncryption: true,
      updateMetadata: false,
    });
  } catch (error) {
    throw toPdfError(error);
  }

  const context = document.context;
  const encrypt = context.lookup(context.trailerInfo.Encrypt);
  if (!encrypt || !(encrypt instanceof Object) || !("get" in encrypt)) {
    return undefined; // Document non chiffré.
  }

  const dict = encrypt as { get: (name: PDFName) => unknown };
  const get = (key: string) => dict.get(PDFName.of(key));
  const num = (key: string): number | undefined => {
    const value = get(key);
    return value instanceof PDFNumber ? value.asNumber() : undefined;
  };

  const revision = num("R") ?? 0;
  const version = num("V") ?? 0;
  const length = num("Length") ?? 40;

  const o = stringBytes(get("O"));
  const u = stringBytes(get("U"));
  if (!o || !u) throw new PdfError("corrupted", "Dictionnaire de chiffrement incomplet.");

  // Premier élément de /ID (requis pour R2–R4).
  let id0 = new Uint8Array(0);
  const idArray = context.trailerInfo.ID;
  if (idArray instanceof PDFArray) {
    const first = stringBytes(idArray.asArray()[0]);
    if (first) id0 = first;
  }

  // /EncryptMetadata : booléen, vrai par défaut.
  const metaValue = get("EncryptMetadata");
  const encryptMetadata = metaValue === undefined ? true : String(metaValue) !== "false";

  // Longueur de clé en octets.
  const keyLength = revision >= 5 ? 32 : Math.max(5, Math.floor(length / 8));

  const { handler, label } = classify(version, revision);
  if (handler === "inconnu") {
    throw new PdfError(
      "encrypted",
      "Ce type de chiffrement n'est pas pris en charge par la récupération.",
    );
  }

  return {
    handler,
    revision,
    label,
    params: {
      revision,
      keyLength,
      o: toHex(o),
      u: toHex(u),
      p: (num("P") ?? 0) | 0,
      id0: toHex(id0),
      encryptMetadata,
    },
  };
}

function classify(version: number, revision: number): { handler: EncryptionHandler; label: string } {
  if (revision >= 5) return { handler: "AES-256", label: "AES-256 (moderne, robuste)" };
  if (version === 4) return { handler: "AES-128", label: "AES-128" };
  if (version === 2 || version === 1) return { handler: "RC4", label: "RC4 (ancien)" };
  return { handler: "inconnu", label: "chiffrement non reconnu" };
}
