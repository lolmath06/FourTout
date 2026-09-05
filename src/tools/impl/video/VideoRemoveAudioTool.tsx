import { VideoToolShell } from "@/components/media/VideoToolShell";
import { runMedia } from "@/core/media/client";
import { removeAudio } from "@/core/media/operations/video";
import { outputName } from "@/core/pdf/filenames";
import type { ToolComponentProps } from "@/tools/implementations";
import { defaultContainer, sizeOutcome } from "./shared";

/**
 * Version muette d'une vidéo.
 *
 * L'image est **recopiée telle quelle** : aucun réencodage, donc aucune perte
 * de qualité et un traitement quasi instantané, quelle que soit la durée.
 */
export function VideoRemoveAudioTool({ tool }: ToolComponentProps) {
  return (
    <VideoToolShell
      tool={tool}
      actionLabel="Supprimer le son"
      hint="L'image n'est pas réencodée : la qualité est strictement identique."
      run={async ({ files, infos, caps, context }) => {
        const info = infos[0];
        if (!info?.hasAudio) throw new Error("Cette vidéo ne contient aucune piste audio.");
        const container = defaultContainer(files[0].extension, caps);
        const file = await runMedia(
          {
            files: [files[0]],
            operation: removeAudio(container),
            outputName: outputName(files[0].name, "muette", container),
            totalMs: info.durationMs,
            label: "Suppression du son…",
          },
          context,
        );
        return sizeOutcome(files[0].size, file, "Vidéo muette :");
      }}
    >
      {({ infos }) =>
        infos[0] && !infos[0].hasAudio ? (
          <p className="rounded-md border border-[var(--ft-border)] bg-[var(--ft-surface-2)] px-3 py-2 text-xs text-[var(--ft-text-muted)]">
            Cette vidéo n'a déjà aucune piste audio : il n'y a rien à supprimer.
          </p>
        ) : null
      }
    </VideoToolShell>
  );
}
