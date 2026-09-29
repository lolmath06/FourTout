import { useEffect, useState } from "react";
import { MediaToolShell } from "@/components/media/MediaToolShell";
import { AudioPreview } from "@/components/media/AudioPreview";
import { Field, Fieldset, TextInput } from "@/components/pdf/Field";
import { runMedia } from "@/core/media/client";
import { trimAudio } from "@/core/media/operations/audio";
import { formatTimecode, parseTimecode, type AudioFormat } from "@/core/media/types";
import type { SelectedFile } from "@/core/files";
import { extensionToFormat } from "@/core/image/types";
import { outputName } from "@/core/pdf/filenames";
import type { ToolComponentProps } from "@/tools/implementations";

export function AudioTrimTool({ tool }: ToolComponentProps) {
  const [start, setStart] = useState("00:00:00.000");
  const [end, setEnd] = useState("00:00:10.000");

  const startMs = parseTimecode(start);
  const endMs = parseTimecode(end);
  const valid = startMs !== undefined && endMs !== undefined && endMs > startMs;

  return (
    <MediaToolShell
      tool={tool}
      actionLabel="Découper"
      actionDisabled={!valid}
      run={async ({ files, context }) => {
        const ext = (files[0].extension || "mp3") as string;
        const format = (["mp3", "wav", "flac", "ogg", "opus", "m4a", "aac"].includes(ext) ? ext : "mp3") as AudioFormat;
        const file = await runMedia(
          { files: [files[0]], operation: trimAudio(startMs!, endMs!, format), outputName: outputName(files[0].name, "extrait", format), totalMs: endMs! - startMs! },
          context,
        );
        return { files: [file], summary: `Portion ${formatTimecode(startMs!)} → ${formatTimecode(endMs!)}.` };
      }}
    >
      {(_infos, files) => (
        <TrimFields file={files[0]} start={start} end={end} setStart={setStart} setEnd={setEnd} defaultEnd={_infos[0]?.durationMs} />
      )}
    </MediaToolShell>
  );
}

function TrimFields({ file, start, end, setStart, setEnd, defaultEnd }: {
  file: SelectedFile; start: string; end: string;
  setStart: (v: string) => void; setEnd: (v: string) => void; defaultEnd?: number;
}) {
  // Ignore la référence pour ESLint : on ne met à jour la fin qu'une fois.
  void extensionToFormat;
  useEffect(() => {
    if (defaultEnd && defaultEnd > 0) setEnd(formatTimecode(defaultEnd));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultEnd]);
  return (
    <div className="space-y-3">
      <Fieldset>
        <Field label="Début (hh:mm:ss.mmm)"><TextInput value={start} onChange={(e) => setStart(e.target.value)} className="font-mono" /></Field>
        <Field label="Fin (hh:mm:ss.mmm)"><TextInput value={end} onChange={(e) => setEnd(e.target.value)} className="font-mono" /></Field>
      </Fieldset>
      <AudioPreview file={file} label="Écouter l'original pour repérer les temps" />
    </div>
  );
}
