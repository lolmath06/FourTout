import { useEffect, useState } from "react";
import { PathPicker } from "@/components/files/PathPicker";
import { RunBar, NativeRequired } from "@/components/files/NativeRun";
import { useNativeAction, isNativeAvailable } from "@/components/files/useNativeAction";
import { StatGrid, Warnings } from "@/components/files/Summary";
import { Field, Fieldset, TextInput } from "@/components/pdf/Field";
import { CheckOption } from "@/components/text/TextToolShell";
import { Callout } from "@/components/ui/Callout";
import { SavedFile } from "@/components/internet/parts";
import { createIso, type IsoCreated } from "@/core/internet/native";
import { folderStats, pickSavePath, type FolderStats } from "@/core/files/native";
import { baseName } from "@/core/files/paths";
import { useHandoffPaths } from "@/features/handoff/usePathHandoff";
import type { ToolComponentProps } from "@/tools/implementations";
import { formatDecimalSize, t } from "@/i18n";

/**
 * Créer une image ISO 9660 à partir d'un dossier.
 *
 * Joliet donne les noms longs en Unicode (lus par Windows), Rock Ridge les noms
 * longs et les droits (lus par Linux et macOS). L'image est un **fichier** : il
 * n'est jamais écrit sur un disque, une clé USB ou un périphérique, et n'est
 * pas amorçable.
 */
export function IsoCreateTool({ tool }: ToolComponentProps) {
  const received = useHandoffPaths(tool.id);
  const [paths, setPaths] = useState<string[]>(received);
  const [label, setLabel] = useState("");
  const [joliet, setJoliet] = useState(true);
  const [rockRidge, setRockRidge] = useState(true);
  const [stats, setStats] = useState<FolderStats | null>(null);
  const action = useNativeAction<IsoCreated>();

  useEffect(() => {
    setStats(null);
    if (!paths[0]) return;
    setLabel((previous) => previous || baseName(paths[0]).slice(0, 32));
    let alive = true;
    folderStats(paths[0]).then((s) => alive && setStats(s)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [paths]);

  if (!isNativeAvailable()) return <NativeRequired />;

  const run = async () => {
    const name = (label.trim() || baseName(paths[0])).replace(/[\\/:*?"<>|]+/g, "_");
    const output = await pickSavePath(`${name}.iso`, [{ name: "ISO", extensions: ["iso"] }]);
    if (!output) return;
    await action.execute((context) =>
      createIso({ source: paths[0], output, label: label.trim() || baseName(paths[0]), joliet, rockRidge, overwrite: true }, context),
    );
  };

  const busy = action.job.isRunning;
  const result = action.result;
  const tooBig = (stats?.largest[0]?.size ?? 0) >= 4 * 1024 ** 3;

  return (
    <div className="space-y-4">
      <PathPicker
        mode="directory"
        paths={paths}
        onChange={(next) => {
          setPaths(next.slice(-1));
          setLabel("");
          action.setResult(null);
        }}
        label={t("Choisissez le dossier à réunir dans une image")}
        hint={t("Tout le contenu du dossier, sous-dossiers compris, entre dans l'image.")}
        disabled={busy}
      />

      {paths[0] && (
        <>
          {stats && (
            <StatGrid
              columns={3}
              stats={[
                { label: t("Fichiers"), value: stats.files },
                { label: t("Dossiers"), value: stats.directories },
                { label: t("Taille estimée"), value: formatDecimalSize(stats.totalBytes) },
              ]}
            />
          )}
          {tooBig && (
            <Callout tone="error" title={t("Fichier trop volumineux")}>
              {t("ISO 9660 ne peut pas contenir un fichier de 4 Gio ou plus. L'image sera refusée.")}
            </Callout>
          )}
          <Fieldset columns={1}>
            <Field label={t("Nom du volume")} hint={t("Le nom que voit le système quand l'image est montée. Restreint aux lettres, chiffres et _ pour ISO 9660 (32 caractères).")}>
              <TextInput value={label} maxLength={32} onChange={(e) => setLabel(e.target.value)} />
            </Field>
            <div className="grid gap-0.5 sm:grid-cols-2">
              <CheckOption checked={joliet} onChange={setJoliet} label={t("Joliet (noms Unicode, Windows)")} hint={t("Noms jusqu'à 64 caractères.")} />
              <CheckOption checked={rockRidge} onChange={setRockRidge} label={t("Rock Ridge (Linux, macOS)")} hint={t("Noms longs et droits POSIX.")} />
            </div>
          </Fieldset>
          <RunBar
            label={t("Créer l'image…")}
            icon="Disc3"
            onRun={run}
            running={busy}
            progress={action.job.progress}
            cancel={action.job.cancel}
            status={action.job.status}
            error={action.error}
          />
        </>
      )}

      {result && (
        <div className="space-y-2">
          <SavedFile path={result.path} bytes={result.imageBytes} title={t("Image créée")}>
            <span className="mt-1 block text-[11px] text-[var(--ft-text-muted)]">
              {t("{files} fichiers et {dirs} dossiers, volume « {label} ».", { files: result.files, dirs: result.directories, label: result.label })}
            </span>
          </SavedFile>
          {result.warnings.length > 0 && (
            <Warnings
              title={t("{count} noms n'ont pas pu être conservés tels quels", { count: result.warningCount })}
              items={result.warnings}
            />
          )}
        </div>
      )}

      <Callout tone="neutral" title={t("Limites")}>
        {t("L'image n'est pas amorçable et n'est jamais écrite sur un disque : FourTout ne touche ni aux partitions ni aux périphériques. Les liens symboliques sont ignorés, et un fichier de 4 Gio ou plus est refusé.")}
      </Callout>
    </div>
  );
}
