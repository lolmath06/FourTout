import { defineTools, IN, OUT } from "./shared";

/**
 * La catégorie « Convertisseurs » est majoritairement peuplée par les outils
 * des autres catégories via `alsoIn`. Elle ne contient en propre que le point
 * d'entrée universel, qui aiguillera vers le bon outil selon le fichier reçu.
 */
export const converterTools = defineTools([
  {
    id: "universal-converter",
    name: "Convertisseur universel",
    description:
      "Déposez un fichier : FourTout propose les conversions possibles vers les formats compatibles.",
    category: "converters",
    icon: "Shuffle",
    keywords: [
      "convertir", "conversion", "changer de format", "transformer",
      "n'importe quel fichier", "quel format", "convertisseur",
    ],
    aliases: ["universal converter", "convert anything", "file converter"],
    status: "planned",
    capabilities: ["local", "batch", "produces-files", "long-running"],
    acceptedInputs: [IN.anyFile()],
    outputs: [OUT.data()],
    note: "S'appuiera sur les entrées/sorties déclarées par chaque outil du registre : aucune table de conversion séparée à maintenir.",
  },
]);
