import type { DataKind, ToolDefinition, ToolInput } from "../tools/types";
import type {
  FileConstraints,
  FileRejection,
  FileSelection,
  SelectedFile,
} from "./types";

export type { FileConstraints, FileRejection, FileSelection, SelectedFile } from "./types";

const KIND_BY_EXTENSION: Record<string, DataKind> = {};
const register = (kind: DataKind, extensions: string[]) => {
  for (const ext of extensions) KIND_BY_EXTENSION[ext] = kind;
};

register("pdf", ["pdf"]);
register("image", ["png", "jpg", "jpeg", "webp", "bmp", "gif", "tiff", "tif", "avif", "ico", "svg", "heic"]);
register("audio", ["mp3", "wav", "flac", "ogg", "m4a", "aac", "opus", "wma"]);
register("video", ["mp4", "mkv", "webm", "mov", "avi", "wmv", "flv", "m4v"]);
register("archive", ["zip", "7z", "tar", "gz", "tgz", "bz2", "xz", "rar"]);
register("text", ["txt", "md", "srt", "vtt", "ass", "log", "rtf"]);
register("document", ["doc", "docx", "odt", "epub", "pptx", "xlsx", "ods"]);
register("data", ["json", "csv", "xml", "yaml", "yml", "html", "sql", "tsv"]);

export function extensionOf(fileName: string): string {
  const index = fileName.lastIndexOf(".");
  if (index <= 0 || index === fileName.length - 1) return "";
  return fileName.slice(index + 1).toLowerCase();
}

export function kindOfExtension(extension: string): DataKind {
  return KIND_BY_EXTENSION[extension.replace(/^\./, "").toLowerCase()] ?? "data";
}

/**
 * Taille lisible, en multiples **binaires**.
 *
 * FourTout compte en 1024 : c'est ce que fait le système de fichiers, et c'est
 * ce que fait l'Explorateur de Windows. Les libellés le disent donc — Kio, Mio,
 * Gio — au lieu d'écrire « Ko » devant un calcul en 1024, ce qui mélangeait
 * deux conventions et rendait tout écart inexplicable.
 *
 * La précision suit l'ordre de grandeur : deux décimales en dessous de dix,
 * une en dessous de cent, aucune au-delà. Un outil technique ne doit pas
 * afficher « 10 Mio » pour 10 584 064 octets.
 */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} o`;
  const units = ["Kio", "Mio", "Gio", "Tio"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const decimals = value < 10 ? 2 : value < 100 ? 1 : 0;
  return `${value.toLocaleString("fr-FR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })} ${units[unit]}`;
}

/** Nombre exact d'octets, groupé par milliers : « 10 584 064 octets ». */
export function formatExactBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  return `${bytes.toLocaleString("fr-FR")} octet${bytes > 1 ? "s" : ""}`;
}

/**
 * Taille lisible **et** exacte : « 10,1 Mio (10 584 064 octets) ».
 *
 * Les outils qui servent à vérifier — analyse d'espace, inspection, intégrité —
 * l'emploient plutôt que la forme arrondie : un chiffre qu'on ne peut pas
 * recouper ne vaut rien dans ce contexte.
 */
export function formatSizeWithExact(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return formatExactBytes(bytes);
  return `${formatFileSize(bytes)} (${formatExactBytes(bytes)})`;
}

let counter = 0;
export function describeFile(file: File): SelectedFile {
  const extension = extensionOf(file.name);
  counter += 1;
  return {
    id: `${Date.now().toString(36)}-${counter}`,
    name: file.name,
    size: file.size,
    extension,
    mimeType: file.type || "application/octet-stream",
    kind: kindOfExtension(extension),
    file,
  };
}

function inputAccepts(input: ToolInput, candidate: SelectedFile): boolean {
  if (input.extensions.includes("*")) {
    return input.kind === "data" || input.kind === candidate.kind;
  }
  return input.extensions.includes(candidate.extension);
}

/** Un outil accepte-t-il ce fichier ? */
export function acceptsFile(inputs: ToolInput[], candidate: SelectedFile): boolean {
  return inputs.some((input) => inputAccepts(input, candidate));
}

/** Contraintes de fichiers déduites de la définition d'un outil. */
export function constraintsForTool(tool: ToolDefinition): FileConstraints {
  const supportsMultiple =
    tool.capabilities.includes("batch") ||
    tool.acceptedInputs.some((input) => input.multiple);
  return {
    inputs: tool.acceptedInputs.filter((input) => input.kind !== "none"),
    maxFiles: supportsMultiple ? undefined : 1,
  };
}

/**
 * Valide une sélection de fichiers. Renvoie systématiquement les deux listes :
 * l'interface peut ainsi expliquer précisément ce qui a été refusé, plutôt que
 * d'ignorer les fichiers en silence.
 */
export function validateSelection(
  files: readonly File[],
  constraints: FileConstraints,
  alreadySelected = 0,
): FileSelection {
  const accepted: SelectedFile[] = [];
  const rejected: FileRejection[] = [];
  const max = constraints.maxFiles ?? Number.POSITIVE_INFINITY;

  for (const file of files) {
    const candidate = describeFile(file);

    if (constraints.inputs.length > 0 && !acceptsFile(constraints.inputs, candidate)) {
      rejected.push({
        name: file.name,
        reason: candidate.extension
          ? `Format .${candidate.extension} non pris en charge par cet outil`
          : "Type de fichier non reconnu",
      });
      continue;
    }
    if (constraints.maxFileSize !== undefined && file.size > constraints.maxFileSize) {
      rejected.push({ name: file.name, reason: "Fichier trop volumineux" });
      continue;
    }
    if (alreadySelected + accepted.length >= max) {
      rejected.push({
        name: file.name,
        reason: max === 1 ? "Cet outil ne traite qu'un fichier à la fois" : `Maximum ${max} fichiers`,
      });
      continue;
    }
    accepted.push(candidate);
  }

  return { accepted, rejected };
}

/** Attribut `accept` d'un `<input type="file">` déduit des entrées de l'outil. */
export function acceptAttribute(inputs: ToolInput[]): string | undefined {
  const extensions = inputs.flatMap((input) => input.extensions);
  if (extensions.length === 0 || extensions.includes("*")) return undefined;
  return [...new Set(extensions)].map((ext) => `.${ext}`).join(",");
}
