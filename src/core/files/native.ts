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

/** Fragment de résultat publié en cours d'opération. */
export interface FilesPartial<T> {
  jobId: string;
  payload: T;
}

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
  /** Identifiant du type réel, déduit des premiers octets (« png », « 7z »…). */
  magic: string;
  /** Libellé français du type détecté. */
  magicLabel: string;
  /** Famille du contenu : c'est elle qui décide de l'aperçu proposé. */
  family: FileFamily;
  /** L'extension du nom correspond-elle au contenu réel ? */
  extensionMatches: boolean;
  looksLikeText: boolean;
}

/** Grande famille d'un fichier, telle que la table de signatures la voit. */
export type FileFamily =
  | "document"
  | "image"
  | "audio"
  | "video"
  | "archive"
  | "executable"
  | "data"
  | "text"
  | "unknown";

export type ArchiveFormat = "zip" | "tar" | "tar-gz" | "tar-xz" | "seven-z";

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
  /** Au moins une entrée est protégée par mot de passe. */
  encrypted: boolean;
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
async function runJob<T, TPartial = unknown>(
  prefix: string,
  command: string,
  args: (jobId: string) => Record<string, unknown>,
  context?: OperationContext,
  onPartial?: (payload: TPartial) => void,
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

  // Certaines opérations publient leurs résultats par lots avant d'avoir fini
  // (la recherche, notamment). On ne s'abonne que si l'appelant le demande.
  const unlistenPartial = onPartial
    ? await listen<FilesPartial<TPartial>>("files://partial", (event) => {
        if (event.payload.jobId !== jobId) return;
        onPartial(event.payload.payload);
      })
    : undefined;

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
    unlistenPartial?.();
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

/* ------------------------------------------------ archives protégées */

/**
 * Archive ZIP chiffrée en **WinZip AES-256**, le format que lisent 7-Zip,
 * WinRAR, PeaZip et l'Explorateur de Windows. Le « ZipCrypto » historique
 * n'est jamais utilisé : il se casse à partir de quelques octets de clair connu.
 *
 * Le mot de passe traverse l'IPC une seule fois et n'est jamais conservé.
 */
export function createEncryptedArchive(
  paths: string[],
  output: string,
  level: number,
  password: string,
  context?: OperationContext,
): Promise<ArchiveSummary> {
  return runJob(
    "archive-aes",
    "files_archive_create_encrypted",
    (jobId) => ({ params: { jobId, paths, output, level, password } }),
    context,
  );
}

export function extractEncryptedArchive(
  path: string,
  destination: string,
  overwrite: boolean,
  password: string,
  context?: OperationContext,
): Promise<ExtractSummary> {
  return runJob(
    "extract-aes",
    "files_archive_extract_encrypted",
    (jobId) => ({ jobId, path, destination, overwrite, password }),
    context,
  );
}

/* ------------------------------------------------------------ chiffrement */

export interface CryptoSummary {
  path: string;
  inputBytes: number;
  outputBytes: number;
}

/** Extension des fichiers produits par le chiffrement. */
export const ENCRYPTED_EXTENSION = "ftenc";

export function encryptFiles(
  sources: string[],
  destination: string | undefined,
  password: string,
  context?: OperationContext,
): Promise<CryptoSummary[]> {
  return runJob(
    "encrypt",
    "files_encrypt",
    (jobId) => ({ jobId, request: { sources, destination, password } }),
    context,
  );
}

export function decryptFiles(
  sources: string[],
  destination: string | undefined,
  password: string,
  context?: OperationContext,
): Promise<CryptoSummary[]> {
  return runJob(
    "decrypt",
    "files_decrypt",
    (jobId) => ({ jobId, request: { sources, destination, password } }),
    context,
  );
}

/* ------------------------------------------------- rangement et effacement */

export interface OrganizeMove {
  name: string;
  from: string;
  category: string;
  /** Chemin relatif au dossier analysé, séparateurs `/`. */
  to: string;
  size: number;
}

export interface OrganizeCategory {
  name: string;
  files: number;
  bytes: number;
}

export interface OrganizePlan {
  root: string;
  moves: OrganizeMove[];
  skipped: string[];
  categories: OrganizeCategory[];
}

export interface OrganizeSummary {
  moved: number;
  renamed: number;
  failed: string[];
}

/** Analyse un dossier et **propose** un rangement. Rien n'est déplacé. */
export function organizePlan(
  root: string,
  recursive: boolean,
  context?: OperationContext,
): Promise<OrganizePlan> {
  return runJob(
    "organize-plan",
    "files_organize_plan",
    (jobId) => ({ jobId, request: { root, recursive } }),
    context,
  );
}

/** Applique un plan validé par l'utilisateur, et lui seul. */
export function organizeApply(
  root: string,
  moves: { from: string; to: string }[],
  context?: OperationContext,
): Promise<OrganizeSummary> {
  return runJob(
    "organize-apply",
    "files_organize_apply",
    (jobId) => ({ jobId, request: { root, moves } }),
    context,
  );
}

export type WipeMode = "random" | "three-pass" | "none";

export interface WipeOutcome {
  path: string;
  bytes: number;
  passes: number;
  error: string | null;
}

export interface WipeSummary {
  deleted: number;
  failed: number;
  bytes: number;
  results: WipeOutcome[];
  notice: string;
}

/**
 * Phrase de confirmation exigée par la couche native. Elle voyage jusqu'au
 * processus natif pour qu'un effacement ne puisse pas être déclenché par un
 * simple clic égaré depuis l'interface.
 */
export const WIPE_CONFIRMATION = "SUPPRIMER DEFINITIVEMENT";

export function secureDelete(
  paths: string[],
  mode: WipeMode,
  confirmation: string,
  context?: OperationContext,
): Promise<WipeSummary> {
  return runJob(
    "wipe",
    "files_secure_delete",
    (jobId) => ({ jobId, request: { paths, mode, confirmation } }),
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

/**
 * Octets bruts d'un fichier, pour un aperçu.
 *
 * Le retour est un `ArrayBuffer` : les octets traversent l'IPC tels quels au
 * lieu d'être encodés en tableau JSON, ce qui rend l'aperçu d'un MP4 de 40 Mo
 * instantané plutôt qu'insupportable.
 */
export async function readBytes(path: string, maxBytes = 0): Promise<Uint8Array> {
  if (!isTauri()) throw new Error(NATIVE_REQUIRED);
  const { invoke } = await import("@tauri-apps/api/core");
  const buffer = await invoke<ArrayBuffer>("files_read_bytes", { path, maxBytes });
  return new Uint8Array(buffer);
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

/* ============================================================================
 * Phase 9 — dossiers, intégrité, archives
 *
 * Chaque capacité ci-dessous est une **fonction**, pas un écran : comparer deux
 * dossiers, calculer un plan de synchronisation ou vérifier un manifeste se
 * fait sans passer par React. Un appelant automatisé futur n'aura donc jamais à
 * simuler des clics — il appellera exactement ce que l'interface appelle.
 * ========================================================================== */

/* --------------------------------------------- comparaison de dossiers */

export type CompareMode = "quick" | "reliable";
export type SymlinkPolicy = "report" | "skip" | "follow-inside";

export interface WalkOptions {
  recursive: boolean;
  includeHidden: boolean;
  symlinks: SymlinkPolicy;
}

export const DEFAULT_WALK_OPTIONS: WalkOptions = {
  recursive: true,
  includeHidden: false,
  symlinks: "report",
};

export interface WalkNotes {
  symlinks: string[];
  unreadable: string[];
  files: number;
  directories: number;
  bytes: number;
}

export type CompareEntryStatus =
  | "same"
  | "different"
  | "left-only"
  | "right-only"
  | "type-conflict";

export interface FolderCompareEntry {
  relative: string;
  status: CompareEntryStatus;
  isDir: boolean;
  leftSize: number | null;
  rightSize: number | null;
  leftModified: number | null;
  rightModified: number | null;
  reason: string;
  /** Le contenu a-t-il réellement été lu pour conclure ? */
  contentChecked: boolean;
}

export interface FolderCompareReport {
  left: string;
  right: string;
  mode: CompareMode;
  entries: FolderCompareEntry[];
  same: number;
  different: number;
  leftOnly: number;
  rightOnly: number;
  typeConflicts: number;
  hashedBytes: number;
  leftNotes: WalkNotes;
  rightNotes: WalkNotes;
  caseCollisions: string[];
}

export interface FolderCompareRequest {
  left: string;
  right: string;
  mode: CompareMode;
  walk: WalkOptions;
}

export function compareFolders(
  request: FolderCompareRequest,
  context?: OperationContext,
): Promise<FolderCompareReport> {
  return runJob("folder-compare", "files_folder_compare", (jobId) => ({ jobId, request }), context);
}

/* -------------------------------------------------------- synchronisation */

export type SyncMode = "update" | "mirror";
export type SyncChangeTest = "size-and-date" | "content";
export type SyncAction = "create-directory" | "copy" | "replace" | "delete" | "delete-directory";

export interface SyncOperation {
  action: SyncAction;
  relative: string;
  size: number;
  sourceModified: number;
  reason: string;
}

export interface SyncPlan {
  source: string;
  destination: string;
  mode: SyncMode;
  operations: SyncOperation[];
  directories: number;
  copies: number;
  replacements: number;
  deletions: number;
  unchanged: number;
  bytes: number;
  freedBytes: number;
  sourceNotes: WalkNotes;
  destinationNotes: WalkNotes;
  warnings: string[];
}

export interface SyncOutcome {
  completed: number;
  total: number;
  copied: number;
  replaced: number;
  deleted: number;
  directoriesCreated: number;
  bytes: number;
  failed: string[];
  changedSincePlan: string[];
  interrupted: boolean;
}

export interface SyncRequest {
  source: string;
  destination: string;
  mode: SyncMode;
  test: SyncChangeTest;
  walk: WalkOptions;
}

/** Calcule le plan. **N'écrit rien** : c'est le « dry-run » de l'outil. */
export function buildSyncPlan(
  request: SyncRequest,
  context?: OperationContext,
): Promise<SyncPlan> {
  return runJob("sync-plan", "files_sync_plan", (jobId) => ({ jobId, request }), context);
}

/**
 * Exécute **exactement** le plan reçu.
 *
 * Le plan est transmis tel quel plutôt que recalculé : ce que l'utilisateur a
 * lu et confirmé est ce qui sera fait, y compris si le disque a bougé entre
 * les deux — auquel cas l'opération concernée est refusée et rapportée.
 */
export function executeSyncPlan(
  plan: SyncPlan,
  context?: OperationContext,
): Promise<SyncOutcome> {
  return runJob(
    "sync-apply",
    "files_sync_apply",
    (jobId) => ({
      jobId,
      source: plan.source,
      destination: plan.destination,
      operations: plan.operations,
    }),
    context,
  );
}

/** La synchronisation a-t-elle réellement abouti, en entier ? */
export function syncIsComplete(outcome: SyncOutcome): boolean {
  return !outcome.interrupted && outcome.failed.length === 0 && outcome.changedSincePlan.length === 0;
}

/* -------------------------------------------------------------- recherche */

export interface SearchQuery {
  root: string;
  name: string;
  extensions: string[];
  minSize: number | null;
  maxSize: number | null;
  modifiedAfter: number | null;
  modifiedBefore: number | null;
  content: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  walk: WalkOptions;
  maxResults: number | null;
}

export const DEFAULT_SEARCH_QUERY: Omit<SearchQuery, "root"> = {
  name: "",
  extensions: [],
  minSize: null,
  maxSize: null,
  modifiedAfter: null,
  modifiedBefore: null,
  content: "",
  caseSensitive: false,
  wholeWord: false,
  walk: DEFAULT_WALK_OPTIONS,
  maxResults: 5000,
};

export interface SearchHit {
  path: string;
  relative: string;
  name: string;
  size: number;
  modified: number;
  extension: string;
  reason: string;
  line: number | null;
  excerpt: string | null;
  matches: number;
  encoding: string | null;
}

export interface SearchReport {
  root: string;
  hits: SearchHit[];
  scannedFiles: number;
  scannedDirectories: number;
  readFiles: number;
  binarySkipped: number;
  tooLarge: number;
  truncated: boolean;
  warnings: string[];
}

/**
 * Recherche dans un dossier. `onBatch` reçoit les résultats **au fil de l'eau**,
 * bien avant la fin du parcours : c'est ce qui rend l'attente supportable sur
 * une arborescence de plusieurs dizaines de milliers de fichiers.
 */
export function searchFiles(
  query: SearchQuery,
  context?: OperationContext,
  onBatch?: (hits: SearchHit[]) => void,
): Promise<SearchReport> {
  return runJob("search", "files_search", (jobId) => ({ jobId, query }), context, onBatch);
}

/* ------------------------------------------------------------ hexadécimal */

export interface HexWindow {
  path: string;
  offset: number;
  fileSize: number;
  bytes: number[];
}

export interface HexPatch {
  offset: number;
  bytes: number[];
}

export interface HexWriteSummary {
  path: string;
  size: number;
  patchedBytes: number;
  patches: number;
  inPlace: boolean;
}

/** Taille maximale d'une fenêtre, alignée sur la limite du moteur natif. */
export const HEX_MAX_WINDOW = 64 * 1024;

export async function readHex(path: string, offset: number, length: number): Promise<HexWindow> {
  if (!isTauri()) throw new Error(NATIVE_REQUIRED);
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<HexWindow>("files_hex_read", { path, offset, length });
}

export function findHex(
  path: string,
  pattern: number[],
  from: number,
  context?: OperationContext,
): Promise<number | null> {
  return runJob("hex-find", "files_hex_find", (jobId) => ({ jobId, path, pattern, from }), context);
}

/**
 * Écrit les octets modifiés. Par défaut `destination` diffère de `source` :
 * l'original reste intact, et l'écrasement doit être demandé explicitement.
 */
export function writeHex(
  source: string,
  destination: string,
  patches: HexPatch[],
  context?: OperationContext,
): Promise<HexWriteSummary> {
  return runJob(
    "hex-write",
    "files_hex_write",
    (jobId) => ({ jobId, source, destination, patches }),
    context,
  );
}

/* ------------------------------------------------------------ sauvegarde */

export type RestoreMode = "skip" | "overwrite";

export interface BackupSummary {
  destination: string;
  manifestPath: string;
  files: number;
  directories: number;
  bytes: number;
  warnings: string[];
  failed: string[];
  interrupted: boolean;
}

export type BackupEntryState = "ok" | "missing" | "modified" | "unreadable";

export interface BackupCheck {
  path: string;
  state: BackupEntryState;
  expected: string;
  actual: string | null;
  size: number;
}

export interface BackupVerifyReport {
  backup: string;
  createdAt: number;
  sourceName: string;
  checks: BackupCheck[];
  ok: number;
  missing: number;
  modified: number;
  unreadable: number;
  unexpected: string[];
  bytes: number;
}

export interface RestorePreview {
  backup: string;
  sourceName: string;
  createdAt: number;
  files: number;
  directories: number;
  bytes: number;
  collisions: string[];
  warnings: string[];
}

export interface RestoreSummary {
  destination: string;
  restored: number;
  skipped: string[];
  failed: string[];
  bytes: number;
  interrupted: boolean;
  corrupted: string[];
}

export function createBackup(
  source: string,
  destination: string,
  walk: WalkOptions = DEFAULT_WALK_OPTIONS,
  context?: OperationContext,
): Promise<BackupSummary> {
  return runJob(
    "backup",
    "files_backup_create",
    (jobId) => ({ jobId, request: { source, destination, walk } }),
    context,
  );
}

export function verifyBackup(
  path: string,
  context?: OperationContext,
): Promise<BackupVerifyReport> {
  return runJob("backup-verify", "files_backup_verify", (jobId) => ({ jobId, path }), context);
}

export function previewRestore(
  path: string,
  destination: string,
  context?: OperationContext,
): Promise<RestorePreview> {
  return runJob(
    "backup-preview",
    "files_backup_preview",
    (jobId) => ({ jobId, path, destination }),
    context,
  );
}

export function restoreBackup(
  path: string,
  destination: string,
  mode: RestoreMode,
  context?: OperationContext,
): Promise<RestoreSummary> {
  return runJob(
    "backup-restore",
    "files_backup_restore",
    (jobId) => ({ jobId, path, destination, mode }),
    context,
  );
}

export function backupIsIntact(report: BackupVerifyReport): boolean {
  return report.missing === 0 && report.modified === 0 && report.unreadable === 0;
}

/* --------------------------------------------------- manifestes et HMAC */

export type ManifestFormat = "text" | "json";

export interface ManifestEntry {
  relative: string;
  digest: string;
  size: number;
}

export interface ManifestSummary {
  output: string;
  algorithm: string;
  entries: ManifestEntry[];
  files: number;
  bytes: number;
  errors: string[];
  /** Rappel affiché quand l'algorithme choisi n'est plus sûr. */
  legacyWarning: string | null;
}

export type ChecksumStatus = "ok" | "mismatch" | "missing" | "unreadable" | "refused";

export interface ChecksumResult {
  relative: string;
  status: ChecksumStatus;
  expected: string;
  actual: string | null;
  size: number;
  detail: string | null;
}

export interface ChecksumVerifyReport {
  manifest: string;
  root: string;
  algorithm: string;
  results: ChecksumResult[];
  ok: number;
  mismatched: number;
  missing: number;
  unreadable: number;
  refused: number;
  legacyWarning: string | null;
}

export function checksumsAreValid(report: ChecksumVerifyReport): boolean {
  return (
    report.mismatched === 0 &&
    report.missing === 0 &&
    report.unreadable === 0 &&
    report.refused === 0
  );
}

export function createManifest(
  request: {
    root: string;
    files?: string[];
    algorithm: HashAlgorithm;
    format: ManifestFormat;
    output: string;
    walk?: WalkOptions;
  },
  context?: OperationContext,
): Promise<ManifestSummary> {
  return runJob(
    "manifest",
    "files_manifest_create",
    (jobId) => ({
      jobId,
      request: {
        files: [],
        walk: DEFAULT_WALK_OPTIONS,
        ...request,
      },
    }),
    context,
  );
}

export function verifyManifest(
  manifestPath: string,
  root: string,
  context?: OperationContext,
): Promise<ChecksumVerifyReport> {
  return runJob(
    "manifest-verify",
    "files_manifest_verify",
    (jobId) => ({ jobId, manifestPath, root }),
    context,
  );
}

export type HmacAlgorithm = "sha1" | "sha256" | "sha512";

export interface HmacResult {
  algorithm: string;
  hex: string;
  base64: string;
  bytes: number;
}

/**
 * HMAC d'un texte. La clé traverse l'IPC une seule fois : elle n'est ni
 * journalisée, ni écrite dans les récents, ni conservée après l'appel.
 */
export async function hmacText(
  algorithm: HmacAlgorithm,
  key: string,
  text: string,
): Promise<HmacResult> {
  if (!isTauri()) throw new Error(NATIVE_REQUIRED);
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<HmacResult>("files_hmac_text", { algorithm, key, text });
}

export function hmacFile(
  algorithm: HmacAlgorithm,
  key: string,
  path: string,
  context?: OperationContext,
): Promise<HmacResult> {
  return runJob(
    "hmac",
    "files_hmac_file",
    (jobId) => ({ jobId, algorithm, key, path }),
    context,
  );
}

/* -------------------------------------------- compression d'un fichier */

export type StreamFormat = "gz" | "xz";

export interface StreamSummary {
  input: string;
  output: string;
  format: string;
  inputBytes: number;
  outputBytes: number;
  ratio: number;
}

export function compressStream(
  input: string,
  output: string,
  format: StreamFormat,
  level: number,
  context?: OperationContext,
): Promise<StreamSummary> {
  return runJob(
    "stream-compress",
    "files_stream_compress",
    (jobId) => ({ jobId, input, output, format, level }),
    context,
  );
}

export function decompressStream(
  input: string,
  output: string,
  format: StreamFormat,
  context?: OperationContext,
): Promise<StreamSummary> {
  return runJob(
    "stream-decompress",
    "files_stream_decompress",
    (jobId) => ({ jobId, input, output, format }),
    context,
  );
}

/** Décompresse entièrement sans rien écrire : le seul test honnête d'un flux. */
export function testStream(
  input: string,
  format: StreamFormat,
  context?: OperationContext,
): Promise<number> {
  return runJob("stream-test", "files_stream_test", (jobId) => ({ jobId, input, format }), context);
}

export async function suggestStreamOutput(
  input: string,
  format: StreamFormat,
  compressing: boolean,
): Promise<string> {
  if (!isTauri()) throw new Error(NATIVE_REQUIRED);
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string>("files_stream_suggest", { input, format, compressing });
}

/* --------------------------------------------------- intégrité d'archive */

export type ArchiveVerdict = "valid" | "corrupt" | "incomplete" | "encrypted" | "unsupported";

export interface ArchiveIntegrityReport {
  path: string;
  format: string;
  verdict: ArchiveVerdict;
  checked: number;
  bytes: number;
  failures: string[];
  detail: string;
}

export function testArchive(
  path: string,
  password: string | null,
  context?: OperationContext,
): Promise<ArchiveIntegrityReport> {
  return runJob(
    "archive-test",
    "files_archive_test",
    (jobId) => ({ jobId, path, password }),
    context,
  );
}
