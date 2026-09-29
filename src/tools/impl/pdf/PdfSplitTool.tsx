import { useMemo, useState } from "react";
import { PdfToolShell } from "@/components/pdf/PdfToolShell";
import { Field, Fieldset, OptionGroup, TextInput } from "@/components/pdf/Field";
import { splitPdf, type SplitMode } from "@/core/pdf/operations/pages";
import { parseSplitGroups } from "@/core/pdf/pageRange";
import { isPdfError } from "@/core/pdf/errors";
import { Icon } from "@/components/ui/Icon";
import type { ToolComponentProps } from "@/tools/implementations";

const MODES = [
  { value: "each-page" as SplitMode, label: "Une page par fichier" },
  { value: "groups" as SplitMode, label: "Par plages" },
];

export function PdfSplitTool({ tool }: ToolComponentProps) {
  const [mode, setMode] = useState<SplitMode>("each-page");
  const [ranges, setRanges] = useState("");

  return (
    <PdfToolShell
      tool={tool}
      actionLabel="Découper"
      actionDisabled={mode === "groups" && ranges.trim().length === 0}
      run={async ({ documents, context }) => {
        const [document] = documents;
        const pageCount = document.info?.pageCount ?? 0;
        const files = await splitPdf(
          document.source,
          mode === "each-page"
            ? { mode: "each-page" }
            : { mode: "groups", groups: parseSplitGroups(ranges, pageCount) },
          context,
        );
        return {
          files,
          summary: `${files.length} document${files.length > 1 ? "s" : ""} produit${files.length > 1 ? "s" : ""} à partir de ${pageCount} pages.`,
          zipName: "pdf-decoupe.zip",
        };
      }}
    >
      {(documents) => {
        const pageCount = documents[0]?.info?.pageCount ?? 0;
        return (
          <Fieldset columns={1}>
            <Field label="Mode de découpage">
              <OptionGroup
                ariaLabel="Mode de découpage"
                value={mode}
                onChange={setMode}
                options={MODES}
              />
            </Field>

            {mode === "each-page" ? (
              <p className="flex items-start gap-1.5 text-xs text-[var(--ft-text-muted)]">
                <Icon name="Info" size={13} className="mt-0.5 shrink-0" />
                {pageCount} fichier{pageCount > 1 ? "s" : ""} seront produits, un par page.
              </p>
            ) : (
              <RangesField value={ranges} onChange={setRanges} pageCount={pageCount} />
            )}
          </Fieldset>
        );
      }}
    </PdfToolShell>
  );
}

function RangesField({
  value,
  onChange,
  pageCount,
}: {
  value: string;
  onChange: (value: string) => void;
  pageCount: number;
}) {
  const preview = useMemo(() => {
    if (value.trim().length === 0) return undefined;
    try {
      return { groups: parseSplitGroups(value, pageCount) };
    } catch (error) {
      return { error: isPdfError(error) ? error.message : "Plages invalides" };
    }
  }, [value, pageCount]);

  return (
    <Field
      label="Plages de pages"
      hint="Une plage par fichier, séparées par des virgules. Exemple : 1-3, 4-5, 6 produit trois documents."
    >
      <TextInput
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="1-3, 4-5, 6"
        className="font-mono"
        aria-label="Plages de pages"
      />
      {preview?.error ? (
        <span className="text-xs text-[var(--ft-danger)]">{preview.error}</span>
      ) : preview?.groups ? (
        <span className="text-xs text-[var(--ft-text-faint)]">
          {preview.groups.length} fichier{preview.groups.length > 1 ? "s" : ""} :{" "}
          {preview.groups.map((group) => `${group.length} p.`).join(" · ")}
        </span>
      ) : null}
    </Field>
  );
}
