import { useState } from "react";
import { FileDropZone } from "@/components/files/FileDropZone";
import { RunBar } from "@/components/files/NativeRun";
import { Field, Fieldset, NumberInput, OptionGroup, Select } from "@/components/pdf/Field";
import { ResultPanel, type OperationOutcome } from "@/components/pdf/ResultPanel";
import { Callout } from "@/components/ui/Callout";
import { constraintsForTool, formatFileSize, type SelectedFile } from "@/core/files";
import { useJob } from "@/core/jobs";
import { compressToSize } from "@/core/internet/native";
import { targetBytes, type SizeUnit } from "@/core/internet/format";
import { cleanup, readBytes, stage } from "@/core/media/client";
import { outputName } from "@/core/pdf/filenames";
import { isTauri } from "@/core/platform";
import { useHandoff } from "@/features/handoff/store";
import { notify } from "@/features/notifications/store";
import type { ToolComponentProps } from "@/tools/implementations";
import { compressImage, compressPdfToSize } from "./compressToSizeCore";
import { formatDecimalSize, localized, t, tx } from "@/i18n";

type Kind = "video" | "audio" | "image" | "pdf";

const VIDEO_EXT = new Set(["mp4", "mkv", "webm", "mov", "avi"]);
const AUDIO_EXT = new Set(["mp3", "wav", "flac", "ogg", "m4a", "aac", "opus"]);
const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "webp"]);

function kindOf(file: SelectedFile): Kind | undefined {
  if (file.extension === "pdf") return "pdf";
  if (VIDEO_EXT.has(file.extension)) return "video";
  if (AUDIO_EXT.has(file.extension)) return "audio";
  if (IMAGE_EXT.has(file.extension)) return "image";
  return undefined;
}

const IMAGE_FORMATS = localized(() => [
  { value: "jpeg" as const, label: "JPEG", hint: t("Qualité et définition ajustées.") },
  { value: "webp" as const, label: "WebP", hint: t("Sans perte : seule la définition varie.") },
  { value: "png" as const, label: "PNG", hint: t("Sans perte : seule la définition varie.") },
]);

const AUDIO_FORMATS = localized(() => [
  { value: "mp3", label: "MP3" },
  { value: "m4a", label: "M4A (AAC)" },
  { value: "opus", label: "Opus" },
  { value: "ogg", label: "Ogg Vorbis" },
]);

const WARNINGS = localized(() => ({
  "already-smaller": t("Le média pesait déjà moins que la cible sur certains flux : le débit n'a pas été augmenté."),
  downscaled: t("La définition a été réduite pour que le débit suffise."),
  impossible: t("La cible est irréaliste pour cette durée."),
  "very-low-quality": t("Le débit est très bas : la qualité sera nettement dégradée."),
  "unknown-duration": t("Durée inconnue."),
}));

/** Lit un fichier temporaire produit par le moteur natif. */
async function readTemp(path: string): Promise<Uint8Array> {
  const { invoke } = await import("@tauri-apps/api/core");
  return new Uint8Array(await invoke<ArrayBuffer>("media_read", { path }));
}

/**
 * Compresser jusqu'à une taille maximale.
 *
 * Une taille n'est jamais promise à l'octet près : l'outil calcule un réglage
 * avec une marge de sécurité, réessaie plus bas si le résultat dépasse, ne
 * grossit jamais l'image, et dit franchement quand la cible est hors d'atteinte.
 */
