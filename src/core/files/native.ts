import { isTauri } from "@/core/platform";
import type { OperationContext } from "@/core/pdf/types";
import { JobCancelledError } from "@/core/jobs/types";

/**
 * Client du socle « Fichiers » natif.
 *
 * Les outils Fichiers travaillent sur des **chemins**, jamais sur des octets
 * transitant par la WebView : c'est ce qui rend une archive de 4 Go ou le
 * hachage d'une image disque possibles sans saturer la mémoire. Toutes les
 * opérations longues acceptent un `OperationContext` (progression, annulation)
 * et le relaient au processus natif, qui s'arrête réellement.
 */

/** Message renvoyé par le socle natif quand l'utilisateur a annulé. */
const NATIVE_CANCELLED = "cancelled";

export interface FilesProgress {
  jobId: string;
  ratio: number;
  label: string;
  done: number;
  total: number;
}

export type HashAlgorithm = "md5" | "sha1" | "sha256" | "sha512";

export interface FileHashes {
  path: string;
  name: string;
  size: number;
  /** `[["SHA-256", "ab12…"], …]`, dans l'ordre demandé. */
  digests: [string, string][];
}

export interface CompareResult {
  identical: boolean;
  sizeA: number;
  sizeB: number;
  firstDifference: number | null;
  bothText: boolean;
  sha256A: string;
  sha256B: string;
}

export interface FileInfo {
  path: string;
  name: string;
  extension: string;
  size: number;
  isDir: boolean;
  isSymlink: boolean;
  readOnly: boolean;
  modified: number;
  created: number;
  accessed: number;
  mime: string;
  magic: string;
  extensionMatches: boolean;
  looksLikeText: boolean;
}

export type ArchiveFormat = "zip" | "tar" | "tar-gz";

export interface ArchiveSummary {
  path: string;
  files: number;
  inputBytes: number;
  outputBytes: number;
}

export interface ArchiveEntry {
  name: string;
  size: number;
  compressedSize: number;
  isDir: boolean;
  rejected: string | null;
}

export interface ArchiveListing {
  format: string;
  entries: ArchiveEntry[];
  files: number;
  totalSize: number;
  archiveSize: number;
  rejected: number;
  suspicious: boolean;
}

export interface ExtractSummary {
  destination: string;
  extracted: number;
  skipped: string[];
  bytes: number;
}

export interface FileEntry {
  path: string;
  name: string;
  size: number;
}

export interface ExtensionStat {
  extension: string;
  files: number;
  bytes: number;
}

export interface FolderStats {
  path: string;
  totalBytes: number;
  files: number;
  directories: number;
  symlinks: number;
  largest: FileEntry[];
  byExtension: ExtensionStat[];
  children: FileEntry[];
  unreadable: string[];
}

export interface TreeOptions {
  maxDepth: number;
  includeHidden: boolean;
  directoriesOnly: boolean;
  ignore: string[];
  showSizes: boolean;
}

export interface TreeResult {
  text: string;
  files: number;
  directories: number;
  truncated: boolean;
}

export interface DuplicateOptions {
  minSize: number;
  includeHidden: boolean;
}

export interface DuplicateGroup {
  hash: string;
  size: number;
  files: FileEntry[];
  reclaimable: number;
}

export interface DuplicateReport {
  root: string;
  scanned: number;
  groups: DuplicateGroup[];
  duplicateFiles: number;
  reclaimable: number;
}

export interface SplitSummary {
  directory: string;
  parts: string[];
  manifestPath: string;
  totalSize: number;
  sha256: string;
}

export interface JoinSummary {
  path: string;
  parts: number;
  totalSize: number;
  sha256: string;
  verified: boolean;
  warning: string | null;
}

export type CaseRule = "keep" | "lower" | "upper" | "title";

export interface RenameRules {
  prefix: string;
  suffix: string;
  find: string;
  replace: string;
  trimStart: number;
  trimEnd: number;
  numbering: boolean;
  numberStart: number;
  numberPadding: number;
  numberPosition: "prefix" | "suffix";
  caseRule: CaseRule;
  lowercaseExtension: boolean;
  sanitize: boolean;
}

