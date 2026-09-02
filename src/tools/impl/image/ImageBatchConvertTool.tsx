import { useState } from "react";
import { ImageToolShell } from "@/components/image/ImageToolShell";
import { Field, Fieldset, OptionGroup, Slider } from "@/components/pdf/Field";
import { processImage } from "@/core/image/pipeline";
import { toImageError } from "@/core/image/errors";
import { formatFileSize } from "@/core/files";
import type { ImageFormat } from "@/core/image/types";
import type { OutputFile } from "@/core/pdf/types";
import type { ToolComponentProps } from "@/tools/implementations";

const FORMATS = [
  { value: "png" as ImageFormat, label: "PNG" },
  { value: "jpeg" as ImageFormat, label: "JPEG" },
  { value: "webp" as ImageFormat, label: "WebP" },
];

export function ImageBatchConvertTool({ tool }: ToolComponentProps) {
  const [format, setFormat] = useState<ImageFormat>("webp");
  const [quality, setQuality] = useState(85);

  return (
    <ImageToolShell
      tool={tool}
      actionLabel="Convertir le lot"
      hint="Déposez autant d'images que nécessaire : elles reçoivent toutes le même format."
      run={async ({ files, context }) => {
        const outputs: OutputFile[] = [];
        const failures: string[] = [];
        for (const [index, file] of files.entries()) {
          if (context.signal?.aborted) break;
          context.report?.({ ratio: index / files.length, label: `Image ${index + 1} sur ${files.length}` });
          try {
            outputs.push(await processImage(file, (c) => c, { format, quality: quality / 100 }, context));
          } catch (error) {
            failures.push(`${file.name} : ${toImageError(error).shortMessage}`);
          }
        }
        context.report?.({ ratio: 1, label: "Terminé" });
        const total = outputs.reduce((sum, f) => sum + f.bytes.length, 0);
        return {
          files: outputs,
          summary: `${outputs.length}/${files.length} images converties en ${format.toUpperCase()} · ${formatFileSize(total)}.`,
          warning: failures.length > 0 ? `${failures.length} échec(s) : ${failures.slice(0, 3).join(" ; ")}${failures.length > 3 ? "…" : ""}` : undefined,
          zipName: `images-${format}.zip`,
        };
      }}
    >
      {() => (
        <Fieldset>
          <Field label="Format" full><OptionGroup ariaLabel="Format" value={format} onChange={setFormat} options={FORMATS} /></Field>
          {format === "jpeg" && (
            <Field label="Qualité"><Slider value={quality} onChange={setQuality} min={40} max={100} suffix=" %" /></Field>
          )}
        </Fieldset>
      )}
    </ImageToolShell>
  );
}
