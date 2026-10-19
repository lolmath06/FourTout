import { useEffect, useState } from "react";
import { MediaToolShell } from "@/components/media/MediaToolShell";
import { Field, Fieldset, NumberInput, OptionGroup, TextInput } from "@/components/pdf/Field";
import { availableEncoders, runMedia } from "@/core/media/client";
import { videoToGif, videoToWebp } from "@/core/media/operations/video";
import { presetString, useHandoff } from "@/features/handoff/store";
import { parseTimecode } from "@/core/media/types";
import { outputName } from "@/core/pdf/filenames";
import type { ToolComponentProps } from "@/tools/implementations";
import { t } from "@/i18n";

export function VideoToGifTool({ tool }: ToolComponentProps) {
  // Le convertisseur universel peut préremplir « webp » ; `MediaToolShell`
  // consomme le relais pour le fichier, on lit donc le réglage d'abord.
  const handoff = useHandoff(tool.id);
  const [format, setFormat] = useState<"gif" | "webp">(presetString(handoff, "format") === "webp" ? "webp" : "gif");
  const [webpEncoder, setWebpEncoder] = useState<"libwebp_anim" | "libwebp" | null>(null);
  useEffect(() => {
    void availableEncoders().then((encoders) =>
      setWebpEncoder(encoders.includes("libwebp_anim") ? "libwebp_anim" : encoders.includes("libwebp") ? "libwebp" : null),
    );
  }, []);
  const [start, setStart] = useState("00:00:00.000");
  const [duration, setDuration] = useState(3);
  const [fps, setFps] = useState(12);
  const [width, setWidth] = useState(480);

  return (
    <MediaToolShell
      tool={tool}
      actionLabel={format === "webp" ? t("Créer le WebP animé") : t("Créer le GIF")}
      hint={t("Palette optimisée pour un GIF net. Gardez une durée courte pour un fichier raisonnable.")}
      run={async ({ files, context }) => {
        const startMs = parseTimecode(start) ?? 0;
        const durationMs = Math.max(0.1, duration) * 1000;
        if (format === "webp" && !webpEncoder) throw new Error(t("Ce FFmpeg ne sait pas produire de WebP animé."));
        const op =
          format === "webp"
            ? videoToWebp({ startMs, durationMs, fps, width, encoder: webpEncoder! })
            : videoToGif({ startMs, durationMs, fps, width });
        const file = await runMedia(
          { files: [files[0]], operation: op, outputName: outputName(files[0].name, "", format), totalMs: durationMs },
          context,
        );
        return {
          files: [file],
          summary: format === "webp"
            ? t("WebP animé {width}px, {fps} img/s, {duration}s.", { width, fps, duration })
            : t("GIF {width}px, {fps} img/s, {duration}s.", { width, fps, duration }),
        };
      }}
    >
      {() => (
        <Fieldset>
          {webpEncoder && (
            <Field label={t("Format")}>
              <OptionGroup
                value={format}
                onChange={setFormat}
                ariaLabel={t("Format de l'animation")}
                options={[
                  { value: "gif", label: "GIF" },
                  { value: "webp", label: t("WebP animé") },
                ]}
              />
            </Field>
          )}
          <Field label={t("Début (hh:mm:ss)")}><TextInput value={start} onChange={(e) => setStart(e.target.value)} className="font-mono" /></Field>
          <Field label={t("Durée (s)")}><NumberInput value={duration} min={0.5} max={30} step={0.5} onChange={(e) => setDuration(Number(e.target.value) || 3)} /></Field>
          <Field label="Images/s"><NumberInput value={fps} min={5} max={30} onChange={(e) => setFps(Number(e.target.value) || 12)} /></Field>
          <Field label={t("Largeur (px)")}><NumberInput value={width} min={120} max={1080} step={20} onChange={(e) => setWidth(Number(e.target.value) || 480)} /></Field>
        </Fieldset>
      )}
    </MediaToolShell>
  );
}
