import { useEffect, useState } from "react";
import { PathPicker } from "@/components/files/PathPicker";
import { NativeRequired } from "@/components/files/NativeRun";
import { useNativeAction, isNativeAvailable } from "@/components/files/useNativeAction";
import { StatGrid, Warnings } from "@/components/files/Summary";
import { Callout, ProgressBar } from "@/components/ui/Callout";
import { CopyButton } from "@/components/internet/parts";
import { inspectIso, type IsoEntry, type IsoInfo } from "@/core/internet/native";
import { useHandoffPaths } from "@/features/handoff/usePathHandoff";
import type { ToolComponentProps } from "@/tools/implementations";
import { formatDateTime, formatDecimalSize, localized, t, tx } from "@/i18n";
import { IsoTree } from "./IsoTree";

const FEATURES = localized(() => ({
  iso9660: t("ISO 9660"),
  joliet: t("Joliet"),
  "rock-ridge": t("Rock Ridge"),
  "el-torito": t("El Torito (démarrage)"),
  udf: t("UDF"),
}));

const PLATFORMS = localized(() => ({
  bios: t("BIOS (PC classique)"),
  efi: t("UEFI"),
  powerpc: t("PowerPC"),
  mac: t("Mac"),
  unknown: t("Inconnue"),
}));

const MEDIA = localized(() => ({
  "no-emulation": t("sans émulation"),
  "floppy-1.2": t("disquette 1,2 Mo"),
  "floppy-1.44": t("disquette 1,44 Mo"),
  "floppy-2.88": t("disquette 2,88 Mo"),
  "hard-disk": t("disque dur"),
  unknown: t("inconnu"),
}));

function date(seconds: number): string {
  return seconds > 0 ? formatDateTime(new Date(seconds * 1000)) : "—";
}

/** Métadonnées au format texte, pour la copie. */
function metadataText(info: IsoInfo): string {
  const lines = [
    `${t("Volume")} : ${info.label}`,
    `${t("Système")} : ${info.systemId || "—"}`,
    `${t("Éditeur")} : ${info.publisher || "—"}`,
    `${t("Application")} : ${info.application || "—"}`,
    `${t("Création")} : ${date(info.created)}`,
    `${t("Modification")} : ${date(info.modified)}`,
    `${t("Taille du volume")} : ${info.volumeBytes} ${t("octets")}`,
    `${t("Fichiers")} : ${info.files} · ${t("Dossiers")} : ${info.directories} · ${t("Données")} : ${info.totalBytes} ${t("octets")}`,
    `${t("Systèmes de fichiers")} : ${info.features.join(", ")}`,
  ];
  if (info.boot) {
    lines.push(`${t("Démarrage")} : ${info.boot.platforms.join(", ")} · ${t("catalogue")} ${info.boot.catalogLba} · ${info.boot.validationOk ? t("valide") : t("invalide")}`);
    for (const entry of info.boot.entries) {
      lines.push(`  ${entry.bootable ? "★" : "·"} ${entry.path ?? `${t("secteur")} ${entry.loadLba}`} (${entry.media}, ${entry.sectors} ${t("secteurs")})`);
    }
  }
  return lines.join("\n");
}

/**
 * Inspecter une image ISO sans l'extraire : volume, systèmes de fichiers,
 * arborescence, données de démarrage. Rien n'est écrit, rien n'est modifié.
 */
