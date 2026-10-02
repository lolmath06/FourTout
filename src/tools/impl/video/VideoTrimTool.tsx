import { useEffect, useRef, useState } from "react";
import { VideoToolShell } from "@/components/media/VideoToolShell";
import { VideoPreview } from "@/components/media/VideoPreview";
import { Field, Fieldset, OptionGroup, TextInput } from "@/components/pdf/Field";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { runMedia } from "@/core/media/client";
import type { TrimMode } from "@/core/media/operations/video";
import { trimPipeline } from "@/core/media/video/pipelines";
import { formatTimecode, parseTimecode } from "@/core/media/types";
import { outputName } from "@/core/pdf/filenames";
import type { ToolComponentProps } from "@/tools/implementations";
import { fallbackTracker } from "./shared";
import { Trans, t } from "@/i18n";

/**
 * Découpage d'un extrait.
 *
 * Deux modes, expliqués à l'utilisateur plutôt que devinés à sa place :
 * *rapide* recopie les flux (instantané, mais la coupe se cale sur l'image-clé
 * précédente), *précis* réencode et tombe exactement à l'instant demandé. Le
 * lecteur sert de règle : « Définir le début ici » reprend la position courante.
 */
export function VideoTrimTool({ tool }: ToolComponentProps) {
  const [start, setStart] = useState("00:00:00.000");
  const [end, setEnd] = useState("00:00:05.000");
  const [mode, setMode] = useState<TrimMode>("fast");
  const [current, setCurrent] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);

  const startMs = parseTimecode(start);
  const endMs = parseTimecode(end);
  const invalid = startMs === undefined || endMs === undefined || endMs <= startMs;

  return (
    <VideoToolShell
      tool={tool}
      actionLabel={t("Découper")}
      actionDisabled={invalid}
      showFileList={false}
      run={async ({ files, infos, caps, context }) => {
        if (startMs === undefined || endMs === undefined || endMs <= startMs) {
          throw new Error(t("L'instant de fin doit être postérieur à l'instant de début."));
        }
        const pipeline = trimPipeline(
          { caps, info: infos[0], extension: files[0].extension },
          { startMs, endMs, mode },
        );
        const tracker = fallbackTracker(pipeline);
        const file = await runMedia(
          {
            files: [files[0]],
            operation: pipeline.operation,
            alternatives: pipeline.alternatives,
            onFallback: tracker.onFallback,
            outputName: outputName(files[0].name, "extrait", pipeline.container),
            totalMs: endMs - startMs,
            label: t("Découpage…"),
          },
          context,
        );
        return {
          files: [file],
          summary: t("Extrait de {value} à {value2} ({value3}).", { value: formatTimecode(startMs), value2: formatTimecode(endMs), value3: formatTimecode(endMs - startMs) }),
          warning:
            mode === "fast"
              ? t("Mode rapide : le début réel peut être décalé de quelques dixièmes de seconde, jusqu'à l'image-clé précédente.")
              : tracker.warning(),
        };
      }}
    >
      {({ files, infos }) => (
        <TrimSettings
          file={files[0]}
          durationMs={infos[0]?.durationMs ?? 0}
          videoRef={videoRef}
          current={current}
          setCurrent={setCurrent}
          start={start}
          setStart={setStart}
          end={end}
          setEnd={setEnd}
          mode={mode}
          setMode={setMode}
          invalid={invalid}
        />
      )}
    </VideoToolShell>
  );
}

function TrimSettings({
  file,
  durationMs,
  videoRef,
  current,
  setCurrent,
  start,
  setStart,
  end,
  setEnd,
  mode,
  setMode,
  invalid,
}: {
  file: Parameters<typeof VideoPreview>[0]["file"];
  durationMs: number;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  current: number;
  setCurrent: (ms: number) => void;
  start: string;
  setStart: (value: string) => void;
  end: string;
  setEnd: (value: string) => void;
  mode: TrimMode;
  setMode: (value: TrimMode) => void;
  invalid: boolean;
}) {
  // Par défaut, la sélection couvre toute la vidéo : un réglage utile d'emblée.
  useEffect(() => {
    if (durationMs > 0) setEnd(formatTimecode(durationMs));
  }, [durationMs, setEnd]);

  const seek = (ms: number) => {
    if (videoRef.current) videoRef.current.currentTime = ms / 1000;
  };

  return (
    <div className="space-y-3">
      <VideoPreview file={file} videoRef={videoRef} onTime={setCurrent} />

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Trans source={"<0>Position : {value}{value2}</0>"} values={{ value: formatTimecode(current), value2: durationMs > 0 && ` / ${formatTimecode(durationMs)}` }} components={[<span className="font-mono tabular-nums text-[var(--ft-text-muted)]" />]} />
        <Button size="sm" onClick={() => setStart(formatTimecode(current))}>
          <Icon name="CornerDownLeft" size={13} />{" "}{t("Définir le début ici")}
        </Button>
        <Button size="sm" onClick={() => setEnd(formatTimecode(current))}>
          <Icon name="CornerDownLeft" size={13} />{" "}{t("Définir la fin ici")}
        </Button>
      </div>

      <Fieldset columns={3}>
        <Field label={t("Début (hh:mm:ss.mmm)")}>
          <span className="flex gap-1">
            <TextInput value={start} onChange={(event) => setStart(event.target.value)} className="font-mono" />
            <Button size="sm" variant="ghost" onClick={() => seek(parseTimecode(start) ?? 0)} aria-label={t("Aller au début")}>
              <Icon name="Play" size={13} />
            </Button>
          </span>
        </Field>
        <Field label={t("Fin (hh:mm:ss.mmm)")}>
          <span className="flex gap-1">
            <TextInput value={end} onChange={(event) => setEnd(event.target.value)} className="font-mono" />
            <Button size="sm" variant="ghost" onClick={() => seek(parseTimecode(end) ?? 0)} aria-label={t("Aller à la fin")}>
              <Icon name="Play" size={13} />
            </Button>
          </span>
        </Field>
        <Field
          label={t("Mode")}
          hint={
            mode === "fast"
              ? t("Rapide : aucun réencodage, la coupe se cale sur l'image-clé précédente.")
              : t("Précis : réencodage, la coupe tombe exactement à l'instant demandé.")
          }
        >
          <OptionGroup
            ariaLabel={t("Mode de découpage")}
            value={mode}
            onChange={setMode}
            options={[
              { value: "fast", label: t("Rapide") },
              { value: "precise", label: t("Précis") },
            ]}
          />
        </Field>
      </Fieldset>

      {invalid && (
        <p className="text-xs text-[var(--ft-danger)]">
          {t("Indiquez un début et une fin valides (hh:mm:ss.mmm), la fin après le début.")}
        </p>
      )}
    </div>
  );
}