export const DEFAULT_RENAME_RULES: RenameRules = {
  prefix: "",
  suffix: "",
  find: "",
  replace: "",
  trimStart: 0,
  trimEnd: 0,
  numbering: false,
  numberStart: 1,
  numberPadding: 3,
  numberPosition: "suffix",
  caseRule: "keep",
  lowercaseExtension: false,
  sanitize: false,
};

export interface RenamePlanEntry {
  path: string;
  from: string;
  to: string;
  problem: string | null;
  changed: boolean;
}

export interface RenamePlan {
  entries: RenamePlanEntry[];
  changed: number;
  problems: number;
}

export interface RenameOutcome {
  renamed: number;
  skipped: number;
  errors: string[];
}

export interface DocxMetadata {
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string;
  created?: string;
  modified?: string;
  lastModifiedBy?: string;
  application?: string;
  pages?: string;
  words?: string;
}

export interface DocxResult {
  text: string;
  html: string;
  markdown: string;
  metadata: DocxMetadata;
  blocks: number;
  tables: number;
  images: number;
  dropped: string[];
}

/** Les outils Fichiers exigent l'application installée. */
export function isFilesEngineAvailable(): boolean {
  return isTauri();
}

export const NATIVE_REQUIRED =
  "Cet outil travaille directement sur vos fichiers et nécessite l'application FourTout installée. Il n'est pas disponible dans l'aperçu navigateur.";

let sequence = 0;
function nextJobId(prefix: string): string {
  sequence += 1;
  return `${prefix}-${Date.now().toString(36)}-${sequence}`;
}

/**
 * Exécute une commande native longue : elle publie sa progression et répond
 * réellement à l'annulation (le travail natif est interrompu, pas ignoré).
 */
async function runJob<T>(
  prefix: string,
  command: string,
  args: (jobId: string) => Record<string, unknown>,
  context?: OperationContext,
): Promise<T> {
  if (!isTauri()) throw new Error(NATIVE_REQUIRED);
  const { invoke } = await import("@tauri-apps/api/core");
  const { listen } = await import("@tauri-apps/api/event");

  const jobId = nextJobId(prefix);
  const unlisten = await listen<FilesProgress>("files://progress", (event) => {
    if (event.payload.jobId !== jobId) return;
    context?.report?.({
      ratio: event.payload.ratio >= 0 ? event.payload.ratio : undefined,
      label: event.payload.label,
    });
  });

  const onAbort = () => {
    void invoke("files_cancel", { jobId });
  };
  context?.signal?.addEventListener("abort", onAbort, { once: true });

  try {
    return await invoke<T>(command, args(jobId));
  } catch (error) {
    const message = typeof error === "string" ? error : error instanceof Error ? error.message : "";
    if (message === NATIVE_CANCELLED || context?.signal?.aborted) throw new JobCancelledError();
    throw new Error(message || "L'opération a échoué.");
  } finally {
    unlisten();
    context?.signal?.removeEventListener("abort", onAbort);
  }
}

/* ------------------------------------------------------------ empreintes */

export function hashFiles(
  paths: string[],
  algorithms: HashAlgorithm[],
  context?: OperationContext,
): Promise<FileHashes[]> {
  return runJob("hash", "files_hash", (jobId) => ({ params: { jobId, paths, algorithms } }), context);
}

export function compareFiles(
  pathA: string,
  pathB: string,
  context?: OperationContext,
): Promise<CompareResult> {
  return runJob("compare", "files_compare", (jobId) => ({ jobId, pathA, pathB }), context);
}

export async function fileInfo(path: string): Promise<FileInfo> {
  if (!isTauri()) throw new Error(NATIVE_REQUIRED);
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<FileInfo>("files_info", { path });
}

/* --------------------------------------------------------------- archives */

export function createArchive(
  paths: string[],
  output: string,
  format: ArchiveFormat,
  level: number,
  context?: OperationContext,
): Promise<ArchiveSummary> {
  return runJob(
    "archive",
    "files_archive_create",
    (jobId) => ({ params: { jobId, paths, output, format, level } }),
    context,
  );
}

export async function listArchive(path: string): Promise<ArchiveListing> {
  if (!isTauri()) throw new Error(NATIVE_REQUIRED);
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<ArchiveListing>("files_archive_list", { path });
}

