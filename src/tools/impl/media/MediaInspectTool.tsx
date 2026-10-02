import { useEffect, useState, type ReactNode } from "react";
import { constraintsForTool, formatFileSize, type SelectedFile } from "@/core/files";
import { FileDropZone } from "@/components/files/FileDropZone";
import { Callout } from "@/components/ui/Callout";
import { Icon } from "@/components/ui/Icon";
import { isMediaAvailable, probeJson } from "@/core/media/client";
import {
  describeChannels,
  formatBitRate,
  formatSampleRate,
  inspectMedia,
  isRealVideo,
  type MediaDetails,
} from "@/core/media/inspect";
import { formatTimecode } from "@/core/media/types";
import { HANDOFF_TARGETS } from "@/features/handoff/targets";
import { OpenToolButton } from "@/features/handoff/openTool";
import type { ToolComponentProps } from "@/tools/implementations";
import { formatNumber, t, tx } from "@/i18n";

/**
 * Fiche d'identité d'un fichier audio ou vidéo.
 *
 * Tout vient de ffprobe, et rien n'est recalculé de ce qu'il donne déjà. Les
 * champs absents ne sont pas affichés : une case vide raconterait que
 * l'information existe et vaut zéro, alors qu'elle n'a simplement pas été
 * déclarée. Le seul écart est signalé comme tel — quand un flux unique ne
 * déclare pas son débit, celui du conteneur est repris avec la mention
 * « déduit ».
 */
