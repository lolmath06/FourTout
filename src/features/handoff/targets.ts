import type { ToolDefinition } from "@/core/tools/types";

/**
 * Outils vers lesquels les outils « Fichiers » savent passer la main.
 *
 * Les identifiants sont rassemblés ici plutôt que semés dans les composants,
 * pour une raison précise : un test vérifie que **chacun** existe au registre
 * et porte une implémentation. Un lien mort ne peut donc plus survivre à une
 * relecture — il fait échouer la suite.
 */
export const HANDOFF_TARGETS = {
  /** Fiche d'identité complète d'un fichier. */
  inspect: "file-info",
  /** Aperçu universel. */
  preview: "file-preview",
  /** Table des matières d'une archive, sans extraction. */
  archiveInspect: "archive-inspect",
  /** Test d'intégrité d'une archive. */
  archiveTest: "archive-test",
  /** Extraction d'une archive vers un dossier. */
  archiveExtract: "archive-extract",
  /** Lecture et correction des octets. */
  hexEdit: "file-hex-edit",
  /** Décompression d'un flux `.gz` ou `.xz`. */
  decompress: "file-decompress",
  /** Vérification d'un manifeste d'empreintes. */
  checksumVerify: "checksum-verify",
  /** Empreintes d'un fichier. */
  hash: "file-hash",
  /** Renommage par lot, seule façon de corriger une extension trompeuse. */
  rename: "file-bulk-rename",
  /** Métadonnées d'un PDF. */
  pdfMetadata: "pdf-metadata",
  /** Extraction du texte d'un PDF. */
  pdfExtractText: "pdf-extract-text",
  /** Conversion d'image. */
  imageConvert: "image-convert",
  /** Conversion audio. */
  audioConvert: "audio-convert",
  /** Conversion vidéo. */
  videoConvert: "video-convert",
  /** Comparaison de deux textes collés. */
  textCompare: "text-compare",
  /** Fiche d'identité d'un fichier audio ou vidéo. */
  mediaInspect: "media-info",
  /** Comparaison de deux images. */
  imageCompare: "image-compare",
  /** Changement de fréquence d'images. */
  videoFrameRate: "video-frame-rate",
  /** Étiquettes d'un fichier audio. */
  audioMetadata: "audio-metadata",
  /** Canaux d'un fichier audio. */
  audioChannels: "audio-channels",
  /** Extraction des sous-titres d'une vidéo. */
  subtitleExtract: "video-extract-subtitles",
  /** Conversion, décalage, fusion et réparation de sous-titres. */
  subtitleEdit: "subtitle-edit",
} as const;

export type HandoffTarget = (typeof HANDOFF_TARGETS)[keyof typeof HANDOFF_TARGETS];

/** Tous les identifiants visés, pour les tests de navigation. */
export function handoffTargetIds(): string[] {
  return [...new Set(Object.values(HANDOFF_TARGETS))];
}

/**
 * Outil à proposer pour un contenu donné, d'après la **famille détectée** par
 * la reconnaissance de signature — jamais d'après l'extension du nom.
 */
export function specialistFor(family: string, magic: string): HandoffTarget | undefined {
  if (magic === "pdf") return HANDOFF_TARGETS.pdfMetadata;
  switch (family) {
    case "archive":
      // Un flux `.gz`/`.xz` n'a pas de table des matières : c'est le
      // décompresseur qui est utile, pas l'inspecteur d'archive.
      return magic === "gz" || magic === "xz"
        ? HANDOFF_TARGETS.decompress
        : HANDOFF_TARGETS.archiveInspect;
    case "image":
      return HANDOFF_TARGETS.imageConvert;
    case "audio":
      return HANDOFF_TARGETS.audioConvert;
    case "video":
      return HANDOFF_TARGETS.videoConvert;
    default:
      return undefined;
  }
}

/** Les outils qui acceptent un **chemin** transmis par relais. */
export function acceptsPathHandoff(tool: ToolDefinition): boolean {
  return PATH_HANDOFF_TOOLS.has(tool.id);
}

const PATH_HANDOFF_TOOLS = new Set<string>([
  HANDOFF_TARGETS.inspect,
  HANDOFF_TARGETS.preview,
  HANDOFF_TARGETS.archiveInspect,
  HANDOFF_TARGETS.archiveTest,
  HANDOFF_TARGETS.archiveExtract,
  HANDOFF_TARGETS.hexEdit,
  HANDOFF_TARGETS.decompress,
  HANDOFF_TARGETS.checksumVerify,
  HANDOFF_TARGETS.hash,
  HANDOFF_TARGETS.rename,
]);
