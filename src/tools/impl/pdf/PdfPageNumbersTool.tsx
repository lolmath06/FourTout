import { useState } from "react";
import { PdfToolShell } from "@/components/pdf/PdfToolShell";
import { singleResult } from "@/components/pdf/result";
import {
  Field,
  Fieldset,
  NumberInput,
  OptionGroup,
  PositionPicker,
  Slider,
} from "@/components/pdf/Field";
import {
  addPageNumbers,
  formatPageNumber,
  type PageNumberFormat,
  type PageNumberPosition,
} from "@/core/pdf/operations/annotate";
import type { ToolComponentProps } from "@/tools/implementations";

const POSITIONS: { value: PageNumberPosition; label: string }[] = [
  { value: "top-left", label: "Haut gauche" },
  { value: "top-center", label: "Haut centre" },
  { value: "top-right", label: "Haut droite" },
  { value: "bottom-left", label: "Bas gauche" },
  { value: "bottom-center", label: "Bas centre" },
  { value: "bottom-right", label: "Bas droite" },
];

const FORMATS: { value: PageNumberFormat; label: string }[] = [
  { value: "plain", label: "1" },
  { value: "page-n", label: "Page 1" },
  { value: "n-of-total", label: "1 / 12" },
];

export function PdfPageNumbersTool({ tool }: ToolComponentProps) {
  const [startAt, setStartAt] = useState(1);
  const [position, setPosition] = useState<PageNumberPosition>("bottom-center");
  const [format, setFormat] = useState<PageNumberFormat>("plain");
  const [fontSize, setFontSize] = useState(10);
  const [margin, setMargin] = useState(28);

  return (
    <PdfToolShell
      tool={tool}
      actionLabel="Numéroter"
      run={async ({ documents, context }) => {
        const [document] = documents;
        const output = await addPageNumbers(
          document.source,
          { startAt, position, format, fontSize, margin },
          context,
        );
        return singleResult(
          output,
          `${document.info?.pageCount ?? 0} pages numérotées à partir de ${startAt}.`,
        );
      }}
    >
      {(documents) => {
        const pageCount = documents[0]?.info?.pageCount ?? 0;
        return (
          <Fieldset>
            <Field label="Position">
              <PositionPicker value={position} onChange={setPosition} options={POSITIONS} />
            </Field>

            <div className="flex flex-col gap-3">
              <Field label="Format">
                <OptionGroup
                  ariaLabel="Format du numéro"
                  value={format}
                  onChange={setFormat}
                  options={FORMATS}
                />
              </Field>
              <Field label="Commencer à">
                <NumberInput
                  min={0}
                  value={startAt}
                  onChange={(event) => setStartAt(Math.max(0, Number(event.target.value)))}
                  aria-label="Numéro de départ"
                />
              </Field>
            </div>

            <Field label="Taille du texte">
              <Slider value={fontSize} onChange={setFontSize} min={6} max={24} suffix=" pt" />
            </Field>
            <Field label="Marge">
              <Slider value={margin} onChange={setMargin} min={10} max={72} suffix=" pt" />
            </Field>

            <p className="text-xs text-[var(--ft-text-faint)] sm:col-span-full">
              Aperçu : la première page portera «{" "}
              <span className="font-medium text-[var(--ft-text)]">
                {formatPageNumber(startAt, startAt + pageCount - 1, format)}
              </span>{" "}
              », la dernière «{" "}
              <span className="font-medium text-[var(--ft-text)]">
                {formatPageNumber(startAt + pageCount - 1, startAt + pageCount - 1, format)}
              </span>{" "}
              ».
            </p>
          </Fieldset>
        );
      }}
    </PdfToolShell>
  );
}
