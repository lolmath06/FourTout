/**
 * Construction des noms de fichiers de sortie.
 *
 * Règle FourTout : le fichier source n'est **jamais** modifié. Chaque opération
 * produit une copie dont le nom dit ce qui a été fait.
 */

/** Retire l'extension d'un nom de fichier. */
export function baseName(fileName: string): string {
  const index = fileName.lastIndexOf(".");
  return index > 0 ? fileName.slice(0, index) : fileName;
}

/**
 * Nettoie un fragment destiné à un nom de fichier : retire les caractères
 * interdits sous Windows, les caractères de contrôle et les espaces superflus.
 * Les accents sont conservés — les systèmes de fichiers modernes les gèrent, et
 * l'utilisateur reconnaît mieux son fichier.
 */
export function sanitizeFileNamePart(part: string): string {
  const forbidden = new RegExp("[\\\\/:*?\"<>|]", "g");
  // Les caractères de contrôle sont précisément ce qu'il faut retirer d'un
  // nom de fichier : la règle ESLint ne s'applique pas ici.
  // eslint-disable-next-line no-control-regex
  const control = new RegExp("[\\u0000-\\u001f\\u007f]", "g");
  return part
    .replace(forbidden, "-")
    .replace(control, "")
    .replace(/\s+/g, " ")
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .slice(0, 80);
}

/**
 * `document.pdf` + `merged` donne `document-merged.pdf`.
 * Un suffixe déjà présent n'est pas répété.
 */
export function outputName(sourceName: string, suffix: string, extension = "pdf"): string {
  const base = sanitizeFileNamePart(baseName(sourceName)) || "document";
  const cleanSuffix = sanitizeFileNamePart(suffix);
  const stem =
    cleanSuffix && !base.endsWith(`-${cleanSuffix}`) ? `${base}-${cleanSuffix}` : base;
  return `${stem}.${extension}`;
}

/** `document.pdf`, page 3 sur 12 donne `document-page-03.png`. */
export function numberedName(
  sourceName: string,
  index: number,
  total: number,
  extension: string,
  prefix = "page",
): string {
  const base = sanitizeFileNamePart(baseName(sourceName)) || "document";
  const width = Math.max(2, String(total).length);
  return `${base}-${prefix}-${String(index).padStart(width, "0")}.${extension}`;
}

/**
 * Évite d'écraser un fichier : `document.pdf` devient `document (2).pdf` si le
 * nom est déjà pris. `taken` contient les noms déjà utilisés (dossier ou lot).
 */
export function uniqueName(name: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((n) => n.toLowerCase()));
  if (!used.has(name.toLowerCase())) return name;

  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";

  for (let counter = 2; counter < 1000; counter += 1) {
    const candidate = `${stem} (${counter})${ext}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
  return `${stem} (${Date.now()})${ext}`;
}
