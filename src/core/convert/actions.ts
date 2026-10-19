import { conversionsFor, convertibleExtensions, type ConversionTarget } from "@/core/convert/graph";
import type { Identity } from "@/core/convert/identity";
import { toolRegistry, type ToolRegistry } from "@/core/tools/registry";
import type { DataKind } from "@/core/tools/types";
import { msg } from "@/i18n";

/**
 * Les actions que FourTout peut **réellement** proposer pour un fichier donné.
 *
 * Trois sources, jamais une table écrite à la main :
 *
 *  1. le graphe dérivé du registre (`graph.ts`) pour les formats ordinaires ;
 *  2. un petit nombre de **règles de contenu** là où l'extension ne suffit pas —
 *     une animation ne passe pas par un outil d'image fixe, un ISO ne se
 *     « convertit » pas, une vidéo sans piste son n'a pas d'audio à extraire ;
 *  3. les **capacités vérifiées** de la machine : un format que ce FFmpeg ou ce
 *     système ne sait pas décoder n'est pas annoncé.
 */
export interface MediaFacts {
  hasVideo: boolean;
  hasAudio: boolean;
}

export interface Capabilities {
  /** FFmpeg est lançable. */
  ffmpeg: boolean;
  /** Un encodeur WebP animé existe dans ce FFmpeg. */
  webpAnimated: boolean;
  /** AVIF décodable (échantillon réellement décodé). */
  avif: boolean;
  /** HEIC/HEIF décodable (décodeur natif). */
  heic: boolean;
  /** Application installée : les outils natifs existent. */
  native: boolean;
}

export const NO_CAPABILITIES: Capabilities = { ffmpeg: false, webpAnimated: false, avif: false, heic: false, native: false };

export type Transport = "file" | "path";

export interface ConversionAction {
  key: string;
  /** Extension ou format cible affiché (« GIF », « WEBP »). */
  to: string;
  kind: DataKind;
  toolId: string;
  /** Réglage prérempli transmis à l'outil. */
  preset: Record<string, unknown>;
  /** L'outil veut un chemin natif (images disque, animations) ou le fichier lu. */
  transport: Transport;
}

export interface Plan {
  actions: ConversionAction[];
  /** Remarques à montrer, par ordre d'importance. */
  notes: PlanNote[];
  /** Extension utilisée pour interroger le graphe. */
  source: string;
}

export type PlanNote =
  | { kind: "extension-mismatch"; named: string; actual: string }
  | { kind: "animated"; format: string }
  | { kind: "sequence" }
  | { kind: "avif-unavailable" }
  | { kind: "heic-unavailable" }
  | { kind: "no-ffmpeg" }
  | { kind: "no-video-stream" }
  | { kind: "no-audio-stream" };

export const NOTE_LABELS = {
  animated: msg("Image animée : les conversions proposées conservent l'animation. Une conversion d'image fixe n'en garderait que la première image."),
  sequence: msg("Séquence HEIF (plusieurs images) : seules les images fixes sont prises en charge."),
  "avif-unavailable": msg("Ce système ne sait pas décoder l'AVIF : aucune conversion n'est proposée."),
  "heic-unavailable": msg("Le décodage HEIC n'est pas disponible dans cet environnement."),
  "no-ffmpeg": msg("FFmpeg est introuvable : les conversions audio et vidéo ne sont pas proposées."),
  "no-video-stream": msg("Aucune piste vidéo dans ce fichier : seules les conversions audio sont proposées."),
  "no-audio-stream": msg("Aucune piste audio dans ce fichier : l'extraction du son n'est pas proposée."),
} as const;

const ANIMATION_TARGETS = ["gif", "apng", "webp", "mp4", "webm", "frames"] as const;
const FFMPEG_ONLY_KINDS: DataKind[] = ["video", "audio"];

/** Extension à interroger : celle du contenu quand le graphe la connaît, sinon celle du nom. */
export function canonicalSource(identity: Identity, named: string, known: Set<string>): string {
  const candidates = [identity.id, ...identity.extensions, named.toLowerCase()];
  return candidates.find((c) => known.has(c)) ?? (named.toLowerCase() || identity.id);
}

function toAction(target: ConversionTarget): ConversionAction {
  return {
    key: `${target.toolId}:${target.to}`,
    to: target.to,
    kind: target.kind,
    toolId: target.toolId,
    preset: { format: target.to },
    transport: "file",
  };
}

