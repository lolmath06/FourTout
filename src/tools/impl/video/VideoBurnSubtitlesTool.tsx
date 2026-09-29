import { useState } from "react";
import { VideoToolShell } from "@/components/media/VideoToolShell";
import { ColorField } from "@/components/image/ColorField";
import { Field, Fieldset, OptionGroup, Slider } from "@/components/pdf/Field";
import { Icon } from "@/components/ui/Icon";
import { runMedia } from "@/core/media/client";
import {
  DEFAULT_BURN_STYLE,
  type BurnStyle,
  type SubtitlePosition,
} from "@/core/media/operations/video";
import { burnPipeline } from "@/core/media/video/pipelines";
import { parseHexColor, rgbToHex } from "@/core/image/types";
import { outputName } from "@/core/pdf/filenames";
import type { ToolComponentProps } from "@/tools/implementations";
import { fallbackTracker, sizeOutcome } from "./shared";

/**
 * Incrustation des sous-titres dans l'image (« hardsub »).
 *
 * Contrairement à l'ajout d'une piste, le texte fait ici partie des pixels : il
 * s'affiche partout, y compris sur les lecteurs qui ignorent les sous-titres —
 * mais il ne peut plus être masqué. L'image est donc nécessairement réencodée ;
 * l'audio, lui, est recopié tel quel.
 */
export function VideoBurnSubtitlesTool({ tool }: ToolComponentProps) {
  const [style, setStyle] = useState<BurnStyle>(DEFAULT_BURN_STYLE);
  const patch = (values: Partial<BurnStyle>) => setStyle((current) => ({ ...current, ...values }));

  return (
    <VideoToolShell
      tool={tool}
      selection="multiple"
      actionLabel="Incruster les sous-titres"
      hint="Déposez la vidéo et le fichier .srt, .vtt ou .ass."
      run={async ({ files, infos, caps, context }) => {
        const videoIndex = files.findIndex((file) => file.kind === "video");
        const subIndex = files.findIndex((file) => ["srt", "vtt", "ass"].includes(file.extension));
        if (videoIndex < 0 || subIndex < 0) {
          throw new Error("Déposez une vidéo et un fichier de sous-titres (.srt, .vtt ou .ass).");
        }
        const videoFile = files[videoIndex];
        const pipeline = burnPipeline(
          { caps, info: infos[videoIndex], extension: videoFile.extension },
          { style },
        );
        const tracker = fallbackTracker(pipeline);
        const file = await runMedia(
          {
            files: [videoFile, files[subIndex]],
            operation: pipeline.operation,
            alternatives: pipeline.alternatives,
            onFallback: tracker.onFallback,
            outputName: outputName(videoFile.name, "sous-titres-incrustes", pipeline.container),
            totalMs: infos[videoIndex]?.durationMs,
            label: "Incrustation…",
          },
          context,
        );
        return sizeOutcome(videoFile.size, file, "Sous-titres incrustés :", tracker.warning());
      }}
    >
      {({ files }) => {
        const ready =
          files.some((file) => file.kind === "video") &&
          files.some((file) => ["srt", "vtt", "ass"].includes(file.extension));
        return (
          <div className="space-y-2">
            <Fieldset columns={2}>
              <Field label="Taille du texte" hint="24 convient à une vidéo 1080p.">
                <Slider
                  value={style.fontSize}
                  onChange={(fontSize) => patch({ fontSize })}
                  min={10}
                  max={60}
                />
              </Field>
              <Field label="Couleur du texte">
                <ColorField
                  value={parseHexColor(style.color) ?? { r: 255, g: 255, b: 255 }}
                  onChange={(color) => patch({ color: rgbToHex(color) })}
                  presets={[
                    { label: "Blanc", hex: "#ffffff" },
                    { label: "Jaune", hex: "#ffe600" },
                    { label: "Noir", hex: "#000000" },
                  ]}
                />
              </Field>
              <Field label="Position">
                <OptionGroup
                  ariaLabel="Position"
                  value={style.position}
                  onChange={(position) => patch({ position: position as SubtitlePosition })}
                  options={[
                    { value: "bottom", label: "En bas" },
                    { value: "center", label: "Au centre" },
                    { value: "top", label: "En haut" },
                  ]}
                />
              </Field>
              <Field label="Lisibilité" hint="Le contour reste lisible sur fond clair comme sur fond sombre.">
                <OptionGroup
                  ariaLabel="Lisibilité"
                  value={style.outline}
                  onChange={(outline) => patch({ outline: outline as BurnStyle["outline"] })}
                  options={[
                    { value: "outline", label: "Contour noir" },
                    { value: "box", label: "Bandeau" },
                    { value: "none", label: "Aucun" },
                  ]}
                />
              </Field>
              <Field label="Marge (px)" full>
                <Slider value={style.marginV} onChange={(marginV) => patch({ marginV })} min={0} max={160} step={5} />
              </Field>
            </Fieldset>
            {!ready && (
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
