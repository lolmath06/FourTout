import { isTauri } from "@/core/platform";
import { JobCancelledError } from "@/core/jobs/types";
import type { OperationContext } from "@/core/pdf/types";
import { msg, t } from "@/i18n";

/**
 * Client des outils Internet et des nouveaux moteurs natifs.
 *
 * Toute requête réseau part du processus natif (Rust), jamais de la WebView :
 * la politique de sécurité de contenu reste fermée (`connect-src 'self'`), et
 * l'adresse, la réponse et les octets transférés ne traversent pas du code web.
 *
 * Les erreurs natives sont structurées (`kind`, `message`, `status`) : l'interface
 * peut réagir à leur genre sans analyser un texte.
 */

export const INTERNET_NATIVE_REQUIRED = msg(
  "Cet outil nécessite l'application FourTout installée : les connexions Internet partent du moteur natif, pas du navigateur.",
);

export type InternetErrorKind =
  | "invalid-url"
  | "unsupported-scheme"
  | "dns"
  | "timeout"
  | "refused"
  | "tls"
  | "status"
  | "redirect"
  | "range-mismatch"
  | "destination"
  | "write"
  | "incomplete"
  | "checksum"
  | "cancelled"
  | "unsupported"
  | "unavailable"
  | "login-required"
  | "drm"
  | "tool-missing"
  | "ffmpeg-missing"
  | "other";

export class InternetClientError extends Error {
  constructor(
    message: string,
    readonly kind: InternetErrorKind,
    readonly status?: number,
  ) {
    super(message);
    this.name = "InternetClientError";
  }
}

/** Convertit ce qu'`invoke` rejette (objet structuré ou texte) en erreur typée. */
export function toClientError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (typeof error === "string") {
    return error === "cancelled" ? new JobCancelledError() : new InternetClientError(error, "other");
  }
  if (error && typeof error === "object" && "message" in error) {
    const { kind, message, status } = error as { kind?: InternetErrorKind; message: string; status?: number | null };
    if (kind === "cancelled" || message === "cancelled") return new JobCancelledError();
    return new InternetClientError(message, kind ?? "other", status ?? undefined);
  }
  return new InternetClientError(t("L'opération a échoué."), "other");
}

export interface TransferProgress {
  done: number;
  total: number;
  ratio?: number;
}

let sequence = 0;
function nextJobId(prefix: string): string {
  sequence += 1;
  return `${prefix}-${Date.now().toString(36)}-${sequence}`;
}

export function isInternetAvailable(): boolean {
  return isTauri();
}

interface JobOptions<TEvent> {
  /** Événement personnalisé en plus de `files://progress`. */
  event?: string;
  onEvent?: (payload: TEvent) => void;
  onTransfer?: (progress: TransferProgress) => void;
}

/**
 * Exécute une commande native longue : progression, annulation réelle (le
 * processus et ses enfants sont tués), erreurs structurées.
 */
export async function runNative<T, TEvent = unknown>(
  prefix: string,
  command: string,
  args: (jobId: string) => Record<string, unknown>,
  context?: OperationContext,
  options: JobOptions<TEvent> = {},
): Promise<T> {
  if (!isTauri()) throw new Error(t(INTERNET_NATIVE_REQUIRED));
  const { invoke } = await import("@tauri-apps/api/core");
  const { listen } = await import("@tauri-apps/api/event");
  const jobId = nextJobId(prefix);

  const unlistenFiles = await listen<{ jobId: string; ratio: number; label: string; done: number; total: number }>(
    "files://progress",
    (event) => {
      if (event.payload.jobId !== jobId) return;
      const ratio = event.payload.ratio >= 0 ? event.payload.ratio : undefined;
      context?.report?.({ ratio });
      options.onTransfer?.({ done: event.payload.done, total: event.payload.total, ratio });
    },
  );
  const unlistenCustom =
    options.event && options.onEvent
      ? await listen<TEvent & { jobId: string }>(options.event, (event) => {
          if (event.payload.jobId === jobId) options.onEvent?.(event.payload);
        })
      : undefined;

  const onAbort = () => {
    void invoke("files_cancel", { jobId });
  };
  context?.signal?.addEventListener("abort", onAbort, { once: true });

  try {
    return await invoke<T>(command, args(jobId));
  } catch (error) {
    if (context?.signal?.aborted) throw new JobCancelledError();
    throw toClientError(error);
  } finally {
    unlistenFiles();
    unlistenCustom?.();
    context?.signal?.removeEventListener("abort", onAbort);
  }
}

