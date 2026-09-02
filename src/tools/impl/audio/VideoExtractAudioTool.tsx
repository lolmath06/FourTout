import { useState } from "react";
import { MediaToolShell } from "@/components/media/MediaToolShell";
import { Field, Fieldset, OptionGroup } from "@/components/pdf/Field";
import { Button } from "@/components/ui/Button";
import { runMedia } from "@/core/media/client";
import { extractAudio } from "@/core/media/operations/audio";
import { AUDIO_FORMATS, type AudioFormat } from "@/core/media/types";
import { outputName } from "@/core/pdf/filenames";
import type { ToolComponentProps } from "@/tools/implementations";

export function VideoExtractAudioTool({ tool }: ToolComponentProps) {
  const [format, setFormat] = useState<AudioFormat>("mp3");
  const [copy, setCopy] = useState(false);
  return (
    <MediaToolShell
      tool={tool}
      actionLabel="Extraire l'audio"
      hint="« Copier la piste » évite le réencodage quand c'est possible (plus rapide, sans perte)."
      run={async ({ files, infos, context }) => {
        const outExt = copy ? "m4a" : format;
        const file = await runMedia(
          { files: [files[0]], operation: extractAudio(copy ? "m4a" : format, { copy }), outputName: outputName(files[0].name, "audio", outExt), totalMs: infos[0]?.durationMs },
          context,
        );
        return { files: [file], summary: copy ? "Piste audio extraite sans réencodage." : `Audio extrait en ${format.toUpperCase()}.` };
      }}
    >
      {() => (
        <Fieldset columns={1}>
          <Field label="Mode">
            <Button size="sm" variant={copy ? "primary" : "secondary"} onClick={() => setCopy((v) => !v)}>
              {copy ? "Copier la piste (sans réencodage)" : "Réencoder"}
            </Button>
          </Field>
          {!copy && (
            <Field label="Format"><OptionGroup ariaLabel="Format" value={format} onChange={setFormat} options={AUDIO_FORMATS.map((f) => ({ value: f, label: f.toUpperCase() }))} /></Field>
          )}
        </Fieldset>
      )}
    </MediaToolShell>
  );
}
