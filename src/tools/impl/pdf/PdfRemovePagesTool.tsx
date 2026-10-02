import { useState } from "react";
import { PdfToolShell } from "@/components/pdf/PdfToolShell";
import { singleResult } from "@/components/pdf/result";
import { Fieldset } from "@/components/pdf/Field";
import { PageRangeInput } from "@/components/pdf/PageRangeInput";
import { usePageRange } from "@/components/pdf/usePageRange";
import { removePages } from "@/core/pdf/operations/pages";
import { parsePageRange } from "@/core/pdf/pageRange";
import type { ToolComponentProps } from "@/tools/implementations";
import { t } from "@/i18n";

export function PdfRemovePagesTool({ tool }: ToolComponentProps) {
  const [input, setInput] = useState("");

  return (
    <PdfToolShell
      tool={tool}
      actionLabel={t("Supprimer les pages")}
      actionDisabled={input.trim().length === 0}
      run={async ({ documents, context }) => {
        const [document] = documents;
        const pageCount = document.info?.pageCount ?? 0;
        const { pages } = parsePageRange(input, pageCount);
        const output = await removePages(document.source, pages, context);
        return singleResult(
          output,
          t("{count} {count, plural, one {page} other {pages}} {count, plural, one {retirée} other {retirées}} ; {value} {value, plural, one {conservée} other {conservées}}.", { count: pages.length, value: pageCount - pages.length }),
        );
      }}
    >
      {(documents) => <RemoveFields documents={documents} value={input} onChange={setInput} />}
    </PdfToolShell>
  );
}

function RemoveFields({
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
  const remaining = pageCount - state.pages.length;

  return (
    <Fieldset columns={1}>
      <PageRangeInput
        label={t("Pages à supprimer")}
        value={value}
        onChange={onChange}
        pageCount={pageCount}
        state={state}
        autoFocus
      />
      {state.valid && (
        <p
          className={`text-xs ${remaining === 0 ? "text-[var(--ft-danger)]" : "text-[var(--ft-text-muted)]"}`}
        >
          {remaining === 0
            ? t("Impossible : toutes les pages du document seraient supprimées.")
            : t("Le document final comptera {remaining} {remaining, plural, one {page} other {pages}}.", { remaining })}
        </p>
      )}
    </Fieldset>
  );
}
