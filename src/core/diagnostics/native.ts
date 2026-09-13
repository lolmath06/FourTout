/**
 * Client du socle de diagnostic natif.
 *
 * Deux responsabilités, et la seconde compte autant que la première :
 *
 * 1. faire appel au moteur natif pour analyser et réparer ;
 * 2. **vérifier ce qu'il a produit**. Pour un PDF, cela veut dire le rouvrir
 *    avec pdf.js et compter ses pages. Écrire un fichier puis le déclarer
 *    réparé sans l'avoir relu serait exactement le théâtre de la réparation que
 *    cette phase refuse.
 *
 * Aucune de ces opérations ne touche au fichier d'origine : le moteur natif
 * écrit toujours ailleurs, et le chemin de sortie est calculé de façon à ne
 * jamais écraser un fichier existant.
 */

import { isTauri } from "@/core/platform";
import { openWithPdfJs } from "@/core/pdf/pdfjs";
import { readBytes } from "@/core/files/native";

export const DIAGNOSTICS_NATIVE_REQUIRED =
  "Le diagnostic lit un fichier sur votre disque : il nécessite l'application FourTout " +
  "installée et n'est pas disponible dans l'aperçu navigateur.";

export type Severity = "info" | "warning" | "error";

export type Repairability = "none" | "safeRepair" | "recoverPartial" | "recoverVisual";

export type Health = "healthy" | "suspicious" | "damaged" | "unreadable";

export interface Finding {
  severity: Severity;
  /** Identifiant stable : l'interface s'y réfère, jamais au libellé. */
  code: string;
  title: string;
  detail: string;
  repairability: Repairability;
}

export interface RepairAction {
  id: string;
  title: string;
  detail: string;
  /** Ce que l'action coûte. Vide quand elle ne coûte rien. */
  costs: string[];
  repairability: Repairability;
  outputExtension: string;
}

export interface DiagnosticReport {
  path: string;
  name: string;
  size: number;
  extension: string;
  detected: string;
  detectedLabel: string;
  extensionMatches: boolean;
  health: Health;
  findings: Finding[];
  actions: RepairAction[];
  sha256: string;
  details: DiagnosticDetails;
}

export interface GenericDetails {
  headHex: string;
  tailHex: string;
  endMarker: string | null;
  endMarkerFound: boolean;
  trailingBytes: number;
  empty: boolean;
}

export type ZipEntryState =
  | "recoverable"
  | "checksumMismatch"
  | "lost"
  | "encrypted"
  | "rejected";

export interface ZipScannedEntry {
  name: string;
  offset: number;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  declaredCrc: number;
  actualCrc: number | null;
  state: ZipEntryState;
  reason: string | null;
  isDir: boolean;
}

export interface ZipDetails {
  eocdOffset: number | null;
  declaredEntries: number | null;
  centralDirectoryOffset: number | null;
  centralEntries: number;
  localHeaders: number;
  trailingBytes: number;
  encrypted: boolean;
  zip64: boolean;
  entries: ZipScannedEntry[];
  recoverableBytes: number;
}

export interface PdfDetails {
  version: string | null;
  eofOffset: number | null;
  trailingBytes: number;
  startxrefValue: number | null;
  startxrefValid: boolean;
  xrefOffset: number | null;
  objects: number;
  rootObject: number | null;
  objectStreams: boolean;
  xrefStreams: boolean;
  signed: boolean;
  pageObjects: number;
  trailer: boolean;
}

export interface PngChunk {
  kind: string;
  offset: number;
  length: number;
  crcValid: boolean;
  ancillary: boolean;
}

export interface JpegSegment {
  marker: number;
  label: string;
  offset: number;
  length: number;
}

export interface ImageDetails {
  format: string;
  width: number | null;
  height: number | null;
  decodes: boolean;
  decodeError: string | null;
  chunks: PngChunk[];
  segments: JpegSegment[];
  trailingBytes: number;
  endMarker: boolean;
  brokenAncillary: number;
  brokenCritical: number;
}

export interface DiagnosticDetails {
  generic?: GenericDetails;
  zip?: ZipDetails;
  pdf?: PdfDetails;
  image?: ImageDetails;
}

export const SEVERITY_LABELS: Record<Severity, string> = {
  info: "Constat",
  warning: "Anomalie",
  error: "Dommage",
};

export const HEALTH_LABELS: Record<Health, string> = {
  healthy: "Aucune anomalie relevée",
  suspicious: "Anomalies sans perte de contenu démontrée",
  damaged: "Structure ou contenu abîmés",
  unreadable: "Rien d'exploitable n'a pu être lu",
};

/**
 * Ce que chaque degré de réparabilité veut dire, en toutes lettres.
 *
 * C'est le vocabulaire de toute la phase : « réparé », « récupéré » et
 * « visuellement récupéré » ne sont pas des synonymes, et l'interface ne les
 * emploie jamais l'un pour l'autre.
 */
export const REPAIRABILITY_LABELS: Record<Repairability, string> = {
  none: "Aucune correction automatique défendable",
  safeRepair: "Réparation sans perte",
  recoverPartial: "Récupération partielle",
  recoverVisual: "Récupération visuelle",
};

async function invokeNative<T>(command: string, args: Record<string, unknown>): Promise<T> {
  if (!isTauri()) throw new Error(DIAGNOSTICS_NATIVE_REQUIRED);
  const { invoke } = await import("@tauri-apps/api/core");
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    const message =
      typeof error === "string" ? error : error instanceof Error ? error.message : "";
    throw new Error(message || "Le diagnostic a échoué.");
  }
}

