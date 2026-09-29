import { useState } from "react";
import { ImageToolShell } from "@/components/image/ImageToolShell";
import { Field, Fieldset, NumberInput, OptionGroup, Slider } from "@/components/pdf/Field";
import { Button } from "@/components/ui/Button";
import { processImages } from "@/core/image/pipeline";
import { computeDimensions, resize } from "@/core/image/operations";
import type { ToolComponentProps } from "@/tools/implementations";

type Mode = "percentage" | "dimensions";

const PRESETS = [
  { label: "1920 × 1080", w: 1920, h: 1080 },
  { label: "1280 × 720", w: 1280, h: 720 },
  { label: "800 × 800", w: 800, h: 800 },
  { label: "512 × 512", w: 512, h: 512 },
];

export function ImageResizeTool({ tool }: ToolComponentProps) {
  const [mode, setMode] = useState<Mode>("percentage");
  const [percent, setPercent] = useState(50);
  const [width, setWidth] = useState(1280);
  const [height, setHeight] = useState(720);
  const [keepRatio, setKeepRatio] = useState(true);

  const disabled = mode === "dimensions" && width < 1 && height < 1;

  return (
    <ImageToolShell
      tool={tool}
      actionLabel="Redimensionner"
      actionDisabled={disabled}
      hint="En pourcentage, le lot s'adapte à chaque image."
      run={async ({ files, context }) => {
        const suffix = mode === "percentage" ? `${percent}pct` : "redimensionnee";
        const outputs = await processImages(
          files,
          (canvas) => {
            if (mode === "percentage") {
              return resize(canvas, (canvas.width * percent) / 100, (canvas.height * percent) / 100);
            }
            const target = computeDimensions(canvas.width, canvas.height, width, height, keepRatio);
            return resize(canvas, target.width, target.height);
          },
          { format: "same", suffix },
          context,
        );
        return {
          files: outputs,
          summary:
            mode === "percentage"
              ? `${outputs.length} image${outputs.length > 1 ? "s" : ""} à ${percent} %.`
              : `${outputs.length} image${outputs.length > 1 ? "s" : ""} redimensionnée${outputs.length > 1 ? "s" : ""}.`,
          zipName: "images-redimensionnees.zip",
        };
      }}
    >
      {() => (
        <Fieldset>
          <Field label="Méthode" full>
            <OptionGroup
              ariaLabel="Méthode"
              value={mode}
              onChange={setMode}
              options={[
                { value: "percentage", label: "Pourcentage" },
                { value: "dimensions", label: "Dimensions" },
              ]}
            />
          </Field>

          {mode === "percentage" ? (
            <Field label="Échelle" full>
              <Slider value={percent} onChange={setPercent} min={10} max={200} suffix=" %" />
            </Field>
          ) : (
            <>
              <Field label="Largeur (px)" hint="0 = calcul automatique">
                <NumberInput
                  value={width || ""}
                  min={0}
                  onChange={(e) => setWidth(Number(e.target.value))}
                />
              </Field>
              <Field label="Hauteur (px)" hint="0 = calcul automatique">
                <NumberInput
                  value={height || ""}
                  min={0}
                  onChange={(e) => setHeight(Number(e.target.value))}
                />
              </Field>
              <Field label="Proportions" full>
                <Button
                  size="sm"
                  variant={keepRatio ? "primary" : "secondary"}
                  onClick={() => setKeepRatio((v) => !v)}
                >
                  {keepRatio ? "Conserver les proportions" : "Déformation libre"}
                </Button>
              </Field>
              <Field label="Formats courants" full>
                <div className="flex flex-wrap gap-1.5">
                  {PRESETS.map((preset) => (
                    <Button
                      key={preset.label}
                      size="sm"
                      onClick={() => {
                        setWidth(preset.w);
                        setHeight(preset.h);
                        setKeepRatio(false);
                      }}
                    >
                      {preset.label}
                    </Button>
                  ))}
                </div>
              </Field>
            </>
          )}
        </Fieldset>
      )}
    </ImageToolShell>
  );
}
