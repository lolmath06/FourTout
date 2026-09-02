import { useState } from "react";
import { ImageToolShell } from "@/components/image/ImageToolShell";
import { Field, Fieldset, OptionGroup } from "@/components/pdf/Field";
import { Button } from "@/components/ui/Button";
import { PreviewFrame } from "@/components/image/ImagePreview";
import { useImagePreview } from "@/components/image/useImagePreview";
import { processImages } from "@/core/image/pipeline";
import { flip, rotateQuarter } from "@/core/image/operations";
import type { SelectedFile } from "@/core/files";
import type { ToolComponentProps } from "@/tools/implementations";

/** Quart de tour horaire : 0, 1 (90°→), 2 (180°), 3 (90°←). */
const ROTATIONS = [
  { value: "0", label: "0°" },
  { value: "3", label: "90° ←" },
  { value: "1", label: "90° →" },
  { value: "2", label: "180°" },
];

export function RotateFlipTool({ tool, rotationEnabled = true }: ToolComponentProps & { rotationEnabled?: boolean }) {
  const [quarters, setQuarters] = useState("0");
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);

  const suffix = rotationEnabled ? "pivotee" : "miroir";

  return (
    <ImageToolShell
      tool={tool}
      actionLabel={rotationEnabled ? "Appliquer la rotation" : "Appliquer le miroir"}
      actionDisabled={quarters === "0" && !flipH && !flipV}
      run={async ({ files, context }) => {
        const outputs = await processImages(
          files,
          (canvas) => {
            let result = rotationEnabled ? rotateQuarter(canvas, Number(quarters)) : canvas;
            if (flipH) result = flip(result, "horizontal");
            if (flipV) result = flip(result, "vertical");
            return result;
          },
          { format: "same", suffix },
          context,
        );
        return {
          files: outputs,
          summary: `${outputs.length} image${outputs.length > 1 ? "s" : ""} traitée${outputs.length > 1 ? "s" : ""}.`,
          zipName: `images-${suffix}.zip`,
        };
      }}
    >
      {(files) => (
        <div className="space-y-3">
          <Fieldset columns={1}>
            {rotationEnabled && (
              <Field label="Rotation">
                <OptionGroup ariaLabel="Rotation" value={quarters} onChange={setQuarters} options={ROTATIONS} />
              </Field>
            )}
            <Field label="Miroir">
              <div className="flex gap-1.5">
                <Button size="sm" variant={flipH ? "primary" : "secondary"} onClick={() => setFlipH((v) => !v)}>
                  Horizontal
                </Button>
                <Button size="sm" variant={flipV ? "primary" : "secondary"} onClick={() => setFlipV((v) => !v)}>
                  Vertical
                </Button>
              </div>
            </Field>
          </Fieldset>
          <RotatePreview file={files[0]} quarters={Number(quarters)} flipH={flipH} flipV={flipV} rotationEnabled={rotationEnabled} />
        </div>
      )}
    </ImageToolShell>
  );
}

function RotatePreview({
  file,
  quarters,
  flipH,
  flipV,
  rotationEnabled,
}: {
  file: SelectedFile;
  quarters: number;
  flipH: boolean;
  flipV: boolean;
  rotationEnabled: boolean;
}) {
  const preview = useImagePreview(file);
  const rotate = rotationEnabled ? quarters * 90 : 0;
  const transform = `rotate(${rotate}deg) scale(${flipH ? -1 : 1}, ${flipV ? -1 : 1})`;
  return (
    <PreviewFrame maxHeight={340}>
      {preview.url && (
        <img
          src={preview.url}
          alt={file.name}
          className="max-h-[300px] max-w-full object-contain transition-transform"
          style={{ transform }}
          draggable={false}
        />
      )}
    </PreviewFrame>
  );
}
