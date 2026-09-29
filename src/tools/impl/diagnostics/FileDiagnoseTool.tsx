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
        throw new Error("Cette action appartient à un outil spécialisé.");
      }
      const output = await fixExtension(report.path);
      return {
        title: "Copie créée avec la bonne extension",
        tone: "success",
        summary:
          "Le contenu n'a pas été touché : c'est une copie octet pour octet, sous un nom qui " +
          "dit enfin ce qu'elle contient. L'original reste à sa place, avec son nom d'origine.",
        kept: ["Tous les octets du fichier, à l'identique"],
        lost: [],
        output,
      };
    },
    [],
  );

  return (
    <DiagnosticShell
      label="Fichier à diagnostiquer"
      hint="N'importe quel fichier. Le type est déterminé par sa signature, pas par son nom."
      initialPath={handed[0]}
      onAction={run}
      structure={(report) => (
        <>
          <StructureTable
            caption="Identité"
            rows={[
              { label: "Taille", value: formatSize(report.size) },
              { label: "Extension du nom", value: report.extension ? `.${report.extension}` : "aucune" },
              { label: "Type détecté par signature", value: report.detectedLabel },
              {
                label: "Le nom correspond-il au contenu ?",
                value: report.extensionMatches ? "oui" : "non",
              },
              {
                label: "Premiers octets",
                value: report.details.generic?.headHex ?? "—",
              },
              {
                label: "Derniers octets",
                value: report.details.generic?.tailHex ?? "—",
              },
              {
                label: "Marque de fin attendue",
                value: report.details.generic?.endMarker
                  ? `${report.details.generic.endMarker} — ${
                      report.details.generic.endMarkerFound ? "présente" : "absente"
                    }`
                  : "ce format n'en porte pas",
              },
              {
                label: "Octets après la fin du fichier",
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
      <Callout tone="neutral" title="Pas d'analyse plus poussée pour ce format">
        FourTout examine la structure interne des archives ZIP, des PDF, des PNG et des JPEG. Pour
        « {report.detectedLabel} », le diagnostic s'arrête à ce qui est affiché ci-dessus — et il
        vaut mieux le dire que de simuler une expertise.
      </Callout>
    );
  }

  return (
    <Callout tone="info" title="Un outil connaît ce format en profondeur">
      <p>
        Le diagnostic détaillé de {report.detectedLabel} — structure interne, entrées, possibilités
        de récupération — vit dans un outil dédié.
      </p>
      <div className="mt-2">
        <Button size="sm" onClick={() => onOpen(target.tool, { paths: [report.path] })}>
          <Icon name="ArrowRight" size={13} /> {target.label}
        </Button>
      </div>
    </Callout>
  );
}