export function planActions(
  identity: Identity,
  namedExtension: string,
  facts: MediaFacts | undefined,
  caps: Capabilities,
  registry: ToolRegistry = toolRegistry,
): Plan {
  const notes: PlanNote[] = [];
  const named = namedExtension.toLowerCase();
  const known = new Set(convertibleExtensions(registry));
  const has = (toolId: string) => registry.has(toolId);

  if (identity.basis === "content" && named && !identity.extensions.includes(named) && identity.id !== named) {
    notes.push({ kind: "extension-mismatch", named, actual: identity.label });
  }

  // --- ISO : des images à lire, pas à convertir ------------------------------
  if (identity.id === "iso") {
    const actions: ConversionAction[] = [];
    if (has("iso-inspect")) actions.push({ key: "iso-inspect", to: "inspect", kind: "none", toolId: "iso-inspect", preset: {}, transport: "path" });
    if (has("iso-extract")) actions.push({ key: "iso-extract", to: "extract", kind: "folder", toolId: "iso-extract", preset: {}, transport: "path" });
    return { actions, notes, source: "iso" };
  }

  // --- Images animées : jamais aplaties en silence ---------------------------
  if (identity.animated && (identity.id === "webp" || identity.id === "apng")) {
    notes.push({ kind: "animated", format: identity.label });
    const actions: ConversionAction[] = [];
    if (has("animated-image-convert") && caps.native) {
      if (!caps.ffmpeg) notes.push({ kind: "no-ffmpeg" });
      for (const target of ANIMATION_TARGETS) {
        // L'export en images ne demande pas FFmpeg ; les autres destinations, si.
        if (target !== "frames" && !caps.ffmpeg) continue;
        if ((target === "webp" && (identity.id === "webp" || !caps.webpAnimated)) || (target === "apng" && identity.id === "apng")) continue;
        actions.push(animation(target));
      }
    }
    return { actions, notes, source: identity.id };
  }

  // --- HEIC / HEIF -------------------------------------------------------------
  if (identity.id === "heic" || identity.id === "heif") {
    if (identity.animated) {
      notes.push({ kind: "sequence" });
      return { actions: [], notes, source: identity.id };
    }
    if (!caps.heic) {
      notes.push({ kind: "heic-unavailable" });
      return { actions: [], notes, source: identity.id };
    }
  }

  // --- AVIF : seulement si cette machine sait le lire --------------------------
  if (identity.id === "avif") {
    if (identity.animated || !caps.avif) {
      notes.push(identity.animated ? { kind: "sequence" } : { kind: "avif-unavailable" });
      return { actions: [], notes, source: "avif" };
    }
  }

  // --- Cas général : le graphe, filtré par ce que le fichier contient vraiment --
  const source = canonicalSource(identity, named, known);
  let targets = conversionsFor(source, registry);

  if (facts) {
    if (!facts.hasVideo) {
      if (targets.some((t) => t.kind === "video" || t.kind === "image")) notes.push({ kind: "no-video-stream" });
      targets = targets.filter((t) => t.kind !== "video" && t.kind !== "image");
    }
    if (!facts.hasAudio && facts.hasVideo) {
      if (targets.some((t) => t.kind === "audio")) notes.push({ kind: "no-audio-stream" });
      targets = targets.filter((t) => t.kind !== "audio");
    }
  }
  if (!caps.ffmpeg && caps.native) {
    if (targets.some((t) => FFMPEG_ONLY_KINDS.includes(t.kind) || sourceNeedsFfmpeg(identity))) notes.push({ kind: "no-ffmpeg" });
    targets = targets.filter((t) => !FFMPEG_ONLY_KINDS.includes(t.kind) && !needsFfmpegTool(t.toolId));
  }

  const actions = targets.map(toAction);

  // Vidéo → WebP animé : l'outil Vidéo vers GIF sait aussi le produire.
  const isVideo = facts?.hasVideo && ["mp4", "mov", "webm", "mkv", "avi"].includes(source);
  if (isVideo && caps.ffmpeg && caps.webpAnimated && has("video-to-gif") && !actions.some((a) => a.to === "webp")) {
    actions.push({ key: "video-to-gif:webp", to: "webp", kind: "image", toolId: "video-to-gif", preset: { format: "webp" }, transport: "file" });
  }
  return { actions, notes, source };
}

function animation(target: (typeof ANIMATION_TARGETS)[number]): ConversionAction {
  return {
    key: `animated-image-convert:${target}`,
    to: target,
    kind: target === "mp4" || target === "webm" ? "video" : target === "frames" ? "folder" : "image",
    toolId: "animated-image-convert",
    preset: { target },
    transport: "path",
  };
}

const FFMPEG_TOOLS = new Set(["video-convert", "video-to-gif", "gif-to-video", "video-extract-frame", "video-extract-audio", "audio-convert"]);
function needsFfmpegTool(toolId: string): boolean {
  return FFMPEG_TOOLS.has(toolId);
}
function sourceNeedsFfmpeg(identity: Identity): boolean {
  return identity.family === "video" || identity.family === "audio";
}