export function IsoInspectTool({ tool }: ToolComponentProps) {
  const received = useHandoffPaths(tool.id);
  const [paths, setPaths] = useState<string[]>(received);
  const [picked, setPicked] = useState<IsoEntry | undefined>();
  const action = useNativeAction<IsoInfo>();
  const { execute, setResult } = action;

  useEffect(() => {
    setPicked(undefined);
    setResult(null);
    if (paths[0]) void execute((context) => inspectIso(paths[0], 20000, context));
  }, [paths]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!isNativeAvailable()) return <NativeRequired />;
  const info = action.result;

  return (
    <div className="space-y-4">
      <PathPicker
        mode="files"
        paths={paths}
        onChange={(next) => setPaths(next.slice(-1))}
        label={t("Choisissez une image ISO")}
        filters={[{ name: "ISO", extensions: ["iso", "img"] }]}
        hint={t("Lecture seule : l'image n'est ni extraite ni modifiée.")}
        disabled={action.job.isRunning}
      />

      {action.job.isRunning && <ProgressBar ratio={action.job.progress.ratio} label={t("Lecture de l'image…")} />}
      {action.error && <Callout tone="error" title={t("Image illisible")}>{action.error}</Callout>}

      {info && (
        <div className="space-y-4" data-testid="iso-info">
          <StatGrid
            columns={4}
            stats={[
              { label: t("Volume"), value: info.label || "—" },
              { label: t("Fichiers"), value: info.files },
              { label: t("Dossiers"), value: info.directories },
              { label: t("Données"), value: formatDecimalSize(info.totalBytes) },
            ]}
          />

          <section className="space-y-2 rounded-[var(--radius-card)] border border-[var(--ft-border)] p-3">
            <div className="flex items-center gap-2">
              <h3 className="ft-section flex-1">{t("Descripteurs")}</h3>
              <CopyButton text={metadataText(info)} label={t("Copier les métadonnées")} />
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-[12.5px]">
              <dt className="text-[var(--ft-text-muted)]">{t("Systèmes de fichiers")}</dt>
              <dd data-testid="iso-features">{info.features.map((f) => tx(FEATURES[f as keyof typeof FEATURES] ?? f)).join(" · ")}</dd>
              <dt className="text-[var(--ft-text-muted)]">{t("Noms lus depuis")}</dt>
              <dd>{tx(FEATURES[info.tree as keyof typeof FEATURES] ?? info.tree)}</dd>
              <dt className="text-[var(--ft-text-muted)]">{t("Taille du volume")}</dt>
              <dd className="tabular-nums">{formatDecimalSize(info.volumeBytes)} ({t("fichier : {size}", { size: formatDecimalSize(info.fileSize) })})</dd>
              <dt className="text-[var(--ft-text-muted)]">{t("Système")}</dt>
              <dd>{info.systemId || "—"}</dd>
              <dt className="text-[var(--ft-text-muted)]">{t("Éditeur")}</dt>
              <dd>{info.publisher || "—"}</dd>
              <dt className="text-[var(--ft-text-muted)]">{t("Préparée avec")}</dt>
              <dd>{info.application || info.preparer || "—"}</dd>
              <dt className="text-[var(--ft-text-muted)]">{t("Création")}</dt>
              <dd>{date(info.created)}</dd>
              <dt className="text-[var(--ft-text-muted)]">{t("Modification")}</dt>
              <dd>{date(info.modified)}</dd>
            </dl>
          </section>

          <section className="space-y-2 rounded-[var(--radius-card)] border border-[var(--ft-border)] p-3" data-testid="iso-boot">
            <h3 className="ft-section">{t("Démarrage")}</h3>
            {info.boot ? (
              <>
                <p className="text-[12.5px]">
                  {t("Image amorçable (El Torito) : {platforms}. Catalogue au secteur {lba}, {validity}.", {
                    platforms: info.boot.platforms.map((p) => tx(PLATFORMS[p as keyof typeof PLATFORMS] ?? p)).join(", "),
                    lba: info.boot.catalogLba,
                    validity: info.boot.validationOk ? t("somme de contrôle valide") : t("somme de contrôle invalide"),
                  })}
                </p>
                <ul className="space-y-0.5 text-[12.5px]">
                  {info.boot.entries.map((entry, index) => (
                    <li key={index} className="font-mono">
                      {entry.bootable ? "★ " : "· "}
                      {entry.path ?? t("secteur {lba}", { lba: entry.loadLba })}
                      <span className="text-[var(--ft-text-faint)]"> — {tx(MEDIA[entry.media as keyof typeof MEDIA] ?? entry.media)}, {t("{count} secteurs", { count: entry.sectors })}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="ft-meta">{t("Aucun catalogue de démarrage El Torito : c'est une image de données.")}</p>
            )}
            {(info.hybridMbr || info.gpt) && (
              <p className="ft-meta">
                {info.gpt ? t("Table de partitions GPT présente (image hybride).") : t("Secteur de démarrage MBR présent (image hybride, copiable sur une clé).")}
              </p>
            )}
          </section>

          {info.warnings.length > 0 && <Warnings title={t("Remarques sur cette image")} items={info.warnings.map((w) => tx(w))} />}

          <section className="space-y-2">
            <div className="flex items-center gap-2">
              <h3 className="ft-section flex-1">{t("Contenu")}</h3>
              {picked && <CopyButton text={picked.path} label={t("Copier le chemin")} />}
            </div>
            <IsoTree entries={info.entries} onPick={setPicked} picked={picked?.path} />
            {info.truncated && (
              <p className="ft-meta">{t("L'arborescence est tronquée à {count} entrées ; les totaux ci-dessus portent sur toute l'image.", { count: info.entries.length })}</p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
