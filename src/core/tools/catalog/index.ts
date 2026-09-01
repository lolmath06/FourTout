import type { ToolDefinition } from "../types";
import { pdfTools } from "./pdf";
import { imageTools } from "./images";
import { audioTools } from "./audio";
import { videoTools } from "./video";
import { textTools } from "./text";
import { fileTools } from "./files";
import { converterTools } from "./converters";
import { developerTools } from "./developer";
import { calculatorTools } from "./calculators";
import { securityTools } from "./security";

/**
 * Catalogue complet de FourTout.
 *
 * Pour ajouter un outil : éditer (ou créer) un fichier de ce dossier et
 * l'exporter ici. Rien d'autre à modifier — la navigation, la recherche,
 * les favoris et les récents s'appuient tous sur cette liste.
 */
export const ALL_TOOLS: ToolDefinition[] = [
  ...pdfTools,
  ...imageTools,
  ...audioTools,
  ...videoTools,
  ...textTools,
  ...fileTools,
  ...converterTools,
  ...developerTools,
  ...calculatorTools,
  ...securityTools,
];
