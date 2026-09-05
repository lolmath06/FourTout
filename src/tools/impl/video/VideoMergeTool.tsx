import { useState } from "react";
import { VideoToolShell } from "@/components/media/VideoToolShell";
import { Field, Fieldset, OptionGroup, Select } from "@/components/pdf/Field";
import { Icon } from "@/components/ui/Icon";
import { runMedia } from "@/core/media/client";
import {
  concatCompatible,
  concatTarget,
  concatVideoCopy,
  concatVideoReencode,
  type ConcatSource,
} from "@/core/media/operations/video";
import { audioCodecsFor, CONTAINER_LABEL, type VideoContainerId } from "@/core/media/capabilities";
import { formatTimecode, type MediaInfo } from "@/core/media/types";
import { outputName } from "@/core/pdf/filenames";
import type { ToolComponentProps } from "@/tools/implementations";
import { containerOptions, defaultContainer, encodeArgsFor, totalDuration } from "./shared";

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
      actionLabel="Fusionner"
      hint="Déposez au moins deux vidéos, puis ordonnez-les par glisser-déposer."
      run={async ({ files, infos, caps, context }) => {
        if (files.length < 2) throw new Error("Déposez au moins deux vidéos à assembler.");
        const sources = infos.map(sourceOf);
        const target = defaultContainer(container ?? files[0].extension, caps);
        const copyable = strategy === "auto" && concatCompatible(sources);

        let operation;
        if (copyable) {
          operation = concatVideoCopy(target);
        } else {
          const videoCodec = (["h264", "vp9", "h265", "av1"] as const).find((codec) => caps.video[codec]);
          if (!videoCodec) throw new Error("Aucun encodeur vidéo n'est disponible dans le moteur installé.");
          const { videoArgs, audioArgs } = encodeArgsFor(
            { container: target, video: videoCodec, audio: audioCodecsFor(target, caps)[0], level: "balanced" },
            caps,
          );
          operation = concatVideoReencode({ sources, container: target, videoArgs, audioArgs });
        }

        const file = await runMedia(
          {
            files,
            operation,
            outputName: outputName(files[0].name, "fusion", target),
            totalMs: totalDuration(infos),
            label: copyable ? "Assemblage…" : "Normalisation et assemblage…",
          },
          context,
        );
        const size = concatTarget(sources);
        return {
          files: [file],
          summary: copyable
            ? `${files.length} vidéos assemblées sans réencodage (${formatTimecode(totalDuration(infos))}).`
            : `${files.length} vidéos normalisées en ${size.width} × ${size.height} puis assemblées (${formatTimecode(totalDuration(infos))}).`,
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
                label="Méthode"
                hint={
                  strategy === "auto"
                    ? "Recopie les flux quand les vidéos sont identiques, normalise sinon."
                    : "Réencode systématiquement, même si les sources sont compatibles."
                }
              >
                <OptionGroup
                  ariaLabel="Méthode"
                  value={strategy}
                  onChange={setStrategy}
                  options={[
                    { value: "auto", label: "Automatique" },
                    { value: "reencode", label: "Toujours réencoder" },
                  ]}
                />
              </Field>
              <Field label="Format de sortie">
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
                  ? "Sources identiques : assemblage sans réencodage, quasi instantané."
                  : `Sources différentes : elles seront normalisées en ${target.width} × ${target.height} à ${target.frameRate} img/s avant assemblage.`}
              </p>
            )}
            {files.length < 2 && (
              <p className="text-xs text-[var(--ft-text-muted)]">
                Ajoutez au moins une seconde vidéo. Sortie : {CONTAINER_LABEL[container ?? defaultContainer(files[0]?.extension, caps)]}.
              </p>
            )}
          </div>
        );
      }}
    </VideoToolShell>
  );
}
