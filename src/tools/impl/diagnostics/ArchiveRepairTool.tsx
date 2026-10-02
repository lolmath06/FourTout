import { useCallback, useState } from "react";
import clsx from "clsx";
import { Field, Fieldset, OptionGroup } from "@/components/pdf/Field";
import { DiagnosticShell, StructureTable, type ActionOutcome } from "@/components/diagnostics/DiagnosticShell";
import {
  fixExtension,
  outputPath,
  zipRecover,
  zipStripTrailing,
  type DiagnosticReport,
  type RepairAction,
  type ZipEntryState,
  type ZipScannedEntry,
} from "@/core/diagnostics/native";
import { formatSize } from "@/core/disks/native";
import { useHandoffPaths } from "@/features/handoff/usePathHandoff";
import type { ToolComponentProps } from "@/tools/implementations";
import { localized, t } from "@/i18n";

const STATE_LABELS: Record<ZipEntryState, string> = localized(() => ({
  recoverable: t("Récupérable"),
  checksumMismatch: t("Somme de contrôle fausse"),
  lost: t("Perdue"),
  encrypted: t("Chiffrée"),
  rejected: t("Chemin refusé"),
}));

const STATE_CLASS: Record<ZipEntryState, string> = {
  recoverable: "text-[var(--ft-success)]",
  checksumMismatch: "text-[var(--ft-danger)]",
  lost: "text-[var(--ft-danger)]",
  encrypted: "text-[var(--ft-warn)]",
  rejected: "text-[var(--ft-warn)]",
};

type Filter = "all" | "healthy" | "damaged";

/**
 * Archive ZIP endommagée.
 *
 * Le format se lit normalement par la fin : son répertoire central dit où
 * trouver chaque entrée. Quand ces quelques kilo-octets sont abîmés, tous les
 * lecteurs déclarent l'archive illisible — alors que la totalité des données
 * peut être intacte un peu plus haut dans le fichier. C'est précisément ce que
 * cet outil va chercher, en balayant les en-têtes locaux qui précèdent chaque
 * fichier.
 *
 * Ce qu'il ne fait pas : reconstituer un flux compressé physiquement tronqué.
 * Quand les octets manquent, l'entrée est déclarée perdue, avec son motif.
 */
