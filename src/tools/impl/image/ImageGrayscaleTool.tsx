import { useState } from "react";
import { ImageToolShell } from "@/components/image/ImageToolShell";
import { Field, Fieldset, OptionGroup, Slider } from "@/components/pdf/Field";
import { PreviewFrame } from "@/components/image/ImagePreview";
import { useSourceCanvas } from "@/components/image/useSourceCanvas";
import { useProcessedPreview } from "@/components/image/useProcessedPreview";
import { processImages } from "@/core/image/pipeline";
import { grayscale, type GrayscaleMode } from "@/core/image/operations";
import type { SelectedFile } from "@/core/files";
import type { ToolComponentProps } from "@/tools/implementations";

export function ImageGrayscaleTool({ tool }: ToolComponentProps) {
  const [mode, setMode] = useState<GrayscaleMode>("grayscale");
  const [threshold, setThreshold] = useState(128);

  return (
    <ImageToolShell
      tool={tool}
      actionLabel="Convertir"
      run={async ({ files, context }) => {
        const outputs = await processImages(
          files,
          (canvas) => grayscale(canvas, { mode, threshold }),
          { format: "same", suffix: "nb" },
          context,
        );
        return {
          files: outputs,
          summary: `${outputs.length} image${outputs.length > 1 ? "s" : ""} en ${mode === "threshold" ? "noir et blanc" : "niveaux de gris"}.`,
          zipName: "images-nb.zip",
        };
      }}
    >
      {(files) => (
        <div className="space-y-3">
          <Fieldset columns={1}>
            <Field label="Rendu">
              <OptionGroup
                ariaLabel="Rendu"
                value={mode}
                onChange={setMode}
                options={[
                  { value: "grayscale", label: "Niveaux de gris" },
                  { value: "threshold", label: "Noir et blanc (seuil)" },
                ]}
              />
            </Field>
            {mode === "threshold" && (
              <Field label="Seuil">
                <Slider value={threshold} onChange={setThreshold} min={1} max={254} />
              </Field>
            )}
          </Fieldset>
          <GrayscalePreview file={files[0]} mode={mode} threshold={threshold} />
        </div>
      )}
    </ImageToolShell>
  );
}

function GrayscalePreview({ file, mode, threshold }: { file: SelectedFile; mode: GrayscaleMode; threshold: number }) {
  const source = useSourceCanvas(file);
  const url = useProcessedPreview(source.preview, (c) => grayscale(c, { mode, threshold }), [mode, threshold]);
  return (
    <PreviewFrame maxHeight={340}>
      {url && <img src={url} alt="Aperçu" className="max-h-[300px] max-w-full object-contain" draggable={false} />}
    </PreviewFrame>
  );
}
