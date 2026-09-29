import { isTauri } from "@/core/platform";

/**
 * Accès au microphone.
 *
 * Sous Linux, la WebView de FourTout est WebKitGTK : elle n'affiche aucun
 * dialogue de permission et refuse `getUserMedia` tant que l'application hôte
 * n'a pas tranché (voir `src-tauri/src/microphone.rs`). L'autorisation est donc
 * demandée explicitement, via un dialogue natif, juste avant l'ouverture du
 * flux — jamais au démarrage de l'application. Ailleurs (navigateur, macOS,
 * Windows), c'est la plateforme qui pose la question et `mic_permission_state`
 * renvoie « granted » pour ne pas ajouter un second filtre.
 */

export type MicPermission = "granted" | "denied" | "prompt";

/** Raison d'un échec d'ouverture du micro. */
export type MicFailure = "unsupported" | "denied" | "not-found" | "failed";

export class MicrophoneError extends Error {
  constructor(readonly reason: MicFailure) {
    super(reason);
    this.name = "MicrophoneError";
  }
}

/** Autorisation déjà accordée, déjà refusée, ou jamais demandée. */
export async function micPermissionState(): Promise<MicPermission> {
  if (!isTauri()) return "prompt";
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const state = await invoke<string>("mic_permission_state");
    return state === "granted" || state === "denied" ? state : "prompt";
  } catch {
    return "prompt";
  }
}

/**
 * Pose la question à l'utilisateur (dialogue natif) et renvoie sa réponse.
 * Hors application, le navigateur pose lui-même la question au moment du
 * `getUserMedia` : il n'y a rien à demander en amont.
 */
export async function requestMicPermission(): Promise<boolean> {
  if (!isTauri()) return true;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<boolean>("mic_request_permission");
  } catch {
    return false;
  }
}

/**
 * Ouvre le microphone, en demandant l'autorisation si elle n'a pas déjà été
 * accordée. Chaque appel qui échoue laisse le système intact : aucun flux
 * n'est ouvert.
 */
export async function openMicrophone(deviceId?: string): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) throw new MicrophoneError("unsupported");

  if ((await micPermissionState()) !== "granted") {
    // Un refus antérieur n'est pas définitif : redemander relance le dialogue.
    if (!(await requestMicPermission())) throw new MicrophoneError("denied");
  }

  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: deviceId ? { deviceId: { exact: deviceId } } : true,
    });
  } catch (error) {
    const name = error instanceof DOMException ? error.name : "";
    if (name === "NotAllowedError" || name === "SecurityError") throw new MicrophoneError("denied");
    if (name === "NotFoundError" || name === "OverconstrainedError") {
      throw new MicrophoneError("not-found");
    }
    throw new MicrophoneError("failed");
  }
}

/**
 * Libère un flux : toutes les pistes sont arrêtées, donc le micro est rendu au
 * système et l'indicateur d'enregistrement s'éteint.
 */
export function releaseStream(stream: MediaStream | null | undefined): void {
  stream?.getTracks().forEach((track) => track.stop());
}
