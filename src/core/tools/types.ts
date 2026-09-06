/**
 * Modèle de données central de FourTout.
 *
 * Une `ToolDefinition` est l'unique source de vérité pour un outil : elle
 * alimente la navigation, les catégories, la recherche, les favoris, les
 * récents, le futur convertisseur universel et le futur assistant local.
 * Aucune information d'outil ne doit être dupliquée ailleurs dans l'application.
 */

/** Identifiants de catégorie (voir `categories.ts`). */
export type CategoryId =
  | "pdf"
  | "images"
  | "audio"
  | "video"
  | "text"
  | "files"
  | "converters"
  | "developer"
  | "calculators"
  | "security";

/**
 * Capacités transverses d'un outil. Elles servent à filtrer, à afficher les
 * bons badges et, plus tard, à laisser l'assistant local raisonner sur ce
 * qu'un outil sait faire sans connaître son implémentation.
 */
export type ToolCapability =
  /** Traitement 100 % local (aucune donnée ne quitte la machine). */
  | "local"
  /** Nécessite un accès réseau (ex. taux de change). */
  | "network"
  /** Accepte plusieurs fichiers en entrée. */
  | "batch"
  /** Produit un ou plusieurs fichiers en sortie. */
  | "produces-files"
  /** Opération potentiellement longue : doit exposer une progression. */
  | "long-running"
  /** Opération destructive/irréversible (effacement sécurisé, caviardage…). */
  | "destructive"
  /** Nécessite un binaire externe (ffmpeg, tesseract…) fourni par l'app. */
  | "needs-sidecar"
  /** Accès matériel (micro, caméra). */
  | "needs-device";

/**
 * Familles de données manipulées. Volontairement grossier : c'est une aide au
 * matching (drag & drop, convertisseur universel), pas une liste MIME exacte.
 */
export type DataKind =
  | "pdf"
  | "image"
  | "audio"
  | "video"
  | "text"
  | "document"
  | "archive"
  | "data"
  | "folder"
  | "url"
  | "none";

/** Description d'une entrée acceptée par un outil. */
export interface ToolInput {
  kind: DataKind;
  /** Extensions acceptées, sans point. `["*"]` = toute extension de ce type. */
  extensions: string[];
  /** L'outil accepte-t-il plusieurs éléments de ce type ? */
  multiple?: boolean;
}

/** Description d'une sortie produite par un outil. */
export interface ToolOutput {
  kind: DataKind;
  extensions: string[];
}

export interface ToolDefinition {
  /** Identifiant stable, kebab-case, unique dans tout le catalogue. */
  id: string;
  /** Nom affiché (français). */
  name: string;
  /** Une phrase, affichée dans les listes et sur la page de l'outil. */
  description: string;
  /** Catégorie principale : détermine le rattachement « propriétaire ». */
  category: CategoryId;
  /**
   * Catégories secondaires : l'outil y est découvrable sans être dupliqué.
   * Une seule implémentation, plusieurs points d'entrée.
   */
  alsoIn?: CategoryId[];
  /** Nom d'icône `lucide-react` (voir `components/ui/Icon.tsx`). */
  icon: string;
  /** Termes de recherche additionnels (langage courant, verbes, formats). */
  keywords?: string[];
  /** Autres noms de l'outil, y compris en anglais. */
  aliases?: string[];
  capabilities: ToolCapability[];
  acceptedInputs: ToolInput[];
  outputs: ToolOutput[];
  /** Note affichée sur la page de l'outil (dépendance système, limite…). */
  note?: string;
}

/** Définition d'une catégorie. */
export interface CategoryDefinition {
  id: CategoryId;
  name: string;
  description: string;
  icon: string;
  /** Ordre d'affichage croissant. */
  order: number;
  /** Accent de couleur (clé de `styles/theme.css`, ex. "rose"). */
  accent: AccentName;
  keywords?: string[];
}

export type AccentName =
  | "red"
  | "amber"
  | "emerald"
  | "sky"
  | "violet"
  | "fuchsia"
  | "cyan"
  | "lime"
  | "orange"
  | "slate";

/** Route canonique d'un outil. Unique endroit où cette URL est construite. */
export function toolRoute(toolId: string): string {
  return `/tools/t/${toolId}`;
}

/** Route canonique d'une catégorie. */
export function categoryRoute(categoryId: CategoryId): string {
  return `/tools/${categoryId}`;
}
