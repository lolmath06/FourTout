import { PdfToolShell } from "@/components/pdf/PdfToolShell";
import { singleResult } from "@/components/pdf/result";
import { mergePdfs } from "@/core/pdf/operations/pages";
import type { ToolComponentProps } from "@/tools/implementations";
import { t } from "@/i18n";

export function PdfMergeTool({ tool }: ToolComponentProps) {
  return (
    <PdfToolShell
      tool={tool}
      selection="multiple"
      reorderable
      actionLabel={t("Fusionner")}
      hint={t("Les documents seront assemblés dans l'ordre de la liste ci-dessous.")}
      run={async ({ documents, context }) => {
        const output = await mergePdfs(
          documents.map((document) => document.source),
          context,
        );
        const total = documents.reduce((sum, item) => sum + (item.info?.pageCount ?? 0), 0);
        return singleResult(
          output,
          t("{count} documents assemblés, {total} pages au total.", { count: documents.length, total }),
        );
      }}
    />
  );
}
