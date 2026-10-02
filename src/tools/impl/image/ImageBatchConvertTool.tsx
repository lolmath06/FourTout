import { useState } from "react";
import { ImageToolShell } from "@/components/image/ImageToolShell";
import { Field, Fieldset, OptionGroup, Slider } from "@/components/pdf/Field";
import { processImage } from "@/core/image/pipeline";
import { toImageError } from "@/core/image/errors";
import { formatFileSize } from "@/core/files";
import type { ImageFormat } from "@/core/image/types";
import type { OutputFile } from "@/core/pdf/types";
import type { ToolComponentProps } from "@/tools/implementations";
import { localized, t } from "@/i18n";

const FORMATS = localized(() => [
  { value: "png" as ImageFormat, label: "PNG" },
  { value: "jpeg" as ImageFormat, label: "JPEG" },
  { value: "webp" as ImageFormat, label: t("WebP") },
]);

export function ImageBatchConvertTool({ tool }: ToolComponentProps) {
  const [format, setFormat] = useState<ImageFormat>("webp");
  const [quality, setQuality] = useState(85);

  return (
    <ImageToolShell
      tool={tool}
      actionLabel={t("Convertir le lot")}
      hint={t("Déposez autant d'images que nécessaire : elles reçoivent toutes le même format.")}
      run={async ({ files, context }) => {
        const outputs: OutputFile[] = [];
        const failures: string[] = [];
        for (const [index, file] of files.entries()) {
          if (context.signal?.aborted) break;
          context.report?.({ ratio: index / files.length, label: t("Image {value} sur {count}", { value: index + 1, count: files.length }) });
          try {
            outputs.push(await processImage(file, (c) => c, { format, quality: quality / 100 }, context));
          } catch (error) {
            failures.push(`${file.name} : ${toImageError(error).shortMessage}`);
          }
        }
        context.report?.({ ratio: 1, label: t("Terminé") });
        const total = outputs.reduce((sum, f) => sum + f.bytes.length, 0);
        return {
          files: outputs,
          summary: t("{count}/{filesCount} images converties en {value} · {size}.", { count: outputs.length, filesCount: files.length, value: format.toUpperCase(), size: formatFileSize(total) }),
          warning: failures.length > 0 ? t("{count} échec(s) : {value}{value2}", { count: failures.length, value: failures.slice(0, 3).join(" ; "), value2: failures.length > 3 ? "…" : "" }) : undefined,
          zipName: `images-${format}.zip`,
        };
      }}
    >
      {() => (
        <Fieldset>
          <Field label={t("Format")} full><OptionGroup ariaLabel={t("Format")} value={format} onChange={setFormat} options={FORMATS} /></Field>
          {format === "jpeg" && (
            <Field label={t("Qualité")}><Slider value={quality} onChange={setQuality} min={40} max={100} suffix=" %" /></Field>
          )}
        </Fieldset>
      )}
    </ImageToolShell>
  );
}