export function extractArchive(
  path: string,
  destination: string,
  overwrite: boolean,
  context?: OperationContext,
): Promise<ExtractSummary> {
  return runJob(
    "extract",
    "files_archive_extract",
    (jobId) => ({ jobId, path, destination, overwrite }),
    context,
  );
}

/* --------------------------------------------------------------- dossiers */

export function folderStats(path: string, context?: OperationContext): Promise<FolderStats> {
  return runJob("folder", "files_folder_stats", (jobId) => ({ jobId, path }), context);
}

export function folderTree(
  path: string,
  options: TreeOptions,
  context?: OperationContext,
): Promise<TreeResult> {
  return runJob("tree", "files_tree", (jobId) => ({ jobId, path, options }), context);
}

export function findDuplicates(
  path: string,
  options: DuplicateOptions,
  context?: OperationContext,
): Promise<DuplicateReport> {
  return runJob("dupes", "files_duplicates", (jobId) => ({ jobId, path, options }), context);
}

/* ------------------------------------------------------- découpe / fusion */

export function splitFile(
  path: string,
  destination: string,
  partSize: number,
  context?: OperationContext,
): Promise<SplitSummary> {
  return runJob("split", "files_split", (jobId) => ({ jobId, path, destination, partSize }), context);
}

export function joinFile(
  path: string,
  destination: string,
  context?: OperationContext,
): Promise<JoinSummary> {
  return runJob("join", "files_join", (jobId) => ({ jobId, path, destination }), context);
}

/* ------------------------------------------------------------- renommage */

export async function renamePlan(paths: string[], rules: RenameRules): Promise<RenamePlan> {
  if (!isTauri()) throw new Error(NATIVE_REQUIRED);
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<RenamePlan>("files_rename_plan", { paths, rules });
}

export async function renameApply(paths: string[], rules: RenameRules): Promise<RenameOutcome> {
  if (!isTauri()) throw new Error(NATIVE_REQUIRED);
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<RenameOutcome>("files_rename_apply", { paths, rules });
}

/* ------------------------------------------------------------------ DOCX */

export async function readDocx(path: string): Promise<DocxResult> {
  if (!isTauri()) throw new Error(NATIVE_REQUIRED);
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<DocxResult>("files_docx_read", { path });
}

export async function readTextFile(path: string, maxBytes = 0): Promise<string> {
  if (!isTauri()) throw new Error(NATIVE_REQUIRED);
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string>("files_read_text", { path, maxBytes });
}

export async function writeTextFile(path: string, content: string): Promise<void> {
  if (!isTauri()) throw new Error(NATIVE_REQUIRED);
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("files_write_text", { path, content });
}

/* ------------------------------------------------------ boîtes de dialogue */

/** Sélection de fichiers via la boîte de dialogue native. */
export async function pickFiles(options?: {
  multiple?: boolean;
  title?: string;
  filters?: { name: string; extensions: string[] }[];
}): Promise<string[]> {
  if (!isTauri()) throw new Error(NATIVE_REQUIRED);
  const { open } = await import("@tauri-apps/plugin-dialog");
  const selection = await open({
    multiple: options?.multiple ?? false,
    directory: false,
    title: options?.title,
    filters: options?.filters,
  });
  if (selection === null) return [];
  return Array.isArray(selection) ? selection : [selection];
}

/** Sélection d'un dossier via la boîte de dialogue native. */
export async function pickDirectory(title?: string): Promise<string | undefined> {
  if (!isTauri()) throw new Error(NATIVE_REQUIRED);
  const { open } = await import("@tauri-apps/plugin-dialog");
  const selection = await open({ directory: true, multiple: false, title });
  return typeof selection === "string" ? selection : undefined;
}

/** Choix d'un emplacement d'enregistrement. */
export async function pickSavePath(
  defaultName: string,
  filters?: { name: string; extensions: string[] }[],
): Promise<string | undefined> {
  if (!isTauri()) throw new Error(NATIVE_REQUIRED);
  const { save } = await import("@tauri-apps/plugin-dialog");
  const path = await save({ defaultPath: defaultName, filters });
  return path ?? undefined;
}
