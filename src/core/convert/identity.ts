import { isTauri } from "@/core/platform";
import type { FileFamily } from "@/core/files/native";
import { msg } from "@/i18n";

/**
 * Ce qu'est réellement un fichier, d'après son contenu.
 *
 * L'extension d'un nom est une affirmation ; les premiers octets sont un fait.
 * L'identité vient de la même table de signatures que l'inspecteur de fichiers
 * (`magic.rs`) : le convertisseur n'en a pas une seconde, qui divergerait.
 */
export interface Identity {
  /** Identifiant de signature (« png », « apng », « webm », « heic », « iso »…). */
  id: string;
  label: string;
  family: FileFamily;
  /** Plusieurs images : WebP ou PNG animé, séquence HEIF. */
  animated: boolean;
  mime: string | null;
  /** Extensions légitimes pour ce contenu. */
  extensions: string[];
  /** D'où vient le verdict : le contenu, ou à défaut le nom. */
  basis: "content" | "extension";
}

export const UNKNOWN_FORMAT = msg("Format inconnu");

export function identityFromExtension(extension: string): Identity {
  const ext = extension.toLowerCase();
  return {
    id: ext || "inconnu",
    label: ext ? ext.toUpperCase() : UNKNOWN_FORMAT,
    family: "unknown",
    animated: false,
    mime: null,
    extensions: ext ? [ext] : [],
    basis: "extension",
  };
}

interface NativeIdentity {
  id: string;
  label: string;
  family: FileFamily;
  animated: boolean;
  mime: string | null;
  extensions: string[];
}

function fromNative(native: NativeIdentity, extension: string): Identity {
  if (native.id === "inconnu") return identityFromExtension(extension);
  return { ...native, basis: "content" };
}

/** Identité d'un fichier du disque (application installée). */
export async function identifyPath(path: string, extension: string): Promise<Identity> {
  if (!isTauri()) return identityFromExtension(extension);
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return fromNative(await invoke<NativeIdentity>("files_identify_path", { path }), extension);
  } catch {
    return identityFromExtension(extension);
  }
}

/** Identité d'un fichier déposé dans le navigateur : on lit son début. */
export async function identifyFile(file: File, extension: string): Promise<Identity> {
  if (!isTauri()) return identityFromExtension(extension);
  try {
    const head = new Uint8Array(await file.slice(0, 64 * 1024).arrayBuffer());
    const { invoke } = await import("@tauri-apps/api/core");
    return fromNative(await invoke<NativeIdentity>("files_identify", head), extension);
  } catch {
    return identityFromExtension(extension);
  }
}
