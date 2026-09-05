import { useState } from "react";
import { VideoToolShell } from "@/components/media/VideoToolShell";
import { Field, Fieldset, OptionGroup } from "@/components/pdf/Field";
import { runMedia } from "@/core/media/client";
import {
  VIDEO_TRANSFORMS,
  encodeVideo,
  swapsDimensions,
  transformFilter,
  type VideoTransform,
} from "@/core/media/operations/video";
import { audioCodecsFor } from "@/core/media/capabilities";
import { outputName } from "@/core/pdf/filenames";
import type { ToolComponentProps } from "@/tools/implementations";
import { defaultContainer, encodeArgsFor, passthroughAudioArgs, sizeOutcome } from "./shared";

/**
 * Rotation et miroir, sur le modèle de la catégorie Images : un choix unique,
 * énoncé dans le sens où l'utilisateur le pense (« 90° à gauche »), et un
 * rappel des dimensions obtenues. L'audio est recopié tel quel.
 */
export function VideoRotateTool({ tool }: ToolComponentProps) {
  const [transform, setTransform] = useState<VideoTransform>("rotate-right");

  return (
    <VideoToolShell
      tool={tool}
      actionLabel="Appliquer"
      hint="Corrige une vidéo filmée dans le mauvais sens, ou produit un effet miroir."
      run={async ({ files, infos, caps, context }) => {
        const info = infos[0];
        const container = defaultContainer(files[0].extension, caps);
        const videoCodec = (["h264", "vp9", "h265", "av1"] as const).find((codec) => caps.video[codec]);
        if (!videoCodec) throw new Error("Aucun encodeur vidéo n'est disponible dans le moteur installé.");
        const { videoArgs } = encodeArgsFor(
          { container, video: videoCodec, audio: audioCodecsFor(container, caps)[0], level: "high" },
          caps,
          info,
        );
        const label = VIDEO_TRANSFORMS.find((entry) => entry.value === transform)?.label ?? "";
        const file = await runMedia(
          {
            files: [files[0]],
            operation: encodeVideo({
              container,
              videoArgs,
              audioArgs: passthroughAudioArgs(files[0].extension, info, container, caps),
              videoFilters: [transformFilter(transform)],
            }),
            outputName: outputName(files[0].name, "pivotee", container),
            totalMs: info?.durationMs,
            label: "Rotation…",
          },
          context,
        );
        return sizeOutcome(files[0].size, file, `${label} :`);
      }}
    >
      {({ infos }) => {
        const width = infos[0]?.width;
        const height = infos[0]?.height;
        const swapped = swapsDimensions(transform);
        return (
          <div className="space-y-2">
            <Fieldset columns={1}>
              <Field label="Transformation">
                <OptionGroup
                  ariaLabel="Transformation"
                  value={transform}
                  onChange={setTransform}
                  options={VIDEO_TRANSFORMS.map((entry) => ({ value: entry.value, label: entry.label }))}
                />
              </Field>
            </Fieldset>
            {width && height && (
              <p className="text-xs text-[var(--ft-text-muted)]">
                {width} × {height} → {swapped ? height : width} × {swapped ? width : height}
              </p>
            )}
          </div>
        );
      }}
    </VideoToolShell>
  );
}
