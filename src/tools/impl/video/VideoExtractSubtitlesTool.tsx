import { useState } from "react";
import { VideoToolShell } from "@/components/media/VideoToolShell";
import { Field, Fieldset, OptionGroup, Select } from "@/components/pdf/Field";
import { Icon } from "@/components/ui/Icon";
import { runMedia } from "@/core/media/client";
import { extractSubtitleTrack } from "@/core/media/operations/video";
import { baseName } from "@/core/pdf/filenames";
import type { ToolComponentProps } from "@/tools/implementations";

/**
 * Extraction des pistes de sous-titres **déjà présentes** dans un fichier.
 *
 * Les pistes sont lues par ffprobe. Seules les pistes textuelles (SubRip, ASS,
 * WebVTT, mov_text) sont exportables : une piste graphique (PGS, DVD, DVB) est
 * une suite d'images, sa conversion en texte demanderait une reconnaissance de
 * caractères que cet outil ne fait pas — c'est dit, plutôt que promis à tort.
 */
export function VideoExtractSubtitlesTool({ tool }: ToolComponentProps) {
  const [order, setOrder] = useState(0);
  const [format, setFormat] = useState<"srt" | "vtt">("srt");

  return (
    <VideoToolShell
      tool={tool}
      actionLabel="Extraire les sous-titres"
      hint="Les pistes détectées dans le fichier sont listées ci-dessous."
      run={async ({ files, infos, context }) => {
        const tracks = infos[0]?.subtitles ?? [];
        if (tracks.length === 0) throw new Error("Ce fichier ne contient aucune piste de sous-titres.");
        const track = tracks.find((entry) => entry.order === order) ?? tracks[0];
        if (!track.textBased) {
          throw new Error(
            `La piste sélectionnée est au format image (${track.codecName ?? "inconnu"}) : elle ne peut pas être convertie en texte.`,
          );
        }
        const file = await runMedia(
          {
            files: [files[0]],
            operation: extractSubtitleTrack(track.order, format),
            outputName: `${baseName(files[0].name)}${track.language ? `-${track.language}` : ""}.${format}`,
            totalMs: infos[0]?.durationMs,
            label: "Extraction…",
          },
          context,
        );
        return {
          files: [file],
          summary: `Piste ${track.order + 1}${track.language ? ` (${track.language})` : ""} exportée en ${format.toUpperCase()}.`,
        };
      }}
    >
      {({ infos }) => {
        const tracks = infos[0]?.subtitles ?? [];
        if (tracks.length === 0) {
          return (
            <p className="flex items-start gap-2 rounded-md border border-[var(--ft-border)] bg-[var(--ft-surface-2)] px-3 py-2 text-xs text-[var(--ft-text-muted)]">
              <Icon name="Info" size={14} className="mt-px shrink-0" />
              Aucune piste de sous-titres dans ce fichier. Pour en créer une, utilisez « Générer les
              sous-titres d'une vidéo ».
            </p>
          );
        }
        const textual = tracks.filter((track) => track.textBased);
        return (
          <div className="space-y-2">
            <Fieldset columns={2}>
              <Field label={`Piste (${tracks.length} détectée${tracks.length > 1 ? "s" : ""})`}>
                <Select
                  value={String(order)}
                  onChange={(value) => setOrder(Number(value))}
                  options={tracks.map((track) => ({
                    value: String(track.order),
                    label:
                      `${track.order + 1}. ${track.language ?? "langue inconnue"}` +
                      `${track.title ? ` — ${track.title}` : ""} (${track.codecName ?? "?"})` +
                      `${track.textBased ? "" : " — image, non extractible"}`,
                  }))}
                />
              </Field>
              <Field label="Format d'export">
                <OptionGroup
                  ariaLabel="Format d'export"
                  value={format}
                  onChange={setFormat}
                  options={[
                    { value: "srt", label: "SRT" },
                    { value: "vtt", label: "WebVTT" },
                  ]}
                />
              </Field>
            </Fieldset>
            {textual.length < tracks.length && (
              <p className="flex items-start gap-1.5 text-xs text-[var(--ft-warn)]">
                <Icon name="TriangleAlert" size={13} className="mt-px shrink-0" />
                {tracks.length - textual.length} piste(s) sont au format image (PGS, DVD…) : elles ne
                contiennent pas de texte et ne peuvent pas être exportées en SRT.
              </p>
            )}
          </div>
        );
      }}
    </VideoToolShell>
  );
}
