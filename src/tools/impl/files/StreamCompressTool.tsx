import { useEffect, useState } from "react";
import { NativeRequired, RunBar } from "@/components/files/NativeRun";
import { isNativeAvailable, useNativeAction } from "@/components/files/useNativeAction";
import { PathPicker } from "@/components/files/PathPicker";
import { StatGrid } from "@/components/files/Summary";
import { Field, Fieldset, OptionGroup, Slider } from "@/components/pdf/Field";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { Icon } from "@/components/ui/Icon";
import { formatFileSize } from "@/core/files";
import {
  fileInfo,
  compressStream,
  decompressStream,
  pickSavePath,
  suggestStreamOutput,
  type StreamFormat,
  type StreamSummary,
} from "@/core/files/native";
import { baseName } from "@/core/files/paths";
import { revealFile } from "@/core/output/save";
import { notify } from "@/features/notifications/store";
import { HANDOFF_TARGETS } from "@/features/handoff/targets";
import { OpenToolButton } from "@/features/handoff/openTool";
import { useHandoffPaths } from "@/features/handoff/usePathHandoff";
import type { ToolComponentProps } from "@/tools/implementations";
import { Trans, localized, t, tx } from "@/i18n";

/**
 * Compression d'un **fichier seul** en GZ ou XZ, et l'inverse.
 *
 * La confusion que cet écran doit dissiper est celle-ci : `.gz` et `.xz` ne
 * sont pas des archives. Ils ne contiennent qu'un flux d'octets — un fichier,
 * sans nom de dossier, sans arborescence, sans permissions. `archive.tar.gz`
 * est autre chose : un TAR, qui porte l'arborescence, *ensuite* compressé.
 *
 * L'outil le dit à l'écran plutôt qu'en note de bas de page, et détecte le cas
 * du `.tar.gz` déposé pour renvoyer vers « Extraire une archive ».
 */
const FORMATS: { value: StreamFormat; label: string; hint: string }[] = localized(() => [
  {
    value: "gz",
    label: t("GZIP (.gz)"),
    hint: t("Universel et rapide. C'est ce que produisent gzip et la plupart des serveurs."),
  },
  {
    value: "xz",
    label: t("XZ (.xz)"),
    hint: t("Plus lent, nettement plus compact sur du texte et des journaux."),
  },
]);

