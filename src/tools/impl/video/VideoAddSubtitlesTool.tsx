import { useState } from "react";
import { VideoToolShell } from "@/components/media/VideoToolShell";
import { Field, Fieldset, Select, TextInput } from "@/components/pdf/Field";
import { Icon } from "@/components/ui/Icon";
import { runMedia } from "@/core/media/client";
import {
  CONTAINER_LABEL,
  SUBTITLE_ENCODER,
  type VideoContainerId,
} from "@/core/media/capabilities";
import {
  containerOfExtension,
  softSubtitlePipeline,
  subtitleContainerFor,
} from "@/core/media/video/pipelines";
import { outputName } from "@/core/pdf/filenames";
import type { ToolComponentProps } from "@/tools/implementations";

/**
 * Ajout d'un fichier SRT/VTT **comme piste** de sous-titres.
 *
 * Rien n'est incrusté dans l'image : le lecteur peut afficher ou masquer les
 * sous-titres. Tous les conteneurs n'acceptent pas les sous-titres textuels, et
 * tous les FFmpeg n'embarquent pas l'encodeur correspondant (`mov_text` pour le
 * MP4 est souvent absent) — l'outil ne propose donc que les formats réellement
 * écrivables, et bascule sur MKV quand le format d'origine ne convient pas.
 */
export function VideoAddSubtitlesTool({ tool }: ToolComponentProps) {
  const [container, setContainer] = useState<VideoContainerId | undefined>(undefined);
  const [language, setLanguage] = useState("fra");

  return (
    <VideoToolShell
      tool={tool}
      selection="multiple"
      actionLabel="Ajouter la piste"
      hint="Déposez la vidéo et le fichier de sous-titres (.srt, .vtt ou .ass)."
      run={async ({ files, infos, caps, context }) => {
        const videoIndex = files.findIndex((file) => file.kind === "video");
        const subIndex = files.findIndex((file) => ["srt", "vtt", "ass"].includes(file.extension));
        if (videoIndex < 0 || subIndex < 0) {
          throw new Error("Déposez une vidéo et un fichier de sous-titres (.srt, .vtt ou .ass).");
        }
        const pipeline = softSubtitlePipeline(
          { caps, info: infos[videoIndex], extension: files[videoIndex].extension },
          { container, language: language || undefined },
        );

        const file = await runMedia(
          {
            files: [files[videoIndex], files[subIndex]],
            operation: pipeline.operation,
            outputName: outputName(files[videoIndex].name, "sous-titree", pipeline.container),
            totalMs: infos[videoIndex]?.durationMs,
            label: "Ajout de la piste…",
          },
          context,
        );
        return {
          files: [file],
          summary:
            `Piste de sous-titres ajoutée (${CONTAINER_LABEL[pipeline.container]}, ` +
            `encodeur ${SUBTITLE_ENCODER[pipeline.container]}).`,
        };
      }}
    >
      {({ files, caps }) => {
        const videoFile = files.find((file) => file.kind === "video");
        const subFile = files.find((file) => ["srt", "vtt", "ass"].includes(file.extension));
        const options = caps.subtitleContainers;
        const target = container ?? subtitleContainerFor(videoFile?.extension, caps);

        if (options.length === 0) {
          return (
            <p className="flex items-start gap-2 rounded-md border border-[var(--ft-warn)] px-3 py-2 text-xs text-[var(--ft-warn)]">
              <Icon name="TriangleAlert" size={14} className="mt-px shrink-0" />
              Le moteur installé ne fournit aucun encodeur de sous-titres. Utilisez « Incruster des
              sous-titres » : le texte sera gravé dans l'image.
            </p>
          );
        }

        return (
          <div className="space-y-2">
            <Fieldset columns={2}>
              <Field
                label="Format de sortie"
                hint={
                  videoFile && containerOfExtension(videoFile.extension) !== target
                    ? "Le format d'origine n'accepte pas de piste de sous-titres avec ce moteur."
                    : undefined
                }
              >
                <Select
                  value={target ?? options[0]}
                  onChange={setContainer}
                  options={options.map((value) => ({ value, label: CONTAINER_LABEL[value] }))}
                />
              </Field>
              <Field label="Langue (code ISO)" hint="fra, eng, spa… Laissez vide pour ne rien déclarer.">
                <TextInput value={language} onChange={(event) => setLanguage(event.target.value)} />
              </Field>
            </Fieldset>
            {(!videoFile || !subFile) && (
              <p className="flex items-center gap-1.5 text-xs text-[var(--ft-warn)]">
                <Icon name="TriangleAlert" size={13} /> Il faut une vidéo et un fichier .srt/.vtt/.ass.
              </p>
            )}
          </div>
        );
      }}
    </VideoToolShell>
  );
}
