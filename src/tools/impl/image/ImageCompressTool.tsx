import { useState } from "react";
import { ImageToolShell } from "@/components/image/ImageToolShell";
import { Field, Fieldset, OptionGroup, Slider } from "@/components/pdf/Field";
import { processImage } from "@/core/image/pipeline";
import { readSelectedFile } from "@/core/image/codec";
import { formatFileSize } from "@/core/files";
import type { ImageFormat } from "@/core/image/types";
import type { OutputFile } from "@/core/pdf/types";
import type { ToolComponentProps } from "@/tools/implementations";

const PRESETS = [
  { value: "light" as const, label: "Légère", quality: 85 },
  { value: "balanced" as const, label: "Équilibrée", quality: 70 },
  { value: "strong" as const, label: "Forte", quality: 55 },
  { value: "custom" as const, label: "Personnalisée", quality: 70 },
];

const TARGETS = [
  { value: "same" as const, label: "Conserver" },
  { value: "webp" as ImageFormat, label: "WebP" },
  { value: "jpeg" as ImageFormat, label: "JPEG" },
];

export function ImageCompressTool({ tool }: ToolComponentProps) {
  const [preset, setPreset] = useState<(typeof PRESETS)[number]["value"]>("balanced");
  const [custom, setCustom] = useState(70);
  const [target, setTarget] = useState<ImageFormat | "same">("same");
  const quality = preset === "custom" ? custom : PRESETS.find((p) => p.value === preset)!.quality;

  return (
    <ImageToolShell
      tool={tool}
      actionLabel="Compresser"
      hint="Astuce : WebP offre souvent le meilleur gain à qualité égale."
      run={async ({ files, context }) => {
        const outputs: OutputFile[] = [];
        let originalTotal = 0;
        let finalTotal = 0;
        let gains = 0;

        for (const [index, file] of files.entries()) {
          if (context.signal?.aborted) break;
          context.report?.({ ratio: index / files.length, label: `Image ${index + 1} sur ${files.length}` });
          const original = await readSelectedFile(file);
          const produced = await processImage(
            file,
            (canvas) => canvas,
            { format: target, quality: quality / 100, suffix: "compressee" },
            context,
          );
          originalTotal += original.length;
          // Ne jamais gonfler un fichier : si la sortie est plus lourde, on
          // conserve l'original tel quel.
          if (produced.bytes.length >= original.length) {
            finalTotal += original.length;
            outputs.push({ ...produced, bytes: original, mimeType: file.mimeType });
          } else {
            finalTotal += produced.bytes.length;
            gains += 1;
            outputs.push(produced);
          }
        }

        const saved = originalTotal - finalTotal;
        const percent = originalTotal > 0 ? Math.round((saved / originalTotal) * 100) : 0;
        const summary =
          gains === 0
            ? "Aucun gain significatif avec ces paramètres."
            : `${formatFileSize(originalTotal)} → ${formatFileSize(finalTotal)} · ${percent}% de gain (${formatFileSize(saved)}).`;
        return {
          files: outputs,
          summary,
          warning: gains === 0 ? "Les fichiers d'origine ont été conservés (aucune réduction possible)." : undefined,
          zipName: "images-compressees.zip",
        };
      }}
    >
      {() => (
        <Fieldset>
          <Field label="Niveau de compression" full>
            <OptionGroup
              ariaLabel="Niveau"
              value={preset}
              onChange={setPreset}
              options={PRESETS.map((p) => ({ value: p.value, label: p.label }))}
            />
          </Field>
          {preset === "custom" && (
            <Field label="Qualité">
              <Slider value={custom} onChange={setCustom} min={20} max={95} suffix=" %" />
            </Field>
          )}
          <Field label="Format de sortie" hint="WebP/JPEG compressent mieux que PNG.">
            <OptionGroup ariaLabel="Format cible" value={target} onChange={setTarget} options={TARGETS} />
          </Field>
        </Fieldset>
      )}
    </ImageToolShell>
  );
}
