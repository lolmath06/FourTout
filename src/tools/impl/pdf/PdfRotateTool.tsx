import { useState } from "react";
import { PdfToolShell } from "@/components/pdf/PdfToolShell";
import { singleResult } from "@/components/pdf/result";
import { Field, Fieldset, OptionGroup } from "@/components/pdf/Field";
import { PageRangeInput } from "@/components/pdf/PageRangeInput";
import { usePageRange } from "@/components/pdf/usePageRange";
import { rotatePages } from "@/core/pdf/operations/pages";
import { parsePageRange } from "@/core/pdf/pageRange";
import type { RotationAngle } from "@/core/pdf/types";
import type { ToolComponentProps } from "@/tools/implementations";

const ANGLES = [
  { value: "90" as const, label: "90° à droite" },
  { value: "180" as const, label: "180°" },
  { value: "270" as const, label: "90° à gauche" },
];

const SCOPES = [
  { value: "all" as const, label: "Toutes les pages" },
  { value: "selection" as const, label: "Pages choisies" },
];

export function PdfRotateTool({ tool }: ToolComponentProps) {
  const [angle, setAngle] = useState<"90" | "180" | "270">("90");
  const [scope, setScope] = useState<"all" | "selection">("all");
  const [input, setInput] = useState("");

  return (
    <PdfToolShell
      tool={tool}
      actionLabel="Faire pivoter"
      actionDisabled={scope === "selection" && input.trim().length === 0}
      run={async ({ documents, context }) => {
        const [document] = documents;
        const pageCount = document.info?.pageCount ?? 0;
        const pages =
          scope === "selection" ? parsePageRange(input, pageCount).pages : undefined;

        const output = await rotatePages(
          document.source,
          { angle: Number(angle) as RotationAngle, pages },
          context,
        );
        return singleResult(
          output,
          `Rotation de ${angle}° appliquée à ${pages ? `${pages.length} page(s)` : `${pageCount} page(s)`}.`,
        );
      }}
    >
      {(documents) => (
        <RotateFields
          pageCount={documents[0]?.info?.pageCount ?? 0}
          angle={angle}
          onAngle={setAngle}
          scope={scope}
          onScope={setScope}
          input={input}
          onInput={setInput}
        />
      )}
    </PdfToolShell>
  );
}

function RotateFields({
  pageCount,
  angle,
  onAngle,
  scope,
  onScope,
  input,
  onInput,
}: {
  pageCount: number;
  angle: "90" | "180" | "270";
  onAngle: (value: "90" | "180" | "270") => void;
  scope: "all" | "selection";
  onScope: (value: "all" | "selection") => void;
  input: string;
  onInput: (value: string) => void;
}) {
  const state = usePageRange(input, pageCount);

  return (
    <Fieldset>
      <Field label="Rotation" hint="La rotation s'ajoute à celle déjà enregistrée dans le document.">
        <OptionGroup ariaLabel="Angle de rotation" value={angle} onChange={onAngle} options={ANGLES} />
      </Field>
      <Field label="Portée">
        <OptionGroup ariaLabel="Pages concernées" value={scope} onChange={onScope} options={SCOPES} />
      </Field>
      {scope === "selection" && (
        <div className="sm:col-span-full">
          <PageRangeInput
            label="Pages à faire pivoter"
            value={input}
            onChange={onInput}
            pageCount={pageCount}
            state={state}
          />
        </div>
      )}
    </Fieldset>
  );
}
