import { loadPdf, savePdf, stripEncryption } from "../document";
import { PdfError } from "../errors";
import { outputName } from "../filenames";
import type { OutputFile, PdfSource } from "../types";

/**
 * Protection par mot de passe.
 *
 * L'algorithme est le chiffrement standard AES-256 (ISO 32000-2, révision 6),
 * mis en œuvre par `@cantoo/pdf-lib` au-dessus de la Web Crypto API. Le
 * chiffrement est donc réel et interopérable : les tests vérifient qu'un
 * fichier protégé par FourTout s'ouvre bien dans pdf.js, une implémentation
 * totalement indépendante.
 *
 * FourTout ne casse aucune protection : le déverrouillage exige le mot de
 * passe et se contente de retirer le chiffrement d'un document déjà ouvert.
 */

export interface ProtectOptions {
  /** Mot de passe demandé à l'ouverture. */
  userPassword: string;
  /**
   * Mot de passe donnant les droits complets. À défaut, le mot de passe
   * utilisateur est repris : un propriétaire distinct mais inconnu de
   * l'utilisateur ne lui rendrait aucun service.
   */
  ownerPassword?: string;
}

export async function protectPdf(
  source: PdfSource,
  options: ProtectOptions,
): Promise<OutputFile> {
  if (options.userPassword.length === 0) {
    throw new PdfError("invalid-range", "Le mot de passe ne peut pas être vide.");
  }

  const document = await loadPdf(source);
  document.encrypt({
    userPassword: options.userPassword,
    ownerPassword: options.ownerPassword || options.userPassword,
  });

  // Le chiffrement doit pouvoir traiter chaque objet séparément : les flux
  // d'objets regrouperaient des données déjà chiffrées.
  return savePdf(document, outputName(source.name, "protege"), { useObjectStreams: false });
}

/**
 * Retire la protection d'un document dont le mot de passe est connu.
 * Le contenu, la structure et les pages sont conservés tels quels.
 */
export async function unlockPdf(source: PdfSource, password: string): Promise<OutputFile> {
  if (password.length === 0) {
    throw new PdfError("wrong-password", "Saisissez le mot de passe du document.");
  }

  const document = await loadPdf({ ...source, password });
  if (!document.isEncrypted && !hasEncryptionArtifacts(document)) {
    throw new PdfError("invalid-range", "Ce document n'est pas protégé par un mot de passe.");
  }

  stripEncryption(document);
  return savePdf(document, outputName(source.name, "deverrouille"));
}

/**
 * Après un chargement réussi avec mot de passe, pdf-lib remet `isEncrypted` à
 * faux : on cherche donc le dictionnaire de sécurité résiduel pour distinguer
 * un document réellement protégé d'un document qui ne l'a jamais été.
 */
function hasEncryptionArtifacts(document: {
  context: { enumerateIndirectObjects(): Iterable<[unknown, unknown]> };
}): boolean {
  for (const [, object] of document.context.enumerateIndirectObjects()) {
    if (String(object).includes("/Filter /Standard")) return true;
  }
  return false;
}
