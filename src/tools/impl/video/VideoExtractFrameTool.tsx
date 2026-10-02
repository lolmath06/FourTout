import { useState } from "react";
import { MediaToolShell } from "@/components/media/MediaToolShell";
import { Field, Fieldset, OptionGroup, TextInput } from "@/components/pdf/Field";
import { runMedia } from "@/core/media/client";
import { extractFrame } from "@/core/media/operations/video";
import { parseTimecode } from "@/core/media/types";
import { outputName } from "@/core/pdf/filenames";
import type { ToolComponentProps } from "@/tools/implementations";
import { t } from "@/i18n";

export function VideoExtractFrameTool({ tool }: ToolComponentProps) {
  const [time, setTime] = useState("00:00:01.000");
  const [format, setFormat] = useState<"png" | "jpg">("png");
  const timeMs = parseTimecode(time);

  return (
    <MediaToolShell
      tool={tool}
      actionLabel={t("Extraire l'image")}
      actionDisabled={timeMs === undefined}
      run={async ({ files, context }) => {
        const file = await runMedia(
          { files: [files[0]], operation: extractFrame(timeMs!, format), outputName: outputName(files[0].name, "frame", format), totalMs: 0 },
          context,
        );
        return { files: [file], summary: t("Image extraite à {time}.", { time }) };
      }}
    >
      {() => (
        <Fieldset>
          <Field label={t("Instant (hh:mm:ss.mmm)")}><TextInput value={time} onChange={(e) => setTime(e.target.value)} className="font-mono" /></Field>
          <Field label={t("Format")}><OptionGroup ariaLabel={t("Format")} value={format} onChange={setFormat} options={[{ value: "png", label: "PNG" }, { value: "jpg", label: "JPEG" }]} /></Field>
        </Fieldset>
      )}
    </MediaToolShell>
  );
}
