import { useCallback } from "react";
import { Callout } from "@/components/ui/Callout";
import { DiagnosticShell, StructureTable, type ActionOutcome } from "@/components/diagnostics/DiagnosticShell";
import {
  discardOutput,
  fixExtension,
  outputPath,
  pdfRepair,
  verifyPdf,
  type DiagnosticReport,
  type PdfRepairAction,
  type RepairAction,
} from "@/core/diagnostics/native";
import { formatSize } from "@/core/disks/native";
import { useHandoffPaths } from "@/features/handoff/usePathHandoff";
import type { ToolComponentProps } from "@/tools/implementations";

const ACTIONS: Record<string, { action: PdfRepairAction; suffix: string }> = {
  "pdf-strip-trailing": { action: "stripTrailing", suffix: "nettoye" },
  "pdf-fix-startxref": { action: "fixStartxref", suffix: "repare" },
  "pdf-rebuild-xref": { action: "rebuildXref", suffix: "reconstruit" },
};

/**
 * PDF endommagé.
 *
 * Trois réparations, et trois seulement, parce que ce sont les trois que l'on
 * peut justifier octet par octet : retirer ce qui suit la fin du document,
 * corriger un pointeur de table qui désigne le vide, et reconstruire une table
 * de références à partir des objets réellement présents.
 *
 * Chaque sortie est **rouverte par pdf.js**, le moteur qui sert à afficher les
 * PDF dans FourTout, et ses pages sont comptées. Sans cette vérification,
 * « réparé » ne voudrait dire que « un fichier a été écrit » — c'est le théâtre
 * de la réparation, et c'est exactement ce que cet outil refuse de jouer.
 */
export function PdfRepairTool({ tool }: ToolComponentProps) {
  const handed = useHandoffPaths(tool.id);

  const run = useCallback(
    async (action: RepairAction, report: DiagnosticReport): Promise<ActionOutcome> => {
      if (action.id === "fix-extension") {
        const output = await fixExtension(report.path);
        return {
          title: "Copie créée avec la bonne extension",
          tone: "success",
          summary: "Copie octet pour octet, sous un nom qui correspond au contenu.",
          kept: ["Tous les octets, à l'identique"],
          lost: [],
          output,
        };
      }

      const recipe = ACTIONS[action.id];
      if (!recipe) throw new Error("Action inconnue pour un PDF.");

      const destination = await outputPath(report.path, recipe.suffix, "pdf");
      const result = await pdfRepair(report.path, recipe.action, destination);

      // La preuve : le moteur qui affichera ce document accepte-t-il de l'ouvrir ?
      const verification = await verifyPdf(destination);
      const before = report.details.pdf?.pageObjects ?? 0;

      if (!verification.readable) {
        // Rien n'est présenté comme réparé : le candidat est retiré.
        await discardOutput(destination).catch(() => undefined);
        return {
          title: "Réparation manquée",
          tone: "error",
          summary:
            "Le fichier produit a bien été écrit, puis rouvert par le moteur PDF de FourTout — " +
            `qui le refuse (${verification.error ?? "raison inconnue"}). La transformation ` +
            "appliquée ne suffit pas à rendre ce document lisible, et il serait malhonnête de " +
            "vous laisser un fichier en le présentant comme réparé. Il a donc été supprimé.",
          kept: [],
          lost: ["Aucun fichier produit : la structure de ce document reste irrécupérable"],
        };
      }

      const pagesMatch = before === 0 || verification.pages === before;

      return {
        title: pagesMatch ? "Document réparé" : "Document réparé, pages en moins",
        tone: pagesMatch ? "success" : "warning",
        summary:
          `Le fichier produit a été rouvert par le moteur PDF : il s'ouvre, et compte ` +
          `${verification.pages} page${verification.pages > 1 ? "s" : ""}.` +
          (pagesMatch
            ? " C'est le nombre d'objets page trouvés dans la source : rien n'a été perdu en route."
            : ` La source portait ${before} objet(s) page : la différence est une perte réelle, ` +
              `pas un effet d'affichage.`),
        kept: [
          ...result.preserved,
          `${verification.pages} page(s) lisibles par le moteur PDF`,
        ],
        lost: [
          ...(result.removedBytes > 0
            ? [`${formatSize(result.removedBytes)} d'octets retirés (hors document)`]
            : []),
          ...(report.details.pdf?.signed
            ? ["La signature numérique du document, invalidée par tout déplacement d'octets"]
            : []),
          ...(pagesMatch ? [] : [`${before - verification.pages} page(s)`]),
        ],
        output: destination,
        extra: report.details.pdf?.signed ? (
          <Callout tone="warning" title="Document signé numériquement">
            FourTout ne vérifie pas les signatures et ne prétend pas les préserver. Si ce document
            tire sa valeur de sa signature, conservez l'original : la copie réparée ne la porte
            plus valablement.
          </Callout>
        ) : undefined,
      };
    },
    [],
  );

  return (
    <DiagnosticShell
      label="Document PDF"
      hint="Même un PDF que votre lecteur habituel refuse d'ouvrir."
      filters={[{ name: "Documents PDF", extensions: ["pdf"] }]}
      initialPath={handed[0]}
      onAction={run}
      wrongFormat={(report) =>
        report.detected === "pdf"
          ? undefined
          : `Ce fichier est du ${report.detectedLabel}, pas un PDF. Cet outil ne saurait rien en ` +
            `dire d'utile — le diagnostic universel, lui, s'applique à n'importe quel fichier.`
      }
      structure={(report) => {
        const pdf = report.details.pdf;
        if (!pdf) return null;
        return (
          <StructureTable
            caption="Structure du document"
            rows={[
              { label: "Version annoncée", value: pdf.version ? `PDF ${pdf.version}` : "illisible" },
              { label: "Objets indirects trouvés", value: String(pdf.objects) },
              { label: "Objets de type page", value: String(pdf.pageObjects) },
              {
                label: "Catalogue du document",
                value: pdf.rootObject === null ? "introuvable" : `objet ${pdf.rootObject}`,
              },
              {
                label: "Pointeur startxref",
                value:
                  pdf.startxrefValue === null
                    ? "absent"
                    : `octet ${pdf.startxrefValue} — ${pdf.startxrefValid ? "valide" : "ne désigne rien"}`,
              },
              {
                label: "Table xref classique",
                value: pdf.xrefOffset === null ? "absente" : `octet ${pdf.xrefOffset}`,
              },
              { label: "Trailer classique", value: pdf.trailer ? "présent" : "absent" },
              {
                label: "Marque de fin %%EOF",
                value: pdf.eofOffset === null ? "absente" : `octet ${pdf.eofOffset}`,
              },
              {
                label: "Octets après la fin",
                value: pdf.trailingBytes > 0 ? formatSize(pdf.trailingBytes) : "aucun",
              },
              { label: "Flux d'objets (/ObjStm)", value: pdf.objectStreams ? "oui" : "non" },
              { label: "Table de références en flux", value: pdf.xrefStreams ? "oui" : "non" },
              { label: "Signature numérique détectée", value: pdf.signed ? "oui" : "non" },
            ]}
          />
        );
      }}
    />
  );
}
