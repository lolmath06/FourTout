import { useState } from "react";
import { VideoToolShell } from "@/components/media/VideoToolShell";
import { Field, Fieldset, OptionGroup, Slider } from "@/components/pdf/Field";
import { runMedia } from "@/core/media/client";
import { VOLUME_PRESETS } from "@/core/media/operations/video";
import { volumePipeline } from "@/core/media/video/pipelines";
import { outputName } from "@/core/pdf/filenames";
import type { ToolComponentProps } from "@/tools/implementations";
import { sizeOutcome } from "./shared";

/**
 * Réglage du volume de la bande son, image recopiée telle quelle.
 *
 * Au-delà de 100 %, un limiteur (`alimiter`) écrête proprement les crêtes au
 * lieu de les tronquer : c'est la différence entre « plus fort » et « saturé ».
 */
export function VideoVolumeTool({ tool }: ToolComponentProps) {
  const [percent, setPercent] = useState(150);

  return (
    <VideoToolShell
      tool={tool}
      actionLabel="Appliquer le volume"
      hint="Seule la piste audio est réencodée ; l'image reste intacte."
      run={async ({ files, infos, caps, context }) => {
        const pipeline = volumePipeline(
          { caps, info: infos[0], extension: files[0].extension },
          percent,
        );
        const file = await runMedia(
          {
            files: [files[0]],
            operation: pipeline.operation,
            outputName: outputName(
              files[0].name,
              percent === 0 ? "muette" : `volume-${percent}`,
              pipeline.container,
            ),
            totalMs: infos[0]?.durationMs,
            label: "Réglage du volume…",
          },
          context,
        );
        return sizeOutcome(
          files[0].size,
          file,
          percent === 0 ? "Piste audio supprimée :" : `Volume à ${percent} % :`,
        );
      }}
    >
      {() => (
        <div className="space-y-2">
          <Fieldset columns={1}>
            <Field label="Volume">
              <OptionGroup
                ariaLabel="Volume"
                value={String(percent)}
                onChange={(value) => setPercent(Number(value))}
                options={VOLUME_PRESETS.map((value) => ({
                  value: String(value),
                  label: value === 0 ? "Muet" : `${value} %`,
                }))}
              />
            </Field>
            <Field label="Réglage fin" hint="100 % = niveau d'origine.">
              <Slider value={percent} onChange={setPercent} min={0} max={300} step={5} suffix=" %" />
            </Field>
          </Fieldset>
          {percent > 100 && (
            <p className="text-xs text-[var(--ft-text-muted)]">
              Au-delà de 100 %, un limiteur évite la saturation des passages les plus forts.
            </p>
          )}
        </div>
      )}
    </VideoToolShell>
  );
}
