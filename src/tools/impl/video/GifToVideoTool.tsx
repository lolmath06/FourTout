import { useState } from "react";
import { MediaToolShell } from "@/components/media/MediaToolShell";
import { Field, Fieldset, OptionGroup } from "@/components/pdf/Field";
import { bestH264Encoder, runMedia } from "@/core/media/client";
import { gifToVideo, type VideoContainer } from "@/core/media/operations/video";
import { outputName } from "@/core/pdf/filenames";
import type { ToolComponentProps } from "@/tools/implementations";
import { t } from "@/i18n";

export function GifToVideoTool({ tool }: ToolComponentProps) {
  const [container, setContainer] = useState<VideoContainer>("mp4");
  return (
    <MediaToolShell
      tool={tool}
      actionLabel={t("Convertir en vidéo")}
      hint={t("MP4 en H.264 (yuv420p) pour une compatibilité maximale (web, mobiles, réseaux sociaux).")}
      run={async ({ files, infos, context }) => {
        const codec = container === "mp4" ? await bestH264Encoder() : undefined;
        const op = gifToVideo(container, codec);
        const file = await runMedia(
          { files: [files[0]], operation: op, outputName: outputName(files[0].name, "", container), totalMs: infos[0]?.durationMs },
          context,
        );
        return { files: [file], summary: t("Vidéo {value} générée.", { value: container.toUpperCase() }) };
      }}
    >
      {() => (
        <Fieldset columns={1}>
          <Field label={t("Format")}><OptionGroup ariaLabel={t("Format")} value={container} onChange={setContainer} options={[{ value: "mp4", label: "MP4 (H.264)" }, { value: "webm", label: t("WebM (VP9)") }]} /></Field>
        </Fieldset>
      )}
    </MediaToolShell>
  );
}
