import { useEffect, useState } from "react";
import { FileDropZone } from "@/components/files/FileDropZone";
import { ModelRequirements } from "@/components/speech/ModelRequirements";
import { TtsWorkbench } from "@/components/speech/TtsWorkbench";
import { constraintsForTool, type SelectedFile } from "@/core/files";
import { normalizeForSpeech } from "@/core/speech/segment";
import { TTS_ENGINE } from "@/core/speech/tts";
import { notify } from "@/features/notifications/store";
import type { ToolComponentProps } from "@/tools/implementations";

/** Lecture à voix haute d'un fichier texte déposé, modifiable avant synthèse. */
export function TextFileToAudioTool({ tool }: ToolComponentProps) {
  const [files, setFiles] = useState<SelectedFile[]>([]);
  const [text, setText] = useState("");

  useEffect(() => {
    const file = files[0];
    if (!file?.file) {
      setText("");
      return;
    }
    let cancelled = false;
    file.file
      .text()
      .then((content) => {
        if (!cancelled) setText(normalizeForSpeech(content));
      })
      .catch(() => {
        if (!cancelled) notify.error("Lecture impossible", "Ce fichier texte n'a pas pu être lu.");
      });
    return () => {
      cancelled = true;
    };
  }, [files]);

  const baseName = files[0]?.name.replace(/\.[^.]+$/, "") || "lecture";

  return (
    <ModelRequirements required={[TTS_ENGINE, "voice-fr-siwis"]} optional={["voice-en-lessac"]}>
      {(assets) => (
        <TtsWorkbench
          tool={tool}
          assets={assets}
          text={text}
          onTextChange={setText}
          baseName={baseName}
          textLabel="Texte détecté"
          readOnlyNote="Vous pouvez corriger le texte avant de lancer la synthèse."
          header={
            <FileDropZone
              constraints={{ ...constraintsForTool(tool), maxFiles: 1 }}
              files={files}
              onChange={setFiles}
              label="Déposez un fichier texte"
            />
          }
        />
      )}
    </ModelRequirements>
  );
}
