import { useState } from "react";
import { PdfToolShell } from "@/components/pdf/PdfToolShell";
import { singleResult } from "@/components/pdf/result";
import { Field, Fieldset, OptionGroup, Slider, TextInput } from "@/components/pdf/Field";
import { PageRangeInput } from "@/components/pdf/PageRangeInput";
import { usePageRange } from "@/components/pdf/usePageRange";
import { addWatermark, type WatermarkOptions } from "@/core/pdf/operations/annotate";
import { parsePageRange } from "@/core/pdf/pageRange";
import type { ToolComponentProps } from "@/tools/implementations";

type Placement = WatermarkOptions["placement"];

const PLACEMENTS = [
  { value: "diagonal" as Placement, label: "Diagonale" },
  { value: "center" as Placement, label: "Centre" },
  { value: "top" as Placement, label: "Haut" },
  { value: "bottom" as Placement, label: "Bas" },
];

const SCOPES = [
  { value: "all" as const, label: "Toutes les pages" },
  { value: "selection" as const, label: "Pages choisies" },
];

export function PdfWatermarkTool({ tool }: ToolComponentProps) {
  const [text, setText] = useState("CONFIDENTIEL");
  const [fontSize, setFontSize] = useState(48);
  const [opacity, setOpacity] = useState(25);
  const [placement, setPlacement] = useState<Placement>("diagonal");
  const [scope, setScope] = useState<"all" | "selection">("all");
  const [input, setInput] = useState("");

  return (
    <PdfToolShell
      tool={tool}
      actionLabel="Appliquer le filigrane"
      actionDisabled={text.trim().length === 0 || (scope === "selection" && input.trim().length === 0)}
      run={async ({ documents, context }) => {
        const [document] = documents;
        const pageCount = document.info?.pageCount ?? 0;
        const pages = scope === "selection" ? parsePageRange(input, pageCount).pages : undefined;

        const output = await addWatermark(
          document.source,
          { text, fontSize, opacity: opacity / 100, placement, pages },
          context,
        );
        return singleResult(
          output,
          `Filigrane « ${text} » ajouté sur ${pages ? pages.length : pageCount} page(s).`,
        );
      }}
    >
      {(documents) => {
        const pageCount = documents[0]?.info?.pageCount ?? 0;
        return (
          <WatermarkFields
            pageCount={pageCount}
            text={text}
            onText={setText}
            fontSize={fontSize}
            onFontSize={setFontSize}
            opacity={opacity}
            onOpacity={setOpacity}
            placement={placement}
            onPlacement={setPlacement}
            scope={scope}
            onScope={setScope}
            input={input}
            onInput={setInput}
          />
        );
      }}
    </PdfToolShell>
  );
}

function WatermarkFields(props: {
  pageCount: number;
  text: string;
  onText: (value: string) => void;
  fontSize: number;
  onFontSize: (value: number) => void;
  opacity: number;
  onOpacity: (value: number) => void;
  placement: Placement;
  onPlacement: (value: Placement) => void;
  scope: "all" | "selection";
  onScope: (value: "all" | "selection") => void;
  input: string;
  onInput: (value: string) => void;
}) {
  const state = usePageRange(props.input, props.pageCount);

  return (
    <Fieldset>
      <Field label="Texte du filigrane" full>
        <TextInput
          value={props.text}
          onChange={(event) => props.onText(event.target.value)}
          placeholder="CONFIDENTIEL"
          aria-label="Texte du filigrane"
        />
      </Field>

      <Field label="Position">
        <OptionGroup
          ariaLabel="Position du filigrane"
          value={props.placement}
          onChange={props.onPlacement}
          options={PLACEMENTS}
        />
      </Field>
      <Field label="Portée">
        <OptionGroup
          ariaLabel="Pages concernées"
          value={props.scope}
          onChange={props.onScope}
          options={SCOPES}
        />
      </Field>

      <Field label="Taille du texte">
        <Slider value={props.fontSize} onChange={props.onFontSize} min={10} max={120} suffix=" pt" />
      </Field>
      <Field label="Opacité" hint="Un filigrane trop opaque gêne la lecture du document.">
        <Slider value={props.opacity} onChange={props.onOpacity} min={5} max={100} suffix=" %" />
      </Field>

      {props.scope === "selection" && (
        <div className="sm:col-span-full">
          <PageRangeInput
            label="Pages à marquer"
            value={props.input}
            onChange={props.onInput}
            pageCount={props.pageCount}
            state={state}
          />
        </div>
      )}
    </Fieldset>
  );
}
