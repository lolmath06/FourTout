import { useState } from "react";
import { MediaToolShell } from "@/components/media/MediaToolShell";
import { Field, Fieldset, OptionGroup } from "@/components/pdf/Field";
import { runMedia } from "@/core/media/client";
import { mergeAudio } from "@/core/media/operations/audio";
import { AUDIO_FORMATS, type AudioFormat } from "@/core/media/types";
import { outputName } from "@/core/pdf/filenames";
import type { ToolComponentProps } from "@/tools/implementations";
import { t } from "@/i18n";

export function AudioMergeTool({ tool }: ToolComponentProps) {
  const [format, setFormat] = useState<AudioFormat>("mp3");
  return (
    <MediaToolShell
      tool={tool}
      selection="multiple"
      reorderable
      actionLabel={t("Fusionner")}
      actionDisabled={false}
      hint={t("Ajoutez plusieurs fichiers ; l'ordre (flèches) est celui de la lecture.")}
      run={async ({ files, infos, context }) => {
        if (files.length < 2) throw new Error(t("Ajoutez au moins deux fichiers à fusionner."));
        const total = infos.reduce((sum, i) => sum + (i.durationMs || 0), 0);
        const file = await runMedia(
          { files, operation: mergeAudio(format), outputName: outputName(files[0].name, "fusion", format), totalMs: total },
          context,
        );
        return { files: [file], summary: t("{count} fichiers fusionnés en {value}.", { count: files.length, value: format.toUpperCase() }) };
      }}
    >
      {() => (
        <Fieldset>
          <Field label={t("Format de sortie")} full>
            <OptionGroup ariaLabel={t("Format")} value={format} onChange={setFormat} options={AUDIO_FORMATS.map((f) => ({ value: f, label: f.toUpperCase() }))} />
          </Field>
        </Fieldset>
      )}
    </MediaToolShell>
  );
}
