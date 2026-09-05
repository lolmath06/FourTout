import { useEffect, useRef, useState } from "react";
import { VideoToolShell } from "@/components/media/VideoToolShell";
import { VideoPreview } from "@/components/media/VideoPreview";
import { Field, Fieldset, OptionGroup, TextInput } from "@/components/pdf/Field";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { runMedia } from "@/core/media/client";
import { trimVideo, type TrimMode } from "@/core/media/operations/video";
import { audioCodecsFor } from "@/core/media/capabilities";
import { formatTimecode, parseTimecode } from "@/core/media/types";
import { outputName } from "@/core/pdf/filenames";
import type { ToolComponentProps } from "@/tools/implementations";
import { defaultContainer, encodeArgsFor } from "./shared";

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
      actionLabel="Découper"
      actionDisabled={invalid}
      showFileList={false}
      run={async ({ files, infos, caps, context }) => {
        if (startMs === undefined || endMs === undefined || endMs <= startMs) {
          throw new Error("L'instant de fin doit être postérieur à l'instant de début.");
        }
        const info = infos[0];
        const container = defaultContainer(files[0].extension, caps);
        let operation;
        if (mode === "fast") {
          operation = trimVideo({ startMs, endMs, mode, container });
        } else {
          const videoCodec = (["h264", "vp9", "h265", "av1"] as const).find((codec) => caps.video[codec]);
          if (!videoCodec) throw new Error("Aucun encodeur vidéo n'est disponible dans le moteur installé.");
          const { videoArgs, audioArgs } = encodeArgsFor(
            { container, video: videoCodec, audio: audioCodecsFor(container, caps)[0], level: "high" },
            caps,
            info,
          );
          operation = trimVideo({ startMs, endMs, mode, container, videoArgs, audioArgs });
        }

        const file = await runMedia(
          {
            files: [files[0]],
            operation,
            outputName: outputName(files[0].name, "extrait", container),
            totalMs: endMs - startMs,
            label: "Découpage…",
          },
          context,
        );
        return {
          files: [file],
          summary: `Extrait de ${formatTimecode(startMs)} à ${formatTimecode(endMs)} (${formatTimecode(endMs - startMs)}).`,
          warning:
            mode === "fast"
              ? "Mode rapide : le début réel peut être décalé de quelques dixièmes de seconde, jusqu'à l'image-clé précédente."
              : undefined,
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
        <span className="font-mono tabular-nums text-[var(--ft-text-muted)]">
          Position : {formatTimecode(current)}
          {durationMs > 0 && ` / ${formatTimecode(durationMs)}`}
        </span>
        <Button size="sm" onClick={() => setStart(formatTimecode(current))}>
          <Icon name="CornerDownLeft" size={13} /> Définir le début ici
        </Button>
        <Button size="sm" onClick={() => setEnd(formatTimecode(current))}>
          <Icon name="CornerDownLeft" size={13} /> Définir la fin ici
        </Button>
      </div>

      <Fieldset columns={3}>
        <Field label="Début (hh:mm:ss.mmm)">
          <span className="flex gap-1">
            <TextInput value={start} onChange={(event) => setStart(event.target.value)} className="font-mono" />
            <Button size="sm" variant="ghost" onClick={() => seek(parseTimecode(start) ?? 0)} aria-label="Aller au début">
              <Icon name="Play" size={13} />
            </Button>
          </span>
        </Field>
        <Field label="Fin (hh:mm:ss.mmm)">
          <span className="flex gap-1">
            <TextInput value={end} onChange={(event) => setEnd(event.target.value)} className="font-mono" />
            <Button size="sm" variant="ghost" onClick={() => seek(parseTimecode(end) ?? 0)} aria-label="Aller à la fin">
              <Icon name="Play" size={13} />
            </Button>
          </span>
        </Field>
        <Field
          label="Mode"
          hint={
            mode === "fast"
              ? "Rapide : aucun réencodage, la coupe se cale sur l'image-clé précédente."
              : "Précis : réencodage, la coupe tombe exactement à l'instant demandé."
          }
        >
          <OptionGroup
            ariaLabel="Mode de découpage"
            value={mode}
            onChange={setMode}
            options={[
              { value: "fast", label: "Rapide" },
              { value: "precise", label: "Précis" },
            ]}
          />
        </Field>
      </Fieldset>

      {invalid && (
        <p className="text-xs text-[var(--ft-danger)]">
          Indiquez un début et une fin valides (hh:mm:ss.mmm), la fin après le début.
        </p>
      )}
    </div>
  );
}
