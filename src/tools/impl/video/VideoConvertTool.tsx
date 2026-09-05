import { useEffect, useState } from "react";
import { VideoToolShell } from "@/components/media/VideoToolShell";
import { Field, Fieldset, OptionGroup, Select, Slider } from "@/components/pdf/Field";
import { runMedia } from "@/core/media/client";
import { convertPipeline } from "@/core/media/video/pipelines";
import {
  CONTAINER_LABEL,
  audioCodecsFor,
  mostCompatible,
  videoCodecsFor,
  type AudioCodecId,
  type MediaCapabilities,
  type VideoCodecId,
  type VideoContainerId,
} from "@/core/media/capabilities";
import {
  CONVERSION_PRESETS,
  crfRange,
  defaultCrf,
  levelOfPreset,
  supportsCrf,
  type ConversionPreset,
} from "@/core/media/video/presets";
import { outputName } from "@/core/pdf/filenames";
import type { ToolComponentProps } from "@/tools/implementations";
import {
  audioCodecOptions,
  containerOptions,
  defaultContainer,
  fallbackTracker,
  sizeOutcome,
  videoCodecOptions,
} from "./shared";

/**
 * Conversion d'une vidéo vers un autre format.
 *
 * L'interface ne propose **que** des combinaisons réellement encodables par le
 * FFmpeg installé : les codecs sont lus à l'exécution (`media_encoders`), pas
 * supposés. C'est ce qui évite le classique bouton qui échoue une minute plus
 * tard sur « Unknown encoder ».
 */
export function VideoConvertTool({ tool }: ToolComponentProps) {
  const [preset, setPreset] = useState<ConversionPreset>("compatible");
  const [container, setContainer] = useState<VideoContainerId | undefined>(undefined);
  const [videoCodec, setVideoCodec] = useState<VideoCodecId | undefined>(undefined);
  const [audioCodec, setAudioCodec] = useState<AudioCodecId | "none" | undefined>(undefined);
  const [crf, setCrf] = useState<number | undefined>(undefined);

  return (
    <VideoToolShell
      tool={tool}
      actionLabel="Convertir"
      hint="Les formats proposés sont ceux que le moteur installé sait réellement produire."
      run={async ({ files, infos, caps, context }) => {
        const choice = resolveChoice({ preset, container, videoCodec, audioCodec, crf, caps, file: files[0] });
        const pipeline = convertPipeline(
          { caps, info: infos[0], extension: files[0].extension },
          { container: choice.container, video: choice.video, audio: choice.audio ?? null, level: choice.level, crf: choice.crf },
        );
        const tracker = fallbackTracker(pipeline);
        const file = await runMedia(
          {
            files: [files[0]],
            operation: pipeline.operation,
            // En mode personnalisé, l'encodeur est un choix explicite de
            // l'utilisateur : on ne le remplace pas dans son dos.
            alternatives: preset === "custom" ? [] : pipeline.alternatives,
            onFallback: tracker.onFallback,
            outputName: outputName(files[0].name, "", pipeline.container),
            totalMs: infos[0]?.durationMs,
            label: "Conversion…",
          },
          context,
        );
        return sizeOutcome(
          files[0].size,
          file,
          `${CONTAINER_LABEL[pipeline.container]} produit :`,
          tracker.warning(),
        );
      }}
    >
      {({ files, caps }) => {
        const resolved = resolveChoice({ preset, container, videoCodec, audioCodec, crf, caps, file: files[0] });
        return (
          <Settings
            caps={caps}
            preset={preset}
            setPreset={setPreset}
            resolved={resolved}
            container={container ?? resolved.container}
            setContainer={(value) => {
              setContainer(value);
              setVideoCodec(videoCodecsFor(value, caps)[0]);
              setAudioCodec(audioCodecsFor(value, caps)[0]);
            }}
            videoCodec={videoCodec ?? resolved.video}
            setVideoCodec={setVideoCodec}
            audioCodec={audioCodec ?? resolved.audio ?? "none"}
            setAudioCodec={setAudioCodec}
            crf={crf}
            setCrf={setCrf}
          />
        );
      }}
    </VideoToolShell>
  );
}

interface ResolveInput {
  preset: ConversionPreset;
  container?: VideoContainerId;
  videoCodec?: VideoCodecId;
  audioCodec?: AudioCodecId | "none";
  crf?: number;
  caps: MediaCapabilities;
  file?: { extension: string };
}

