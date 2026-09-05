import { useState } from "react";
import { VideoToolShell } from "@/components/media/VideoToolShell";
import { Field, Fieldset, OptionGroup } from "@/components/pdf/Field";
import { formatFileSize } from "@/core/files";
import { runMedia } from "@/core/media/client";
import { encodeVideo } from "@/core/media/operations/video";
import { audioCodecsFor } from "@/core/media/capabilities";
import { COMPRESSION_LABEL, type QualityLevel } from "@/core/media/video/presets";
import { formatTimecode } from "@/core/media/types";
import { outputName } from "@/core/pdf/filenames";
import type { ToolComponentProps } from "@/tools/implementations";
import { defaultContainer, encodeArgsFor, sizeOutcome } from "./shared";

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
        const info = infos[0];
        const container = defaultContainer(files[0].extension, caps);
        const videoCodec = (["h264", "vp9", "h265", "av1"] as const).find((codec) => caps.video[codec]);
        if (!videoCodec) throw new Error("Aucun encodeur vidéo n'est disponible dans le moteur installé.");
        const { videoArgs, audioArgs } = encodeArgsFor(
          { container, video: videoCodec, audio: audioCodecsFor(container, caps)[0], level: mode },
          caps,
          info,
        );
        const file = await runMedia(
          {
            files: [files[0]],
            operation: encodeVideo({ container, videoArgs, audioArgs }),
            outputName: outputName(files[0].name, "compressee", container),
            totalMs: info?.durationMs,
            label: "Compression…",
          },
          context,
        );
        return sizeOutcome(files[0].size, file, `${COMPRESSION_LABEL[mode]} :`);
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
