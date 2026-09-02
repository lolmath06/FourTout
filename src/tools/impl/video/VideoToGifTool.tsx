import { useState } from "react";
import { MediaToolShell } from "@/components/media/MediaToolShell";
import { Field, Fieldset, NumberInput, TextInput } from "@/components/pdf/Field";
import { runMedia } from "@/core/media/client";
import { videoToGif } from "@/core/media/operations/video";
import { parseTimecode } from "@/core/media/types";
import { outputName } from "@/core/pdf/filenames";
import type { ToolComponentProps } from "@/tools/implementations";

export function VideoToGifTool({ tool }: ToolComponentProps) {
  const [start, setStart] = useState("00:00:00.000");
  const [duration, setDuration] = useState(3);
  const [fps, setFps] = useState(12);
  const [width, setWidth] = useState(480);

  return (
    <MediaToolShell
      tool={tool}
      actionLabel="Créer le GIF"
      hint="Palette optimisée pour un GIF net. Gardez une durée courte pour un fichier raisonnable."
      run={async ({ files, context }) => {
        const startMs = parseTimecode(start) ?? 0;
        const durationMs = Math.max(0.1, duration) * 1000;
        const op = videoToGif({ startMs, durationMs, fps, width });
        const file = await runMedia(
          { files: [files[0]], operation: op, outputName: outputName(files[0].name, "", "gif"), totalMs: durationMs },
          context,
        );
        return { files: [file], summary: `GIF ${width}px, ${fps} img/s, ${duration}s.` };
      }}
    >
      {() => (
        <Fieldset>
          <Field label="Début (hh:mm:ss)"><TextInput value={start} onChange={(e) => setStart(e.target.value)} className="font-mono" /></Field>
          <Field label="Durée (s)"><NumberInput value={duration} min={0.5} max={30} step={0.5} onChange={(e) => setDuration(Number(e.target.value) || 3)} /></Field>
          <Field label="Images/s"><NumberInput value={fps} min={5} max={30} onChange={(e) => setFps(Number(e.target.value) || 12)} /></Field>
          <Field label="Largeur (px)"><NumberInput value={width} min={120} max={1080} step={20} onChange={(e) => setWidth(Number(e.target.value) || 480)} /></Field>
        </Fieldset>
      )}
    </MediaToolShell>
  );
}
