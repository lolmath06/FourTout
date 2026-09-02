import { useState } from "react";
import { MediaToolShell } from "@/components/media/MediaToolShell";
import { Field, Fieldset, OptionGroup } from "@/components/pdf/Field";
import { runMedia } from "@/core/media/client";
import { speedAudio } from "@/core/media/operations/audio";
import { sameFormatOf } from "./format";
import { outputName } from "@/core/pdf/filenames";
import type { ToolComponentProps } from "@/tools/implementations";

const SPEEDS = ["0.5", "0.75", "1", "1.25", "1.5", "2"].map((v) => ({ value: v, label: `${v}×` }));

export function AudioSpeedTool({ tool }: ToolComponentProps) {
  const [speed, setSpeed] = useState("1.25");
  const factor = Number(speed);
  return (
    <MediaToolShell
      tool={tool}
      actionLabel="Changer la vitesse"
      actionDisabled={factor === 1}
      hint="La hauteur (pitch) de la voix est conservée."
      run={async ({ files, infos, context }) => {
        const format = sameFormatOf(files[0]);
        const file = await runMedia(
          { files: [files[0]], operation: speedAudio(factor, format), outputName: outputName(files[0].name, `${speed}x`, format), totalMs: (infos[0]?.durationMs ?? 0) / factor },
          context,
        );
        return { files: [file], summary: `Vitesse ${speed}× (hauteur conservée).` };
      }}
    >
      {() => (
        <Fieldset columns={1}>
          <Field label="Vitesse"><OptionGroup ariaLabel="Vitesse" value={speed} onChange={setSpeed} options={SPEEDS} /></Field>
        </Fieldset>
      )}
    </MediaToolShell>
  );
}
