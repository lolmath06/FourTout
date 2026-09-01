import { useState } from "react";
import { PdfToolShell } from "@/components/pdf/PdfToolShell";
import { singleResult } from "@/components/pdf/result";
import { Fieldset } from "@/components/pdf/Field";
import { PageRangeInput } from "@/components/pdf/PageRangeInput";
import { usePageRange } from "@/components/pdf/usePageRange";
import { extractPages } from "@/core/pdf/operations/pages";
import { parsePageRange } from "@/core/pdf/pageRange";
import type { ToolComponentProps } from "@/tools/implementations";

export function PdfExtractPagesTool({ tool }: ToolComponentProps) {
  const [input, setInput] = useState("");

  return (
    <PdfToolShell
      tool={tool}
      actionLabel="Extraire"
      actionDisabled={input.trim().length === 0}
      run={async ({ documents, context }) => {
        const [document] = documents;
        const pageCount = document.info?.pageCount ?? 0;
        // On garde l'ordre saisi : demander « 4,2 » produit bien 4 puis 2.
        const { ordered } = parsePageRange(input, pageCount);
        const output = await extractPages(document.source, ordered, context);
        return singleResult(
          output,
          `${ordered.length} page${ordered.length > 1 ? "s" : ""} extraite${ordered.length > 1 ? "s" : ""} sur ${pageCount}.`,
        );
      }}
    >
      {(documents) => <RangeFields documents={documents} value={input} onChange={setInput} />}
    </PdfToolShell>
  );
}

function RangeFields({
  documents,
  value,
  onChange,
}: {
  documents: { info?: { pageCount: number } }[];
  value: string;
  onChange: (value: string) => void;
}) {
  const pageCount = documents[0]?.info?.pageCount ?? 0;
  const state = usePageRange(value, pageCount);
  return (
    <Fieldset columns={1}>
      <PageRangeInput
        label="Pages à conserver"
        value={value}
        onChange={onChange}
        pageCount={pageCount}
        state={state}
        autoFocus
      />
    </Fieldset>
  );
}
