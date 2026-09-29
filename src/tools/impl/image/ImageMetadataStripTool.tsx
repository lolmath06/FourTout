import { ImageToolShell } from "@/components/image/ImageToolShell";
import { processImages } from "@/core/image/pipeline";
import type { ToolComponentProps } from "@/tools/implementations";

export function ImageMetadataStripTool({ tool }: ToolComponentProps) {
  return (
    <ImageToolShell
      tool={tool}
      actionLabel="Supprimer les métadonnées"
      hint="EXIF, GPS et informations d'appareil sont retirés ; l'orientation est appliquée à l'image."
      run={async ({ files, context }) => {
        // Le simple ré-encodage des pixels supprime toutes les métadonnées.
        // L'orientation EXIF est d'abord appliquée pour conserver le bon sens.
        const outputs = await processImages(
          files,
          (canvas) => canvas,
          { format: "same", suffix: "propre", applyOrientation: true },
          context,
        );
        return {
          files: outputs,
          summary: `Métadonnées supprimées de ${outputs.length} image${outputs.length > 1 ? "s" : ""}.`,
          zipName: "images-sans-metadonnees.zip",
        };
      }}
    />
  );
}
