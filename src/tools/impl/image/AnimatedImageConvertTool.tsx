import { useEffect, useState } from "react";
import { PathPicker } from "@/components/files/PathPicker";
import { NativeRequired, RunBar } from "@/components/files/NativeRun";
import { useNativeAction, isNativeAvailable } from "@/components/files/useNativeAction";
import { StatGrid } from "@/components/files/Summary";
import { Field, Fieldset, NumberInput, OptionGroup, Select } from "@/components/pdf/Field";
import { Callout } from "@/components/ui/Callout";
import { SavedFile } from "@/components/internet/parts";
import {
  animInfo,
  convertAnimation,
  nativeImageFormats,
  type AnimInfo,
  type AnimSummary,
  type AnimTarget,
  type NativeImageFormats,
} from "@/core/internet/native";
import { formatTimecode } from "@/core/internet/format";
import { pickDirectory, pickSavePath } from "@/core/files/native";
import { baseName, stemOf } from "@/core/files/paths";
import { presetString, useHandoff } from "@/features/handoff/store";
import type { ToolComponentProps } from "@/tools/implementations";
import { localized, t } from "@/i18n";

const TARGETS = localized(() => [
  { value: "gif" as AnimTarget, label: "GIF" },
  { value: "apng" as AnimTarget, label: "APNG" },
  { value: "webp" as AnimTarget, label: t("WebP animé") },
  { value: "mp4" as AnimTarget, label: "MP4" },
  { value: "webm" as AnimTarget, label: "WebM" },
  { value: "frames" as AnimTarget, label: t("Images (PNG)") },
]);

const EXTENSION: Record<Exclude<AnimTarget, "frames">, string> = { gif: "gif", apng: "png", webp: "webp", mp4: "mp4", webm: "webm" };

function asTarget(value: string | undefined): AnimTarget | undefined {
  return TARGETS.find((entry) => entry.value === value)?.value;
}

/**
 * Convertir une image animée (WebP animé, APNG) sans la mettre à plat.
 *
 * Les images sont décodées une à une avec leur durée d'origine, puis
 * réassemblées dans le format voulu. L'outil dit ce que la destination ne peut
 * pas conserver : la transparence (GIF, MP4, WebM) ou la boucle (vidéo).
 */