export function StreamCompressTool({ tool }: ToolComponentProps) {
  const [direction, setDirection] = useState<"compress" | "decompress">(
    tool.id === "file-decompress" ? "decompress" : "compress",
  );
  const received = useHandoffPaths(tool.id);
  const [paths, setPaths] = useState<string[]>(received);
  const [format, setFormat] = useState<StreamFormat>("gz");
  const [level, setLevel] = useState(6);
  const action = useNativeAction<StreamSummary>();
  /**
   * Ce que les premiers octets disent du fichier choisi.
   *
   * Le décompresseur a besoin de savoir si on lui a donné un flux compressé —
   * et si ce n'est pas le cas, de le dire dans ces termes. Annoncer « archive
   * invalide » devant un `.txt` parfaitement sain serait un faux diagnostic :
   * le fichier va très bien, il n'est simplement pas compressé.
   */
  const [detected, setDetected] = useState<{ magic: string; label: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDetected(null);
    const target = paths[0];
    if (!target) return;
    (async () => {
      try {
        const info = await fileInfo(target);
        if (!cancelled) setDetected({ magic: info.magic, label: info.magicLabel });
      } catch {
        if (!cancelled) setDetected(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [paths]);

  if (!isNativeAvailable()) return <NativeRequired />;

  const path = paths[0];
  const name = path ? baseName(path).toLowerCase() : "";
  /** Format déduit du **contenu** d'abord, du nom ensuite. */
  const streamFormat: StreamFormat | null =
    detected?.magic === "xz"
      ? "xz"
      : detected?.magic === "gz"
        ? "gz"
        : name.endsWith(".xz") || name.endsWith(".txz")
          ? "xz"
          : name.endsWith(".gz") || name.endsWith(".tgz")
            ? "gz"
            : null;
  const isTarball = /\.(tar\.gz|tgz|tar\.xz|txz)$/i.test(name);
  const effectiveFormat = direction === "decompress" ? (streamFormat ?? format) : format;
  /**
   * Un fichier donné au décompresseur alors qu'il n'est pas compressé : cas
   * courant et parfaitement innocent, qui mérite une phrase juste.
   */
  const notCompressed =
    direction === "decompress" && detected !== null && streamFormat === null;

  const run = async () => {
    const suggestion = await suggestStreamOutput(path, effectiveFormat, direction === "compress");
    const output = await pickSavePath(baseName(suggestion));
    if (!output) return;
    const summary = await action.execute((context) =>
      direction === "compress"
        ? compressStream(path, output, effectiveFormat, level, context)
        : decompressStream(path, output, effectiveFormat, context),
    );
    if (summary) {
      notify.success(
        direction === "compress" ? t("Fichier compressé") : t("Fichier décompressé"),
        `${formatFileSize(summary.inputBytes)} → ${formatFileSize(summary.outputBytes)}`,
      );
    }
  };

  return (
    <div className="space-y-4">
      <OptionGroup
        ariaLabel={t("Sens de l'opération")}
        value={direction}
        onChange={(next) => {
          setDirection(next);
          setPaths([]);
          action.setResult(null);
        }}
        options={[
          { value: "compress", label: t("Compresser") },
          { value: "decompress", label: t("Décompresser") },
        ]}
      />

      <Callout tone="info" title={t("« .gz » et « .xz » ne contiennent qu'un seul fichier")}>
        {direction === "compress"
          ? t("Compresser produit un flux : un seul fichier, sans nom de dossier ni arborescence. Pour regrouper plusieurs fichiers en conservant leur organisation, passez par « Créer une archive » et son format TAR.GZ ou TAR.XZ.")
          : t("Décompresser attend un flux déjà compressé — un .gz ou un .xz. Un fichier ordinaire n'a rien à y faire, et un .tar.gz redonnera le .tar, pas l'arborescence qu'il contient.")}
      </Callout>

      <PathPicker
        mode="files"
        paths={paths}
        onChange={(next) => {
          setPaths(next);
          action.setResult(null);
        }}
        label={direction === "compress" ? t("Fichier à compresser") : t("Fichier .gz ou .xz à décompresser")}
        hint={t("traité en flux : la taille n'a pas d'importance")}
        disabled={action.job.isRunning}
        filters={
          direction === "decompress"
            ? [{ name: t("Flux compressés"), extensions: ["gz", "xz", "tgz", "txz"] }]
            : undefined
        }
      />

      {path && direction === "decompress" && isTarball && (
        <Callout tone="warning" title={t("Ce fichier est une archive TAR compressée")}>
          <Trans source={"Le décompresser ici redonnera le <0>.tar</0>, pas l'arborescence qu'il contient. Pour retrouver les fichiers, utilisez « Extraire une archive », qui fait les deux étapes."} components={[<code className="font-mono" />]} />
        </Callout>
      )}

      {notCompressed && (
        <Callout tone="warning" title={t("Ce fichier n'est pas compressé en GZ ni en XZ")}>
          <span className="block">
            <Trans source={"Ses premiers octets le désignent comme : <0>{label}</0>. Il n'y a donc rien à décompresser — le fichier n'a rien d'anormal, il n'est simplement pas un flux compressé."} values={{ label: detected?.label }} components={[<strong />]} />
          </span>
          <span className="mt-1 block">
            <Trans source={"Pour le <0>compresser</0>, basculez sur « Compresser » ci-dessus."} components={[<strong />]} />
          </span>
        </Callout>
      )}

      {path && direction === "decompress" && detected === null && streamFormat === null && (
        <Callout tone="warning" title={t("Format non reconnu")}>
          {t("FourTout ne sait dire ni d'après le nom ni d'après les premiers octets s'il s'agit d'un flux GZIP ou XZ. Choisissez le format explicitement ci-dessous.")}
        </Callout>
      )}

      {path && (
        <Fieldset columns={2} title={t("Réglages")}>
          <Field
            label={t("Format")}
            hint={tx(FORMATS.find((entry) => entry.value === effectiveFormat)?.hint)}
          >
            <OptionGroup
              ariaLabel={t("Format de compression")}
              value={effectiveFormat}
              onChange={setFormat}
              options={FORMATS}
              disabled={direction === "decompress" && streamFormat !== null}
            />
          </Field>
          {direction === "compress" && (
            <Field
              label={t("Compression : {level}", { level })}
              hint={t("0 = stocké sans compression, 9 = plus lent mais plus petit")}
            >
              <Slider min={0} max={9} step={1} value={level} onChange={setLevel} />
            </Field>
          )}
        </Fieldset>
      )}

      {path && !notCompressed && (
        <RunBar
          label={direction === "compress" ? t("Compresser…") : t("Décompresser…")}
          icon={direction === "compress" ? "FileArchive" : "FileOutput"}
          running={action.job.isRunning}
          progress={action.job.progress}
          status={action.job.status}
          error={tx(action.error)}
          cancel={action.job.cancel}
          onRun={() => void run()}
        />
      )}

      {action.result && (
        <div className="space-y-3" data-testid="stream-summary">
          <StatGrid
            columns={4}
            stats={[
              { label: t("Format"), value: action.result.format },
              { label: t("Entrée"), value: formatFileSize(action.result.inputBytes) },
              { label: t("Sortie"), value: formatFileSize(action.result.outputBytes) },
              { label: t("Taille finale"), value: `${action.result.ratio.toFixed(1)} %` },
            ]}
          />
          <div className="flex flex-wrap items-center gap-2" data-testid="stream-handoffs">
            <Trans source={"<0>Continuer avec</0>"} components={[<span className="ft-label" />]} />
            <OpenToolButton
              toolId={HANDOFF_TARGETS.inspect}
              paths={[action.result.output]}
            />
            <OpenToolButton toolId={HANDOFF_TARGETS.preview} paths={[action.result.output]} />
          </div>

          <Callout
            tone="success"
            title={direction === "compress" ? t("Fichier compressé") : t("Fichier décompressé")}
            actions={
              <Button size="sm" onClick={() => revealFile(action.result!.output)}>
                <Icon name="FolderTree" size={13} />{" "}{t("Ouvrir")}
              </Button>
            }
          >
            <code className="font-mono">{action.result.output}</code>
          </Callout>
        </div>
      )}
    </div>
  );
}
