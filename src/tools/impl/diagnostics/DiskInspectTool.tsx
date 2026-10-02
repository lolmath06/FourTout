import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { Icon } from "@/components/ui/Icon";
import { Field, Fieldset, OptionGroup } from "@/components/pdf/Field";
import { StructureTable } from "@/components/diagnostics/DiagnosticShell";
import {
  DISKS_NATIVE_REQUIRED,
  formatSize,
  health,
  healthProvider,
  healthSummary,
  inventory,
  isDisksAvailable,
  mediaKind,
  TRANSPORT_LABELS,
  usedRatio,
  type Disk,
  type SmartReport,
  type StorageInventory,
  type Volume,
} from "@/core/disks/native";
import type { ToolComponentProps } from "@/tools/implementations";
import { Trans, formatNumber, t, tx } from "@/i18n";

type Pane = "overview" | "partitions" | "volumes" | "health";

/**
 * Inspection des disques, partitions et volumes — **en lecture seule**.
 *
 * Il n'y a ici aucun bouton « Réparer le disque », « Optimiser » ou « Corriger
 * les secteurs ». Ces formulations ne désignent rien de précis, et un bouton
 * dont on ne peut pas énoncer l'effet exact n'a pas sa place dans un outil qui
 * touche à des périphériques bloc. Partitionner, formater, monter, cloner,
 * effacer : rien de cela n'existe dans FourTout, et rien dans le moteur natif
 * n'ouvre un disque en écriture.
 *
 * Les numéros de série et les identifiants de système de fichiers sont
 * affichés pendant la session et rien de plus : ils ne sont ni enregistrés, ni
 * ajoutés aux récents, ni journalisés.
 */
