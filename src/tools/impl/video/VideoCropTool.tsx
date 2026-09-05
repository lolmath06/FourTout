import { useEffect, useRef, useState } from "react";
import { VideoToolShell } from "@/components/media/VideoToolShell";
import { VideoPreview } from "@/components/media/VideoPreview";
import { CropOverlay } from "@/components/media/CropOverlay";
import { Field, Fieldset, OptionGroup } from "@/components/pdf/Field";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { runMedia } from "@/core/media/client";
import { cropPipeline } from "@/core/media/video/pipelines";
import {
  CROP_RATIOS,
  centeredRect,
  cropRectFor,
  fitAspect,
  type CropRatioKey,
  type NormalizedRect,
} from "@/core/media/video/dimensions";
import { outputName } from "@/core/pdf/filenames";
import type { ToolComponentProps } from "@/tools/implementations";
import { fallbackTracker, sizeOutcome } from "./shared";

const DEFAULT_RECT: NormalizedRect = { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };

/**
 * Rognage visuel.
 *
 * La sélection se fait directement sur l'image, à la souris, et le rectangle
 * exporté est **exactement** celui affiché : les fractions sont converties en
 * pixels pairs contenus dans l'image (`cropRectFor`), jamais approximées côté
 * FFmpeg. Le préréglage 9:16 sert aux formats verticaux sans dépendre d'une
 * plateforme particulière.
 */
export function VideoCropTool({ tool }: ToolComponentProps) {
  const [rect, setRect] = useState<NormalizedRect>(DEFAULT_RECT);
  const [ratioKey, setRatioKey] = useState<CropRatioKey>("free");
  const videoRef = useRef<HTMLVideoElement>(null);
  const ratio = CROP_RATIOS.find((entry) => entry.value === ratioKey)?.ratio ?? 0;

  return (
    <VideoToolShell
      tool={tool}
      actionLabel="Rogner"
      showFileList={false}
      hint="Faites glisser la zone ou ses poignées ; le résultat correspond exactement à la sélection."
      run={async ({ files, infos, caps, context }) => {
        const pipeline = cropPipeline(
          { caps, info: infos[0], extension: files[0].extension },
          { rect },
        );
        const tracker = fallbackTracker(pipeline);
        const file = await runMedia(
          {
            files: [files[0]],
            operation: pipeline.operation,
            alternatives: pipeline.alternatives,
            onFallback: tracker.onFallback,
            outputName: outputName(files[0].name, "rognee", pipeline.container),
            totalMs: infos[0]?.durationMs,
            label: "Rognage…",
          },
          context,
        );
        return sizeOutcome(
          files[0].size,
          file,
          `${pipeline.rect.width} × ${pipeline.rect.height} :`,
          tracker.warning(),
        );
      }}
    >
      {({ files, infos }) => {
        const source = { width: infos[0]?.width ?? 0, height: infos[0]?.height ?? 0 };
        const pixels = source.width ? cropRectFor(source, rect) : undefined;
        return (
          <div className="space-y-3">
            <Fieldset columns={1}>
              <Field label="Proportions">
                <OptionGroup
                  ariaLabel="Proportions"
                  value={ratioKey}
                  onChange={(key) => {
                    setRatioKey(key);
                    const next = CROP_RATIOS.find((entry) => entry.value === key)?.ratio ?? 0;
                    if (next > 0 && source.width) setRect(fitAspect(rect, source, next));
                  }}
                  options={CROP_RATIOS.map((entry) => ({ value: entry.value, label: entry.label }))}
                />
              </Field>
            </Fieldset>

            <CropStage
              file={files[0]}
              videoRef={videoRef}
              rect={rect}
              onChange={setRect}
              source={source}
              ratio={ratio}
            />

            <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--ft-text-muted)]">
              <Button
                size="sm"
                onClick={() => setRect(source.width ? centeredRect(source, ratio) : DEFAULT_RECT)}
              >
                <Icon name="Crop" size={13} /> Centrer la sélection
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setRect(DEFAULT_RECT)}>
                Réinitialiser
              </Button>
              {pixels && (
                <span className="tabular-nums">
                  Sélection : {pixels.width} × {pixels.height} px, à ({pixels.x}, {pixels.y}) — source{" "}
                  {source.width} × {source.height}
                </span>
              )}
            </div>
          </div>
        );
      }}
    </VideoToolShell>
  );
}

function CropStage({
  file,
  videoRef,
  rect,
  onChange,
  source,
  ratio,
}: {
  file: Parameters<typeof VideoPreview>[0]["file"];
  videoRef: React.RefObject<HTMLVideoElement | null>;
  rect: NormalizedRect;
  onChange: (rect: NormalizedRect) => void;
  source: { width: number; height: number };
  ratio: number;
}) {
  // Dès que les proportions réelles sont connues, la sélection s'y conforme.
  useEffect(() => {
    if (ratio > 0 && source.width) onChange(fitAspect(rect, source, ratio));
    // Volontairement limité au changement de ratio/source : sinon la sélection
    // serait recalculée à chaque déplacement de la souris.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ratio, source.width, source.height]);

  return (
    <VideoPreview
      file={file}
      videoRef={videoRef}
      maxHeight={380}
      overlay={<CropOverlay rect={rect} onChange={onChange} source={source} ratio={ratio} />}
    />
  );
}
