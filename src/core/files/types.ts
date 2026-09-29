import type { DataKind, ToolInput } from "../tools/types";

/**
 * Représentation d'un fichier sélectionné par l'utilisateur, indépendante de
 * la façon dont il a été fourni (glisser-déposer, explorateur, plus tard une
 * boîte de dialogue native Tauri).
 */
export interface SelectedFile {
  /** Identifiant local, stable le temps de la session. */
  id: string;
  name: string;
  /** Taille en octets. */
  size: number;
  /** Extension en minuscules, sans point. */
  extension: string;
  mimeType: string;
  kind: DataKind;
  /** Handle navigateur, présent lors d'un glisser-déposer. */
  file?: File;
  /** Chemin absolu, disponible uniquement via les dialogues natifs Tauri. */
  path?: string;
}

export interface FileRejection {
  name: string;
  reason: string;
}

export interface FileSelection {
  accepted: SelectedFile[];
  rejected: FileRejection[];
}

export interface FileConstraints {
  /** Entrées acceptées, telles que déclarées par l'outil. */
  inputs: ToolInput[];
  /** Nombre maximal de fichiers ; 1 par défaut si l'outil n'est pas « batch ». */
  maxFiles?: number;
  /** Taille maximale par fichier, en octets. */
  maxFileSize?: number;
}