export function isDiagnosticsAvailable(): boolean {
  return isTauri();
}

/** Diagnostic d'un fichier, quel que soit son type. */
export function inspectFile(path: string): Promise<DiagnosticReport> {
  return invokeNative<DiagnosticReport>("diagnostics_inspect", { path });
}

/** Chemin qui sera employé pour la sortie, sans rien écrire. */
export function outputPath(path: string, suffix: string, extension: string): Promise<string> {
  return invokeNative<string>("diagnostics_output_path", { path, suffix, extension });
}

/** Empreinte d'un fichier — sert à prouver qu'il n'a pas bougé. */
export function sha256(path: string): Promise<string> {
  return invokeNative<string>("diagnostics_sha256", { path });
}

export function fixExtension(path: string): Promise<string> {
  return invokeNative<string>("diagnostics_fix_extension", { path });
}

export function zipStripTrailing(path: string, destination: string): Promise<number> {
  return invokeNative<number>("diagnostics_zip_strip", { path, destination });
}

export interface ZipRecoveryResult {
  output: string;
  recovered: number;
  lost: number;
  recoveredBytes: number;
  entries: ZipScannedEntry[];
}

let sequence = 0;
function nextJobId(prefix: string): string {
  sequence += 1;
  return `${prefix}-${Date.now().toString(36)}-${sequence}`;
}

/** Récupération d'une archive, avec progression et annulation réelles. */
export async function zipRecover(
  path: string,
  destination: string,
  mode: "folder" | "archive",
  context?: { signal?: AbortSignal; report?: (update: { ratio?: number; label: string }) => void },
): Promise<ZipRecoveryResult> {
  if (!isTauri()) throw new Error(DIAGNOSTICS_NATIVE_REQUIRED);
  const { invoke } = await import("@tauri-apps/api/core");
  const { listen } = await import("@tauri-apps/api/event");

  const jobId = nextJobId("zip-recover");
  const unlisten = await listen<{ jobId: string; ratio: number; label: string }>(
    "files://progress",
    (event) => {
      if (event.payload.jobId !== jobId) return;
      context?.report?.({
        ratio: event.payload.ratio >= 0 ? event.payload.ratio : undefined,
        label: event.payload.label,
      });
    },
  );
  const onAbort = () => {
    void invoke("files_cancel", { jobId });
  };
  context?.signal?.addEventListener("abort", onAbort, { once: true });

  try {
    return await invoke<ZipRecoveryResult>("diagnostics_zip_recover", {
      jobId,
      path,
      destination,
      mode,
    });
  } catch (error) {
    const message =
      typeof error === "string" ? error : error instanceof Error ? error.message : "";
    throw new Error(message === "cancelled" ? "Récupération interrompue." : message);
  } finally {
    unlisten();
    context?.signal?.removeEventListener("abort", onAbort);
  }
}

export type PdfRepairAction = "stripTrailing" | "fixStartxref" | "rebuildXref";

export interface PdfRepairReport {
  output: string;
  action: string;
  removedBytes: number;
  addedBytes: number;
  indexedObjects: number;
  preserved: string[];
}

export function pdfRepair(
  path: string,
  action: PdfRepairAction,
  destination: string,
): Promise<PdfRepairReport> {
  return invokeNative<PdfRepairReport>("diagnostics_pdf_repair", { path, action, destination });
}

export interface ImageRecovery {
  output: string;
  width: number;
  height: number;
  lossless: boolean;
  steps: string[];
  outputSize: number;
}

export function imageRecover(path: string, destination: string): Promise<ImageRecovery> {
  return invokeNative<ImageRecovery>("diagnostics_image_recover", { path, destination });
}

/** Supprime un fichier que FourTout vient de produire, et lui seul. */
export function discardOutput(path: string): Promise<void> {
  return invokeNative<void>("diagnostics_discard", { request: { path } });
}

/* ------------------------------------------------------------------------ */
/* Vérification des sorties PDF                                              */
/* ------------------------------------------------------------------------ */

export interface PdfVerification {
  /** Le moteur PDF accepte-t-il de lire le fichier produit ? */
  readable: boolean;
  pages: number;
  /** Message du moteur en cas de refus. */
  error?: string;
}

/**
 * Rouvre un PDF avec pdf.js et compte ses pages.
 *
 * C'est la seule preuve que FourTout puisse apporter qu'une réparation a
 * abouti : le moteur qui servira à lire le document accepte de l'ouvrir. Sans
 * cette étape, « réparé » ne voudrait dire que « un fichier a été écrit ».
 */
export async function verifyPdf(path: string): Promise<PdfVerification> {
  try {
    const bytes = await readBytes(path);
    const name = path.split(/[\\/]/).pop() ?? "document.pdf";
    const document = await openWithPdfJs({ bytes, name });
    const pages = document.numPages;
    document.cleanup();
    return { readable: true, pages };
  } catch (error) {
    return {
      readable: false,
      pages: 0,
      error: error instanceof Error ? error.message : "Le moteur PDF refuse ce fichier.",
    };
  }
}

/** Comparaison de deux empreintes, pour l'affichage « source inchangée ». */
export function unchanged(before: string, after: string): boolean {
  return before.length > 0 && before === after;
}
