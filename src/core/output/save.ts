import { isTauri } from "@/core/platform";
import { createZip } from "@/core/archive/zip";
import type { OutputFile } from "@/core/pdf/types";

/**
 * Enregistrement des fichiers produits.
 *
 * Dans l'application, l'utilisateur choisit l'emplacement via la boîte de
 * dialogue native puis les octets sont écrits sur le disque. Dans le
 * navigateur (développement), on retombe sur un téléchargement classique.
 *
 * Aucune écriture n'a lieu sans que l'utilisateur ait désigné la destination :
 * FourTout ne dépose jamais de fichier quelque part de sa propre initiative.
 */

export interface SaveResult {
  /** L'utilisateur a-t-il validé l'enregistrement ? */
  saved: boolean;
  /** Chemin du fichier écrit, si connu (application uniquement). */
  path?: string;
  /** Nombre de fichiers réellement écrits. */
  count: number;
}

/** Types de fichiers proposés par la boîte de dialogue, selon l'extension. */
const FILTERS: Record<string, { name: string; extensions: string[] }> = {
  pdf: { name: "Document PDF", extensions: ["pdf"] },
  png: { name: "Image PNG", extensions: ["png"] },
  jpg: { name: "Image JPEG", extensions: ["jpg", "jpeg"] },
  txt: { name: "Fichier texte", extensions: ["txt"] },
  zip: { name: "Archive ZIP", extensions: ["zip"] },
};

function extensionOf(name: string): string {
  const index = name.lastIndexOf(".");
  return index > 0 ? name.slice(index + 1).toLowerCase() : "";
}

/** Enregistre un fichier unique. */
export async function saveFile(file: OutputFile): Promise<SaveResult> {
  if (!isTauri()) {
    downloadInBrowser(file);
    return { saved: true, count: 1 };
  }

  const { save } = await import("@tauri-apps/plugin-dialog");
  const extension = extensionOf(file.name);
  const filter = FILTERS[extension];

  const path = await save({
    defaultPath: file.name,
    filters: filter ? [filter] : undefined,
  });
  if (!path) return { saved: false, count: 0 };

  const { writeFile } = await import("@tauri-apps/plugin-fs");
  await writeFile(path, file.bytes);
  return { saved: true, path, count: 1 };
}

/**
 * Enregistre plusieurs fichiers dans un dossier choisi par l'utilisateur.
 * Les noms déjà pris sont suffixés plutôt qu'écrasés.
 */
export async function saveFilesToFolder(files: readonly OutputFile[]): Promise<SaveResult> {
  if (files.length === 0) return { saved: false, count: 0 };
  if (files.length === 1) return saveFile(files[0]);

  if (!isTauri()) {
    files.forEach(downloadInBrowser);
    return { saved: true, count: files.length };
  }

  const { open } = await import("@tauri-apps/plugin-dialog");
  const directory = await open({ directory: true, multiple: false, title: "Dossier de destination" });
  if (typeof directory !== "string") return { saved: false, count: 0 };

  const { writeFile, exists } = await import("@tauri-apps/plugin-fs");
  const separator = directory.includes("\\") ? "\\" : "/";
  const used = new Set<string>();

  for (const file of files) {
    let name = file.name;
    // Ne jamais écraser en silence : ni un fichier déjà présent, ni un
    // homonyme produit par la même opération.
    for (let counter = 2; used.has(name) || (await exists(`${directory}${separator}${name}`)); counter += 1) {
      const dot = file.name.lastIndexOf(".");
      const stem = dot > 0 ? file.name.slice(0, dot) : file.name;
      const ext = dot > 0 ? file.name.slice(dot) : "";
      name = `${stem} (${counter})${ext}`;
    }
    used.add(name);
    await writeFile(`${directory}${separator}${name}`, file.bytes);
  }

  return { saved: true, path: directory, count: files.length };
}

/** Regroupe plusieurs fichiers en une archive ZIP, puis l'enregistre. */
export async function saveFilesAsZip(
  files: readonly OutputFile[],
  archiveName: string,
): Promise<SaveResult> {
  const zip = createZip(files.map((file) => ({ name: file.name, bytes: file.bytes })));
  return saveFile({ name: archiveName, bytes: zip, mimeType: "application/zip" });
}

/** Ouvre le fichier dans l'application par défaut du système. */
export async function openFile(path: string): Promise<void> {
  if (!isTauri()) return;
  const { openPath } = await import("@tauri-apps/plugin-opener");
  await openPath(path);
}

/** Ouvre le dossier contenant le fichier et l'y met en évidence. */
export async function revealFile(path: string): Promise<void> {
  if (!isTauri()) return;
  const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
  await revealItemInDir(path);
}

/** Ouvre un dossier dans l'explorateur du système. */
export async function openFolder(path: string): Promise<void> {
  if (!isTauri()) return;
  const { openPath } = await import("@tauri-apps/plugin-opener");
  await openPath(path);
}

function downloadInBrowser(file: OutputFile): void {
  const blob = new Blob([file.bytes.slice().buffer as ArrayBuffer], { type: file.mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  link.click();
  // Laisse au navigateur le temps d'amorcer le téléchargement.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
