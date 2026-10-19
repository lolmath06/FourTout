import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Callout, ProgressBar } from "@/components/ui/Callout";
import { Icon } from "@/components/ui/Icon";
import { Field, Fieldset, NumberInput, OptionGroup, Select, TextInput } from "@/components/pdf/Field";
import { CheckOption } from "@/components/text/TextToolShell";
import { RunBar } from "@/components/files/NativeRun";
import { useNativeAction } from "@/components/files/useNativeAction";
import { StatGrid } from "@/components/files/Summary";
import {Contacts, NativeGate, SavedFile, UrlField } from "@/components/internet/parts";
import { errorMessage } from "@/core/internet/errors";
import {
  ytdlpAnimate,
  ytdlpCapabilities,
  ytdlpDownload,
  ytdlpInfo,
  ytdlpInstall,
  ytdlpLatest,
  ytdlpPreview,
  ytdlpRemove,
  ytdlpStatus,
  type AudioFormat,
  type MediaCapabilities,
  type MediaInfo,
  type MediaOutcome,
  type MediaPreview,
  type MediaRequest,
  type MediaUpdate,
  type VideoContainer,
  type YtdlpStatus,
} from "@/core/internet/native";
import { formatTimecode, looksLikeWebUrl, parseTimecode, suggestStem, targetBytes, type SizeUnit } from "@/core/internet/format";
import { pickDirectory } from "@/core/files/native";
import { notify } from "@/features/notifications/store";
import { formatDecimalSize, localized, t, tx } from "@/i18n";

export type MediaVariant = "download" | "excerpt" | "gif";

const HEIGHTS = [2160, 1440, 1080, 720, 480, 360];

const CONTAINERS = localized(() => [
  { value: "mp4" as VideoContainer, label: "MP4", hint: t("Le plus compatible.") },
  { value: "webm" as VideoContainer, label: "WebM", hint: t("Ouvert, pour le web.") },
  { value: "best" as VideoContainer, label: t("Meilleur"), hint: t("Le conteneur que choisit yt-dlp (souvent MKV).") },
  { value: "source" as VideoContainer, label: t("Source"), hint: t("Les flux d'origine, sans conversion.") },
]);

const AUDIO_LABELS: Record<AudioFormat, { label: string; encoder: string | null }> = {
  mp3: { label: "MP3", encoder: "libmp3lame" },
  m4a: { label: "M4A (AAC)", encoder: "aac" },
  opus: { label: "Opus", encoder: "libopus" },
  ogg: { label: "Ogg Vorbis", encoder: "libvorbis" },
  wav: { label: "WAV", encoder: "pcm_s16le" },
  flac: { label: "FLAC", encoder: "flac" },
  source: { label: "", encoder: null },
};

const STAGES = localized(() => ({
  inspect: t("Analyse…"),
  download: t("Téléchargement…"),
  merge: t("Assemblage audio et vidéo…"),
  audio: t("Conversion du son…"),
  trim: t("Découpe de l'extrait…"),
  encode: t("Encodage…"),
}));

/* ----------------------------------------------------------------- yt-dlp */

