import { useState } from "react";
import { VideoToolShell } from "@/components/media/VideoToolShell";
import { Field, Fieldset, OptionGroup, TextInput } from "@/components/pdf/Field";
import { Callout } from "@/components/ui/Callout";
import { runMedia } from "@/core/media/client";
import {
  FRAME_RATE_PRESETS,
  frameRateValue,
  parseFrameRateInput,
} from "@/core/media/operations/video";
import { frameRatePipeline } from "@/core/media/video/pipelines";
import { formatTimecode } from "@/core/media/types";
import { outputName } from "@/core/pdf/filenames";
import type { ToolComponentProps } from "@/tools/implementations";
import { fallbackTracker, sizeOutcome } from "./shared";

/**
 * Changer la fréquence d'images.
 *
 * Le filtre `fps` **duplique ou supprime** des images pour atteindre la cadence
 * demandée. Rien n'est interpolé : aucune image intermédiaire n'est fabriquée,
 * et passer de 24 à 30 i/s se voit comme une saccade régulière, pas comme un
 * ralenti fluide. C'est le comportement attendu d'une conversion de cadence —
 * inventer des images demanderait un modèle d'interpolation, que FourTout n'a
 * pas et ne prétend pas avoir.
 *
 * La durée ne change pas et la bande son est recopiée telle quelle : elle ne
 * peut donc pas se désynchroniser.
 */
export function VideoFrameRateTool({ tool }: ToolComponentProps) {
  const [fraction, setFraction] = useState("30/1");
  const [custom, setCustom] = useState("");

  const target = custom.trim() === "" ? fraction : parseFrameRateInput(custom);
  const targetValue = target ? frameRateValue(target) : undefined;

  return (
    <VideoToolShell
      tool={tool}
      actionLabel="Changer la cadence"
      actionDisabled={!target}
      hint="La durée reste identique ; la bande son n'est pas retouchée."
      run={async ({ files, infos, caps, context }) => {
        const pipeline = frameRatePipeline(
          { caps, info: infos[0], extension: files[0].extension },
          { fraction: target! },
        );
        const tracker = fallbackTracker(pipeline);
        const file = await runMedia(
          {
            files: [files[0]],
            operation: pipeline.operation,
            alternatives: pipeline.alternatives,
            onFallback: tracker.onFallback,
            outputName: outputName(
              files[0].name,
              `${String(targetValue).replace(".", "-")}fps`,
              pipeline.container,
            ),
            totalMs: infos[0]?.durationMs,
            label: "Changement de cadence…",
          },
          context,
        );
        return sizeOutcome(
          files[0].size,
          file,
          `Cadence portée à ${targetValue} i/s (${target}) :`,
          tracker.warning(),
        );
      }}
    >
      {({ infos }) => {
        const stream = infos[0]?.streams.find((entry) => entry.codecType === "video");
        const source = infos[0]?.frameRate;
        return (
          <div className="space-y-3">
            {source !== undefined && (
              <p className="text-xs text-[var(--ft-text-muted)]">
                Source : {source} i/s
                {stream?.width ? ` · ${stream.width} × ${stream.height}` : ""}
                {infos[0].durationMs > 0 ? ` · ${formatTimecode(infos[0].durationMs)}` : ""}
              </p>
            )}

            <Fieldset columns={1}>
              <Field label="Cadence cible">
                <OptionGroup
                  ariaLabel="Cadence"
                  value={custom.trim() === "" ? fraction : ""}
                  onChange={(value) => {
                    setFraction(value);
                    setCustom("");
                  }}
                  options={FRAME_RATE_PRESETS.map((preset) => ({
                    value: preset.value,
                    label: preset.label,
                  }))}
                />
              </Field>
              <Field
                label="Ou une valeur personnalisée"
                hint="Un nombre (18, 48) ou une fraction exacte (30000/1001)."
              >
                <TextInput
                  value={custom}
                  placeholder="ex. 48"
                  spellCheck={false}
                  onChange={(event) => setCustom(event.target.value)}
                />
              </Field>
            </Fieldset>

            {custom.trim() !== "" && !target && (
              <Callout tone="error" title="Cadence invalide">
                Saisissez un nombre entre 1 et 480, ou une fraction du type 30000/1001.
              </Callout>
            )}

            {target && (
              <Callout tone="info" title="Ce que fait exactement cette conversion">
                Les images sont dupliquées ou supprimées pour atteindre {targetValue} i/s ; aucune
                image intermédiaire n'est calculée. La sortie est à cadence constante, même si la
                source était à cadence variable.
                {target.includes("/1001") &&
                  " La cadence est écrite comme la fraction exacte " +
                    `${target}, et non comme un décimal arrondi qui ferait dériver l'image.`}
              </Callout>
            )}
          </div>
        );
      }}
    </VideoToolShell>
  );
}
