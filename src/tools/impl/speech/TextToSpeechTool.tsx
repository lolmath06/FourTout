import { useState } from "react";
import { ModelRequirements } from "@/components/speech/ModelRequirements";
import { TtsWorkbench } from "@/components/speech/TtsWorkbench";
import { TTS_ENGINE } from "@/core/speech/tts";
import type { ToolComponentProps } from "@/tools/implementations";

/** Lecture à voix haute d'un texte saisi ou collé. */
export function TextToSpeechTool({ tool }: ToolComponentProps) {
  const [text, setText] = useState("");
  return (
    <ModelRequirements required={[TTS_ENGINE, "voice-fr-siwis"]} optional={["voice-en-lessac"]}>
      {(assets) => (
        <TtsWorkbench
          tool={tool}
          assets={assets}
          text={text}
          onTextChange={setText}
          baseName="lecture"
        />
      )}
    </ModelRequirements>
  );
}