export function DiskInspectTool(_props: ToolComponentProps) {
  const [data, setData] = useState<StorageInventory | undefined>();
  const [selected, setSelected] = useState<string | undefined>();
  const [pane, setPane] = useState<Pane>("overview");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [provider, setProvider] = useState<string | undefined>();
  const [reports, setReports] = useState<Record<string, SmartReport>>({});
  const [checking, setChecking] = useState(false);

  const available = isDisksAvailable();

  const load = useCallback(() => {
    if (!available) return;
    setBusy(true);
    setError(undefined);
    inventory()
      .then((result) => {
        setData(result);
        setSelected((current) => current ?? result.disks[0]?.name);
      })
      .catch((failure: unknown) =>
        setError(failure instanceof Error ? failure.message : t("Inventaire impossible.")),
      )
      .finally(() => setBusy(false));
  }, [available]);

  useEffect(() => {
    load();
    if (available) {
      healthProvider()
        .then(setProvider)
        .catch(() => setProvider(""));
    }
  }, [load, available]);

  const disk = data?.disks.find((entry) => entry.name === selected);

  const askHealth = useCallback(async () => {
    if (!disk) return;
    setChecking(true);
    try {
      const report = await health(disk.path);
      setReports((current) => ({ ...current, [disk.name]: report }));
    } catch (failure) {
      setReports((current) => ({
        ...current,
        [disk.name]: {
          available: false,
          provider: t("aucun"),
          health: null,
          temperatureC: null,
          powerOnHours: null,
          powerCycles: null,
          reallocatedSectors: null,
          pendingSectors: null,
          uncorrectableSectors: null,
          percentageUsed: null,
          mediaErrors: null,
          bytesWritten: null,
          notes: [failure instanceof Error ? failure.message : t("Interrogation impossible.")],
        },
      }));
    } finally {
      setChecking(false);
    }
  }, [disk]);

  return (
    <div className="space-y-4">
      {!available && <Callout tone="warning">{DISKS_NATIVE_REQUIRED}</Callout>}

      <Callout tone="info" title={t("Lecture seule")}>
        {t("Cet écran lit, et rien d'autre. FourTout ne sait pas partitionner, formater, monter, cloner ni effacer un disque : ces opérations n'existent nulle part dans le programme. Les numéros de série et identifiants affichés ne sont enregistrés nulle part.")}
      </Callout>

      {error && <Callout tone="error">{tx(error)}</Callout>}

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={load} disabled={!available || busy}>
          <Icon name="RefreshCw" size={13} /> {busy ? t("Lecture…") : t("Actualiser")}
        </Button>
        {data && <span className="ft-meta">{t("Source : {provider}", { provider: data.provider })}</span>}
      </div>

      {data && data.disks.length === 0 && (
        <Callout tone="neutral">{t("Aucun disque physique n'a été rapporté par le système.")}</Callout>
      )}

      {data && data.disks.length > 0 && (
        <div className="flex flex-col gap-4 lg:flex-row">
          <nav className="lg:w-60 lg:shrink-0">
            <h3 className="ft-section mb-1.5">{t("Disques physiques")}</h3>
            <ul className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface)]">
              {data.disks.map((entry) => (
                <li key={entry.name}>
                  <button
                    type="button"
                    onClick={() => setSelected(entry.name)}
                    className={clsx(
                      "w-full border-b border-[var(--ft-rule)] px-3 py-1.5 text-left last:border-b-0",
                      entry.name === selected
                        ? "bg-[var(--ft-accent-quiet)]"
                        : "hover:bg-[var(--ft-surface-2)]",
                    )}
                  >
                    <span className="ft-value flex items-baseline gap-1.5">
                      <Icon name={entry.removable ? "Usb" : "HardDrive"} size={13} />
                      <span className="min-w-0 flex-1 truncate font-medium">{entry.name}</span>
                      {entry.system && (
                        <span className="ft-meta shrink-0">{t("système")}</span>
                      )}
                    </span>
                    <span className="ft-meta">
                      {formatSize(entry.size)} · {tx(TRANSPORT_LABELS[entry.transport])}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          <div className="min-w-0 flex-1 space-y-3">
            <Fieldset columns={1}>
              <Field label={t("Affichage")}>
                <OptionGroup
                  ariaLabel={t("Panneau")}
                  value={pane}
                  onChange={setPane}
                  options={[
                    { value: "overview", label: t("Vue d'ensemble") },
                    { value: "partitions", label: t("Partitions") },
                    { value: "volumes", label: t("Volumes") },
                    { value: "health", label: t("Santé") },
                  ]}
                />
              </Field>
            </Fieldset>

            {disk && pane === "overview" && (
              <StructureTable
                caption={disk.model ?? disk.name}
                rows={[
                  { label: t("Nom système"), value: disk.name },
                  { label: t("Chemin"), value: disk.path },
                  { label: t("Modèle"), value: disk.model ?? t("non rapporté") },
                  { label: t("Fabricant"), value: disk.vendor ?? t("non rapporté") },
                  { label: t("Capacité"), value: formatSize(disk.size) },
                  { label: t("Raccordement"), value: TRANSPORT_LABELS[disk.transport] },
                  { label: t("Support"), value: mediaKind(disk) },
                  { label: t("Amovible"), value: disk.removable ? t("oui") : t("non") },
                  { label: t("Lecture seule"), value: disk.readOnly ? t("oui") : t("non") },
                  { label: t("Table de partitions"), value: disk.partitionTable?.toUpperCase() ?? t("aucune") },
                  { label: t("Partitions"), value: String(disk.partitions.length) },
                  { label: t("Porte le système"), value: disk.system ? t("oui") : t("non") },
                  { label: t("Numéro de série"), value: disk.serial ?? t("non exposé sans privilèges") },
                ]}
              />
            )}

            {disk && pane === "partitions" && (
              <section className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface)]">
                <div className="overflow-x-auto">
                  <table className="ft-table">
                    <thead>
                      <tr>
                        <th scope="col">{t("Partition")}</th>
                        <th scope="col" className="text-right">
                          {t("Taille")}
                        </th>
                        <th scope="col" className="text-right">
                          {t("Début")}
                        </th>
                        <th scope="col">{t("Type")}</th>
                        <th scope="col">{t("Amorçage")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {disk.partitions.map((partition) => (
                        <tr key={partition.name}>
                          <th scope="row" className="ft-value font-normal">
                            {partition.name}
                          </th>
                          <td className="ft-value text-right tabular-nums">
                            {formatSize(partition.size)}
                          </td>
                          <td className="ft-value text-right tabular-nums">
                            {partition.offset === null ? "—" : formatSize(partition.offset)}
                          </td>
                          <td className="ft-value max-w-[16rem] truncate" title={partition.kind ?? undefined}>
                            {partition.kind ?? "—"}
                          </td>
                          <td className="ft-value">{partition.boot ? t("oui") : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {disk.partitions.length === 0 && (
                  <p className="ft-meta px-3 py-2">
                    {t("Aucune partition : ce disque n'est pas partitionné, ou sa table n'est pas lisible.")}
                  </p>
                )}
              </section>
            )}

            {disk && pane === "volumes" && (
              <div className="space-y-3">
                {disk.partitions
                  .filter((partition) => partition.volume)
                  .map((partition) => (
                    <VolumeCard
                      key={partition.name}
                      name={partition.name}
                      volume={partition.volume!}
                    />
                  ))}
                {disk.partitions.every((partition) => !partition.volume) && (
                  <Callout tone="neutral">
                    {t("Aucun système de fichiers reconnu sur ce disque, ou aucun volume monté.")}
                  </Callout>
                )}
              </div>
            )}

            {disk && pane === "health" && (
              <HealthPane
                disk={disk}
                provider={provider}
                report={reports[disk.name]}
                checking={checking}
                onAsk={askHealth}
              />
            )}
          </div>
        </div>
      )}

      {data && data.otherVolumes.length > 0 && (
        <section className="space-y-2">
          <h3 className="ft-section">{t("Volumes sans disque physique identifié")}</h3>
          {data.otherVolumes.map((volume) => (
            <VolumeCard key={volume.mountPoint ?? volume.uuid ?? "?"} name={volume.mountPoint ?? "—"} volume={volume} />
          ))}
        </section>
      )}

      {data && data.notes.length > 0 && (
        <Callout tone="neutral" title={t("Ce que le système n'a pas donné")}>
          <ul className="list-disc pl-4">
            {data.notes.map((note) => (
              <li key={note}>{tx(note)}</li>
            ))}
          </ul>
        </Callout>
      )}
    </div>
  );
}

function VolumeCard({ name, volume }: { name: string; volume: Volume }) {
  const ratio = usedRatio(volume);
  return (
    <section className="rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface)] p-3">
      <p className="ft-value">
        <strong>{volume.label ?? name}</strong>
        {volume.filesystem && ` · ${volume.filesystem}`}
        {volume.readOnly && t(" · monté en lecture seule")}
      </p>
      <p className="ft-meta">
        {volume.mountPoint ? t("Monté sur {mountPoint}", { mountPoint: volume.mountPoint }) : t("Non monté")}
        {volume.uuid && ` · identifiant ${volume.uuid}`}
      </p>
      {ratio !== undefined ? (
        <>
          <div className="mt-2 h-[4px] overflow-hidden rounded-full bg-[var(--ft-surface-2)]">
            <div
              className="h-full bg-[var(--ft-accent)]"
              style={{ width: `${Math.round(ratio * 100)}%` }}
            />
          </div>
          <p className="ft-meta mt-1">
            {t("{size} occupés sur {size2} · {size3} disponibles", { size: formatSize(volume.usedBytes), size2: formatSize(volume.totalBytes), size3: formatSize(volume.availableBytes) })}
          </p>
        </>
      ) : (
        <p className="ft-meta mt-1">
          {t("Espace occupé non rapporté : ce volume n'est pas monté, ou le système ne le dit pas.")}
        </p>
      )}
    </section>
  );
}

/**
 * Volet santé.
 *
 * Il ne réduit jamais un disque à un point vert ou rouge. « Sain » ne veut rien
 * dire si l'on ignore d'où vient le mot, et un disque sans compteur détaillé
 * n'est pas un disque en bonne santé : c'est un disque muet.
 */
function HealthPane({
  disk,
  provider,
  report,
  checking,
  onAsk,
}: {
  disk: Disk;
  provider: string | undefined;
  report: SmartReport | undefined;
  checking: boolean;
  onAsk: () => void;
}) {
  return (
    <div className="space-y-3">
      {provider === "" && (
        <Callout tone="neutral" title={t("Aucun fournisseur de santé sur cette machine")}>
          <Trans source={"Les indicateurs détaillés (température, heures de fonctionnement, secteurs réalloués) passent par <0>smartctl</0>, qui n'est pas installé ici. FourTout ne l'embarque pas et ne l'installe pas : c'est un logiciel distribué séparément, sous une licence incompatible avec celle de FourTout. Si vous installez <1>smartmontools</1> vous-même, cet écran s'enrichira sans rien faire de plus."} components={[<code />, <code />]} />
        </Callout>
      )}

      <div>
        <Button size="sm" variant="primary" onClick={onAsk} disabled={checking}>
          <Icon name="Activity" size={13} />{" "}
          {checking ? t("Interrogation…") : t("Interroger la santé de ce disque")}
        </Button>
        <p className="ft-meta mt-1">
          {t("Lecture des compteurs déjà tenus par le disque. Aucun autotest n'est lancé : ce sont des opérations longues qui occupent le disque, et elles n'ont pas leur place ici.")}
        </p>
      </div>

      {report && (
        <>
          <Callout tone={report.available ? "info" : "neutral"} title={healthSummary(report)}>
            {t("Source : {provider}. {value}.", { provider: report.provider, value: mediaKind(disk) })}
          </Callout>

          {report.available && (
            <StructureTable
              caption={t("Compteurs rapportés")}
              rows={[
                { label: t("Santé rapportée par le système"), value: report.health ?? t("non rapportée") },
                {
                  label: t("Température"),
                  value: report.temperatureC === null ? t("non rapportée") : `${report.temperatureC} °C`,
                },
                {
                  label: t("Heures de fonctionnement"),
                  value:
                    report.powerOnHours === null
                      ? t("non rapportées")
                      : `${formatNumber(report.powerOnHours)} h`,
                },
                {
                  label: t("Cycles d'allumage"),
                  value:
                    report.powerCycles === null
                      ? t("non rapportés")
                      : formatNumber(report.powerCycles),
                },
                {
                  label: t("Secteurs réalloués"),
                  value:
                    report.reallocatedSectors === null
                      ? t("non rapportés")
                      : String(report.reallocatedSectors),
                },
                {
                  label: t("Secteurs en attente"),
                  value: report.pendingSectors === null ? t("non rapportés") : String(report.pendingSectors),
                },
                {
                  label: t("Secteurs non corrigibles"),
                  value:
                    report.uncorrectableSectors === null
                      ? t("non rapportés")
                      : String(report.uncorrectableSectors),
                },
                {
                  label: t("Usure (NVMe)"),
                  value: report.percentageUsed === null ? t("non rapportée") : `${report.percentageUsed} %`,
                },
                {
                  label: t("Erreurs d'intégrité (NVMe)"),
                  value: report.mediaErrors === null ? t("non rapportées") : String(report.mediaErrors),
                },
                {
                  label: t("Données écrites"),
                  value: report.bytesWritten === null ? t("non rapportées") : formatSize(report.bytesWritten),
                },
              ]}
            />
          )}

          {report.notes.length > 0 && (
            <Callout tone="neutral" title={t("Ce que ce disque n'expose pas")}>
              <ul className="list-disc pl-4">
                {report.notes.map((note) => (
                  <li key={note}>{tx(note)}</li>
                ))}
              </ul>
            </Callout>
          )}
        </>
      )}
    </div>
  );
}