/** Appel court, sans progression. */
export async function callNative<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!isTauri()) throw new Error(t(INTERNET_NATIVE_REQUIRED));
  const { invoke } = await import("@tauri-apps/api/core");
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw toClientError(error);
  }
}

/* --------------------------------------------------------------- téléchargement */

export interface Probe {
  requestedUrl: string;
  finalUrl: string;
  redirects: number;
  status: number;
  mime: string | null;
  size: number | null;
  filename: string;
  acceptsRanges: boolean;
  etag: string | null;
  lastModified: string | null;
}

export interface DownloadSummary {
  path: string;
  bytes: number;
  sha256: string;
  resumedFrom: number;
  finalUrl: string;
  mime: string | null;
  elapsedMs: number;
  bytesPerSecond: number;
  restarted: boolean;
}

export const probeUrl = (url: string, timeoutSecs?: number) =>
  callNative<Probe>("internet_probe", { url, timeoutSecs });

export function downloadUrl(
  params: { url: string; destination: string; overwrite: boolean; resume: boolean; expectedSha256?: string; timeoutSecs?: number },
  context?: OperationContext,
  onTransfer?: (progress: TransferProgress) => void,
): Promise<DownloadSummary> {
  return runNative("download", "internet_download", (jobId) => ({ params: { jobId, ...params } }), context, { onTransfer });
}

/* ------------------------------------------------------------------- débit */

export interface SpeedResult {
  endpoint: string;
  server: string | null;
  latencyMs: number | null;
  jitterMs: number | null;
  latencySamples: number;
  downloadMbps: number | null;
  uploadMbps: number | null;
  downloadBytes: number;
  uploadBytes: number;
  durationMs: number;
}

export interface SpeedProgress {
  phase: "latency" | "download" | "upload";
  mbps: number;
  ratio: number;
}

export function runSpeedTest(context?: OperationContext, onProgress?: (progress: SpeedProgress) => void): Promise<SpeedResult> {
  return runNative<SpeedResult, SpeedProgress>("speed", "internet_speedtest", (jobId) => ({ jobId }), context, {
    event: "internet://speed",
    onEvent: onProgress,
  });
}

/* --------------------------------------------------------- raccourcisseur */

export type ShortenProvider = "is-gd" | "v-gd" | "tiny-url";

export interface Shortened {
  provider: string;
  original: string;
  shortUrl: string;
  endpoint: string;
}

export const shortenUrl = (url: string, provider: ShortenProvider) =>
  callNative<Shortened>("internet_shorten", { url, provider });

/* ----------------------------------------------------------------- yt-dlp */

export interface YtdlpStatus {
  installed: boolean;
  origin: "managed" | "system" | null;
  path: string | null;
  version: string | null;
  supported: boolean;
  directory: string;
  jsRuntime: string | null;
}

export interface MediaCapabilities {
  ffmpeg: boolean;
  webpAnimated: boolean;
  audioEncoders: string[];
}

export interface FormatInfo {
  id: string;
  container: string;
  width: number | null;
  height: number | null;
  fps: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  bitrateKbps: number | null;
  filesize: number | null;
  filesizeApprox: boolean;
  note: string;
  hasVideo: boolean;
  hasAudio: boolean;
  protocol: string;
}

export interface MediaInfo {
  id: string;
  title: string;
  uploader: string | null;
  durationSecs: number | null;
  thumbnailUrl: string | null;
  thumbnailData: string | null;
  webpageUrl: string;
  extractor: string;
  isLive: boolean;
  formats: FormatInfo[];
  heights: number[];
  hasAudio: boolean;
  hasVideo: boolean;
}

export type VideoContainer = "best" | "mp4" | "webm" | "source";
export type AudioFormat = "source" | "mp3" | "m4a" | "opus" | "ogg" | "wav" | "flac";

export interface MediaRequest {
  url: string;
  mode: "video" | "audio";
  container: VideoContainer;
  maxHeight: number | null;
  audioFormat: AudioFormat;
  audioKbps: number | null;
  section: { start: number; end: number } | null;
  exactCuts: boolean;
  maxBytes: number | null;
}

export interface MediaOutcome {
  path: string;
  bytes: number;
  container: string;
  method: "full" | "section-remote" | "section-local";
  reencoded: boolean;
  warnings: string[];
}