export function MediaInspectTool({ tool }: ToolComponentProps) {
  const [files, setFiles] = useState<SelectedFile[]>([]);
  const [details, setDetails] = useState<MediaDetails | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [available, setAvailable] = useState<boolean | undefined>();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    isMediaAvailable().then(setAvailable);
  }, []);

  useEffect(() => {
    const file = files[0];
    if (!file || !available) {
      setDetails(undefined);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    (async () => {
      try {
        const inspected = inspectMedia(await probeJson(file));
        if (!cancelled) setDetails(inspected);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [files, available]);

  if (available === false) {
    return (
      <Callout tone="info" title={t("Traitement local requis")}>
        {t("L'inspection s'appuie sur ffprobe et nécessite l'application FourTout installée. Elle n'est pas disponible dans l'aperçu navigateur.")}
      </Callout>
    );
  }

  return (
    <div className="space-y-4">
      <FileDropZone
        constraints={{ ...constraintsForTool(tool), maxFiles: 1 }}
        files={files}
        onChange={setFiles}
        label={t("Déposez un fichier audio ou vidéo")}
      />

      {loading && (
        <p className="flex items-center gap-2 text-xs text-[var(--ft-text-muted)]">
          <Icon name="Loader" size={14} className="animate-spin" />{" "}{t("Lecture des métadonnées…")}
        </p>
      )}

      {error && (
        <Callout tone="error" title={t("Fichier illisible")}>
          {tx(error)}
        </Callout>
      )}

      {details && files[0] && <Details details={details} file={files[0]} />}
    </div>
  );
}

/* ---------------------------------------------------------------- affichage */

/** Une ligne de la fiche. Rendue seulement si la valeur existe vraiment. */
function Row({ label, value, hint }: { label: string; value?: ReactNode; hint?: string }) {
  if (value === undefined || value === null || value === "") return null;
  return (
    <div className="flex items-baseline justify-between gap-4 py-1 text-xs">
      <span className="shrink-0 text-[var(--ft-text-muted)]" title={hint}>
        {label}
      </span>
      <span className="text-right font-mono">{value}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-[var(--radius-card)] border border-[var(--ft-border)] p-3">
      <h3 className="mb-1 text-[10px] uppercase tracking-wide text-[var(--ft-text-faint)]">
        {tx(title)}
      </h3>
      <div className="divide-y divide-[var(--ft-border)]">{children}</div>
    </section>
  );
}

function Details({ details, file }: { details: MediaDetails; file: SelectedFile }) {
  const [advanced, setAdvanced] = useState(false);

  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-2">
        <Section title={t("Fichier")}>
          <Row label={t("Nom")} value={file.name} />
          <Row label={t("Conteneur")} value={details.formatLongName ?? details.formatName} />
          <Row label={t("Durée")} value={details.durationMs > 0 ? formatTimecode(details.durationMs) : undefined} />
          <Row
            label={t("Taille")}
            value={details.sizeBytes ? formatFileSize(details.sizeBytes) : formatFileSize(file.size)}
          />
          <Row
            label={t("Débit global")}
            value={details.bitRate ? formatBitRate(details.bitRate) : undefined}
          />
          <Row label={t("Encodeur")} value={details.encoder} />
        </Section>

        {details.video.map((stream, index) => (
          <Section
            key={stream.index}
            title={
              stream.attachedPicture
                ? t("Pochette")
                : details.video.length > 1
                  ? t("Vidéo {value}", { value: index + 1 })
                  : t("Vidéo")
            }
          >
            <Row label={t("Codec")} value={stream.codecLongName ?? stream.codecName} />
            <Row label={t("Profil")} value={stream.profile} />
            <Row
              label={t("Résolution")}
              value={stream.width && stream.height ? `${stream.width} × ${stream.height}` : undefined}
            />
            <Row label={t("Rapport d'affichage")} value={stream.displayAspectRatio} />
            <Row
              label={t("Cadence")}
              value={
                stream.frameRate.average !== undefined
                  ? `${t("{rate} i/s", { rate: stream.frameRate.average })}${
                      stream.frameRate.averageFraction ? ` (${stream.frameRate.averageFraction})` : ""
                    }`
                  : undefined
              }
            />
            {stream.frameRate.diverging && (
              <Row
                label={t("Cadence réelle")}
                value={`${t("{rate} i/s", { rate: stream.frameRate.real })} (${stream.frameRate.realFraction})`}
                hint={t("Cadence déclarée par le conteneur, différente de la moyenne observée.")}
              />
            )}
            <Row
              label={t("Images")}
              value={stream.frameCount === undefined ? undefined : formatNumber(stream.frameCount)}
            />
            <Row
              label={t("Débit vidéo")}
              value={
                stream.bitRate
                  ? stream.bitRateInferred
                    ? t("{bitRate} (déduit)", { bitRate: formatBitRate(stream.bitRate) })
                    : formatBitRate(stream.bitRate)
                  : undefined
              }
              hint={stream.bitRateInferred ? t("Le flux ne déclare pas son débit : celui du conteneur est repris.") : undefined}
            />
            <Row label={t("Format de pixels")} value={stream.pixelFormat} />
            <Row label={t("Langue")} value={stream.language} />
          </Section>
        ))}

        {details.audio.map((stream, index) => (
          <Section key={stream.index} title={details.audio.length > 1 ? `Audio ${index + 1}` : t("Audio")}>
            <Row label={t("Codec")} value={stream.codecLongName ?? stream.codecName} />
            <Row label={t("Profil")} value={stream.profile} />
            <Row label={t("Canaux")} value={describeChannels(stream.channels, stream.channelLayout)} />
            <Row
              label={t("Échantillonnage")}
              value={stream.sampleRate ? formatSampleRate(stream.sampleRate) : undefined}
            />
            <Row label={t("Profondeur")} value={stream.bitDepth ? `${stream.bitDepth} bits` : undefined} />
            <Row
              label={t("Débit audio")}
              value={
                stream.bitRate
                  ? stream.bitRateInferred
                    ? t("{bitRate} (déduit)", { bitRate: formatBitRate(stream.bitRate) })
                    : formatBitRate(stream.bitRate)
                  : undefined
              }
            />
            <Row label={t("Langue")} value={stream.language} />
            <Row label={t("Titre")} value={stream.title} />
          </Section>
        ))}

        {details.subtitles.length > 0 && (
          <Section title={t("Sous-titres")}>
            {details.subtitles.map((stream, index) => (
              <Row
                key={stream.index}
                label={t("Piste {value}", { value: index + 1 })}
                value={[stream.codecName, stream.language, stream.title, stream.forced ? t("forcée") : undefined]
                  .filter(Boolean)
                  .join(" · ")}
              />
            ))}
          </Section>
        )}

        {details.tags.length > 0 && (
          <Section title={t("Étiquettes")}>
            {details.tags.map((tag) => (
              <Row key={tag.key} label={tag.key} value={tag.value} />
            ))}
          </Section>
        )}
      </div>

      {(details.replayGain.length > 0 || details.otherStreams > 0 || details.hasCoverArt) && (
        <div>
          <button
            onClick={() => setAdvanced((current) => !current)}
            className="text-xs text-[var(--ft-accent-text)] underline"
          >
            {t("{value} les informations techniques", { value: advanced ? t("Masquer") : t("Afficher") })}
          </button>
          {advanced && (
            <Section title={t("Technique avancée")}>
              <Row label={t("Pochette")} value={details.hasCoverArt ? t("présente") : undefined} />
              <Row
                label={t("Autres flux")}
                value={details.otherStreams > 0 ? String(details.otherStreams) : undefined}
              />
              {details.replayGain.map((tag) => (
                <Row key={tag.key} label={tag.key} value={tag.value} />
              ))}
            </Section>
          )}
        </div>
      )}

      {/* Ce qu'on veut faire juste après avoir lu la fiche. */}
      <div className="flex flex-wrap gap-2">
        {isRealVideo(details) && (
          <OpenToolButton toolId={HANDOFF_TARGETS.videoFrameRate} files={[file]} label={t("Changer la fréquence d'images")} />
        )}
        {details.audio.length > 0 && !isRealVideo(details) && (
          <OpenToolButton toolId={HANDOFF_TARGETS.audioMetadata} files={[file]} label={t("Modifier les étiquettes")} />
        )}
        {details.subtitles.some((stream) => stream.codecName) && isRealVideo(details) && (
          <OpenToolButton
            toolId={HANDOFF_TARGETS.subtitleExtract}
            files={[file]}
            label={t("Extraire les sous-titres")}
          />
        )}
      </div>
    </div>
  );
}
