import { useEffect, useMemo, useState } from "react";
import { PathPicker } from "@/components/files/PathPicker";
import { NativeRequired, RunBar } from "@/components/files/NativeRun";
import { useNativeAction, isNativeAvailable } from "@/components/files/useNativeAction";
import { StatGrid, Warnings } from "@/components/files/Summary";
import { Fieldset } from "@/components/pdf/Field";
import { CheckOption } from "@/components/text/TextToolShell";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { Icon } from "@/components/ui/Icon";
import { inspectIso, extractIso, type IsoInfo } from "@/core/internet/native";
import { pickDirectory } from "@/core/files/native";
import { baseName, directoryName, joinPath, stemOf } from "@/core/files/paths";
import { openFolder } from "@/core/output/save";
import { useHandoffPaths } from "@/features/handoff/usePathHandoff";
import type { ToolComponentProps } from "@/tools/implementations";
import { formatDecimalSize, t, tx } from "@/i18n";
import { IsoTree } from "./IsoTree";

/**
 * Extraire une image ISO, en entier ou en partie.
 *
 * Les noms contenus dans l'image sont traités comme **hostiles** : aucun ne
 * peut sortir du dossier choisi, aucun lien symbolique n'est recréé, rien n'est
 * écrasé sans demande. Une extraction interrompue retire ce qu'elle a créé.
 */
export function IsoExtractTool({ tool }: ToolComponentProps) {
  const received = useHandoffPaths(tool.id);
  const [paths, setPaths] = useState<string[]>(received);
  const [info, setInfo] = useState<IsoInfo | null>(null);
  const [loadError, setLoadError] = useState<string | undefined>();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [destination, setDestination] = useState("");
  const [subfolder, setSubfolder] = useState(true);
  const [overwrite, setOverwrite] = useState(false);
  const action = useNativeAction<Awaited<ReturnType<typeof extractIso>>>();

  useEffect(() => {
    setInfo(null);
    setLoadError(undefined);
    setSelected(new Set());
    action.setResult(null);
    if (!paths[0]) return;
    let alive = true;
    inspectIso(paths[0]).then((i) => alive && setInfo(i)).catch((e) => alive && setLoadError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [paths]); // eslint-disable-line react-hooks/exhaustive-deps

  const parent = destination || (paths[0] ? directoryName(paths[0]) : "");
  const target = useMemo(
    () => (parent && subfolder && paths[0] ? joinPath(parent, stemOf(baseName(paths[0]))) : parent),
    [parent, subfolder, paths],
  );

  if (!isNativeAvailable()) return <NativeRequired />;

  const toggle = (path: string) =>
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const run = () =>
    action.execute((context) =>
      extractIso({ path: paths[0], destination: target, selection: [...selected], overwrite }, context),
    );
  const busy = action.job.isRunning;
  const result = action.result;

  return (
    <div className="space-y-4">
      <PathPicker
        mode="files"
        paths={paths}
        onChange={(next) => {
          setPaths(next.slice(-1));
          setDestination("");
        }}
        label={t("Choisissez une image ISO")}
        filters={[{ name: "ISO", extensions: ["iso", "img"] }]}
        disabled={busy}
      />
      {loadError && <Callout tone="error" title={t("Image illisible")}>{loadError}</Callout>}

      {info && (
        <>
          <StatGrid
            columns={3}
            stats={[
              { label: t("Fichiers"), value: info.files },
              { label: t("Dossiers"), value: info.directories },
              { label: t("Données"), value: formatDecimalSize(info.totalBytes) },
            ]}
          />
          {info.warnings.length > 0 && <Warnings title={t("Remarques sur cette image")} items={info.warnings.map((w) => tx(w))} />}

          <section className="space-y-2">
            <div className="flex items-center gap-2">
              <h3 className="ft-section flex-1">
                {selected.size === 0 ? t("Tout sera extrait") : t("{count} éléments sélectionnés", { count: selected.size })}
              </h3>
              {selected.size > 0 && (
                <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>{t("Tout extraire")}</Button>
              )}
            </div>
            <IsoTree entries={info.entries} selectable selected={selected} onToggle={toggle} />
            <p className="ft-meta">{t("Cochez des fichiers ou des dossiers pour n'en extraire que la sélection ; sans coche, toute l'image est extraite.")}</p>
          </section>

          <Fieldset columns={2}>
            <div className="flex flex-col gap-1">
              <span className="ft-label">{t("Dossier de destination")}</span>
              <span className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate rounded-md border border-[var(--ft-border)] bg-[var(--ft-bg)] px-2.5 py-2 text-xs">{target || "—"}</span>
                <Button
                  size="sm"
                  onClick={async () => {
                    const chosen = await pickDirectory(t("Dossier de destination"));
                    if (chosen) setDestination(chosen);
                  }}
                  disabled={busy}
                  aria-label={t("Choisir le dossier de destination")}
                >
                  {t("Choisir…")}
                </Button>
              </span>
            </div>
            <div className="grid gap-0.5">
              <CheckOption checked={subfolder} onChange={setSubfolder} label={t("Créer un sous-dossier au nom de l'image")} />
              <CheckOption
                checked={overwrite}
                onChange={setOverwrite}
                label={t("Écraser les fichiers existants")}
                hint={t("Sinon, ils sont écrits à côté sous un nom libre")}
              />
            </div>
          </Fieldset>

          <RunBar
            label={selected.size > 0 ? t("Extraire la sélection") : t("Extraire l'image")}
            icon="PackageOpen"
            onRun={run}
            running={busy}
            progress={action.job.progress}
            disabled={!target}
            cancel={action.job.cancel}
            status={action.job.status}
            error={action.error}
          />
        </>
      )}

      {result && (
        <div className="space-y-2">
          <Callout
            tone="success"
            title={t("{count} {count, plural, one {fichier extrait} other {fichiers extraits}} — {size}", { count: result.extracted, size: formatDecimalSize(result.bytes) })}
            actions={<Button size="sm" onClick={() => void openFolder(result.destination)}><Icon name="FolderTree" size={13} /> {t("Ouvrir le dossier")}</Button>}
          >
            <span className="break-all">{result.destination}</span>
          </Callout>
          {result.skipped.length > 0 && (
            <Warnings title={t("{count} {count, plural, one {entrée refusée} other {entrées refusées}} par sécurité", { count: result.skipped.length })} items={result.skipped} />
          )}
        </div>
      )}
    </div>
  );
}
