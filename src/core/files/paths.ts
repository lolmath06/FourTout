/**
 * Manipulation de chemins **côté interface**.
 *
 * Le frontend ne construit jamais de chemin destiné à être écrit : il affiche
 * des chemins reçus du socle natif et compose au plus un nom de fichier. Ces
 * fonctions restent donc volontairement descriptives, et neutres vis-à-vis du
 * système : un chemin Windows (`C:\Users\…`) comme un chemin Unix (`/home/…`)
 * doivent s'afficher correctement dans les deux cas.
 */

/** Séparateur employé par un chemin donné. */
export function separatorOf(path: string): "\\" | "/" {
  return path.includes("\\") && !path.startsWith("/") ? "\\" : "/";
}

/** Dernier segment d'un chemin (nom de fichier ou de dossier). */
export function baseName(path: string): string {
  const cleaned = path.replace(/[\\/]+$/, "");
  const index = Math.max(cleaned.lastIndexOf("/"), cleaned.lastIndexOf("\\"));
  return index >= 0 ? cleaned.slice(index + 1) : cleaned;
}

/** Dossier parent d'un chemin ; chaîne vide s'il n'y en a pas. */
export function directoryName(path: string): string {
  const cleaned = path.replace(/[\\/]+$/, "");
  const index = Math.max(cleaned.lastIndexOf("/"), cleaned.lastIndexOf("\\"));
  return index > 0 ? cleaned.slice(0, index) : index === 0 ? "/" : "";
}

/**
 * Assemble un chemin en respectant le séparateur du parent.
 *
 * Le fragment ajouté est normalisé au même séparateur : les chemins relatifs
 * que produisent les moteurs Fichiers emploient toujours `/`, y compris sous
 * Windows, et les recoller tels quels donnerait `C:\dossier\sous/fichier.txt`.
 */
export function joinPath(parent: string, child: string): string {
  const separator = separatorOf(parent);
  const normalized = child.replace(/[\\/]+/g, separator);
  return `${parent.replace(/[\\/]+$/, "")}${separator}${normalized}`;
}

/** Nom sans extension. */
export function stemOf(name: string): string {
  const index = name.lastIndexOf(".");
  return index > 0 ? name.slice(0, index) : name;
}

/** Remplace l'extension d'un nom de fichier. */
export function withExtension(name: string, extension: string): string {
  return `${stemOf(name)}.${extension.replace(/^\./, "")}`;
}

/** Chemin raccourci pour l'affichage : `…/dossier/fichier.txt`. */
export function shortenPath(path: string, segments = 3): string {
  const separator = separatorOf(path);
  const parts = path.split(/[\\/]/).filter(Boolean);
  if (parts.length <= segments) return path;
  return `…${separator}${parts.slice(-segments).join(separator)}`;
}