export function AnimatedImageConvertTool({ tool }: ToolComponentProps) {
  const handoff = useHandoff(tool.id);
  const [paths, setPaths] = useState<string[]>(() => handoff?.paths ?? []);
  const [target, setTarget] = useState<AnimTarget>(() => asTarget(presetString(handoff, "target")) ?? "gif");
  const [formats, setFormats] = useState<NativeImageFormats | null>(null);
  const [info, setInfo] = useState<AnimInfo | null>(null);
  const [infoError, setInfoError] = useState<string | undefined>();
  const [maxWidth, setMaxWidth] = useState(0);
  const [quality, setQuality] = useState(80);
  const [background, setBackground] = useState("white");
  const action = useNativeAction<AnimSummary>();

  useEffect(() => {
    void nativeImageFormats().then(setFormats);
  }, []);

  useEffect(() => {
    setInfo(null);
    setInfoError(undefined);
    action.setResult(null);
    if (!paths[0]) return;
    let alive = true;
    animInfo(paths[0]).then((i) => alive && setInfo(i)).catch((e) => alive && setInfoError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [paths]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!isNativeAvailable()) return <NativeRequired />;

  const needsFfmpeg = target !== "frames";
  const blocked = needsFfmpeg && formats !== null && !formats.ffmpeg;
  const loss: string[] = [];
  if (target === "gif") loss.push(t("Le GIF ne garde que 256 couleurs et une transparence tout ou rien."));
  if (target === "mp4" || target === "webm") loss.push(t("Une vidéo n'a pas de transparence (le fond choisi la remplace) et ne boucle pas toute seule."));

  const run = async () => {
    const source = paths[0];
    const stem = stemOf(baseName(source));
    const output =
      target === "frames"
        ? await pickDirectory(t("Dossier où créer le dossier d'images"))
        : await pickSavePath(`${stem}.${EXTENSION[target]}`);
    if (!output) return;
    await action.execute((context) =>
      convertAnimation(
        {
          source,
          target,
          output,
          overwrite: true,
          options: { maxWidth: maxWidth > 0 ? maxWidth : null, background: background === "black" ? [0, 0, 0] : [255, 255, 255], quality },
        },
        context,
      ),
    );
  };

  const busy = action.job.isRunning;
  const result = action.result;

  return (
    <div className="space-y-4">
      <PathPicker
        mode="files"
        paths={paths}
        onChange={(next) => setPaths(next.slice(-1))}
        label={t("Choisissez un WebP animé ou un PNG animé")}
        filters={[{ name: t("Images animées"), extensions: ["webp", "png", "apng"] }]}
        disabled={busy}
      />
      {infoError && <Callout tone="error" title={t("Image illisible")}>{infoError}</Callout>}
      {info && !info.animated && (
        <Callout tone="warning" title={t("Cette image n'est pas animée")} data-testid="not-animated">
          {t("Elle ne contient qu'une image. Utilisez « Convertir une image » pour un changement de format ordinaire.")}
        </Callout>
      )}

      {info?.animated && (
        <>
          <StatGrid
            columns={4}
            stats={[
              { label: t("Format"), value: info.kind === "webp" ? "WebP" : "APNG" },
              { label: t("Images"), value: info.frames },
              { label: t("Dimensions"), value: `${info.width} × ${info.height}` },
              { label: t("Durée"), value: formatTimecode(info.durationMs / 1000) },
            ]}
          />
          <Fieldset columns={2}>
            <Field label={t("Convertir en")}>
              <OptionGroup
                value={target}
                onChange={setTarget}
                ariaLabel={t("Format de destination")}
                options={TARGETS.filter((entry) => {
                  if (entry.value === "webp" && info.kind === "webp") return false;
                  if (entry.value === "apng" && info.kind === "apng") return false;
                  if (entry.value === "webp") return formats?.ffmpeg === true;
                  return true;
                })}
              />
            </Field>
            {target !== "frames" && (
              <Field label={t("Largeur maximale")} hint={t("0 = taille d'origine ; jamais agrandie.")}>
                <NumberInput value={maxWidth} min={0} max={4096} step={20} onChange={(e) => setMaxWidth(Math.max(0, Number(e.target.value) || 0))} />
              </Field>
            )}
            {target === "webp" && (
              <Field label={t("Qualité ({value} %)", { value: quality })} hint={t("100 % = sans perte.")}>
                <NumberInput value={quality} min={10} max={100} step={5} onChange={(e) => setQuality(Math.min(100, Math.max(10, Number(e.target.value) || 80)))} />
              </Field>
            )}
            {(target === "mp4" || target === "webm") && (
              <Field label={t("Fond à la place de la transparence")}>
                <Select value={background} onChange={setBackground} aria-label={t("Fond")} options={[{ value: "white", label: t("Blanc") }, { value: "black", label: t("Noir") }]} />
              </Field>
            )}
          </Fieldset>
          {loss.map((message) => (
            <Callout key={message} tone="neutral" icon="Info">{message}</Callout>
          ))}
          {blocked && (
            <Callout tone="warning" title={t("FFmpeg est introuvable")}>
              {t("Cette destination demande FFmpeg. Seul l'export en images PNG fonctionne sans lui.")}
            </Callout>
          )}
          <RunBar
            label={target === "frames" ? t("Exporter les images…") : t("Convertir…")}
            icon="Images"
            onRun={run}
            running={busy}
            progress={action.job.progress}
            disabled={blocked}
            cancel={action.job.cancel}
            status={action.job.status}
            error={action.error}
          />
        </>
      )}

      {result && (
        <SavedFile path={result.path} bytes={result.bytes} title={target === "frames" ? t("Images exportées") : t("Conversion terminée")}>
          <span className="mt-1 block text-[11px] text-[var(--ft-text-muted)]">{t("{count} images.", { count: result.frames })}</span>
          {result.alphaLost && <span className="block text-[11px] text-[var(--ft-warn)]">{t("La transparence n'existe plus dans ce fichier.")}</span>}
          {result.loopLost && <span className="block text-[11px] text-[var(--ft-warn)]">{t("Ce fichier ne boucle pas : le lecteur décide de la répétition.")}</span>}
        </SavedFile>
      )}
    </div>
  );
}