export function CompressToSizeTool({ tool }: ToolComponentProps) {
  const handoff = useHandoff(tool.id);
  const [files, setFiles] = useState<SelectedFile[]>(() => handoff?.files ?? []);
  const [value, setValue] = useState(25);
  const [unit, setUnit] = useState<SizeUnit>("mb");
  const [imageFormat, setImageFormat] = useState<"jpeg" | "webp" | "png">("jpeg");
  const [videoFormat, setVideoFormat] = useState<"mp4" | "webm">("mp4");
  const [audioFormat, setAudioFormat] = useState("mp3");
  const [outcome, setOutcome] = useState<OperationOutcome | null>(null);
  const job = useJob<OperationOutcome>();

  const file = files[0];
  const kind = file ? kindOf(file) : undefined;
  const target = targetBytes(value, unit);
  const needsNative = kind === "video" || kind === "audio";

  const run = async () => {
    if (!file || !kind || !target) return;
    setOutcome(null);
    const result = await job.run(async (context) => {
      const base = { report: context.report, signal: context.signal };
      if (file.size <= target) {
        throw new Error(t("Le fichier fait déjà {size}, sous la cible de {target} : rien à compresser.", { size: formatFileSize(file.size), target: formatDecimalSize(target) }));
      }
      if (kind === "video" || kind === "audio") {
        const extension = kind === "video" ? videoFormat : audioFormat;
        const staged = await stage(await readBytes(file), file.extension || "bin");
        let produced: string | undefined;
        try {
          const done = await compressToSize({ input: staged, kind, extension, maxBytes: target }, base);
          produced = done.path;
          const bytes = await readTemp(done.path);
          const notes = done.report.warnings.map((w) => tx(WARNINGS[w])).filter(Boolean);
          return {
            files: [{ name: outputName(file.name, "taille", extension), bytes, mimeType: kind === "video" ? `video/${extension}` : `audio/${extension}` }],
            summary: t("{size} pour une cible de {target} ({attempts} essai(s)).", { size: formatDecimalSize(bytes.length), target: formatDecimalSize(target), attempts: done.report.attempts }),
            warning: notes.join(" ") || undefined,
          };
        } finally {
          await cleanup([staged, ...(produced ? [produced] : [])]);
        }
      }
      if (kind === "image") return compressImage(file, target, imageFormat, base);
      return compressPdfToSize(file, target, base);
    });
    if (result) {
      setOutcome(result);
      notify.success(t("Fichier prêt"), result.summary);
    }
  };

  const error = job.status === "error" && job.error ? (job.error.cause instanceof Error ? job.error.cause.message : job.error.message) : undefined;

  return (
    <div className="space-y-4">
      {needsNative && !isTauri() && (
        <Callout tone="info" title={t("Application installée requise")}>
          {t("Les vidéos et les sons sont réencodés par FFmpeg, qui n'est disponible que dans l'application FourTout installée.")}
        </Callout>
      )}
      <FileDropZone
        constraints={{ ...constraintsForTool(tool), maxFiles: 1 }}
        files={files}
        onChange={(next) => {
          setFiles(next);
          setOutcome(null);
        }}
        label={t("Déposez votre fichier ici")}
        hint={t("Vidéo, audio, image ou PDF")}
        disabled={job.isRunning}
      />

      {file && kind && (
        <Fieldset columns={2}>
          <Field label={t("Taille maximale visée")} hint={t("1 Mo = 1 000 000 octets : de la marge par rapport aux limites comptées en Mio.")}>
            <span className="flex items-center gap-2">
              <NumberInput className="!w-28" value={value} min={1} step={1} onChange={(e) => setValue(Number(e.target.value) || 1)} />
              <Select
                value={unit}
                onChange={setUnit}
                aria-label={t("Unité")}
                options={[
                  { value: "kb", label: t("Ko") },
                  { value: "mb", label: t("Mo") },
                  { value: "gb", label: t("Go") },
                ]}
              />
            </span>
          </Field>
          {kind === "image" && (
            <Field label={t("Format de sortie")}>
              <OptionGroup value={imageFormat} onChange={setImageFormat} options={IMAGE_FORMATS} ariaLabel={t("Format de sortie")} />
            </Field>
          )}
          {kind === "video" && (
            <Field label={t("Format de sortie")}>
              <OptionGroup value={videoFormat} onChange={setVideoFormat} ariaLabel={t("Format de sortie")} options={[{ value: "mp4", label: "MP4" }, { value: "webm", label: "WebM" }]} />
            </Field>
          )}
          {kind === "audio" && (
            <Field label={t("Format de sortie")}>
              <Select value={audioFormat} onChange={setAudioFormat} options={AUDIO_FORMATS} aria-label={t("Format de sortie")} />
            </Field>
          )}
          {kind === "pdf" && (
            <p className="ft-meta sm:col-span-full">
              {t("Les images du PDF sont réduites par paliers (légère, équilibrée, forte) jusqu'à passer sous la cible. Le texte reste du texte : rien n'est transformé en image.")}
            </p>
          )}
        </Fieldset>
      )}
      {file && !kind && (
        <Callout tone="warning" title={t("Format non pris en charge")}>
          {t("Cet outil traite les vidéos, les sons, les images PNG, JPEG et WebP, et les PDF.")}
        </Callout>
      )}

      {file && kind && (
        <RunBar
          label={t("Compresser")}
          icon="Minimize2"
          onRun={run}
          running={job.isRunning}
          progress={job.progress}
          disabled={!target || (needsNative && !isTauri())}
          cancel={job.cancel}
          status={job.status}
          error={error}
        />
      )}
      {outcome && <ResultPanel outcome={outcome} />}
    </div>
  );
}
