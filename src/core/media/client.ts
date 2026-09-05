import { isTauri } from "@/core/platform";
import type { SelectedFile } from "@/core/files";
import type { OperationContext, OutputFile } from "@/core/pdf/types";
import { JobCancelledError } from "@/core/jobs/types";
import { parseProbe, type MediaInfo } from "./types";
import { isEncoderUnavailable } from "./errors";

/**
 * Client du socle média. Orchestre le cycle complet d'une opération FFmpeg :
 * préparation des entrées, exécution native (progression + annulation),
 * relecture de la sortie, nettoyage. Tout reste local ; l'application native
 * (Tauri) est requise — FFmpeg n'existe pas dans un simple navigateur.
 */

/** Forme commune des opérations audio/vidéo (voir `operations/`). */
export interface MediaExecutable {
  buildArgs: (inputs: string[], output: string) => string[];
  outputExt: string;
  mimeType: string;
  /**
   * Fichier texte à préparer à partir des entrées déjà déposées (liste de
   * concaténation…). Son chemin est ajouté à la fin des entrées avant l'appel à
   * `buildArgs`, et supprimé comme les autres temporaires.
   */
  stageText?: (inputs: string[]) => { content: string; ext: string };
}

let availability: Promise<boolean> | undefined;

/** FFmpeg est-il disponible (application native avec binaire résolu) ? */
export function isMediaAvailable(): Promise<boolean> {
  if (!isTauri()) return Promise.resolve(false);
  if (!availability) {
    availability = import("@tauri-apps/api/core")
      .then(({ invoke }) => invoke<boolean>("media_available"))
      .catch(() => false);
  }
  return availability;
}

let encoderCache: Promise<string[]> | undefined;

/** Encodeurs disponibles dans le FFmpeg utilisé (mis en cache). */
export function availableEncoders(): Promise<string[]> {
  if (!isTauri()) return Promise.resolve([]);
  if (!encoderCache) {
    encoderCache = import("@tauri-apps/api/core")
      .then(({ invoke }) => invoke<string[]>("media_encoders"))
      .catch(() => []);
  }
  return encoderCache;
}

/**
 * Teste réellement une liste d'encodeurs et renvoie ceux qui fonctionnent.
 *
 * Le nom d'un encodeur dans `ffmpeg -encoders` ne prouve rien : le socle natif
 * en encode une image pour de bon. Hors application (aperçu navigateur), aucun
 * encodeur n'est utilisable de toute façon.
 */
export async function probeEncoders(names: readonly string[]): Promise<string[]> {
  if (!isTauri() || names.length === 0) return [];
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<string[]>("media_probe_encoders", { names: [...names] });
  } catch {
    return [];
  }
}

/** Meilleur encodeur H.264 logiciel disponible (libx264 sinon libopenh264). */
export async function bestH264Encoder(): Promise<"libx264" | "libopenh264"> {
  const encoders = await availableEncoders();
  return encoders.includes("libx264") ? "libx264" : "libopenh264";
}

/** Lit les octets d'un fichier sélectionné (mémoire ou disque). */
export async function readBytes(file: SelectedFile): Promise<Uint8Array> {
  if (file.file) return new Uint8Array(await file.file.arrayBuffer());
  if (file.path) {
    const { readFile } = await import("@tauri-apps/plugin-fs");
    return await readFile(file.path);
  }
  throw new Error("Fichier illisible.");
}

/** Écrit des octets dans un fichier temporaire natif et renvoie son chemin. */
export async function stage(bytes: Uint8Array, ext: string): Promise<string> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string>("media_stage", bytes.slice(), { headers: { "x-media-ext": ext } });
}

/** Réserve un chemin temporaire natif (fichier non créé). */
export async function tempPath(ext: string): Promise<string> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string>("media_temp", { ext });
}

/** Supprime des fichiers temporaires natifs ; n'échoue jamais. */
export async function cleanup(paths: string[]): Promise<void> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("media_cleanup", { paths });
  } catch {
    // Le nettoyage ne doit jamais faire échouer une opération.
  }
}

