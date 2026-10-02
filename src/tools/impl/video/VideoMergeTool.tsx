import { useState } from "react";
import { VideoToolShell } from "@/components/media/VideoToolShell";
import { Field, Fieldset, OptionGroup, Select } from "@/components/pdf/Field";
import { Icon } from "@/components/ui/Icon";
import { runMedia } from "@/core/media/client";
import { concatCompatible, concatTarget, type ConcatSource } from "@/core/media/operations/video";
import { CONTAINER_LABEL, type VideoContainerId } from "@/core/media/capabilities";
import { mergePipeline } from "@/core/media/video/pipelines";
import { formatTimecode, type MediaInfo } from "@/core/media/types";
import { outputName } from "@/core/pdf/filenames";
import type { ToolComponentProps } from "@/tools/implementations";
import { containerOptions, defaultContainer, fallbackTracker, totalDuration } from "./shared";
import { t } from "@/i18n";

type Strategy = "auto" | "reencode";

/** Décrit une source pour la concaténation à partir de ce qu'a lu ffprobe. */
function sourceOf(info: MediaInfo | undefined): ConcatSource {
  return {
    width: info?.width,
    height: info?.height,
    frameRate: info?.frameRate,
    hasAudio: Boolean(info?.hasAudio),
    durationMs: info?.durationMs ?? 0,
    videoCodec: info?.videoCodec,
    audioCodec: info?.audioCodec,
    sampleRate: info?.sampleRate,
    channels: info?.channels,
  };
}

/**
 * Fusion de plusieurs vidéos bout à bout.
 *
 * Concaténer naïvement des flux incompatibles produit un fichier illisible ou
 * désynchronisé. L'outil compare donc réellement les sources : si elles
 * partagent codecs, définition et cadence, il recopie les flux (instantané) ;
 * sinon il normalise tout le monde — mise à l'échelle sans déformation, cadence
 * et audio communs — avant d'assembler.
 */
export function VideoMergeTool({ tool }: ToolComponentProps) {
  const [strategy, setStrategy] = useState<Strategy>("auto");
  const [container, setContainer] = useState<VideoContainerId | undefined>(undefined);

  return (
    <VideoToolShell
      tool={tool}
      selection="multiple"
      reorderable
      actionLabel={t("Fusionner")}
      hint={t("Déposez au moins deux vidéos, puis ordonnez-les par glisser-déposer.")}
      run={async ({ files, infos, caps, context }) => {
        if (files.length < 2) throw new Error(t("Déposez au moins deux vidéos à assembler."));
        const pipeline = mergePipeline(caps, {
          infos,
          extension: container ?? files[0].extension,
          container,
          forceReencode: strategy === "reencode",
        });
        const tracker = fallbackTracker(pipeline);
        const file = await runMedia(
          {
            files,
            operation: pipeline.operation,
            alternatives: pipeline.alternatives,
            onFallback: tracker.onFallback,
            outputName: outputName(files[0].name, "fusion", pipeline.container),
            totalMs: totalDuration(infos),
            label: pipeline.copied ? t("Assemblage…") : t("Normalisation et assemblage…"),
          },
          context,
        );
        return {
          files: [file],
          summary: pipeline.copied
            ? t("{count} vidéos assemblées sans réencodage ({value}).", { count: files.length, value: formatTimecode(totalDuration(infos)) })
            : t("{count} vidéos normalisées en {width} × {height} puis assemblées ({value}).", { count: files.length, width: pipeline.target.width, height: pipeline.target.height, value: formatTimecode(totalDuration(infos)) }),
          warning: tracker.warning(),
        };
      }}
    >
      {({ files, infos, caps }) => {
        const sources = infos.map(sourceOf);
        const compatible = files.length > 1 && concatCompatible(sources);
        const target = concatTarget(sources);
        return (
          <div className="space-y-2">
            <Fieldset columns={2}>
              <Field
                label={t("Méthode")}
                hint={
                  strategy === "auto"
                    ? t("Recopie les flux quand les vidéos sont identiques, normalise sinon.")
                    : t("Réencode systématiquement, même si les sources sont compatibles.")
                }
              >
                <OptionGroup
                  ariaLabel={t("Méthode")}
                  value={strategy}
                  onChange={setStrategy}
                  options={[
                    { value: "auto", label: t("Automatique") },
                    { value: "reencode", label: t("Toujours réencoder") },
                  ]}
                />
              </Field>
              <Field label={t("Format de sortie")}>
                <Select
                  value={container ?? defaultContainer(files[0]?.extension, caps)}
                  onChange={setContainer}
                  options={containerOptions(caps)}
                />
              </Field>
            </Fieldset>

            {files.length > 1 && (
              <p className="flex items-start gap-1.5 text-xs text-[var(--ft-text-muted)]">
                <Icon name={compatible && strategy === "auto" ? "Zap" : "Info"} size={13} className="mt-px shrink-0" />
                {compatible && strategy === "auto"
                  ? t("Sources identiques : assemblage sans réencodage, quasi instantané.")
                  : t("Sources différentes : elles seront normalisées en {width} × {height} à {frameRate} img/s avant assemblage.", { width: target.width, height: target.height, frameRate: target.frameRate })}
              </p>
            )}
            {files.length < 2 && (
              <p className="text-xs text-[var(--ft-text-muted)]">
                {t("Ajoutez au moins une seconde vidéo. Sortie : {value}.", { value: CONTAINER_LABEL[container ?? defaultContainer(files[0]?.extension, caps)] })}
              </p>
            )}
          </div>
        );
      }}
    </VideoToolShell>
  );
}
