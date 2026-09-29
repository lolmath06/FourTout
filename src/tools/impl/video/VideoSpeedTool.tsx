import { useState } from "react";
import { VideoToolShell } from "@/components/media/VideoToolShell";
import { Field, Fieldset, OptionGroup } from "@/components/pdf/Field";
import { runMedia } from "@/core/media/client";
import { SPEED_FACTORS, speedDurationMs } from "@/core/media/operations/video";
import { speedPipeline } from "@/core/media/video/pipelines";
import { formatTimecode } from "@/core/media/types";
import { outputName } from "@/core/pdf/filenames";
import type { ToolComponentProps } from "@/tools/implementations";
import { fallbackTracker, sizeOutcome } from "./shared";

/**
 * Accéléré et ralenti.
 *
 * L'image suit `setpts`, la bande son `atempo` — ce dernier n'acceptant qu'un
 * facteur entre 0,5 et 2, les facteurs extrêmes sont obtenus en enchaînant
 * plusieurs étages (même logique que les outils audio). La hauteur de la voix
 * n'est donc pas déformée, et l'audio reste synchrone avec l'image.
 */
export function VideoSpeedTool({ tool }: ToolComponentProps) {
  const [factor, setFactor] = useState(2);

  return (
    <VideoToolShell
      tool={tool}
      actionLabel="Changer la vitesse"
      hint="La bande son suit l'image sans changer de hauteur."
      run={async ({ files, infos, caps, context }) => {
        const pipeline = speedPipeline(
          { caps, info: infos[0], extension: files[0].extension },
          { factor },
        );
        const tracker = fallbackTracker(pipeline);
        const file = await runMedia(
          {
            files: [files[0]],
            operation: pipeline.operation,
            alternatives: pipeline.alternatives,
            onFallback: tracker.onFallback,
            outputName: outputName(files[0].name, `x${String(factor).replace(".", "-")}`, pipeline.container),
            totalMs: pipeline.durationMs,
            label: "Changement de vitesse…",
          },
          context,
        );
        return sizeOutcome(files[0].size, file, `Vitesse ×${factor} :`, tracker.warning());
      }}
    >
      {({ infos }) => {
        const duration = infos[0]?.durationMs ?? 0;
        return (
          <div className="space-y-2">
            <Fieldset columns={1}>
              <Field label="Vitesse">
                <OptionGroup
                  ariaLabel="Vitesse"
                  value={String(factor)}
                  onChange={(value) => setFactor(Number(value))}
                  options={SPEED_FACTORS.map((value) => ({ value: String(value), label: `${value}×` }))}
                />
              </Field>
            </Fieldset>
            {duration > 0 && (
              <p className="text-xs text-[var(--ft-text-muted)]">
                Durée : {formatTimecode(duration)} → {formatTimecode(speedDurationMs(duration, factor))}
                {factor < 1 ? " (ralenti)" : factor > 1 ? " (accéléré)" : ""}
              </p>
            )}
          </div>
        );
      }}
    </VideoToolShell>
  );
}
