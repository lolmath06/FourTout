import { useState } from "react";
import { VideoToolShell } from "@/components/media/VideoToolShell";
import { Field, Fieldset, NumberInput, Select } from "@/components/pdf/Field";
import { Icon } from "@/components/ui/Icon";
import { runMedia } from "@/core/media/client";
import { resizePipeline } from "@/core/media/video/pipelines";
import {
  RESOLUTION_PRESETS,
  isUpscale,
  resolveSize,
  sizeForHeight,
  type Size,
} from "@/core/media/video/dimensions";
import { outputName } from "@/core/pdf/filenames";
import type { ToolComponentProps } from "@/tools/implementations";
import { fallbackTracker, sizeOutcome } from "./shared";

type PresetKey = "original" | "custom" | `${number}`;

/**
 * Changement de définition.
 *
 * Deux garde-fous : les proportions sont conservées par défaut (une vidéo
 * verticale reste verticale), et **aucun agrandissement n'est appliqué en
 * silence** — repasser du 720p en 1080p n'ajoute aucun détail, l'utilisateur
 * doit donc le confirmer explicitement.
 */
export function VideoResolutionTool({ tool }: ToolComponentProps) {
  const [preset, setPreset] = useState<PresetKey>("720");
  const [customWidth, setCustomWidth] = useState<number | undefined>(undefined);
  const [customHeight, setCustomHeight] = useState<number | undefined>(undefined);
  const [keepRatio, setKeepRatio] = useState(true);
  const [allowUpscale, setAllowUpscale] = useState(false);

  const targetFor = (source: Size): Size => {
    if (preset === "original") return { width: source.width, height: source.height };
    if (preset === "custom") {
      return resolveSize(source, { width: customWidth, height: customHeight, keepRatio });
    }
    return sizeForHeight(source, Number(preset));
  };

  return (
    <VideoToolShell
      tool={tool}
      actionLabel="Redimensionner"
      hint="Les dimensions produites sont toujours paires : c'est ce qu'exigent les formats lisibles partout."
      run={async ({ files, infos, caps, context }) => {
        const info = infos[0];
        const source = { width: info?.width ?? 0, height: info?.height ?? 0 };
        if (!source.width || !source.height) throw new Error("Ce fichier ne contient pas de piste vidéo lisible.");
        const target = targetFor(source);
        if (isUpscale(source, target) && !allowUpscale) {
          throw new Error(
            `La définition demandée (${target.width} × ${target.height}) est plus grande que la source ` +
              `(${source.width} × ${source.height}). Cochez « Autoriser l'agrandissement » pour continuer.`,
          );
        }

        const pipeline = resizePipeline(
          { caps, info, extension: files[0].extension },
          { width: target.width, height: target.height },
        );
        const tracker = fallbackTracker(pipeline);
        const file = await runMedia(
          {
            files: [files[0]],
            operation: pipeline.operation,
            alternatives: pipeline.alternatives,
            onFallback: tracker.onFallback,
            outputName: outputName(files[0].name, `${target.height}p`, pipeline.container),
            totalMs: info?.durationMs,
            label: "Redimensionnement…",
          },
          context,
        );
        return sizeOutcome(files[0].size, file, `${target.width} × ${target.height} :`, tracker.warning());
      }}
    >
      {({ infos }) => {
        const source = { width: infos[0]?.width ?? 0, height: infos[0]?.height ?? 0 };
        const target = source.width ? targetFor(source) : source;
        const upscaling = source.width > 0 && isUpscale(source, target);

        return (
          <div className="space-y-3">
            <Fieldset columns={3}>
              <Field label="Définition">
                <Select
                  value={preset}
                  onChange={(value) => setPreset(value as PresetKey)}
                  options={[
                    { value: "original", label: "Originale" },
                    ...RESOLUTION_PRESETS.map((height) => ({
                      value: String(height) as PresetKey,
                      label: `${height}p`,
                    })),
                    { value: "custom", label: "Personnalisée" },
                  ]}
                />
              </Field>
              {preset === "custom" && (
                <>
                  <Field label="Largeur (px)">
                    <NumberInput
                      value={customWidth ?? ""}
                      min={16}
                      max={7680}
                      placeholder="auto"
                      onChange={(event) =>
                        setCustomWidth(event.target.value === "" ? undefined : Number(event.target.value))
                      }
                    />
                  </Field>
                  <Field label="Hauteur (px)">
                    <NumberInput
                      value={customHeight ?? ""}
                      min={16}
                      max={4320}
                      placeholder="auto"
                      onChange={(event) =>
                        setCustomHeight(event.target.value === "" ? undefined : Number(event.target.value))
                      }
                    />
                  </Field>
                  <Field label="Proportions" full>
                    <label className="flex items-center gap-2 text-xs text-[var(--ft-text-muted)]">
                      <input
                        type="checkbox"
                        checked={keepRatio}
                        onChange={(event) => setKeepRatio(event.target.checked)}
                      />
                      Conserver les proportions de la source
                    </label>
                  </Field>
                </>
              )}
            </Fieldset>

            <p className="text-xs text-[var(--ft-text-muted)]">
              {source.width
                ? `${source.width} × ${source.height} → ${target.width} × ${target.height}`
                : "Définition de la source inconnue."}
            </p>

            {upscaling && (
              <div className="rounded-md border border-[var(--ft-warn)] px-3 py-2 text-xs text-[var(--ft-warn)]">
                <p className="flex items-start gap-2">
                  <Icon name="TriangleAlert" size={14} className="mt-px shrink-0" />
                  <span>
                    Cette définition <strong>agrandit</strong> la vidéo : aucun détail ne sera ajouté et le
                    fichier sera plus lourd.
                  </span>
                </p>
                <label className="mt-1.5 flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={allowUpscale}
                    onChange={(event) => setAllowUpscale(event.target.checked)}
                  />
                  Autoriser l'agrandissement
                </label>
              </div>
            )}
          </div>
        );
      }}
    </VideoToolShell>
  );
}
