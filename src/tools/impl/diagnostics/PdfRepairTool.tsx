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
import { t } from "@/i18n";

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
          title: t("Copie créée avec la bonne extension"),
          tone: "success",
          summary: t("Copie octet pour octet, sous un nom qui correspond au contenu."),
          kept: [t("Tous les octets, à l'identique")],
          lost: [],
          output,
        };
      }

      const recipe = ACTIONS[action.id];
      if (!recipe) throw new Error(t("Action inconnue pour un PDF."));

      const destination = await outputPath(report.path, recipe.suffix, "pdf");
      const result = await pdfRepair(report.path, recipe.action, destination);

      // La preuve : le moteur qui affichera ce document accepte-t-il de l'ouvrir ?
      const verification = await verifyPdf(destination);
      // Le nombre de pages de référence est celui des pages **complètes**
      // trouvées dans la source, jamais le `/Count` qu'elle annonce.
      const before = report.details.pdf?.structure.pageObjects ?? 0;

      if (!verification.readable) {
        // Rien n'est présenté comme réparé : le candidat est retiré.
        await discardOutput(destination).catch(() => undefined);
        return {
          title: t("Réparation manquée"),
          tone: "error",
          summary:
            t("Le fichier produit a bien été écrit, puis rouvert par le moteur PDF de FourTout — qui le refuse ({value}). La transformation appliquée ne suffit pas à rendre ce document lisible, et il serait malhonnête de vous laisser un fichier en le présentant comme réparé. Il a donc été supprimé.", { value: verification.error ?? "raison inconnue" }),
          kept: [],
          lost: [t("Aucun fichier produit : la structure de ce document reste irrécupérable")],
        };
      }

      const pagesMatch = before === 0 || verification.pages === before;

      return {
        title: pagesMatch ? t("Document réparé") : t("Document réparé, pages en moins"),
        tone: pagesMatch ? "success" : "warning",
        summary:
          t("Le fichier produit a été rouvert par le moteur PDF : il s'ouvre, et compte ") +
          `${verification.pages} page${verification.pages > 1 ? "s" : ""}.` +
          (pagesMatch
            ? t(" C'est le nombre d'objets page trouvés dans la source : rien n'a été perdu en route.")
            : t(" La source portait {before} objet(s) page : la différence est une perte réelle, pas un effet d'affichage.", { before })),
        kept: [
          ...result.preserved,
          t("{pages} page(s) lisibles par le moteur PDF", { pages: verification.pages }),
        ],
        lost: [
          ...(result.removedBytes > 0
            ? [t("{size} d'octets retirés (hors document)", { size: formatSize(result.removedBytes) })]
            : []),
          ...(report.details.pdf?.signed
            ? [t("La signature numérique du document, invalidée par tout déplacement d'octets")]
            : []),
          ...(pagesMatch ? [] : [`${before - verification.pages} page(s)`]),
        ],
        output: destination,
        extra: report.details.pdf?.signed ? (
          <Callout tone="warning" title={t("Document signé numériquement")}>
            {t("FourTout ne vérifie pas les signatures et ne prétend pas les préserver. Si ce document tire sa valeur de sa signature, conservez l'original : la copie réparée ne la porte plus valablement.")}
          </Callout>
        ) : undefined,
      };
    },
    [],
  );

  return (
    <DiagnosticShell
      label={t("Document PDF")}
      hint={t("Même un PDF que votre lecteur habituel refuse d'ouvrir.")}
      filters={[{ name: t("Documents PDF"), extensions: ["pdf"] }]}
      initialPath={handed[0]}
      onAction={run}
      wrongFormat={(report) =>
        report.detected === "pdf"
          ? undefined
          : t("Ce fichier est du {detectedLabel}, pas un PDF. Cet outil ne saurait rien en dire d'utile — le diagnostic universel, lui, s'applique à n'importe quel fichier.", { detectedLabel: report.detectedLabel })
      }
      structure={(report) => {
        const pdf = report.details.pdf;
        if (!pdf) return null;
        return (
          <StructureTable
            caption={t("Structure du document")}
            rows={[
              { label: t("Version annoncée"), value: pdf.version ? `PDF ${pdf.version}` : "illisible" },
              { label: t("Objets indirects trouvés"), value: String(pdf.objects) },
              {
                label: t("Objets complets (avec leur « endobj »)"),
                value: String(pdf.structure.completeObjects),
              },
              {
                label: t("Objets tronqués"),
                value:
                  pdf.structure.incompleteObjects.length === 0
                    ? "aucun"
                    : pdf.structure.incompleteObjects.join(", "),
              },
              {
                label: t("Pages complètes trouvées"),
                value: String(pdf.pageObjects),
              },
              {
                label: t("Pages annoncées par /Count"),
                value:
                  pdf.structure.declaredCount === null
                    ? t("non annoncé")
                    : String(pdf.structure.declaredCount),
              },
              {
                label: t("Références sans destination"),
                value:
                  pdf.structure.danglingReferences.length === 0
                    ? "aucune"
                    : pdf.structure.danglingReferences.join(" ; "),
              },
              {
                label: t("Catalogue du document"),
                value: pdf.rootObject === null ? "introuvable" : `objet ${pdf.rootObject}`,
              },
              {
                label: t("Pointeur startxref"),
                value:
                  pdf.startxrefValue === null
                    ? "absent"
                    : `octet ${pdf.startxrefValue} — ${pdf.startxrefValid ? "valide" : t("ne désigne rien")}`,
              },
              {
                label: t("Table xref classique"),
                value: pdf.xrefOffset === null ? "absente" : `octet ${pdf.xrefOffset}`,
              },
              { label: t("Trailer classique"), value: pdf.trailer ? t("présent") : "absent" },
              {
                label: t("Marque de fin %%EOF"),
                value: pdf.eofOffset === null ? "absente" : `octet ${pdf.eofOffset}`,
              },
              {
                label: t("Octets après la fin"),
                value: pdf.trailingBytes > 0 ? formatSize(pdf.trailingBytes) : "aucun",
              },
              { label: t("Flux d'objets (/ObjStm)"), value: pdf.objectStreams ? "oui" : "non" },
              { label: t("Table de références en flux"), value: pdf.xrefStreams ? "oui" : "non" },
              { label: t("Signature numérique détectée"), value: pdf.signed ? "oui" : "non" },
            ]}
          />
        );
      }}
    />
  );
}
