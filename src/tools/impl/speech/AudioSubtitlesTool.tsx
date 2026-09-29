import { ModelRequirements } from "@/components/speech/ModelRequirements";
import { TranscriptWorkbench } from "@/components/speech/TranscriptWorkbench";
import { STT_ENGINE } from "@/core/speech/stt";
import type { ToolComponentProps } from "@/tools/implementations";

/** Sous-titres horodatés (SRT/VTT) depuis un audio ou une vidéo. */
export function AudioSubtitlesTool({ tool }: ToolComponentProps) {
  return (
    <ModelRequirements required={[STT_ENGINE, "stt-base"]} optional={["stt-small"]}>
      {(assets) => <TranscriptWorkbench tool={tool} assets={assets} focus="subtitles" />}
    </ModelRequirements>
  );
}
