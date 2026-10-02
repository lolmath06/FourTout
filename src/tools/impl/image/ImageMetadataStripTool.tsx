import { ImageToolShell } from "@/components/image/ImageToolShell";
import { processImages } from "@/core/image/pipeline";
import type { ToolComponentProps } from "@/tools/implementations";
import { t } from "@/i18n";

export function ImageMetadataStripTool({ tool }: ToolComponentProps) {
  return (
    <ImageToolShell
      tool={tool}
      actionLabel={t("Supprimer les métadonnées")}
      hint={t("EXIF, GPS et informations d'appareil sont retirés ; l'orientation est appliquée à l'image.")}
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
          summary: t("Métadonnées supprimées de {count} {count, plural, one {image} other {images}}.", { count: outputs.length }),
          zipName: "images-sans-metadonnees.zip",
        };
      }}
    />
  );
}