export interface MediaUpdate {
  stage: "inspect" | "download" | "merge" | "audio" | "trim" | "encode";
  ratio: number | null;
  speed: number | null;
  eta: number | null;
}

export const ytdlpStatus = () => callNative<YtdlpStatus>("ytdlp_status");
export const ytdlpCapabilities = () => callNative<MediaCapabilities>("ytdlp_capabilities");
export const ytdlpLatest = () => callNative<string>("ytdlp_latest");
export const ytdlpRemove = () => callNative<void>("ytdlp_remove");

export function ytdlpInstall(context?: OperationContext, onTransfer?: (p: TransferProgress) => void) {
  return runNative<{ version: string; sha256: string; path: string }>("ytdlp-install", "ytdlp_install", (jobId) => ({ jobId }), context, { onTransfer });
}

export function ytdlpInfo(url: string, context?: OperationContext) {
  return runNative<MediaInfo>("ytdlp-info", "ytdlp_info", (jobId) => ({ jobId, url }), context);
}

export function ytdlpDownload(
  params: { request: MediaRequest; title: string; destination: string },
  context?: OperationContext,
  onUpdate?: (update: MediaUpdate) => void,
) {
  return runNative<MediaOutcome, MediaUpdate>("media", "ytdlp_download", (jobId) => ({ params: { jobId, ...params } }), context, {
    event: "internet://media",
    onEvent: onUpdate,
  });
}

export function ytdlpAnimate(
  params: {
    request: MediaRequest;
    title: string;
    destination: string;
    format: "gif" | "webp";
    fps: number;
    width: number;
    quality: number;
  },
  context?: OperationContext,
  onUpdate?: (update: MediaUpdate) => void,
) {
  return runNative<MediaOutcome, MediaUpdate>("media-anim", "ytdlp_animate", (jobId) => ({ params: { jobId, ...params } }), context, {
    event: "internet://media",
    onEvent: onUpdate,
  });
}

/* --------------------------------------------------------------- budget */

export interface BudgetSource {
  durationSecs: number;
  hasAudio: boolean;
  videoKbps: number | null;
  audioKbps: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
}

export interface BudgetPlan {
  feasible: boolean;
  videoKbps: number;
  audioKbps: number;
  scaleHeight: number | null;
  expectedBytes: number;
  warnings: ("already-smaller" | "downscaled" | "impossible" | "very-low-quality" | "unknown-duration")[];
}

export const planBudget = (source: BudgetSource, targetBytes: number) =>
  callNative<BudgetPlan>("media_budget_plan", { source, targetBytes });

/* -------------------------------------------------------------- capture web */

export interface DetectedBrowser {
  family: "chrome" | "chromium" | "edge" | "brave";
  path: string;
  version: string | null;
}

export type WebCapture =
  | { kind: "pdf"; paperWidth: number; paperHeight: number; landscape: boolean; marginMm: number; background: boolean }
  | { kind: "image"; format: "png" | "jpeg" | "webp"; quality: number; viewportWidth: number; viewportHeight: number; fullPage: boolean }
  | { kind: "mhtml" };

export interface CaptureSummary {
  path: string;
  bytes: number;
  browser: string;
  finalUrl: string;
  httpStatus: number | null;
  width: number | null;
  height: number | null;
}

export const detectBrowsers = () => callNative<DetectedBrowser[]>("web_browsers");

export function captureWeb(
  params: { url: string; capture: WebCapture; output: string; overwrite: boolean; browserPath?: string; timeoutSecs?: number },
  context?: OperationContext,
) {
  return runNative<CaptureSummary>("web", "web_capture", (jobId) => ({ params: { jobId, ...params } }), context);
}

/* --------------------------------------------------------------------- ISO */

export interface IsoEntry {
  path: string;
  name: string;
  isDir: boolean;
  size: number;
  modified: number;
  symlink: boolean;
}

export interface IsoBootEntry {
  bootable: boolean;
  media: string;
  loadSegment: number;
  systemType: number;
  sectors: number;
  loadLba: number;
  path: string | null;
}

export interface IsoBoot {
  platforms: string[];
  catalogLba: number;
  validationOk: boolean;
  idString: string;
  entries: IsoBootEntry[];
}

export interface IsoInfo {
  path: string;
  fileSize: number;
  label: string;
  systemId: string;
  publisher: string;
  preparer: string;
  application: string;
  created: number;
  modified: number;
  volumeBytes: number;
  features: string[];
  tree: string;
  entries: IsoEntry[];
  files: number;
  directories: number;
  totalBytes: number;
  truncated: boolean;
  boot: IsoBoot | null;
  hybridMbr: boolean;
  gpt: boolean;
  warnings: string[];
}

