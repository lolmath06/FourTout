import { useState } from "react";
import { VideoToolShell } from "@/components/media/VideoToolShell";
import { Field, Fieldset, OptionGroup, Select } from "@/components/pdf/Field";
import { formatFileSize } from "@/core/files";
import { runMedia } from "@/core/media/client";
import type { OutputFile } from "@/core/pdf/types";
import { VIDEO_TRANSFORMS, type VideoTransform } from "@/core/media/operations/video";
import { type VideoContainerId } from "@/core/media/capabilities";
import { batchPipeline, type BatchOperation } from "@/core/media/video/pipelines";
import { COMPRESSION_LABEL, type QualityLevel } from "@/core/media/video/presets";
import { RESOLUTION_PRESETS } from "@/core/media/video/dimensions";
import { AUDIO_FORMATS, type AudioFormat } from "@/core/media/types";
import { outputName } from "@/core/pdf/filenames";
import type { ToolComponentProps } from "@/tools/implementations";
import { containerOptions, totalDuration } from "./shared";
import { localized, t } from "@/i18n";

type Operation = BatchOperation;

const OPERATIONS: { value: Operation; label: string }[] = localized(() => [
  { value: "convert", label: t("Convertir") },
  { value: "compress", label: t("Compresser") },
  { value: "resize", label: t("Redimensionner") },
  { value: "rotate", label: t("Pivoter") },
  { value: "extract-audio", label: t("Extraire l'audio") },
]);

/**
 * Même opération appliquée à plusieurs vidéos.
 *
 * Seules les opérations réellement **indépendantes** d'un fichier à l'autre sont
 * proposées : convertir, compresser, redimensionner, pivoter, extraire l'audio.
 * Découper ou rogner demandent des réglages propres à chaque vidéo et n'ont
 * donc pas de sens en lot — mieux vaut l'assumer que produire n'importe quoi.
 *
 * Les fichiers sont traités **l'un après l'autre** : la mémoire reste
 * constante, la progression est réelle, et une annulation arrête le fichier en
 * cours sans laisser de résultat partiel.
 */
export function VideoBatchTool({ tool }: ToolComponentProps) {
  const [operation, setOperation] = useState<Operation>("compress");
  const [container, setContainer] = useState<VideoContainerId | undefined>(undefined);
  const [level, setLevel] = useState<QualityLevel>("balanced");
  const [height, setHeight] = useState(720);
  const [transform, setTransform] = useState<VideoTransform>("rotate-right");
  const [audioFormat, setAudioFormat] = useState<AudioFormat>("mp3");

  return (
    <VideoToolShell
      tool={tool}
      selection="multiple"
      actionLabel={t("Traiter le lot")}
      hint={t("Déposez plusieurs vidéos : la même opération leur est appliquée l'une après l'autre.")}
      run={async ({ files, infos, caps, context }) => {
        const outputs: OutputFile[] = [];
        // Le lot écrit un seul format, celui affiché : sans cela, des sources
        // d'extensions différentes ressortiraient dans des conteneurs différents
        // alors que l'interface n'en annonce qu'un.
        const target = container ?? containerOptions(caps)[0]?.value;
        const total = Math.max(1, totalDuration(infos));
        let done = 0;
        let savedBytes = 0;
        let fellBack = false;

        for (let index = 0; index < files.length; index += 1) {
          const file = files[index];
          const info = infos[index];
          // Même point de décision que les outils unitaires : conteneur,
          // encodeur réellement utilisable et repli logiciel compris.
          const pipeline = batchPipeline(
            { caps, info, extension: file.extension },
            { operation, container: target, level, height, transform, audioFormat },
          );

          // Progression globale : part faite + avancement du fichier courant.
          const report = (progress: { ratio?: number; label?: string }) =>
            context.report({
              ratio: (done + (progress.ratio ?? 0) * info.durationMs) / total,
              label: t("Fichier {value} sur {count} — {name}", { value: index + 1, count: files.length, name: file.name }),
            });

          const produced = await runMedia(
            {
              files: [file],
              operation: pipeline.operation,
              alternatives: pipeline.alternatives,
              onFallback: () => {
                fellBack = true;
              },
              outputName: outputName(file.name, pipeline.suffix, pipeline.outputExt),
              totalMs: info?.durationMs,
              label: t("Traitement…"),
            },
            { report, signal: context.signal },
          );
          outputs.push(produced);
          savedBytes += file.size - produced.bytes.length;
          done += info.durationMs;
        }

        const label = OPERATIONS.find((entry) => entry.value === operation)?.label ?? "";
        return {
          files: outputs,
          zipName: "fourtout-videos.zip",
          summary:
            t("{count} fichier(s) traité(s) — {value}.", { count: outputs.length, value: label.toLowerCase() }) +
            (operation === "extract-audio"
              ? ""
              : savedBytes > 0
                ? t(" {size} économisés au total.", { size: formatFileSize(savedBytes) })
                : t(" Le lot n'a pas gagné en poids ; les sources étaient déjà optimisées.")),
          warning: fellBack
            ? t("L'encodeur initial n'a pas pu démarrer sur au moins un fichier ; un encodeur logiciel a pris le relais.")
            : undefined,
        };
      }}
    >
      {({ caps }) => (
        <Fieldset columns={2}>
          <Field label={t("Opération")}>
            <OptionGroup
              ariaLabel={t("Opération")}
              value={operation}
              onChange={setOperation}
              options={OPERATIONS}
            />
          </Field>

          {operation === "extract-audio" ? (
            <Field label={t("Format audio")}>
              <Select
                value={audioFormat}
                onChange={setAudioFormat}
                options={AUDIO_FORMATS.map((value) => ({ value, label: value.toUpperCase() }))}
              />
            </Field>
          ) : (
            <Field label={t("Format de sortie")}>
              <Select
                value={container ?? containerOptions(caps)[0]?.value ?? "mp4"}
                onChange={setContainer}
                options={containerOptions(caps)}
              />
            </Field>
          )}

          {operation === "compress" && (
            <Field label={t("Niveau")} full>
              <OptionGroup
                ariaLabel={t("Niveau")}
                value={level}
                onChange={setLevel}
                options={(["high", "balanced", "small"] as QualityLevel[]).map((value) => ({
                  value,
                  label: COMPRESSION_LABEL[value],
                }))}
              />
            </Field>
          )}

          {operation === "resize" && (
            <Field label={t("Définition")} full>
              <Select
                value={String(height)}
                onChange={(value) => setHeight(Number(value))}
                options={RESOLUTION_PRESETS.map((value) => ({ value: String(value), label: `${value}p` }))}
              />
            </Field>
          )}

          {operation === "rotate" && (
            <Field label={t("Transformation")} full>
              <OptionGroup
                ariaLabel={t("Transformation")}
                value={transform}
                onChange={setTransform}
                options={VIDEO_TRANSFORMS.map((entry) => ({ value: entry.value, label: entry.label }))}
              />
            </Field>
          )}
        </Fieldset>
      )}
    </VideoToolShell>
  );
}
