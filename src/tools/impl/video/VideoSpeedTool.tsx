import { useState } from "react";
import { VideoToolShell } from "@/components/media/VideoToolShell";
import { Field, Fieldset, OptionGroup } from "@/components/pdf/Field";
import { runMedia } from "@/core/media/client";
import {
  SPEED_FACTORS,
  encodeVideo,
  speedAudioFilter,
  speedDurationMs,
  speedVideoFilter,
} from "@/core/media/operations/video";
import { audioCodecsFor } from "@/core/media/capabilities";
import { formatTimecode } from "@/core/media/types";
import { outputName } from "@/core/pdf/filenames";
import type { ToolComponentProps } from "@/tools/implementations";
import { defaultContainer, encodeArgsFor, sizeOutcome } from "./shared";

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
        const info = infos[0];
        const container = defaultContainer(files[0].extension, caps);
        const videoCodec = (["h264", "vp9", "h265", "av1"] as const).find((codec) => caps.video[codec]);
        if (!videoCodec) throw new Error("Aucun encodeur vidéo n'est disponible dans le moteur installé.");
        const audioCodec = audioCodecsFor(container, caps)[0];
        const { videoArgs, audioArgs } = encodeArgsFor(
          { container, video: videoCodec, audio: audioCodec, level: "balanced" },
          caps,
          info,
        );
        const file = await runMedia(
          {
            files: [files[0]],
            operation: encodeVideo({
              container,
              videoArgs,
              audioArgs,
              videoFilters: [speedVideoFilter(factor)],
              audioFilters: info?.hasAudio ? [speedAudioFilter(factor)] : [],
            }),
            outputName: outputName(files[0].name, `x${String(factor).replace(".", "-")}`, container),
            totalMs: speedDurationMs(info?.durationMs ?? 0, factor),
            label: "Changement de vitesse…",
          },
          context,
        );
        return sizeOutcome(files[0].size, file, `Vitesse ×${factor} :`);
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