export interface IsoCreated {
  path: string;
  files: number;
  directories: number;
  dataBytes: number;
  imageBytes: number;
  label: string;
  warnings: string[];
  warningCount: number;
}

export function createIso(
  params: { source: string; output: string; label: string; joliet: boolean; rockRidge: boolean; overwrite: boolean },
  context?: OperationContext,
) {
  return runNative<IsoCreated>("iso", "files_iso_create", (jobId) => ({ params: { jobId, ...params } }), context);
}

export function inspectIso(path: string, limit = 20000, context?: OperationContext) {
  return runNative<IsoInfo>("iso-inspect", "files_iso_inspect", (jobId) => ({ jobId, path, limit }), context);
}

export function extractIso(
  params: { path: string; destination: string; selection: string[]; overwrite: boolean },
  context?: OperationContext,
) {
  return runNative<{ destination: string; extracted: number; skipped: string[]; bytes: number }>(
    "iso-extract",
    "files_iso_extract",
    (jobId) => ({ jobId, ...params }),
    context,
  );
}

/* ----------------------------------------------------------------- images */

export interface NativeImageFormats {
  heic: boolean;
  avif: boolean;
  animatedWebp: boolean;
  apng: boolean;
  ffmpeg: boolean;
}

export interface AnimInfo {
  kind: "webp" | "apng" | null;
  animated: boolean;
  frames: number;
  width: number;
  height: number;
  durationMs: number;
}

export type AnimTarget = "gif" | "apng" | "webp" | "mp4" | "webm" | "frames";

export interface AnimSummary {
  path: string;
  frames: number;
  bytes: number;
  alphaLost: boolean;
  loopLost: boolean;
}

let formats: Promise<NativeImageFormats> | undefined;
/** Capacités natives de décodage, vérifiées une fois par session. */
export function nativeImageFormats(): Promise<NativeImageFormats> {
  if (!isTauri()) return Promise.resolve({ heic: false, avif: false, animatedWebp: false, apng: false, ffmpeg: false });
  formats ??= callNative<NativeImageFormats>("image_native_formats").catch(() => ({
    heic: false,
    avif: false,
    animatedWebp: false,
    apng: false,
    ffmpeg: false,
  }));
  return formats;
}

export const animInfo = (path: string) => callNative<AnimInfo>("image_anim_info", { path });

export function convertAnimation(
  params: {
    source: string;
    target: AnimTarget;
    output: string;
    overwrite: boolean;
    options: { maxWidth: number | null; background: [number, number, number]; quality: number };
  },
  context?: OperationContext,
) {
  return runNative<AnimSummary>("anim", "image_anim_convert", (jobId) => ({ params: { jobId, ...params } }), context);
}

/** Décode HEIC/HEIF ou AVIF en PNG avec le moteur natif. */
export async function decodeNativeImage(bytes: Uint8Array): Promise<Uint8Array> {
  const { invoke } = await import("@tauri-apps/api/core");
  try {
    const buffer = await invoke<ArrayBuffer>("image_decode_native", bytes.slice());
    return new Uint8Array(buffer);
  } catch (error) {
    throw toClientError(error);
  }
}

export interface MediaPreview {
  resolvedHeight: number | null;
  estimatedBytes: number | null;
  video: FormatInfo | null;
  audio: FormatInfo | null;
}

export const ytdlpPreview = (info: Omit<MediaInfo, "thumbnailData">, request: MediaRequest) =>
  callNative<MediaPreview>("ytdlp_preview", { info, request });

export interface SizeReport {
  attempts: number;
  bytes: number;
  videoKbps: number;
  audioKbps: number;
  scaleHeight: number | null;
  warnings: BudgetPlan["warnings"];
}

/** Compresse un média déjà préparé (`stage`) sous une taille maximale. */
export function compressToSize(
  params: { input: string; kind: "video" | "audio"; extension: string; maxBytes: number },
  context?: OperationContext,
) {
  return runNative<{ path: string; report: SizeReport }>("size", "media_compress_size", (jobId) => ({ params: { jobId, ...params } }), context);
}

/** ffprobe d'un média choisi sur le disque (refusé pour tout autre contenu). */
export const probeMediaPath = (path: string) => callNative<string>("media_probe_path", { path });
