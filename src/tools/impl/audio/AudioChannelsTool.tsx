import { useState } from "react";
import { MediaToolShell } from "@/components/media/MediaToolShell";
import { Field, Fieldset, OptionGroup } from "@/components/pdf/Field";
import { Callout } from "@/components/ui/Callout";
import { runMedia } from "@/core/media/client";
import { CHANNEL_TARGETS, channelCount, setChannels, type ChannelTarget } from "@/core/media/operations/audio";
import { describeChannels } from "@/core/media/inspect";
import { AUDIO_FORMATS, type AudioFormat } from "@/core/media/types";
import { outputName } from "@/core/pdf/filenames";
import type { ToolComponentProps } from "@/tools/implementations";
import { sameFormatOf } from "./format";
import { t, tx } from "@/i18n";

/**
 * Convertir les canaux d'un fichier audio.
 *
 * Deux opérations honnêtes, et rien de plus. Vers le mono, c'est le mixage de
 * FFmpeg qui travaille : coefficients standard et correction de volume, pas une
 * somme brute qui saturerait. Vers le stéréo depuis du mono, le canal est
 * **dupliqué** — les deux voies portent le même signal. FourTout ne prétend pas
 * reconstituer une image stéréo qui n'a jamais été enregistrée.
 *
 * Rien n'est réduit d'office : un fichier 5.1 reste 5.1 tant qu'on n'a pas
 * demandé autre chose.
 */
export function AudioChannelsTool({ tool }: ToolComponentProps) {
  const [target, setTarget] = useState<ChannelTarget>("mono");
  const [format, setFormat] = useState<AudioFormat | "same">("same");

  return (
    <MediaToolShell
      tool={tool}
      actionLabel={t("Convertir les canaux")}
      actionDisabled={target === "keep" && format === "same"}
      run={async ({ files, infos, context }) => {
        const outputFormat = format === "same" ? sameFormatOf(files[0]) : format;
        const file = await runMedia(
          {
            files: [files[0]],
            operation: setChannels(target, outputFormat),
            outputName: outputName(files[0].name, target === "keep" ? "" : target, outputFormat),
            totalMs: infos[0]?.durationMs,
            label: t("Conversion des canaux…"),
          },
          context,
        );
        const wanted = channelCount(target);
        return {
          files: [file],
          summary:
            wanted === undefined
              ? t("Canaux conservés, converti en {value}.", { value: outputFormat.toUpperCase() })
              : t("Sortie sur {wanted} {wanted, plural, one {canal} other {canaux}} ({value}).", { wanted, value: outputFormat.toUpperCase() }),
        };
      }}
    >
      {(infos) => {
        const source = infos[0];
        const channels = source?.channels;
        const layout = source?.streams.find((stream) => stream.codecType === "audio");
        return (
          <div className="space-y-3">
            {channels !== undefined && (
              <p className="text-xs text-[var(--ft-text-muted)]">
                {t("Source : {value}{value2}", { value: describeChannels(channels, undefined), value2: layout?.sampleRate ? ` · ${layout.sampleRate} Hz` : "" })}
              </p>
            )}

            {channels !== undefined && channels > 2 && target === "keep" && (
              <Callout tone="info" title={t("{channels} canaux détectés", { channels })}>
                {t("Ce fichier est multicanal. FourTout ne le réduit pas de lui-même : choisissez explicitement mono ou stéréo si vous voulez un mixage.")}
              </Callout>
            )}

            {channels === 1 && target === "stereo" && (
              <Callout tone="info" title={t("Duplication, pas spatialisation")}>
                {t("La source est mono : les deux voies produites porteront exactement le même signal. Aucune information stéréo ne peut être inventée.")}
              </Callout>
            )}

            <Fieldset columns={1}>
              <Field
                label={t("Canaux de sortie")}
                hint={tx(CHANNEL_TARGETS.find((entry) => entry.value === target)?.hint)}
              >
                <OptionGroup
                  ariaLabel={t("Canaux")}
                  value={target}
                  onChange={(value) => setTarget(value as ChannelTarget)}
                  options={CHANNEL_TARGETS.map((entry) => ({ value: entry.value, label: entry.label }))}
                />
              </Field>
              <Field label={t("Format de sortie")}>
                <OptionGroup
                  ariaLabel={t("Format")}
                  value={format}
                  onChange={(value) => setFormat(value as AudioFormat | "same")}
                  options={[
                    { value: "same", label: t("Identique") },
                    ...AUDIO_FORMATS.map((entry) => ({ value: entry, label: entry.toUpperCase() })),
                  ]}
                />
              </Field>
            </Fieldset>
          </div>
        );
      }}
    </MediaToolShell>
  );
}