/** Traduit préréglage + choix manuels en une combinaison réellement valide. */
function resolveChoice(input: ResolveInput) {
  const { preset, caps } = input;
  if (preset !== "custom") {
    const compatible = mostCompatible(caps);
    if (!compatible) throw new Error("Aucun encodeur vidéo n'est disponible dans le moteur installé.");
    return { ...compatible, level: levelOfPreset(preset) };
  }
  const container = input.container ?? defaultContainer(input.file?.extension, caps);
  const video = input.videoCodec ?? videoCodecsFor(container, caps)[0];
  const audio =
    input.audioCodec === "none" ? undefined : (input.audioCodec ?? audioCodecsFor(container, caps)[0]);
  return { container, video, audio, level: "balanced" as const, crf: input.crf };
}

function Settings({
  caps,
  preset,
  setPreset,
  resolved,
  container,
  setContainer,
  videoCodec,
  setVideoCodec,
  audioCodec,
  setAudioCodec,
  crf,
  setCrf,
}: {
  caps: MediaCapabilities;
  preset: ConversionPreset;
  setPreset: (value: ConversionPreset) => void;
  resolved: { container: VideoContainerId; video: VideoCodecId; audio?: AudioCodecId };
  container: VideoContainerId;
  setContainer: (value: VideoContainerId) => void;
  videoCodec: VideoCodecId;
  setVideoCodec: (value: VideoCodecId) => void;
  audioCodec: AudioCodecId | "none";
  setAudioCodec: (value: AudioCodecId | "none") => void;
  crf: number | undefined;
  setCrf: (value: number) => void;
}) {
  const encoder = caps.video[videoCodec];
  const range = encoder ? crfRange(encoder) : undefined;
  const fallbackCrf = encoder ? defaultCrf(encoder, "balanced") : undefined;

  // Le CRF n'a de sens que si l'encodeur retenu le comprend.
  useEffect(() => {
    if (preset === "custom" && crf === undefined && fallbackCrf !== undefined) setCrf(fallbackCrf);
  }, [preset, crf, fallbackCrf, setCrf]);

  return (
    <div className="space-y-3">
      <Fieldset columns={1}>
        <Field
          label="Préréglage"
          hint={CONVERSION_PRESETS.find((entry) => entry.value === preset)?.hint}
        >
          <OptionGroup
            ariaLabel="Préréglage"
            value={preset}
            onChange={setPreset}
            options={CONVERSION_PRESETS.map((entry) => ({ value: entry.value, label: entry.label }))}
          />
        </Field>
      </Fieldset>

      {preset === "custom" ? (
        <Fieldset columns={3}>
          <Field label="Format">
            <Select value={container} onChange={setContainer} options={containerOptions(caps)} />
          </Field>
          <Field label="Codec vidéo">
            <Select
              value={videoCodec}
              onChange={setVideoCodec}
              options={videoCodecOptions(container, caps)}
            />
          </Field>
          <Field label="Codec audio">
            <Select
              value={audioCodec}
              onChange={setAudioCodec}
              options={[...audioCodecOptions(container, caps), { value: "none" as const, label: "Aucun (muet)" }]}
            />
          </Field>
          {encoder && supportsCrf(encoder) && range ? (
            <Field
              label="Qualité (CRF)"
              full
              hint="Plus la valeur est basse, meilleure est la qualité — et plus le fichier est lourd."
            >
              <Slider
                value={crf ?? fallbackCrf ?? 25}
                onChange={setCrf}
                min={range.min}
                max={range.max}
              />
            </Field>
          ) : (
            <Field label="Qualité" full hint={`L'encodeur ${encoder ?? "sélectionné"} travaille à débit cible : la qualité suit le préréglage.`}>
              <p className="text-xs text-[var(--ft-text-muted)]">Débit calculé d'après la source.</p>
            </Field>
          )}
        </Fieldset>
      ) : (
        <p className="text-xs text-[var(--ft-text-muted)]">
          Sortie : {CONTAINER_LABEL[resolved.container]} · vidéo {resolved.video.toUpperCase()}
          {resolved.audio ? ` · audio ${resolved.audio.toUpperCase()}` : " · sans audio"} ·{" "}
          {caps.video[resolved.video]} (testé sur cette machine)
        </p>
      )}
    </div>
  );
}
