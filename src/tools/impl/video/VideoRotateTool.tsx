import { useState } from "react";
import { VideoToolShell } from "@/components/media/VideoToolShell";
import { Field, Fieldset, OptionGroup } from "@/components/pdf/Field";
import { runMedia } from "@/core/media/client";
import { VIDEO_TRANSFORMS, swapsDimensions, type VideoTransform } from "@/core/media/operations/video";
import { transformPipeline } from "@/core/media/video/pipelines";
import { outputName } from "@/core/pdf/filenames";
import type { ToolComponentProps } from "@/tools/implementations";
import { fallbackTracker, sizeOutcome } from "./shared";

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
        const pipeline = transformPipeline(
          { caps, info: infos[0], extension: files[0].extension },
          { transform },
        );
        const tracker = fallbackTracker(pipeline);
        const label = VIDEO_TRANSFORMS.find((entry) => entry.value === transform)?.label ?? "";
        const file = await runMedia(
          {
            files: [files[0]],
            operation: pipeline.operation,
            alternatives: pipeline.alternatives,
            onFallback: tracker.onFallback,
            outputName: outputName(files[0].name, "pivotee", pipeline.container),
            totalMs: infos[0]?.durationMs,
            label: "Rotation…",
          },
          context,
        );
        return sizeOutcome(files[0].size, file, `${label} :`, tracker.warning());
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
