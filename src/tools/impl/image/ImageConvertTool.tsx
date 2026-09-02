import { useState } from "react";
import { ImageToolShell } from "@/components/image/ImageToolShell";
import { Field, Fieldset, OptionGroup, Slider } from "@/components/pdf/Field";
import { ColorField } from "@/components/image/ColorField";
import { processImages } from "@/core/image/pipeline";
import { formatFileSize } from "@/core/files";
import type { ImageFormat, Rgb } from "@/core/image/types";
import type { ToolComponentProps } from "@/tools/implementations";

const FORMATS = [
  { value: "png" as ImageFormat, label: "PNG", hint: "Sans perte, transparence" },
  { value: "jpeg" as ImageFormat, label: "JPEG", hint: "Léger, photos" },
  { value: "webp" as ImageFormat, label: "WebP", hint: "Compact et moderne" },
];

export function ImageConvertTool({ tool }: ToolComponentProps) {
  const [format, setFormat] = useState<ImageFormat>("webp");
  const [quality, setQuality] = useState(85);
  const [background, setBackground] = useState<Rgb>({ r: 255, g: 255, b: 255 });
  const lossy = format === "jpeg" || format === "webp";

  return (
    <ImageToolShell
      tool={tool}
      actionLabel="Convertir"
      hint="Formats lus : PNG, JPG, WebP, GIF, BMP, TIFF, SVG."
      run={async ({ files, context }) => {
        const outputs = await processImages(
          files,
          (canvas) => canvas,
          { format, quality: quality / 100, background: format === "jpeg" ? background : undefined },
          context,
        );
        const total = outputs.reduce((sum, file) => sum + file.bytes.length, 0);
        return {
          files: outputs,
          summary: `${outputs.length} image${outputs.length > 1 ? "s" : ""} en ${format.toUpperCase()} · ${formatFileSize(total)}.`,
          zipName: `images-${format}.zip`,
        };
      }}
    >
      {() => (
        <Fieldset>
          <Field label="Format de sortie" full>
            <OptionGroup ariaLabel="Format" value={format} onChange={setFormat} options={FORMATS} />
          </Field>
          {lossy && (
            <Field label="Qualité" hint="Plus la qualité est basse, plus le fichier est léger.">
              <Slider value={quality} onChange={setQuality} min={40} max={100} suffix=" %" />
            </Field>
          )}
          {format === "jpeg" && (
            <Field label="Fond (remplace la transparence)">
              <ColorField value={background} onChange={setBackground} />
            </Field>
          )}
        </Fieldset>
      )}
    </ImageToolShell>
  );
}
