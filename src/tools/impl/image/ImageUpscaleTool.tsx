import { useState } from "react";
import { ImageToolShell } from "@/components/image/ImageToolShell";
import { ModelRequirements } from "@/components/speech/ModelRequirements";
import { Field, Fieldset, OptionGroup } from "@/components/pdf/Field";
import { Callout } from "@/components/ui/Callout";
import { StatGrid } from "@/components/files/Summary";
import { useSourceCanvas } from "@/components/image/useSourceCanvas";
import { processImage } from "@/core/image/pipeline";
import { loadUpscaler, UPSCALE_MODEL } from "@/core/image/upscaleEngine";
import { planTiles, upscaleCanvas, MAX_OUTPUT_PIXELS, type UpscaleFactor } from "@/core/image/upscale";
import type { ImageFormat } from "@/core/image/types";
import type { SelectedFile } from "@/core/files";
import type { ToolComponentProps } from "@/tools/implementations";
import { formatDecimalSize, formatNumber, t } from "@/i18n";

/**
 * Agrandir une image avec un réseau de super-résolution.
 *
 * Le modèle (Real-ESRGAN général x4 v3, BSD-3, 5 Mo) est installé à la demande
 * puis tourne sur la machine : l'image n'est envoyée nulle part. Ce n'est pas
 * un agrandissement bicubique — le réseau reconstruit textures et contours.
 */
export function ImageUpscaleTool({ tool }: ToolComponentProps) {
  const [factor, setFactor] = useState<UpscaleFactor>(4);
  const [format, setFormat] = useState<ImageFormat>("png");

  return (
    <ModelRequirements
      required={[UPSCALE_MODEL.id]}
      what={t("L'agrandissement par IA")}
      manageLabel={t("Gérer le modèle d'agrandissement")}
    >
      {() => (
        <ImageToolShell
          tool={tool}
          selection="single"
          actionLabel={t("Agrandir l'image")}
          hint={t("Un agrandissement ×4 d'une grande photo peut prendre plusieurs minutes : environ une seconde par tuile de 112 pixels.")}
          run={async ({ files, context }) => {
            const { session, tensor } = await loadUpscaler();
            let tiles = 0;
            let alpha = false;
            const output = await processImage(
              files[0],
              async (canvas) => {
                const result = await upscaleCanvas(canvas, factor, session, tensor, context);
                tiles = result.tiles;
                alpha = result.hadAlpha;
                return result.canvas;
              },
              { format, quality: 0.95, suffix: `x${factor}` },
              context,
            );
            return {
              files: [output],
              summary: t("Image agrandie ×{factor} en {tiles} tuiles.", { factor, tiles }),
              warning: alpha
                ? t("La transparence est conservée, mais agrandie par interpolation ordinaire : le réseau ne traite que les couleurs.")
                : undefined,
            };
          }}
        >
          {(files) => <UpscaleStage key={files[0].id} file={files[0]} factor={factor} setFactor={setFactor} format={format} setFormat={setFormat} />}
        </ImageToolShell>
      )}
    </ModelRequirements>
  );
}

function UpscaleStage({
  file,
  factor,
  setFactor,
  format,
  setFormat,
}: {
  file: SelectedFile;
  factor: UpscaleFactor;
  setFactor: (value: UpscaleFactor) => void;
  format: ImageFormat;
  setFormat: (value: ImageFormat) => void;
}) {
  const source = useSourceCanvas(file);
  const plan = source.width > 0 ? planTiles(source.width, source.height, factor) : null;

  return (
    <div className="space-y-3">
      <Fieldset columns={2}>
        <Field label={t("Facteur")} hint={t("×2 est calculé à partir du ×4 puis réduit de moitié : plus net qu'un simple agrandissement ×2.")}>
          <OptionGroup
            value={String(factor) as "2" | "4"}
            onChange={(v) => setFactor(Number(v) as UpscaleFactor)}
            ariaLabel={t("Facteur d'agrandissement")}
            options={[
              { value: "2", label: "×2" },
              { value: "4", label: "×4" },
            ]}
          />
        </Field>
        <Field label={t("Format de sortie")}>
          <OptionGroup
            value={format}
            onChange={setFormat}
            ariaLabel={t("Format de sortie")}
            options={[
              { value: "png", label: "PNG" },
              { value: "jpeg", label: "JPEG" },
              { value: "webp", label: "WebP" },
            ]}
          />
        </Field>
      </Fieldset>

      {plan && (
        <>
          <StatGrid
            columns={4}
            stats={[
              { label: t("Taille d'origine"), value: `${source.width} × ${source.height}` },
              { label: t("Taille obtenue"), value: `${formatNumber(plan.outputWidth)} × ${formatNumber(plan.outputHeight)}`, tone: plan.tooLarge ? "danger" : "neutral" },
              { label: t("Mémoire du résultat"), value: `≈ ${formatDecimalSize(plan.outputBytes)}`, tone: plan.outputBytes > 200_000_000 ? "warn" : "neutral" },
              { label: t("Tuiles à calculer"), value: plan.tiles.length },
            ]}
          />
          {plan.tooLarge && (
            <Callout tone="error" title={t("Résultat trop grand")}>
              {t("Le résultat dépasserait {limit} millions de pixels. Choisissez ×2, ou réduisez d'abord l'image.", { limit: MAX_OUTPUT_PIXELS / 1_000_000 })}
            </Callout>
          )}
        </>
      )}

      <Callout tone="neutral" title={t("Ce que fait ce modèle")}>
        {t("Il reconstruit des détails plausibles à partir de l'image : textures, contours, photos et dessins. Il ne devine pas ce qui n'y est pas — un visage minuscule reste approximatif, et du texte illisible le reste. Tout se passe sur votre machine ; l'image n'est envoyée nulle part.")}
      </Callout>
    </div>
  );
}