/** Inspecte un fichier média via ffprobe. */
export async function probeFile(file: SelectedFile): Promise<MediaInfo> {
  const bytes = await readBytes(file);
  const path = await stage(bytes, file.extension || "bin");
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const json = await invoke<string>("media_probe", { path });
    return parseProbe(json);
  } finally {
    await cleanup([path]);
  }
}

export interface RunOptions {
  files: SelectedFile[];
  operation: MediaExecutable;
  /** Nom du fichier produit. */
  outputName: string;
  /** Durée totale en ms, pour la progression (0 = indéterminée). */
  totalMs?: number;
  /**
   * Entrées supplémentaires produites par l'application (sous-titres générés,
   * audio synthétisé…), ajoutées après les fichiers de l'utilisateur.
   */
  extraInputs?: { bytes: Uint8Array; ext: string }[];
  /** Étiquette affichée pendant l'exécution. */
  label?: string;
  /**
   * Variantes de repli, tentées **dans l'ordre** et **uniquement** si l'échec
   * est reconnu comme une indisponibilité d'encodeur. La détection préalable
   * évite normalement d'en arriver là ; ce filet couvre le cas où un encodeur
   * s'ouvre sur une image de test mais pas sur le fichier réel (résolution,
   * profil, mémoire vidéo).
   */
  alternatives?: MediaExecutable[];
  /** Appelé quand une variante de repli a dû être employée. */
  onFallback?: (info: { attempt: number; reason: string }) => void;
}

/** Exécute une opération média de bout en bout et renvoie le fichier produit. */
export async function runMedia(options: RunOptions, context?: OperationContext): Promise<OutputFile> {
  if (!isTauri()) throw new Error("Le traitement média nécessite l'application FourTout installée.");
  const { invoke } = await import("@tauri-apps/api/core");
  const { listen } = await import("@tauri-apps/api/event");

  const jobId = `media-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const staged: string[] = [];
  const produced: string[] = [];

  const label = options.label ?? "Traitement…";
  const unlisten = await listen<{ jobId: string; ratio: number }>("media://progress", (event) => {
    if (event.payload.jobId === jobId) context?.report?.({ ratio: event.payload.ratio, label });
  });

  const onAbort = () => {
    void invoke("media_cancel", { jobId });
  };
  context?.signal?.addEventListener("abort", onAbort);

  try {
    for (const file of options.files) {
      const bytes = await readBytes(file);
      staged.push(await stage(bytes, file.extension || "bin"));
    }
    for (const extra of options.extraInputs ?? []) {
      staged.push(await stage(extra.bytes, extra.ext));
    }
    const inputs = [...staged];
    const text = options.operation.stageText?.(inputs);
    if (text) {
      const listPath = await stage(new TextEncoder().encode(text.content), text.ext);
      staged.push(listPath);
      inputs.push(listPath);
    }
    const attempts = [options.operation, ...(options.alternatives ?? [])];
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < attempts.length; attempt += 1) {
      const operation = attempts[attempt];
      // Chaque tentative écrit dans sa propre sortie : un fichier tronqué par
      // un encodeur qui a échoué ne doit jamais être relu comme un résultat.
      const target = await tempPath(operation.outputExt);
      produced.push(target);

      try {
        await invoke("media_exec", {
          params: { jobId, args: operation.buildArgs(inputs, target), totalMs: options.totalMs ?? 0 },
        });
      } catch (error) {
        if (String(error) === "cancelled" || context?.signal?.aborted) throw new JobCancelledError();
        lastError = error instanceof Error ? error : new Error(String(error));
        const retryable = attempt + 1 < attempts.length && isEncoderUnavailable(lastError.message);
        if (!retryable) throw lastError;
        options.onFallback?.({ attempt: attempt + 1, reason: lastError.message });
        context?.report?.({ ratio: 0, label: "Reprise avec un encodeur logiciel…" });
        continue;
      }

      const output = await invoke<ArrayBuffer>("media_read", { path: target });
      return { name: options.outputName, bytes: new Uint8Array(output), mimeType: operation.mimeType };
    }

    throw lastError ?? new Error("Le traitement a échoué.");
  } finally {
    unlisten();
    context?.signal?.removeEventListener("abort", onAbort);
    await cleanup([...staged, ...produced]);
  }
}
