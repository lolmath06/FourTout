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
import { Trans, localized, t } from "@/i18n";

const POSITIONS: { value: PageNumberPosition; label: string }[] = localized(() => [
  { value: "top-left", label: t("Haut gauche") },
  { value: "top-center", label: t("Haut centre") },
  { value: "top-right", label: t("Haut droite") },
  { value: "bottom-left", label: t("Bas gauche") },
  { value: "bottom-center", label: t("Bas centre") },
  { value: "bottom-right", label: t("Bas droite") },
]);

const FORMATS: { value: PageNumberFormat; label: string }[] = localized(() => [
  { value: "plain", label: "1" },
  { value: "page-n", label: t("Page 1") },
  { value: "n-of-total", label: "1 / 12" },
]);

export function PdfPageNumbersTool({ tool }: ToolComponentProps) {
  const [startAt, setStartAt] = useState(1);
  const [position, setPosition] = useState<PageNumberPosition>("bottom-center");
  const [format, setFormat] = useState<PageNumberFormat>("plain");
  const [fontSize, setFontSize] = useState(10);
  const [margin, setMargin] = useState(28);

  return (
    <PdfToolShell
      tool={tool}
      actionLabel={t("Numéroter")}
      run={async ({ documents, context }) => {
        const [document] = documents;
        const output = await addPageNumbers(
          document.source,
          { startAt, position, format, fontSize, margin },
          context,
        );
        return singleResult(
          output,
          t("{value} pages numérotées à partir de {startAt}.", { value: document.info?.pageCount ?? 0, startAt }),
        );
      }}
    >
      {(documents) => {
        const pageCount = documents[0]?.info?.pageCount ?? 0;
        return (
          <Fieldset>
            <Field label={t("Position")}>
              <PositionPicker value={position} onChange={setPosition} options={POSITIONS} />
            </Field>

            <div className="flex flex-col gap-3">
              <Field label={t("Format")}>
                <OptionGroup
                  ariaLabel={t("Format du numéro")}
                  value={format}
                  onChange={setFormat}
                  options={FORMATS}
                />
              </Field>
              <Field label={t("Commencer à")}>
                <NumberInput
                  min={0}
                  value={startAt}
                  onChange={(event) => setStartAt(Math.max(0, Number(event.target.value)))}
                  aria-label={t("Numéro de départ")}
                />
              </Field>
            </div>

            <Field label={t("Taille du texte")}>
              <Slider value={fontSize} onChange={setFontSize} min={6} max={24} suffix=" pt" />
            </Field>
            <Field label={t("Marge")}>
              <Slider value={margin} onChange={setMargin} min={10} max={72} suffix=" pt" />
            </Field>

            <p className="text-xs text-[var(--ft-text-faint)] sm:col-span-full">
              <Trans source={"Aperçu : la première page portera « <0>{value}</0> », la dernière « <1>{value2}</1> »."} values={{ value: formatPageNumber(startAt, startAt + pageCount - 1, format), value2: formatPageNumber(startAt + pageCount - 1, startAt + pageCount - 1, format) }} components={[<span className="font-medium text-[var(--ft-text)]" />, <span className="font-medium text-[var(--ft-text)]" />]} />
            </p>
          </Fieldset>
        );
      }}
    </PdfToolShell>
  );
}
