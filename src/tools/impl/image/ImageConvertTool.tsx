import { useState } from "react";
import { ImageToolShell } from "@/components/image/ImageToolShell";
import { Field, Fieldset, OptionGroup, Slider } from "@/components/pdf/Field";
import { ColorField } from "@/components/image/ColorField";
import { Icon } from "@/components/ui/Icon";
import { processImages } from "@/core/image/pipeline";
import { formatFileSize } from "@/core/files";
import type { ImageFormat, Rgb } from "@/core/image/types";
import type { ToolComponentProps } from "@/tools/implementations";
import { presetString, useHandoff } from "@/features/handoff/store";

const FORMATS = [
  { value: "png" as ImageFormat, label: "PNG", hint: "Sans perte, transparence" },
  { value: "jpeg" as ImageFormat, label: "JPEG", hint: "Léger, photos" },
  { value: "webp" as ImageFormat, label: "WebP", hint: "Compact et moderne" },
];

/** Extension reçue du convertisseur universel → format interne. */
function presetFormat(value: string | undefined): ImageFormat | undefined {
  if (value === "jpg" || value === "jpeg") return "jpeg";
  if (value === "png" || value === "webp") return value;
  return undefined;
}

export function ImageConvertTool({ tool }: ToolComponentProps) {
  // Le convertisseur universel présélectionne le format demandé ; les réglages
  // fins (qualité, fond) restent à la main de l'utilisateur.
  const handoff = useHandoff(tool.id);
  const [format, setFormat] = useState<ImageFormat>(
    () => presetFormat(presetString(handoff, "format")) ?? "webp",
  );
  const [quality, setQuality] = useState(85);
  const [background, setBackground] = useState<Rgb>({ r: 255, g: 255, b: 255 });

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
      {(files) => (
        <Fieldset>
          {files.some((file) => file.extension === "gif") && (
            <div className="sm:col-span-full flex items-start gap-2 rounded-md border border-[var(--ft-border)] bg-[var(--ft-surface-2)] px-3 py-2 text-xs text-[var(--ft-text-muted)]">
              <Icon name="Info" size={14} className="mt-px shrink-0" />
              Les GIF animés sont convertis à partir de leur première image : l'animation n'est pas conservée.
            </div>
          )}
          <Field label="Format de sortie" full>
            <OptionGroup ariaLabel="Format" value={format} onChange={setFormat} options={FORMATS} />
          </Field>
          {format === "jpeg" && (
            <Field label="Qualité" hint="Plus la qualité est basse, plus le fichier est léger.">
              <Slider value={quality} onChange={setQuality} min={40} max={100} suffix=" %" />
            </Field>
          )}
          {format === "webp" && (
            <Field label="WebP" hint="Encodage sans perte : idéal pour les captures et les graphiques.">
              <p className="text-xs text-[var(--ft-text-muted)]">Qualité maximale conservée, fichier compact.</p>
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
