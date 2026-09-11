import { toolRegistry, type ToolRegistry } from "@/core/tools/registry";
import type { DataKind, ToolDefinition } from "@/core/tools/types";

/**
 * Graphe de conversion.
 *
 * Il n'existe **aucune table de conversion écrite à la main** : les arêtes sont
 * dérivées du registre. Un outil déclare ce qu'il accepte (`acceptedInputs`) et
 * ce qu'il produit (`outputs`) ; s'il est rattaché à la catégorie
 * « Convertisseurs » (en propre ou via `alsoIn`) et qu'il est réellement
 * disponible, ses arêtes apparaissent ici.
 *
 * Conséquence directe : rendre un outil disponible suffit à l'exposer dans le
 * convertisseur universel : toute arête proposée est donc exécutable.
 */

export interface ConversionTarget {
  /** Extension produite, sans point. */
  to: string;
  /** Famille de la sortie, pour regrouper l'affichage. */
  kind: DataKind;
  toolId: string;
  toolName: string;
  toolIcon: string;
  /** Description de l'outil, affichée sous la carte. */
  description: string;
}

export interface ConversionEdge extends ConversionTarget {
  /**
   * Extension acceptée en entrée, sans point, ou `"*"` pour un outil qui
   * accepte réellement **n'importe quel** fichier.
   *
   * La compression d'un fichier seul en `.gz` est le cas typique : elle ne
   * connaît ni ne regarde le format de son entrée. Coder cela comme une liste
   * d'extensions serait mentir par omission — il y en aurait toujours une qui
   * manquerait.
   */
  from: string;
}

/** Source universelle : l'outil accepte tout ce qu'on lui donne. */
export const ANY_SOURCE = "*";

/** Le point d'entrée universel n'est pas lui-même une conversion. */
const EXCLUDED_TOOLS = new Set(["universal-converter"]);

/**
 * Ordre d'affichage des familles de sortie : on montre d'abord la conversion
 * « du même genre » (image → image), puis les changements de nature.
 */
const KIND_ORDER: DataKind[] = [
  "image",
  "video",
  "audio",
  "pdf",
  "document",
  "text",
  "data",
  "archive",
  "folder",
  "url",
  "none",
];

function isConverter(tool: ToolDefinition): boolean {
  return tool.category === "converters" || (tool.alsoIn?.includes("converters") ?? false);
}

/** Toutes les arêtes de conversion dérivées d'un registre. */
export function buildConversionEdges(registry: ToolRegistry = toolRegistry): ConversionEdge[] {
  const edges: ConversionEdge[] = [];

  for (const tool of registry.all()) {
    if (EXCLUDED_TOOLS.has(tool.id)) continue;
    if (!isConverter(tool)) continue;

    const sources = new Set<string>();
    for (const input of tool.acceptedInputs) {
      // Un dossier n'est pas un format : accepter un dossier d'images ne rend
      // pas l'outil capable de convertir n'importe quelle extension.
      if (input.kind === "none" || input.kind === "folder") continue;
      for (const extension of input.extensions) {
        sources.add(extension.toLowerCase());
      }
    }

    for (const output of tool.outputs) {
      if (output.kind === "none") continue;
      for (const extension of output.extensions) {
        if (extension === "*") continue;
        const to = extension.toLowerCase();
        for (const from of sources) {
          // Une « conversion » vers le même format n'en est pas une.
          if (from === to) continue;
          edges.push({
            from,
            to,
            kind: output.kind,
            toolId: tool.id,
            toolName: tool.name,
            toolIcon: tool.icon,
            description: tool.description,
          });
        }
      }
    }
  }

  return edges;
}

let cache: ConversionEdge[] | undefined;

function edges(): ConversionEdge[] {
  if (!cache) cache = buildConversionEdges();
  return cache;
}

/** Conversions possibles pour une extension donnée, dédoublonnées et triées. */
export function conversionsFor(
  extension: string,
  registry?: ToolRegistry,
): ConversionTarget[] {
  const from = extension.replace(/^\./, "").toLowerCase();
  const source = registry ? buildConversionEdges(registry) : edges();

  const seen = new Set<string>();
  const targets: ConversionTarget[] = [];
  for (const edge of source) {
    // Une arête universelle vaut pour toute extension, sauf la sienne propre :
    // compresser un `.gz` en `.gz` n'est pas une conversion.
    if (edge.from !== from && !(edge.from === ANY_SOURCE && edge.to !== from)) continue;
    // Premier outil rencontré pour un format donné : l'ordre du catalogue fait
    // foi (les outils « unitaires » y précèdent les traitements par lot).
    if (seen.has(edge.to)) continue;
    seen.add(edge.to);
    targets.push({
      to: edge.to,
      kind: edge.kind,
      toolId: edge.toolId,
      toolName: edge.toolName,
      toolIcon: edge.toolIcon,
      description: edge.description,
    });
  }

  return targets.sort(
    (a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.to.localeCompare(b.to),
  );
}

/** Toutes les extensions pour lesquelles au moins une conversion existe. */
export function convertibleExtensions(registry?: ToolRegistry): string[] {
  const source = registry ? buildConversionEdges(registry) : edges();
  return [...new Set(source.map((edge) => edge.from))].sort();
}

/** Libellé lisible d'une famille de sortie. */
export const KIND_LABELS: Record<DataKind, string> = {
  image: "Images",
  video: "Vidéo",
  audio: "Audio",
  pdf: "PDF",
  document: "Documents",
  text: "Texte",
  data: "Données",
  archive: "Archives",
  folder: "Dossiers",
  url: "Liens",
  none: "Autres",
};

/**
 * Réglage prérempli transmis à l'outil destinataire.
 *
 * Chaque outil de conversion sait lire la clé `format` ; la valeur est
 * l'extension cible telle qu'affichée à l'utilisateur.
 */
export function presetForTarget(target: ConversionTarget): Record<string, unknown> {
  return { format: target.to };
}
