import { useState } from "react";
import { ImageToolShell } from "@/components/image/ImageToolShell";
import { Field, Fieldset, Slider } from "@/components/pdf/Field";
import { Button } from "@/components/ui/Button";
import { PreviewFrame } from "@/components/image/ImagePreview";
import { useSourceCanvas } from "@/components/image/useSourceCanvas";
import { useProcessedPreview } from "@/components/image/useProcessedPreview";
import { processImages } from "@/core/image/pipeline";
import { adjust, type AdjustOptions } from "@/core/image/operations";
import type { SelectedFile } from "@/core/files";
import type { ToolComponentProps } from "@/tools/implementations";

const NEUTRAL: Required<AdjustOptions> = { brightness: 0, contrast: 0, saturation: 0, gamma: 1 };

export function ImageAdjustTool({ tool }: ToolComponentProps) {
  const [options, setOptions] = useState<Required<AdjustOptions>>(NEUTRAL);
  const set = (key: keyof AdjustOptions) => (value: number) => setOptions((o) => ({ ...o, [key]: value }));
  const untouched =
    options.brightness === 0 && options.contrast === 0 && options.saturation === 0 && options.gamma === 1;

  return (
    <ImageToolShell
      tool={tool}
      selection="single"
      actionLabel="Appliquer les réglages"
      actionDisabled={untouched}
      run={async ({ files, context }) => {
        const outputs = await processImages(
          files,
          (canvas) => adjust(canvas, options),
          { format: "same", suffix: "ajustee" },
          context,
        );
        return { files: outputs, summary: "Réglages appliqués." };
      }}
    >
      {(files) => (
        <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
          <AdjustPreview file={files[0]} options={options} />
          <Fieldset columns={1}>
            <Field label={`Luminosité (${options.brightness > 0 ? "+" : ""}${options.brightness})`}>
              <Slider value={options.brightness} onChange={set("brightness")} min={-100} max={100} />
            </Field>
            <Field label={`Contraste (${options.contrast > 0 ? "+" : ""}${options.contrast})`}>
              <Slider value={options.contrast} onChange={set("contrast")} min={-100} max={100} />
            </Field>
            <Field label={`Saturation (${options.saturation > 0 ? "+" : ""}${options.saturation})`}>
              <Slider value={options.saturation} onChange={set("saturation")} min={-100} max={100} />
            </Field>
            <Field label={`Gamma (${options.gamma.toFixed(2)})`}>
              <Slider value={options.gamma} onChange={set("gamma")} min={0.2} max={2.5} step={0.05} />
            </Field>
            <Button size="sm" variant="ghost" onClick={() => setOptions(NEUTRAL)} disabled={untouched}>
              Réinitialiser
            </Button>
          </Fieldset>
        </div>
      )}
    </ImageToolShell>
  );
}

function AdjustPreview({ file, options }: { file: SelectedFile; options: AdjustOptions }) {
  const source = useSourceCanvas(file);
  const url = useProcessedPreview(
    source.preview,
    (c) => adjust(c, options),
    [options.brightness, options.contrast, options.saturation, options.gamma],
  );
  return (
    <PreviewFrame maxHeight={440}>
      {url && <img src={url} alt="Aperçu" className="max-h-[420px] max-w-full object-contain" draggable={false} />}
    </PreviewFrame>
  );
}
