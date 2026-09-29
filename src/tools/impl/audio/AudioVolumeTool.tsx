import { useState } from "react";
import { MediaToolShell } from "@/components/media/MediaToolShell";
import { Field, Fieldset, Slider } from "@/components/pdf/Field";
import { Icon } from "@/components/ui/Icon";
import { runMedia } from "@/core/media/client";
import { volumeAudio } from "@/core/media/operations/audio";
import { sameFormatOf } from "@/tools/impl/audio/format";
import { outputName } from "@/core/pdf/filenames";
import type { ToolComponentProps } from "@/tools/implementations";

export function AudioVolumeTool({ tool }: ToolComponentProps) {
  const [db, setDb] = useState(0);
  return (
    <MediaToolShell
      tool={tool}
      actionLabel="Appliquer le volume"
      actionDisabled={db === 0}
      run={async ({ files, infos, context }) => {
        const format = sameFormatOf(files[0]);
        const file = await runMedia(
          { files: [files[0]], operation: volumeAudio(db, format), outputName: outputName(files[0].name, `${db > 0 ? "+" : ""}${db}dB`, format), totalMs: infos[0]?.durationMs },
          context,
        );
        return { files: [file], summary: `Volume ${db > 0 ? "+" : ""}${db} dB appliqué.` };
      }}
    >
      {() => (
        <Fieldset columns={1}>
          <Field label={`Gain (${db > 0 ? "+" : ""}${db} dB)`}>
            <Slider value={db} onChange={setDb} min={-30} max={12} />
          </Field>
          {db > 0 && (
            <p className="flex items-center gap-1.5 text-xs text-[var(--ft-warn)]">
              <Icon name="TriangleAlert" size={13} /> Augmenter le volume peut saturer (clipping). En cas de doute, préférez « Normaliser ».
            </p>
          )}
        </Fieldset>
      )}
    </MediaToolShell>
  );
}
