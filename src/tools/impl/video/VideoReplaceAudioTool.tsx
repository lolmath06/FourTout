import { useState } from "react";
import { VideoToolShell } from "@/components/media/VideoToolShell";
import { Field, Fieldset, OptionGroup } from "@/components/pdf/Field";
import { Icon } from "@/components/ui/Icon";
import { runMedia } from "@/core/media/client";
import {
  AUDIO_FIT_MODES,
  addAudioTrack,
  replaceAudio,
  type AudioFitMode,
} from "@/core/media/operations/video";
import { audioCodecsFor, CONTAINER_LABEL } from "@/core/media/capabilities";
import { audioBitrateKbps } from "@/core/media/video/presets";
import { formatTimecode } from "@/core/media/types";
import { outputName } from "@/core/pdf/filenames";
import type { ToolComponentProps } from "@/tools/implementations";
import { defaultContainer } from "./shared";

type Mode = "replace" | "add";

/**
 * Remplacement ou ajout de bande son.
 *
 * L'image n'est jamais réencodée : seule la piste audio est produite, ce qui
 * rend l'opération rapide et sans perte visuelle. Quand la vidéo et l'audio
 * n'ont pas la même durée, le choix est explicite plutôt que subi — couper à la
 * vidéo, couper à l'audio, ou boucler la bande son.
 *
 * L'ajout d'une **seconde** piste (sans supprimer l'existante) exige un
 * conteneur multi-pistes : la sortie passe alors en MKV, ce que l'outil annonce.
 */
export function VideoReplaceAudioTool({ tool }: ToolComponentProps) {
  const [mode, setMode] = useState<Mode>("replace");
  const [fit, setFit] = useState<AudioFitMode>("video");

  return (
    <VideoToolShell
      tool={tool}
      selection="multiple"
      actionLabel={mode === "replace" ? "Remplacer la bande son" : "Ajouter la piste"}
      hint="Déposez la vidéo et le fichier audio (deux fichiers)."
      run={async ({ files, infos, caps, context }) => {
        const videoIndex = files.findIndex((file) => file.kind === "video");
        const audioIndex = files.findIndex((file) => file.kind === "audio");
        if (videoIndex < 0 || audioIndex < 0) {
          throw new Error("Déposez une vidéo **et** un fichier audio.");
        }
        const videoFile = files[videoIndex];
        const audioFile = files[audioIndex];
        const videoInfo = infos[videoIndex];

        const container = mode === "add" ? "mkv" : defaultContainer(videoFile.extension, caps);
        const codec = audioCodecsFor(container, caps)[0];
        const encoder = codec ? caps.audio[codec] : undefined;
        if (!encoder) throw new Error("Aucun encodeur audio n'est disponible dans le moteur installé.");

        const operation =
          mode === "add"
            ? addAudioTrack({
                container,
                audioEncoder: encoder,
                bitrateKbps: audioBitrateKbps("high"),
                trackIndex: videoInfo?.audioStreams.length ?? 1,
              })
            : replaceAudio({
                container,
                audioArgs: ["-c:a", encoder, "-b:a", `${audioBitrateKbps("high")}k`],
                mode: fit,
                videoDurationMs: videoInfo?.durationMs ?? 0,
              });

        const file = await runMedia(
          {
            files: [videoFile, audioFile],
            operation,
            outputName: outputName(videoFile.name, mode === "add" ? "multi-audio" : "nouvelle-bande-son", container),
            totalMs: videoInfo?.durationMs,
            label: mode === "add" ? "Ajout de la piste…" : "Remplacement de la bande son…",
          },
          context,
        );
        return {
          files: [file],
          summary:
            mode === "add"
              ? `Piste « ${audioFile.name} » ajoutée (${CONTAINER_LABEL[container]}, ${(videoInfo?.audioStreams.length ?? 0) + 1} pistes audio).`
              : `Bande son remplacée par « ${audioFile.name} ».`,
        };
      }}
    >
      {({ files, infos }) => {
        const videoIndex = files.findIndex((file) => file.kind === "video");
        const audioIndex = files.findIndex((file) => file.kind === "audio");
        const videoMs = videoIndex >= 0 ? (infos[videoIndex]?.durationMs ?? 0) : 0;
        const audioMs = audioIndex >= 0 ? (infos[audioIndex]?.durationMs ?? 0) : 0;
        const ready = videoIndex >= 0 && audioIndex >= 0;

        return (
          <div className="space-y-2">
            <Fieldset columns={mode === "replace" ? 2 : 1}>
              <Field
                label="Opération"
                hint={
                  mode === "replace"
                    ? "L'ancienne bande son est retirée."
                    : "L'ancienne bande son est conservée ; la sortie passe en MKV (multi-pistes)."
                }
              >
                <OptionGroup
                  ariaLabel="Opération"
                  value={mode}
                  onChange={setMode}
                  options={[
                    { value: "replace", label: "Remplacer" },
                    { value: "add", label: "Ajouter une piste" },
                  ]}
                />
              </Field>
              {mode === "replace" && (
                <Field label="Durées différentes" hint={AUDIO_FIT_MODES.find((m) => m.value === fit)?.hint}>
                  <OptionGroup
                    ariaLabel="Durées différentes"
                    value={fit}
                    onChange={setFit}
                    options={AUDIO_FIT_MODES.map((entry) => ({ value: entry.value, label: entry.label }))}
                  />
                </Field>
              )}
            </Fieldset>

            {!ready ? (
              <p className="flex items-center gap-1.5 text-xs text-[var(--ft-warn)]">
                <Icon name="TriangleAlert" size={13} /> Il faut exactement une vidéo et un fichier audio.
              </p>
            ) : (
              <p className="text-xs text-[var(--ft-text-muted)]">
                Vidéo : {formatTimecode(videoMs)} · Audio : {formatTimecode(audioMs)}
                {Math.abs(videoMs - audioMs) > 500 && mode === "replace" ? " — durées différentes" : ""}
              </p>
            )}
          </div>
        );
      }}
    </VideoToolShell>
  );
}