/** Installation à la demande de yt-dlp : rien ne se télécharge sans un clic. */
function Engine({ status, refresh }: { status: YtdlpStatus; refresh: () => void }) {
  const action = useNativeAction<{ version: string }>();
  const [latest, setLatest] = useState<string | null>(null);
  const [received, setReceived] = useState<{ done: number; total: number } | null>(null);

  const install = async () => {
    setReceived(null);
    const outcome = await action.execute((context) => ytdlpInstall(context, (p) => setReceived({ done: p.done, total: p.total })));
    if (outcome) {
      notify.success(t("yt-dlp installé"), outcome.version);
      refresh();
    }
  };
  const check = async () => {
    try {
      setLatest(await ytdlpLatest());
    } catch (error) {
      notify.error(t("Vérification impossible"), errorMessage(error));
    }
  };

  if (!status.supported) {
    return (
      <Callout tone="warning" title={t("Plateforme non prise en charge")}>
        {t("Aucun binaire officiel de yt-dlp n'existe pour ce système. Installez yt-dlp vous-même, FourTout l'utilisera s'il est dans le PATH.")}
      </Callout>
    );
  }

  const busy = action.job.isRunning;
  const outdated = latest !== null && status.version !== null && latest !== status.version && status.origin === "managed";

  return (
    <div className="space-y-2">
      {!status.installed && (
        <Callout
          tone="info"
          title={t("yt-dlp doit être installé")}
          data-testid="ytdlp-missing"
          actions={
            <Button size="sm" variant="primary" onClick={install} disabled={busy}>
              {busy ? <Icon name="Loader" size={13} className="animate-spin" /> : <Icon name="Download" size={13} />} {t("Installer yt-dlp")}
            </Button>
          }
        >
          {t("yt-dlp est le moteur libre (Unlicense) qui sait lire les médias publics de centaines de sites. Il est téléchargé une seule fois depuis la page officielle de ses publications (GitHub), vérifié par son empreinte SHA-256 officielle, puis rangé dans le dossier de données de FourTout : {directory}", { directory: status.directory })}
        </Callout>
      )}
      {busy && (
        <>
          <ProgressBar ratio={received && received.total > 0 ? received.done / received.total : undefined} label={t("Installation de yt-dlp")} />
          <Button size="sm" variant="ghost" onClick={action.job.cancel}>{t("Annuler")}</Button>
        </>
      )}
      {action.error && <Callout tone="error" title={t("Installation impossible")}>{action.error}</Callout>}

      {status.installed && (
        <div className="ft-meta flex flex-wrap items-center gap-x-3 gap-y-1" data-testid="ytdlp-ready">
          <span className="inline-flex items-center gap-1">
            <Icon name="CircleCheck" size={13} className="text-[var(--ft-ok)]" />
            {t("yt-dlp {version}", { version: status.version ?? "" })}
            {status.origin === "system" ? ` · ${t("installé sur le système")}` : ""}
          </span>
          {status.origin === "managed" && (
            <>
              <button type="button" className="underline-offset-2 hover:underline" onClick={check}>{t("Rechercher une mise à jour")}</button>
              <button
                type="button"
                className="underline-offset-2 hover:underline"
                onClick={async () => {
                  await ytdlpRemove();
                  refresh();
                }}
              >
                {t("Supprimer")}
              </button>
            </>
          )}
          {latest && !outdated && <span>{t("À jour")}</span>}
          {outdated && (
            <Button size="sm" onClick={install} disabled={busy}>{t("Mettre à jour vers {version}", { version: latest ?? "" })}</Button>
          )}
        </div>
      )}
      {status.installed && status.jsRuntime === null && (
        <p className="ft-meta">
          {t("Certains formats YouTube récents demandent un moteur JavaScript (Deno ou Node.js) installé sur le système ; sans lui, certaines qualités peuvent manquer.")}
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ flux */

interface Props {
  variant: MediaVariant;
}

export function MediaFlow({ variant }: Props) {
  return (
    <NativeGate>
      <MediaPanel variant={variant} />
    </NativeGate>
  );
}

function MediaPanel({ variant }: Props) {
  const [status, setStatus] = useState<YtdlpStatus | null>(null);
  const [caps, setCaps] = useState<MediaCapabilities | null>(null);
  const [url, setUrl] = useState("");
  const [info, setInfo] = useState<(MediaInfo & { thumbnailData: string | null }) | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [inspectError, setInspectError] = useState<string | undefined>();

  const [mode, setMode] = useState<"video" | "audio">("video");
  const [container, setContainer] = useState<VideoContainer>("mp4");
  const [height, setHeight] = useState<number | null>(null);
  const [audioFormat, setAudioFormat] = useState<AudioFormat>("mp3");
  const [audioKbps, setAudioKbps] = useState<number | null>(null);
  const [limit, setLimit] = useState(false);
  const [limitValue, setLimitValue] = useState(50);
  const [limitUnit, setLimitUnit] = useState<SizeUnit>("mb");
  const [start, setStart] = useState("0:00");
  const [end, setEnd] = useState("0:10");
  const [exact, setExact] = useState(true);
  const [animation, setAnimation] = useState<"gif" | "webp">("gif");
  const [fps, setFps] = useState(12);
  const [width, setWidth] = useState(480);
  const [quality, setQuality] = useState(70);
  const [destination, setDestination] = useState("");
  const [preview, setPreview] = useState<MediaPreview | null>(null);
  const [update, setUpdate] = useState<MediaUpdate | null>(null);

  const action = useNativeAction<MediaOutcome>();

  const refresh = useCallback(() => {
    void ytdlpStatus().then(setStatus).catch(() => setStatus(null));
    void ytdlpCapabilities().then(setCaps).catch(() => setCaps(null));
  }, []);
  useEffect(refresh, [refresh]);

  const analyse = async () => {
    setInspecting(true);
    setInspectError(undefined);
    setInfo(null);
    action.setResult(null);
    try {
      const found = await ytdlpInfo(url.trim());
      setInfo(found);
      const duration = found.durationSecs ?? 0;
      if (variant !== "download" && duration > 0) {
        setStart("0:00");
        setEnd(formatTimecode(Math.min(duration, variant === "gif" ? 5 : Math.min(duration, 30))));
      }
      if (!found.hasVideo) setMode("audio");
    } catch (error) {
      setInspectError(errorMessage(error));
    } finally {
      setInspecting(false);
    }
  };

  const startS = parseTimecode(start);
  const endS = parseTimecode(end);
  const section = variant === "download" ? null : startS !== null && endS !== null ? { start: startS, end: endS } : null;
  const sectionValid = variant === "download" || (section !== null && section.end > section.start + 0.4 && section.start < (info?.durationSecs ?? Infinity));
  const maxBytes = limit ? targetBytes(limitValue, limitUnit) : null;

  const request: MediaRequest | null = useMemo(
    () =>
      info
        ? {
            url: url.trim(),
            mode: variant === "gif" ? "video" : mode,
            container: variant === "gif" ? "mp4" : container,
            maxHeight: height,
            audioFormat,
            audioKbps,
            section,
            exactCuts: exact,
            maxBytes,
          }
        : null,
    // `section` est recréé à chaque rendu : ses deux nombres suffisent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [info, url, variant, mode, container, height, audioFormat, audioKbps, section?.start, section?.end, exact, maxBytes],
  );

  useEffect(() => {
    if (!info || !request) {
      setPreview(null);
      return;
    }
    let alive = true;
    const { thumbnailData: _thumbnail, ...bare } = info;
    ytdlpPreview(bare, request).then((p) => alive && setPreview(p)).catch(() => alive && setPreview(null));
    return () => {
      alive = false;
    };
  }, [info, request]);

  const choose = async () => {
    const dir = await pickDirectory(t("Dossier de destination"));
    if (dir) setDestination(dir);
  };

  const run = async () => {
    if (!info || !request || !destination) return;
    setUpdate(null);
    const title = suggestStem(info.title);
    await action.execute((context) =>
      variant === "gif"
        ? ytdlpAnimate({ request, title, destination, format: animation, fps, width, quality }, context, setUpdate)
        : ytdlpDownload({ request, title, destination }, context, setUpdate),
    );
  };

  const availableHeights = info ? HEIGHTS.filter((h) => info.heights.some((available) => available >= h) || info.heights.length === 0) : HEIGHTS;
  const audioChoices = (Object.keys(AUDIO_LABELS) as AudioFormat[])
    .filter((f) => f !== "source" && caps?.audioEncoders.includes(AUDIO_LABELS[f].encoder ?? ""))
    .map((f) => ({ value: f, label: AUDIO_LABELS[f].label }));
  const lossy = audioFormat === "mp3" || audioFormat === "m4a" || audioFormat === "opus" || audioFormat === "ogg";
  const busy = action.job.isRunning;
  const ready = status?.installed === true && caps?.ffmpeg === true;
  const canRun = ready && !!info && !!request && !!destination && sectionValid && (variant === "gif" ? true : mode === "video" || audioChoices.length > 0);

  return (
    <>
      <div className="space-y-4">
        <Contacts>
          {t("yt-dlp contacte le service de médias de l'adresse que vous indiquez. Seuls les contenus publics sont pris en charge : FourTout ne contourne ni DRM, ni paiement, ni connexion, et n'utilise aucun cookie de navigateur.")}
        </Contacts>

        {status && <Engine status={status} refresh={refresh} />}
        {caps && !caps.ffmpeg && (
          <Callout tone="warning" title={t("FFmpeg est introuvable")} data-testid="ffmpeg-missing">
            {t("Assembler l'image et le son, convertir en MP3 ou découper demande FFmpeg. Installez-le (il est déjà utilisé par les outils audio et vidéo de FourTout), puis rouvrez cet outil.")}
          </Callout>
        )}

        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <UrlField
              value={url}
              onChange={(v) => {
                setUrl(v);
                setInfo(null);
              }}
              onSubmit={analyse}
              disabled={busy || inspecting || !ready}
              hint={t("Adresse d'une seule vidéo. Les listes de lecture ne sont pas prises en charge.")}
            />
          </div>
          <Button size="md" onClick={analyse} disabled={!looksLikeWebUrl(url) || busy || inspecting || !ready}>
            {inspecting ? <Icon name="Loader" size={14} className="animate-spin" /> : <Icon name="ScanSearch" size={14} />} {t("Analyser")}
          </Button>
        </div>
        {inspectError && <Callout tone="error" title={t("Analyse impossible")}>{inspectError}</Callout>}

        {info && request && (
          <div className="space-y-4" data-testid="media-info">
            <div className="flex gap-3 rounded-[var(--radius-card)] border border-[var(--ft-border)] p-2.5">
              {info.thumbnailData && <img src={info.thumbnailData} alt="" className="h-20 w-36 shrink-0 rounded object-cover" />}
              <div className="min-w-0 space-y-0.5">
                <p className="truncate text-sm font-medium" title={info.title}>{info.title}</p>
                <p className="ft-meta truncate">{[info.uploader, info.extractor].filter(Boolean).join(" · ")}</p>
                <p className="ft-meta tabular-nums">
                  {info.durationSecs ? formatTimecode(info.durationSecs) : "—"}
                  {info.heights.length > 0 ? ` · ${info.heights.map((h) => `${h}p`).slice(0, 6).join(" ")}` : ""}
                </p>
              </div>
            </div>

            <Fieldset columns={2}>
              {variant !== "gif" && (
                <Field label={t("Contenu")} full>
                  <OptionGroup
                    value={mode}
                    onChange={setMode}
                    ariaLabel={t("Vidéo ou audio")}
                    options={[
                      { value: "video", label: t("Vidéo") },
                      { value: "audio", label: t("Audio seul") },
                    ]}
                  />
                </Field>
              )}

              {(variant === "gif" || mode === "video") && info.hasVideo && (
                <>
                  {variant !== "gif" && (
                    <Field label={t("Format")}>
                      <OptionGroup value={container} onChange={setContainer} options={CONTAINERS} ariaLabel={t("Format vidéo")} />
                    </Field>
                  )}
                  <Field label={t("Résolution maximale")} hint={t("Jamais agrandie : si la source est plus petite, elle reste telle quelle.")}>
                    <Select
                      value={height === null ? "best" : String(height)}
                      onChange={(v) => setHeight(v === "best" ? null : Number(v))}
                      aria-label={t("Résolution maximale")}
                      options={[
                        { value: "best", label: t("Meilleure disponible") },
                        ...availableHeights.map((h) => ({ value: String(h), label: `${h}p` })),
                      ]}
                    />
                  </Field>
                </>
              )}

              {variant !== "gif" && mode === "audio" && (
                <>
                  <Field label={t("Format audio")} hint={audioChoices.length === 0 ? t("Ce FFmpeg ne sait encoder aucun de ces formats.") : undefined}>
                    <Select value={audioFormat} onChange={setAudioFormat} options={audioChoices} aria-label={t("Format audio")} />
                  </Field>
                  {lossy && (
                    <Field label={t("Débit")}>
                      <Select
                        value={audioKbps === null ? "auto" : String(audioKbps)}
                        onChange={(v) => setAudioKbps(v === "auto" ? null : Number(v))}
                        aria-label={t("Débit audio")}
                        options={[
                          { value: "auto", label: t("Meilleure qualité") },
                          ...[320, 256, 192, 128, 96].map((k) => ({ value: String(k), label: `${k} kb/s` })),
                        ]}
                      />
                    </Field>
                  )}
                </>
              )}

              {variant !== "download" && (
                <>
                  <Field label={t("Début")} hint={t("Secondes, mm:ss ou hh:mm:ss")}>
                    <TextInput value={start} onChange={(e) => setStart(e.target.value)} className="font-mono" aria-invalid={startS === null || undefined} />
                  </Field>
                  <Field label={t("Fin")} hint={info.durationSecs ? t("Durée de la vidéo : {value}", { value: formatTimecode(info.durationSecs) }) : undefined}>
                    <TextInput value={end} onChange={(e) => setEnd(e.target.value)} className="font-mono" aria-invalid={endS === null || undefined} />
                  </Field>
                </>
              )}
              {variant === "excerpt" && (
                <CheckOption
                  checked={exact}
                  onChange={setExact}
                  label={t("Couper exactement aux bornes")}
                  hint={t("Réencode les bords de l'extrait. Décoché : plus rapide, mais calé sur les images clés.")}
                />
              )}

              {variant === "gif" && (
                <>
                  <Field label={t("Format")}>
                    <OptionGroup
                      value={animation}
                      onChange={setAnimation}
                      ariaLabel={t("Format de l'animation")}
                      options={[
                        { value: "gif", label: "GIF" },
                        ...(caps?.webpAnimated ? [{ value: "webp" as const, label: t("WebP animé") }] : []),
                      ]}
                    />
                  </Field>
                  <Field label={t("Images par seconde")}><NumberInput value={fps} min={4} max={30} onChange={(e) => setFps(Math.min(30, Math.max(4, Number(e.target.value) || 12)))} /></Field>
                  <Field label={t("Largeur (px)")} hint={t("Jamais plus large que la source.")}><NumberInput value={width} min={120} max={1280} step={20} onChange={(e) => setWidth(Math.min(1280, Math.max(64, Number(e.target.value) || 480)))} /></Field>
                  {animation === "webp" && (
                    <Field label={t("Qualité ({value} %)", { value: quality })}><NumberInput value={quality} min={10} max={100} step={5} onChange={(e) => setQuality(Math.min(100, Math.max(10, Number(e.target.value) || 70)))} /></Field>
                  )}
                </>
              )}

              <div className="sm:col-span-full">
                <CheckOption
                  checked={limit}
                  onChange={setLimit}
                  label={t("Viser une taille maximale")}
                  hint={t("Le résultat est réencodé si besoin. La taille n'est pas garantie à l'octet près.")}
                />
                {limit && (
                  <div className="mt-1.5 flex items-center gap-2 pl-7">
                    <NumberInput className="!w-28" value={limitValue} min={1} onChange={(e) => setLimitValue(Number(e.target.value) || 1)} aria-label={t("Taille maximale")} />
                    <Select
                      value={limitUnit}
                      onChange={setLimitUnit}
                      aria-label={t("Unité")}
                      options={[
                        { value: "kb", label: t("Ko") },
                        { value: "mb", label: t("Mo") },
                        { value: "gb", label: t("Go") },
                      ]}
                    />
                  </div>
                )}
              </div>
            </Fieldset>

            {preview && (
              <StatGrid
                columns={3}
                stats={[
                  {
                    label: t("Résolution obtenue"),
                    value: mode === "audio" && variant !== "gif" ? "—" : preview.resolvedHeight ? `${preview.resolvedHeight}p` : "—",
                  },
                  { label: t("Taille estimée"), value: preview.estimatedBytes ? `≈ ${formatDecimalSize(preview.estimatedBytes)}` : t("Inconnue") },
                  {
                    label: t("Codecs"),
                    value: [preview.video?.videoCodec?.split(".")[0], preview.audio?.audioCodec?.split(".")[0] ?? preview.video?.audioCodec?.split(".")[0]].filter(Boolean).join(" + ") || "—",
                  },
                ]}
              />
            )}
            {maxBytes && preview?.estimatedBytes && preview.estimatedBytes <= maxBytes && variant === "download" && (
              <p className="ft-meta">{t("Le média tient déjà sous cette taille : il ne sera pas réencodé.")}</p>
            )}
            {variant === "download" && mode === "video" && container === "mp4" && (info.heights[0] ?? 0) > 1080 && (
              <p className="ft-meta">{t("Au-delà de 1080p, les services proposent rarement du H.264 : le MP4 contiendra alors du VP9 ou de l'AV1, que certains lecteurs anciens n'ouvrent pas.")}</p>
            )}

            <div className="flex flex-col gap-1">
              <span className="ft-label">{t("Dossier de destination")}</span>
              <span className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate rounded-md border border-[var(--ft-border)] bg-[var(--ft-bg)] px-2.5 py-2 text-xs" data-testid="destination">{destination || "—"}</span>
                <Button size="sm" onClick={choose} disabled={busy} aria-label={t("Choisir le dossier de destination")}>{t("Choisir…")}</Button>
              </span>
            </div>

            <RunBar
              label={variant === "gif" ? t("Créer l'animation") : variant === "excerpt" ? t("Télécharger l'extrait") : t("Télécharger")}
              icon="Download"
              onRun={run}
              running={busy}
              progress={{
                ratio: update?.ratio ?? undefined,
                label: update ? [tx(STAGES[update.stage]), update.speed ? `${formatDecimalSize(update.speed)}/s` : ""].filter(Boolean).join(" · ") : undefined,
              }}
              disabled={!canRun}
              cancel={action.job.cancel}
              status={action.job.status}
              error={action.error}
            />
          </div>
        )}

        {action.result && (
          <SavedFile path={action.result.path} bytes={action.result.bytes} title={t("Média enregistré")}>
            <span className="mt-1 block text-[11px] text-[var(--ft-text-muted)]">
              {action.result.method === "section-remote"
                ? t("Seul l'extrait a été téléchargé.")
                : action.result.method === "section-local"
                  ? t("Ce site ne permet pas de ne récupérer qu'un extrait : la source entière a été téléchargée, puis découpée ici.")
                  : null}
              {action.result.reencoded ? ` ${t("Le fichier a été réencodé pour respecter la taille demandée.")}` : ""}
            </span>
          </SavedFile>
        )}
      </div>
    </>
  );
}
