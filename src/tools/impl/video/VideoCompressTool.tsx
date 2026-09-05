import { useState } from "react";
import { VideoToolShell } from "@/components/media/VideoToolShell";
import { Field, Fieldset, OptionGroup } from "@/components/pdf/Field";
import { formatFileSize } from "@/core/files";
import { runMedia } from "@/core/media/client";
import { compressPipeline } from "@/core/media/video/pipelines";
import { COMPRESSION_LABEL, type QualityLevel } from "@/core/media/video/presets";
import { formatTimecode } from "@/core/media/types";
import { outputName } from "@/core/pdf/filenames";
import type { ToolComponentProps } from "@/tools/implementations";
import { fallbackTracker, sizeOutcome } from "./shared";

const MODES: { value: QualityLevel; label: string; hint: string }[] = [
  { value: "high", label: COMPRESSION_LABEL.high, hint: "Presque invisible à l'œil, gain modéré." },
  { value: "balanced", label: COMPRESSION_LABEL.balanced, hint: "Le meilleur compromis dans la plupart des cas." },
  { value: "small", label: COMPRESSION_LABEL.small, hint: "Fichier nettement plus léger, qualité en retrait." },
];

/**
 * Compression d'une vidéo.
 *
 * L'outil affiche l'état exact **avant** (taille, durée, définition, codec,
 * débit) et rend compte **après** sans embellir : si le fichier produit est plus
 * gros que l'original, il le dit et le déconseille au lieu d'annoncer « 0 % de
 * gain » comme une réussite.
 */
export function VideoCompressTool({ tool }: ToolComponentProps) {
  const [mode, setMode] = useState<QualityLevel>("balanced");

  return (
    <VideoToolShell
      tool={tool}
      actionLabel="Compresser"
      hint="La vidéo est réencodée localement ; le fichier d'origine n'est jamais modifié."
      run={async ({ files, infos, caps, context }) => {
        const pipeline = compressPipeline(
          { caps, info: infos[0], extension: files[0].extension },
          { level: mode },
        );
        const tracker = fallbackTracker(pipeline);
        const file = await runMedia(
          {
            files: [files[0]],
            operation: pipeline.operation,
            alternatives: pipeline.alternatives,
            onFallback: tracker.onFallback,
            outputName: outputName(files[0].name, "compressee", pipeline.container),
            totalMs: infos[0]?.durationMs,
            label: "Compression…",
          },
          context,
        );
        return sizeOutcome(files[0].size, file, `${COMPRESSION_LABEL[mode]} :`, tracker.warning());
      }}
    >
      {({ files, infos }) => (
        <div className="space-y-3">
          <Fieldset columns={1}>
            <Field label="Niveau de compression" hint={MODES.find((m) => m.value === mode)?.hint}>
              <OptionGroup
                ariaLabel="Niveau de compression"
                value={mode}
                onChange={setMode}
                options={MODES.map((entry) => ({ value: entry.value, label: entry.label }))}
              />
            </Field>
          </Fieldset>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface)] p-3 text-xs sm:grid-cols-3">
            <Row label="Taille" value={formatFileSize(files[0].size)} />
            <Row label="Durée" value={infos[0]?.durationMs ? formatTimecode(infos[0].durationMs) : "—"} />
            <Row
              label="Définition"
              value={infos[0]?.width ? `${infos[0].width} × ${infos[0].height}` : "—"}
            />
            <Row label="Codec vidéo" value={infos[0]?.videoCodec ?? "—"} />
            <Row label="Codec audio" value={infos[0]?.audioCodec ?? "aucun"} />
            <Row
              label="Débit"
              value={infos[0]?.bitRate ? `${Math.round(infos[0].bitRate / 1000)} kb/s` : "inconnu"}
            />
          </dl>
        </div>
      )}
    </VideoToolShell>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-[11px] text-[var(--ft-text-faint)]">{label}</dt>
      <dd className="tabular-nums text-[var(--ft-text)]">{value}</dd>
    </div>
  );
}
