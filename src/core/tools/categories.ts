import type { CategoryDefinition, CategoryId } from "./types";

/**
 * Source de vérité des catégories.
 *
 * Ajouter une catégorie = ajouter une entrée ici + son id dans `CategoryId`.
 * Aucune page ni aucun composant n'a besoin d'être modifié : la navigation,
 * la page Outils et les filtres sont construits à partir de cette liste.
 */
export const CATEGORIES: CategoryDefinition[] = [
  {
    id: "pdf",
    name: "PDF",
    description: "Fusionner, découper, compresser, convertir et sécuriser des PDF.",
    icon: "FileText",
    order: 10,
    accent: "red",
    keywords: ["pdf", "document", "acrobat"],
  },
  {
    id: "images",
    name: "Images",
    description: "Convertir, compresser, redimensionner et nettoyer des images.",
    icon: "Image",
    order: 20,
    accent: "violet",
    keywords: ["image", "photo", "png", "jpg", "jpeg", "webp"],
  },
  {
    id: "audio",
    name: "Audio",
    description: "Convertir, découper, normaliser, transcrire et synthétiser du son.",
    icon: "AudioLines",
    order: 30,
    accent: "emerald",
    keywords: ["audio", "son", "musique", "mp3", "voix"],
  },
  {
    id: "video",
    name: "Vidéo",
    description: "Convertir, compresser, découper et sous-titrer des vidéos.",
    icon: "Clapperboard",
    order: 40,
    accent: "sky",
    keywords: ["video", "vidéo", "film", "mp4", "clip"],
  },
  {
    id: "text",
    name: "Texte & Documents",
    description: "Analyser, nettoyer, comparer et transformer du texte.",
    icon: "Type",
    order: 50,
    accent: "amber",
    keywords: ["texte", "text", "document", "markdown", "mots"],
  },
  {
    id: "files",
    name: "Fichiers & Archives",
    description: "Compresser, extraire, comparer, renommer et organiser des fichiers.",
    icon: "FolderArchive",
    order: 60,
    accent: "orange",
    keywords: ["fichier", "archive", "zip", "dossier"],
  },
  {
    id: "converters",
    name: "Convertisseurs",
    description: "Passer d'un format à un autre, quel que soit le type de fichier.",
    icon: "Repeat",
    order: 70,
    accent: "cyan",
    keywords: ["convertir", "conversion", "convert", "format", "transformer"],
  },
  {
    id: "developer",
    name: "Développeur",
    description: "Formater, encoder, générer et inspecter les formats techniques.",
    icon: "Code2",
    order: 80,
    accent: "fuchsia",
    keywords: ["dev", "développeur", "json", "code", "programmation"],
  },
  {
    id: "calculators",
    name: "Calculateurs",
    description: "Unités, pourcentages, dates, durées et calculs du quotidien.",
    icon: "Calculator",
    order: 90,
    accent: "lime",
    keywords: ["calcul", "unité", "conversion", "mesure", "math"],
  },
  {
    id: "security",
    name: "Sécurité & Confidentialité",
    description: "Mots de passe, chiffrement, empreintes et effacement de données.",
    icon: "ShieldCheck",
    order: 100,
    accent: "slate",
    keywords: ["sécurité", "confidentialité", "privacy", "chiffrement", "mot de passe"],
  },
];

const BY_ID = new Map<CategoryId, CategoryDefinition>(
  CATEGORIES.map((c) => [c.id, c]),
);

export function getCategory(id: CategoryId): CategoryDefinition | undefined {
  return BY_ID.get(id);
}

export function isCategoryId(value: string): value is CategoryId {
  return BY_ID.has(value as CategoryId);
}

/** Catégories triées pour affichage. */
export function listCategories(): CategoryDefinition[] {
  return [...CATEGORIES].sort((a, b) => a.order - b.order);
}
