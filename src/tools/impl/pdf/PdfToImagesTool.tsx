import { useState } from "react";
import { PdfToolShell } from "@/components/pdf/PdfToolShell";
import { Field, Fieldset, OptionGroup, Slider } from "@/components/pdf/Field";
import { PageRangeInput } from "@/components/pdf/PageRangeInput";
import { usePageRange } from "@/components/pdf/usePageRange";
import { pdfToImages, type ImageOutputFormat } from "@/core/pdf/operations/toImages";
import { parsePageRange } from "@/core/pdf/pageRange";
import type { ToolComponentProps } from "@/tools/implementations";
import { localized, t } from "@/i18n";

const FORMATS = localized(() => [
  { value: "png" as ImageOutputFormat, label: "PNG", hint: t("Sans perte, idéal pour du texte") },
  { value: "jpeg" as ImageOutputFormat, label: "JPEG", hint: t("Plus léger, idéal pour des photos") },
]);

const RESOLUTIONS = localized(() => [
  { value: "96", label: t("Écran (96 ppp)") },
  { value: "150", label: t("Bonne (150 ppp)") },
  { value: "300", label: t("Impression (300 ppp)") },
]);

const SCOPES = localized(() => [
  { value: "all" as const, label: t("Toutes les pages") },
  { value: "selection" as const, label: t("Pages choisies") },
]);

export function PdfToImagesTool({ tool }: ToolComponentProps) {
  const [format, setFormat] = useState<ImageOutputFormat>("png");
  const [dpi, setDpi] = useState("150");
  const [quality, setQuality] = useState(85);
  const [scope, setScope] = useState<"all" | "selection">("all");
  const [input, setInput] = useState("");

  return (
    <PdfToolShell
      tool={tool}
      actionLabel={t("Convertir en images")}
      actionDisabled={scope === "selection" && input.trim().length === 0}
      run={async ({ documents, context }) => {
        const [document] = documents;
        const pageCount = document.info?.pageCount ?? 0;
        const pages = scope === "selection" ? parsePageRange(input, pageCount).pages : undefined;

        const files = await pdfToImages(
          document.source,
          { format, dpi: Number(dpi), quality: quality / 100, pages },
          context,
        );
        return {
          files,
          summary: t("{count} {count, plural, one {image} other {images}} en {value} à {dpi} ppp.", { count: files.length, value: format.toUpperCase(), dpi }),
          zipName: "pdf-en-images.zip",
        };
      }}
    >
      {(documents) => (
        <ImageFields
          pageCount={documents[0]?.info?.pageCount ?? 0}
          format={format}
          onFormat={setFormat}
          dpi={dpi}
          onDpi={setDpi}
          quality={quality}
          onQuality={setQuality}
          scope={scope}
          onScope={setScope}
          input={input}
          onInput={setInput}
        />
      )}
    </PdfToolShell>
  );
}

function ImageFields({
  pageCount,
  format,
  onFormat,
  dpi,
  onDpi,
  quality,
  onQuality,
  scope,
  onScope,
  input,
  onInput,
}: {
  pageCount: number;
  format: ImageOutputFormat;
  onFormat: (value: ImageOutputFormat) => void;
  dpi: string;
  onDpi: (value: string) => void;
  quality: number;
  onQuality: (value: number) => void;
  scope: "all" | "selection";
  onScope: (value: "all" | "selection") => void;
  input: string;
  onInput: (value: string) => void;
}) {
  const state = usePageRange(input, pageCount);

  return (
    <Fieldset>
      <Field label={t("Format")}>
        <OptionGroup ariaLabel={t("Format de sortie")} value={format} onChange={onFormat} options={FORMATS} />
      </Field>
      <Field label={t("Résolution")} hint={t("Plus la résolution est élevée, plus les images sont grandes.")}>
        <OptionGroup ariaLabel={t("Résolution")} value={dpi} onChange={onDpi} options={RESOLUTIONS} />
      </Field>

      {format === "jpeg" && (
        <Field label={t("Qualité JPEG")}>
          <Slider value={quality} onChange={onQuality} min={40} max={100} suffix=" %" />
        </Field>
      )}

      <Field label={t("Portée")}>
        <OptionGroup ariaLabel={t("Pages concernées")} value={scope} onChange={onScope} options={SCOPES} />
      </Field>

      {scope === "selection" && (
        <div className="sm:col-span-full">
          <PageRangeInput
            label={t("Pages à convertir")}
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
