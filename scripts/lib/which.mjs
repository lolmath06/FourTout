/**
 * Emplacement d'un exécutable du système, sous une forme que `spawn` accepte.
 *
 * `sh -c 'command -v X'` répondait partout — mais sur Windows, le shell de Git
 * rend une route MSYS (« /c/ProgramData/Chocolatey/bin/ffmpeg ») que Node ne
 * sait pas lancer. L'appel échouait alors en ENOENT au lieu de signaler une
 * absence, et les scripts de fixtures s'interrompaient au lieu de se sauter.
 * On interroge donc `where` sous Windows, qui rend une route Win32.
 *
 * Rend `null` si l'exécutable est introuvable — les appelants s'en servent
 * pour ignorer proprement les fixtures qui en dépendent.
 */
import { spawnSync } from "node:child_process";

export function which(name) {
  const result =
    process.platform === "win32"
      ? spawnSync("where", [name], { windowsHide: true })
      : spawnSync("sh", ["-c", `command -v ${name}`]);

  if (result.error || result.status !== 0 || !result.stdout) return null;

  // `where` peut rendre plusieurs lignes ; la première est celle que le PATH choisit.
  const first = result.stdout
    .toString()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  return first || null;
}
