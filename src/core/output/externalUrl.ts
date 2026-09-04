import { isTauri } from "@/core/platform";

/**
 * Ouverture d'un lien externe.
 *
 * Le contenu d'un QR code (ou de tout fichier importé) est arbitraire : il ne
 * doit jamais être confié tel quel au système. Seuls les protocoles qui
 * désignent une ressource à consulter sont acceptés ; `javascript:`, `data:`,
 * `file:` et les schémas d'application inconnus sont refusés.
 *
 * Dans l'application, l'ouverture passe par `openUrl` du plugin `opener`
 * (`open_url`), et non par `openPath` : celui-ci est réservé aux chemins du
 * disque, vérifie l'existence du fichier et est filtré par la portée « chemins »
 * — il rejette silencieusement une URL.
 */

/** Protocoles autorisés pour un contenu venu de l'extérieur. */
const OPENABLE_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

/** Ce texte est-il un lien que FourTout accepte d'ouvrir ? */
export function isOpenableUrl(text: string): boolean {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return false;
  }
  if (!OPENABLE_PROTOCOLS.has(url.protocol)) return false;
  // `http:` / `https:` sans hôte ne désignent rien d'ouvrable.
  if (url.protocol !== "mailto:" && !url.hostname) return false;
  return true;
}

/**
 * Ouvre le lien dans l'application par défaut du système (navigateur, client
 * mail). Renvoie `false` sans rien ouvrir si le protocole n'est pas autorisé.
 */
export async function openExternalUrl(text: string): Promise<boolean> {
  const url = text.trim();
  if (!isOpenableUrl(url)) return false;

  if (!isTauri()) {
    window.open(url, "_blank", "noopener,noreferrer");
    return true;
  }

  const { openUrl } = await import("@tauri-apps/plugin-opener");
  await openUrl(url);
  return true;
}
