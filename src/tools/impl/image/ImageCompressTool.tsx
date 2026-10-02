import { useState } from "react";
import { ImageToolShell } from "@/components/image/ImageToolShell";
import { Field, Fieldset, OptionGroup, Slider } from "@/components/pdf/Field";
import { processImage } from "@/core/image/pipeline";
import { readSelectedFile } from "@/core/image/codec";
import { formatFileSize } from "@/core/files";
import type { ImageFormat } from "@/core/image/types";
import type { OutputFile } from "@/core/pdf/types";
import type { ToolComponentProps } from "@/tools/implementations";
import { localized, t } from "@/i18n";

const PRESETS = localized(() => [
  { value: "light" as const, label: t("Légère"), quality: 85 },
  { value: "balanced" as const, label: t("Équilibrée"), quality: 70 },
  { value: "strong" as const, label: t("Forte"), quality: 55 },
  { value: "custom" as const, label: t("Personnalisée"), quality: 70 },
]);

const TARGETS = localized(() => [
  { value: "same" as const, label: t("Conserver") },
  { value: "webp" as ImageFormat, label: t("WebP") },
  { value: "jpeg" as ImageFormat, label: "JPEG" },
]);

export function ImageCompressTool({ tool }: ToolComponentProps) {
  const [preset, setPreset] = useState<(typeof PRESETS)[number]["value"]>("balanced");
  const [custom, setCustom] = useState(70);
  const [target, setTarget] = useState<ImageFormat | "same">("same");
  const quality = preset === "custom" ? custom : PRESETS.find((p) => p.value === preset)!.quality;

  return (
    <ImageToolShell
      tool={tool}
      actionLabel={t("Compresser")}
      hint={t("Astuce : WebP offre souvent le meilleur gain à qualité égale.")}
      run={async ({ files, context }) => {
        const outputs: OutputFile[] = [];
        let originalTotal = 0;
        let finalTotal = 0;
        let gains = 0;

        for (const [index, file] of files.entries()) {
          if (context.signal?.aborted) break;
          context.report?.({ ratio: index / files.length, label: t("Image {value} sur {count}", { value: index + 1, count: files.length }) });
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
            ? t("Aucun gain significatif avec ces paramètres.")
            : t("{size} → {size2} · {percent}% de gain ({size3}).", { size: formatFileSize(originalTotal), size2: formatFileSize(finalTotal), percent, size3: formatFileSize(saved) });
        return {
          files: outputs,
          summary,
          warning: gains === 0 ? t("Les fichiers d'origine ont été conservés (aucune réduction possible).") : undefined,
          zipName: "images-compressees.zip",
        };
      }}
    >
      {() => (
        <Fieldset>
          <Field label={t("Niveau de compression")} full>
            <OptionGroup
              ariaLabel={t("Niveau")}
              value={preset}
              onChange={setPreset}
              options={PRESETS.map((p) => ({ value: p.value, label: p.label }))}
            />
          </Field>
          {preset === "custom" && (
            <Field label={t("Qualité")}>
              <Slider value={custom} onChange={setCustom} min={20} max={95} suffix=" %" />
            </Field>
          )}
          <Field label={t("Format de sortie")} hint={t("WebP/JPEG compressent mieux que PNG.")}>
            <OptionGroup ariaLabel={t("Format cible")} value={target} onChange={setTarget} options={TARGETS} />
          </Field>
        </Fieldset>
      )}
    </ImageToolShell>
  );
}
