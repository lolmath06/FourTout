import { useCallback } from "react";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { Icon } from "@/components/ui/Icon";
import { DiagnosticShell, StructureTable, type ActionOutcome } from "@/components/diagnostics/DiagnosticShell";
import { fixExtension, type DiagnosticReport, type RepairAction } from "@/core/diagnostics/native";
import { formatSize } from "@/core/disks/native";
import { useHandoffPaths } from "@/features/handoff/usePathHandoff";
import { useOpenTool } from "@/features/handoff/useOpenTool";
import { DIAGNOSTIC_SPECIALISTS } from "@/features/handoff/targets";
import type { ToolComponentProps } from "@/tools/implementations";
import { t, tx } from "@/i18n";

/**
 * Diagnostic universel.
 *
 * Le point d'entrée quand on ne sait pas encore ce qui cloche : il dit ce que
 * le fichier **est** (par sa signature, jamais par son nom), s'il est entier,
 * et il passe la main à l'outil spécialisé quand il en existe un.
 *
 * Il ne prétend pas analyser tous les formats du monde. FourTout en connaît
 * quatre en profondeur — ZIP, PDF, PNG, JPEG — et le dit franchement pour les
 * autres plutôt que d'afficher un vernis d'analyse.
 */
export function FileDiagnoseTool({ tool }: ToolComponentProps) {
  const handed = useHandoffPaths(tool.id);
  const openTool = useOpenTool();

  const run = useCallback(
    async (action: RepairAction, report: DiagnosticReport): Promise<ActionOutcome> => {
      if (action.id !== "fix-extension") {
        throw new Error(t("Cette action appartient à un outil spécialisé."));
      }
      const output = await fixExtension(report.path);
      return {
        title: t("Copie créée avec la bonne extension"),
        tone: "success",
        summary:
          t("Le contenu n'a pas été touché : c'est une copie octet pour octet, sous un nom qui dit enfin ce qu'elle contient. L'original reste à sa place, avec son nom d'origine."),
        kept: [t("Tous les octets du fichier, à l'identique")],
        lost: [],
        output,
      };
    },
    [],
  );

  return (
    <DiagnosticShell
      label={t("Fichier à diagnostiquer")}
      hint={t("N'importe quel fichier. Le type est déterminé par sa signature, pas par son nom.")}
      initialPath={handed[0]}
      onAction={run}
      structure={(report) => (
        <>
          <StructureTable
            caption={t("Identité")}
            rows={[
              { label: t("Taille"), value: formatSize(report.size) },
              { label: t("Extension du nom"), value: report.extension ? `.${report.extension}` : t("aucune") },
              { label: t("Type détecté par signature"), value: tx(report.detectedLabel) },
              {
                label: t("Le nom correspond-il au contenu ?"),
                value: report.extensionMatches ? t("oui") : t("non"),
              },
              {
                label: t("Premiers octets"),
                value: report.details.generic?.headHex ?? "—",
              },
              {
                label: t("Derniers octets"),
                value: report.details.generic?.tailHex ?? "—",
              },
              {
                label: t("Marque de fin attendue"),
                value: report.details.generic?.endMarker
                  ? `${report.details.generic.endMarker} — ${
                      report.details.generic.endMarkerFound ? t("présente") : t("absente")
                    }`
                  : t("ce format n'en porte pas"),
              },
              {
                label: t("Octets après la fin du fichier"),
                value: report.details.generic?.trailingBytes
                  ? formatSize(report.details.generic.trailingBytes)
                  : "aucun",
              },
            ]}
          />

          <Specialist report={report} onOpen={openTool} />
        </>
      )}
    />
  );
}

/** Passe la main à l'outil qui connaît ce format en profondeur. */
function Specialist({
  report,
  onOpen,
}: {
  report: DiagnosticReport;
  onOpen: (toolId: string, payload?: { paths?: string[] }) => void;
}) {
  const target = DIAGNOSTIC_SPECIALISTS[report.detected];
  if (!target) {
    return (
      <Callout tone="neutral" title={t("Pas d'analyse plus poussée pour ce format")}>
        {t("FourTout examine la structure interne des archives ZIP, des PDF, des PNG et des JPEG. Pour « {detectedLabel} », le diagnostic s'arrête à ce qui est affiché ci-dessus — et il vaut mieux le dire que de simuler une expertise.", { detectedLabel: report.detectedLabel })}
      </Callout>
    );
  }

  return (
    <Callout tone="info" title={t("Un outil connaît ce format en profondeur")}>
      <p>
        {t("Le diagnostic détaillé de {detectedLabel} — structure interne, entrées, possibilités de récupération — vit dans un outil dédié.", { detectedLabel: report.detectedLabel })}
      </p>
      <div className="mt-2">
        <Button size="sm" onClick={() => onOpen(target.tool, { paths: [report.path] })}>
          <Icon name="ArrowRight" size={13} /> {tx(target.label)}
        </Button>
      </div>
    </Callout>
  );
}
