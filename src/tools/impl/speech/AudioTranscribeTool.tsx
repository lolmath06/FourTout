import { ModelRequirements } from "@/components/speech/ModelRequirements";
import { TranscriptWorkbench } from "@/components/speech/TranscriptWorkbench";
import { STT_ENGINE } from "@/core/speech/stt";
import type { ToolComponentProps } from "@/tools/implementations";

/** Transcription locale d'un audio ou d'une vidéo. */
export function AudioTranscribeTool({ tool }: ToolComponentProps) {
  return (
    <ModelRequirements required={[STT_ENGINE, "stt-base"]} optional={["stt-small"]}>
      {(assets) => <TranscriptWorkbench tool={tool} assets={assets} focus="text" />}
    </ModelRequirements>
  );
}