export function ArchiveRepairTool({ tool }: ToolComponentProps) {
  const handed = useHandoffPaths(tool.id);
  const [filter, setFilter] = useState<Filter>("all");

  const run = useCallback(
    async (
      action: RepairAction,
      report: DiagnosticReport,
      context: { signal: AbortSignal; report: (u: { ratio?: number; label: string }) => void },
    ): Promise<ActionOutcome> => {
      if (action.id === "fix-extension") {
        const output = await fixExtension(report.path);
        return {
          title: t("Copie créée avec la bonne extension"),
          tone: "success",
          summary: t("Copie octet pour octet, sous un nom qui correspond au contenu."),
          kept: [t("Tous les octets, à l'identique")],
          lost: [],
          output,
        };
      }

      if (action.id === "zip-strip-trailing") {
        const destination = await outputPath(report.path, "nettoye", "zip");
        const removed = await zipStripTrailing(report.path, destination);
        return {
          title: t("Archive réparée"),
          tone: "success",
          summary:
            t("{removed} octets parasites retirés. Le mot « réparée » est employé au sens strict : aucune entrée n'a été relue ni réécrite, seule la fin du fichier a été tronquée après la structure de fin d'archive.", { removed }),
          kept: [t("Toutes les entrées, à l'octet près")],
          lost: [t("{removed} octets situés après la fin de l'archive", { removed })],
          output: destination,
        };
      }

      const archive = action.id === "zip-recover-archive";
      const destination = await outputPath(
        report.path,
        "recuperee",
        archive ? "zip" : "",
      );
      const result = await zipRecover(
        report.path,
        destination,
        archive ? "archive" : "folder",
        context,
      );

      const total = result.recovered + result.lost;
      const reasons = new Map<string, number>();
      for (const entry of result.entries) {
        if (entry.state === "recoverable" || entry.isDir) continue;
        const key = STATE_LABELS[entry.state];
        reasons.set(key, (reasons.get(key) ?? 0) + 1);
      }

      return {
        title: result.lost === 0 ? t("Toutes les entrées récupérées") : t("Récupération partielle"),
        tone: result.lost === 0 ? "success" : "warning",
        summary:
          result.lost === 0
            ? t("{recovered} entrées sur {total} ont été retrouvées, décompressées et vérifiées par leur somme de contrôle. L'archive d'origine n'a pas été touchée.", { recovered: result.recovered, total })
            : t("{recovered} entrées sur {total} ont pu être récupérées. {lost} ne l'ont pas été : leurs données ne sont pas présentes dans le fichier, et FourTout ne les invente pas.", { recovered: result.recovered, total, lost: result.lost }),
        kept: [
          t("{recovered} entrées, {size} de contenu vérifié", { recovered: result.recovered, size: formatSize(result.recoveredBytes) }),
        ],
        lost: [...reasons.entries()].map(([reason, count]) => t("{count} entrée(s) — {reason}", { count, reason })),
        output: result.output,
      };
    },
    [],
  );

  return (
    <DiagnosticShell
      label={t("Archive ZIP")}
      hint={t("Même une archive que les autres logiciels refusent d'ouvrir.")}
      filters={[{ name: t("Archives ZIP"), extensions: ["zip"] }]}
      initialPath={handed[0]}
      onAction={run}
      wrongFormat={(report) =>
        report.detected === "zip"
          ? undefined
          : t("Ce fichier est du {detectedLabel}, pas une archive ZIP. Cet outil ne saurait rien en dire d'utile — le diagnostic universel, lui, s'applique à n'importe quel fichier.", { detectedLabel: report.detectedLabel })
      }
      structure={(report) => {
        const zip = report.details.zip;
        if (!zip) return null;
        const entries = zip.entries;
        const visible = entries.filter((entry) => {
          if (filter === "healthy") return entry.state === "recoverable";
          if (filter === "damaged") return entry.state !== "recoverable";
          return true;
        });

        return (
          <>
            <StructureTable
              caption={t("Structure de l'archive")}
              rows={[
                {
                  label: t("Fin de répertoire central"),
                  value:
                    zip.eocdOffset === null
                      ? t("absente")
                      : t("octet {offset}", { offset: zip.eocdOffset }),
                },
                {
                  label: t("Entrées annoncées"),
                  value: zip.declaredEntries === null ? "—" : String(zip.declaredEntries),
                },
                { label: t("Entrées lues dans le répertoire central"), value: String(zip.centralEntries) },
                { label: t("En-têtes d'entrée retrouvés par balayage"), value: String(zip.localHeaders) },
                {
                  label: t("Octets parasites en fin de fichier"),
                  value: zip.trailingBytes > 0 ? formatSize(zip.trailingBytes) : t("aucun"),
                },
                { label: t("Archive protégée par mot de passe"), value: zip.encrypted ? t("oui") : t("non") },
                { label: t("Format ZIP64"), value: zip.zip64 ? t("oui") : t("non") },
              ]}
            />

            {entries.length > 0 && (
              <section className="space-y-2">
                <Fieldset columns={1}>
                  <Field label={t("Entrées affichées")}>
                    <OptionGroup
                      ariaLabel={t("Filtre des entrées")}
                      value={filter}
                      onChange={setFilter}
                      options={[
                        { value: "all", label: t("Toutes ({count})", { count: entries.length }) },
                        {
                          value: "healthy",
                          label: t("Saines ({count})", { count: entries.filter((e) => e.state === "recoverable").length }),
                        },
                        {
                          value: "damaged",
                          label: t("Endommagées ({count})", { count: entries.filter((e) => e.state !== "recoverable").length }),
                        },
                      ]}
                    />
                  </Field>
                </Fieldset>
                <EntryTable entries={visible} />
              </section>
            )}
          </>
        );
      }}
    />
  );
}

function EntryTable({ entries }: { entries: ZipScannedEntry[] }) {
  if (entries.length === 0) {
    return <p className="ft-meta">{t("Aucune entrée dans cette catégorie.")}</p>;
  }
  return (
    <section className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface)]">
      <div className="max-h-80 overflow-auto">
        <table className="ft-table">
          <thead>
            <tr>
              <th scope="col">{t("Entrée")}</th>
              <th scope="col">{t("État")}</th>
              <th scope="col" className="text-right">
                {t("Taille")}
              </th>
              <th scope="col">{t("Somme de contrôle")}</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={`${entry.offset}-${entry.name}`}>
                <th scope="row" className="ft-value max-w-[18rem] truncate font-normal">
                  {entry.name}
                </th>
                <td className={clsx("ft-value", STATE_CLASS[entry.state])} title={entry.reason ?? undefined}>
                  {entry.isDir ? t("Dossier") : STATE_LABELS[entry.state]}
                </td>
                <td className="ft-value text-right tabular-nums">
                  {entry.isDir ? "—" : formatSize(entry.uncompressedSize)}
                </td>
                <td className="ft-value font-mono text-[11px]">
                  {entry.isDir
                    ? "—"
                    : entry.actualCrc === null
                      ? t("annoncée {value}", { value: entry.declaredCrc.toString(16).padStart(8, "0").toUpperCase() })
                      : entry.actualCrc === entry.declaredCrc
                        ? "concorde"
                        : `${entry.declaredCrc.toString(16).padStart(8, "0").toUpperCase()} ≠ ${entry.actualCrc
                            .toString(16)
                            .padStart(8, "0")
                            .toUpperCase()}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
