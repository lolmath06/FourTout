import type * as PdfJs from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import { PdfError, toPdfError } from "./errors";
import type { PdfSource } from "./types";

/**
 * Accès à pdf.js.
 *
 * pdf.js prend en charge ce que pdf-lib ne sait pas faire : lire le texte,
 * rendre les pages en image et ouvrir un document chiffré. On utilise la
 * version « legacy », la seule qui fonctionne à la fois dans la WebView et
 * dans Node (tests) sans construction séparée.
 *
 * La bibliothèque est chargée à la demande : elle pèse plusieurs centaines de
 * kilo-octets et n'a aucune raison de ralentir le démarrage de l'application
 * pour quelqu'un qui n'ouvrira jamais un PDF.
 *
 * Les ressources (polices standard, tables CJK) sont servies par
 * l'application elle-même : aucune requête réseau, conformément au principe
 * local-first. Voir `scripts/sync-pdfjs-assets.mjs`.
 */

export interface PdfJsResources {
  standardFontDataUrl: string;
  cMapUrl: string;
  /** Fichier du worker ; absent en Node, où pdf.js utilise un worker simulé. */
  workerSrc?: string;
}

let resources: PdfJsResources = {
  standardFontDataUrl: "/pdfjs/standard_fonts/",
  cMapUrl: "/pdfjs/cmaps/",
};

/** Configure les chemins des ressources (l'application au démarrage, les tests). */
export function configurePdfJs(next: Partial<PdfJsResources>): void {
  resources = { ...resources, ...next };
}

type PdfJsModule = typeof PdfJs;

let modulePromise: Promise<PdfJsModule> | undefined;

/** Charge pdf.js une seule fois et applique la configuration du worker. */
export async function getPdfJs(): Promise<PdfJsModule> {
  if (!modulePromise) {
    modulePromise = import("pdfjs-dist/legacy/build/pdf.mjs").then((module) => {
      if (resources.workerSrc) {
        module.GlobalWorkerOptions.workerSrc = resources.workerSrc;
      }
      return module;
    });
  }
  return modulePromise;
}

export interface OpenOptions {
  /** Mot de passe, si le document est protégé. */
  password?: string;
}

/**
 * Ouvre un document avec pdf.js. Les erreurs sont normalisées en `PdfError`
 * pour que l'interface affiche « mot de passe incorrect » plutôt que le
 * message interne de la bibliothèque.
 */
export async function openWithPdfJs(
  source: PdfSource,
  options: OpenOptions = {},
): Promise<PDFDocumentProxy> {
  const pdfjs = await getPdfJs();
  const password = options.password ?? source.password;

  try {
    return await pdfjs.getDocument({
      // pdf.js prend possession du tableau : on lui donne une copie pour que
      // les octets d'origine restent utilisables par les autres opérations.
      data: new Uint8Array(source.bytes),
      standardFontDataUrl: resources.standardFontDataUrl,
      cMapUrl: resources.cMapUrl,
      cMapPacked: true,
      ...(password !== undefined ? { password } : {}),
    }).promise;
  } catch (error) {
    throw normalizePdfJsError(error);
  }
}

function normalizePdfJsError(error: unknown): PdfError {
  const name = error instanceof Error ? error.name : "";
  if (name === "PasswordException") {
    const code = (error as { code?: number }).code;
    // 1 = mot de passe requis, 2 = mot de passe incorrect (pdf.js).
    return new PdfError(code === 2 ? "wrong-password" : "encrypted");
  }
  return toPdfError(error);
}
