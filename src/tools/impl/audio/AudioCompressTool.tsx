import { useState } from "react";
import { MediaToolShell } from "@/components/media/MediaToolShell";
import { Field, Fieldset, OptionGroup } from "@/components/pdf/Field";
import { runMedia } from "@/core/media/client";
import { compressAudio } from "@/core/media/operations/audio";
import { formatFileSize } from "@/core/files";
import type { AudioFormat } from "@/core/media/types";
import { outputName } from "@/core/pdf/filenames";
import type { ToolComponentProps } from "@/tools/implementations";

const LEVELS = [
  { value: "light", label: "Légère", bitrate: 192 },
  { value: "balanced", label: "Équilibrée", bitrate: 128 },
  { value: "strong", label: "Forte", bitrate: 96 },
];
const TARGETS: { value: AudioFormat; label: string }[] = [
  { value: "mp3", label: "MP3" },
  { value: "opus", label: "Opus" },
  { value: "m4a", label: "AAC/M4A" },
];

export function AudioCompressTool({ tool }: ToolComponentProps) {
  const [level, setLevel] = useState("balanced");
  const [format, setFormat] = useState<AudioFormat>("mp3");
  const bitrate = LEVELS.find((l) => l.value === level)!.bitrate;

  return (
    <MediaToolShell
      tool={tool}
      actionLabel="Compresser"
      hint="Un WAV sans perte est réencodé en format compressé (perte assumée)."
      run={async ({ files, infos, context }) => {
        const original = files[0].size;
        const file = await runMedia(
          { files: [files[0]], operation: compressAudio(format, bitrate), outputName: outputName(files[0].name, "compresse", format), totalMs: infos[0]?.durationMs },
          context,
        );
        const gain = original - file.bytes.length;
        const percent = original > 0 ? Math.round((gain / original) * 100) : 0;
        return {
          files: [file],
          summary:
            gain > 0
              ? `${formatFileSize(original)} → ${formatFileSize(file.bytes.length)} · ${percent}% de gain (${format.toUpperCase()} ${bitrate} kb/s).`
              : `Sortie ${format.toUpperCase()} ${bitrate} kb/s (${formatFileSize(file.bytes.length)}).`,
          warning: gain <= 0 ? "Aucun gain : le fichier d'origine était déjà plus compact." : undefined,
        };
      }}
    >
      {() => (
        <Fieldset>
          <Field label="Niveau"><OptionGroup ariaLabel="Niveau" value={level} onChange={setLevel} options={LEVELS.map((l) => ({ value: l.value, label: l.label }))} /></Field>
          <Field label="Format"><OptionGroup ariaLabel="Format" value={format} onChange={setFormat} options={TARGETS} /></Field>
        </Fieldset>
      )}
    </MediaToolShell>
  );
}
