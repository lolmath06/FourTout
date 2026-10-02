import { useState } from "react";
import { MediaToolShell } from "@/components/media/MediaToolShell";
import { Field, Fieldset, OptionGroup } from "@/components/pdf/Field";
import { runMedia } from "@/core/media/client";
import { normalizeAudio, type NormalizePreset } from "@/core/media/operations/audio";
import { sameFormatOf } from "@/tools/impl/audio/format";
import { outputName } from "@/core/pdf/filenames";
import type { ToolComponentProps } from "@/tools/implementations";
import { localized, t } from "@/i18n";

const PRESETS: { value: NormalizePreset; label: string }[] = localized(() => [
  { value: "standard", label: t("Standard (-16 LUFS)") },
  { value: "podcast", label: t("Podcast (-16 LUFS)") },
  { value: "music", label: t("Musique (-14 LUFS)") },
]);

export function AudioNormalizeTool({ tool }: ToolComponentProps) {
  const [preset, setPreset] = useState<NormalizePreset>("standard");
  return (
    <MediaToolShell
      tool={tool}
      actionLabel={t("Normaliser")}
      hint={t("Normalisation de sonie EBU R128 (loudnorm) : un niveau homogène, sans saturation.")}
      run={async ({ files, infos, context }) => {
        const format = sameFormatOf(files[0]);
        const file = await runMedia(
          { files: [files[0]], operation: normalizeAudio(preset, format), outputName: outputName(files[0].name, "normalise", format), totalMs: infos[0]?.durationMs },
          context,
        );
        return { files: [file], summary: t("Volume normalisé ({preset}).", { preset }) };
      }}
    >
      {() => (
        <Fieldset columns={1}>
          <Field label={t("Cible")}><OptionGroup ariaLabel={t("Cible")} value={preset} onChange={setPreset} options={PRESETS} /></Field>
        </Fieldset>
      )}
    </MediaToolShell>
  );
}
