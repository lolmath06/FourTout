import { useState } from "react";
import { PdfToolShell } from "@/components/pdf/PdfToolShell";
import { Field, Fieldset, OptionGroup, Slider } from "@/components/pdf/Field";
import { PageRangeInput } from "@/components/pdf/PageRangeInput";
import { usePageRange } from "@/components/pdf/usePageRange";
import { pdfToImages, type ImageOutputFormat } from "@/core/pdf/operations/toImages";
import { parsePageRange } from "@/core/pdf/pageRange";
import type { ToolComponentProps } from "@/tools/implementations";

const FORMATS = [
  { value: "png" as ImageOutputFormat, label: "PNG", hint: "Sans perte, idéal pour du texte" },
  { value: "jpeg" as ImageOutputFormat, label: "JPEG", hint: "Plus léger, idéal pour des photos" },
];

const RESOLUTIONS = [
  { value: "96", label: "Écran (96 ppp)" },
  { value: "150", label: "Bonne (150 ppp)" },
  { value: "300", label: "Impression (300 ppp)" },
];

const SCOPES = [
  { value: "all" as const, label: "Toutes les pages" },
  { value: "selection" as const, label: "Pages choisies" },
];

export function PdfToImagesTool({ tool }: ToolComponentProps) {
  const [format, setFormat] = useState<ImageOutputFormat>("png");
  const [dpi, setDpi] = useState("150");
  const [quality, setQuality] = useState(85);
  const [scope, setScope] = useState<"all" | "selection">("all");
  const [input, setInput] = useState("");

  return (
    <PdfToolShell
      tool={tool}
      actionLabel="Convertir en images"
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
          summary: `${files.length} image${files.length > 1 ? "s" : ""} en ${format.toUpperCase()} à ${dpi} ppp.`,
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
      <Field label="Format">
        <OptionGroup ariaLabel="Format de sortie" value={format} onChange={onFormat} options={FORMATS} />
      </Field>
      <Field label="Résolution" hint="Plus la résolution est élevée, plus les images sont grandes.">
        <OptionGroup ariaLabel="Résolution" value={dpi} onChange={onDpi} options={RESOLUTIONS} />
      </Field>

      {format === "jpeg" && (
        <Field label="Qualité JPEG">
          <Slider value={quality} onChange={onQuality} min={40} max={100} suffix=" %" />
        </Field>
      )}

      <Field label="Portée">
        <OptionGroup ariaLabel="Pages concernées" value={scope} onChange={onScope} options={SCOPES} />
      </Field>

      {scope === "selection" && (
        <div className="sm:col-span-full">
          <PageRangeInput
            label="Pages à convertir"
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
