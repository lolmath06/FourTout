import { useState } from "react";
import { MediaToolShell } from "@/components/media/MediaToolShell";
import { Field, Fieldset, Slider } from "@/components/pdf/Field";
import { runMedia } from "@/core/media/client";
import { removeSilenceAudio } from "@/core/media/operations/audio";
import { sameFormatOf } from "./format";
import { outputName } from "@/core/pdf/filenames";
import type { ToolComponentProps } from "@/tools/implementations";

export function AudioRemoveSilenceTool({ tool }: ToolComponentProps) {
  const [threshold, setThreshold] = useState(-35);
  const [minMs, setMinMs] = useState(1000);
  return (
    <MediaToolShell
      tool={tool}
      actionLabel="Supprimer les silences"
      hint="Les passages plus silencieux que le seuil et plus longs que la durée minimale sont retirés."
      run={async ({ files, infos, context }) => {
        const format = sameFormatOf(files[0]);
        const file = await runMedia(
          { files: [files[0]], operation: removeSilenceAudio(format, { thresholdDb: threshold, minSilenceMs: minMs }), outputName: outputName(files[0].name, "sans-silences", format), totalMs: infos[0]?.durationMs },
          context,
        );
        return { files: [file], summary: "Silences supprimés." };
      }}
    >
      {() => (
        <Fieldset columns={1}>
          <Field label={`Seuil de silence (${threshold} dB)`} hint="Plus bas = seuls les passages très silencieux comptent.">
            <Slider value={threshold} onChange={setThreshold} min={-60} max={-10} />
          </Field>
          <Field label={`Durée minimale d'un silence (${(minMs / 1000).toFixed(1)} s)`}>
            <Slider value={minMs} onChange={setMinMs} min={200} max={3000} step={100} />
          </Field>
        </Fieldset>
      )}
    </MediaToolShell>
  );
}
