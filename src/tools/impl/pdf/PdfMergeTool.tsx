import { PdfToolShell } from "@/components/pdf/PdfToolShell";
import { singleResult } from "@/components/pdf/result";
import { mergePdfs } from "@/core/pdf/operations/pages";
import type { ToolComponentProps } from "@/tools/implementations";

export function PdfMergeTool({ tool }: ToolComponentProps) {
  return (
    <PdfToolShell
      tool={tool}
      selection="multiple"
      reorderable
      actionLabel="Fusionner"
      hint="Les documents seront assemblés dans l'ordre de la liste ci-dessous."
      run={async ({ documents, context }) => {
        const output = await mergePdfs(
          documents.map((document) => document.source),
          context,
        );
        const total = documents.reduce((sum, item) => sum + (item.info?.pageCount ?? 0), 0);
        return singleResult(
          output,
          `${documents.length} documents assemblés, ${total} pages au total.`,
        );
      }}
    />
  );
}
