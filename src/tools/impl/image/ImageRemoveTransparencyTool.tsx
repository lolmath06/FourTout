import { useState } from "react";
import { ImageToolShell } from "@/components/image/ImageToolShell";
import { Field, Fieldset } from "@/components/pdf/Field";
import { ColorField } from "@/components/image/ColorField";
import { PreviewFrame } from "@/components/image/ImagePreview";
import { useSourceCanvas } from "@/components/image/useSourceCanvas";
import { useProcessedPreview } from "@/components/image/useProcessedPreview";
import { processImages } from "@/core/image/pipeline";
import { removeTransparency } from "@/core/image/operations";
import type { Rgb } from "@/core/image/types";
import type { SelectedFile } from "@/core/files";
import type { ToolComponentProps } from "@/tools/implementations";
import { t } from "@/i18n";

export function ImageRemoveTransparencyTool({ tool }: ToolComponentProps) {
  const [color, setColor] = useState<Rgb>({ r: 255, g: 255, b: 255 });

  return (
    <ImageToolShell
      tool={tool}
      actionLabel={t("Aplatir sur ce fond")}
      hint={t("Utile avant d'imprimer ou d'envoyer un PNG transparent.")}
      run={async ({ files, context }) => {
        const outputs = await processImages(
          files,
          (canvas) => removeTransparency(canvas, color),
          { format: "same", suffix: "opaque" },
          context,
        );
        return {
          files: outputs,
          summary: t("{count} {count, plural, one {image} other {images}} {count, plural, one {aplatie} other {aplaties}}.", { count: outputs.length }),
          zipName: "images-opaques.zip",
        };
      }}
    >
      {(files) => (
        <div className="space-y-3">
          <Fieldset columns={1}>
            <Field label={t("Couleur de fond")}>
              <ColorField value={color} onChange={setColor} />
            </Field>
          </Fieldset>
          <RemovePreview file={files[0]} color={color} />
        </div>
      )}
    </ImageToolShell>
  );
}

function RemovePreview({ file, color }: { file: SelectedFile; color: Rgb }) {
  const source = useSourceCanvas(file);
  const url = useProcessedPreview(source.preview, (c) => removeTransparency(c, color), [color.r, color.g, color.b]);
  return (
    <PreviewFrame maxHeight={340}>
      {url && <img src={url} alt={t("Aperçu")} className="max-h-[300px] max-w-full object-contain" draggable={false} />}
    </PreviewFrame>
  );
}
