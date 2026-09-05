import { useState } from "react";
import { MediaToolShell } from "@/components/media/MediaToolShell";
import { Field, Fieldset, OptionGroup } from "@/components/pdf/Field";
import { runMedia } from "@/core/media/client";
import { convertAudio } from "@/core/media/operations/audio";
import { AUDIO_FORMATS, type AudioFormat } from "@/core/media/types";
import { outputName } from "@/core/pdf/filenames";
import type { ToolComponentProps } from "@/tools/implementations";
import { presetString, useHandoff } from "@/features/handoff/store";

const FORMATS = AUDIO_FORMATS.map((f) => ({ value: f, label: f.toUpperCase() }));

export function AudioConvertTool({ tool }: ToolComponentProps) {
  // Format présélectionné par le convertisseur universel, s'il en propose un.
  const handoff = useHandoff(tool.id);
  const [format, setFormat] = useState<AudioFormat>(() => {
    const preset = presetString(handoff, "format");
    return (AUDIO_FORMATS as readonly string[]).includes(preset ?? "")
      ? (preset as AudioFormat)
      : "mp3";
  });
  return (
    <MediaToolShell
      tool={tool}
      actionLabel="Convertir"
      run={async ({ files, infos, context }) => {
        const op = convertAudio(format);
        const file = await runMedia(
          { files: [files[0]], operation: op, outputName: outputName(files[0].name, "", format), totalMs: infos[0]?.durationMs },
          context,
        );
        return { files: [file], summary: `Audio converti en ${format.toUpperCase()}.` };
      }}
    >
      {() => (
        <Fieldset>
          <Field label="Format de sortie" full>
            <OptionGroup ariaLabel="Format" value={format} onChange={setFormat} options={FORMATS} />
          </Field>
        </Fieldset>
      )}
    </MediaToolShell>
  );
}
