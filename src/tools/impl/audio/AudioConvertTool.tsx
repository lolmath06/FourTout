import { useState } from "react";
import { MediaToolShell } from "@/components/media/MediaToolShell";
import { Field, Fieldset, OptionGroup } from "@/components/pdf/Field";
import { runMedia } from "@/core/media/client";
import { convertAudio } from "@/core/media/operations/audio";
import { AUDIO_FORMATS, type AudioFormat } from "@/core/media/types";
import { outputName } from "@/core/pdf/filenames";
import type { ToolComponentProps } from "@/tools/implementations";

const FORMATS = AUDIO_FORMATS.map((f) => ({ value: f, label: f.toUpperCase() }));

export function AudioConvertTool({ tool }: ToolComponentProps) {
  const [format, setFormat] = useState<AudioFormat>("mp3");
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
