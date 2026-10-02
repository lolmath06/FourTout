import { useMemo, useState } from "react";
import { TextToolShell } from "@/components/text/TextToolShell";
import { Field, Fieldset, OptionGroup } from "@/components/pdf/Field";
import { Icon } from "@/components/ui/Icon";
import {
  listCodePoints,
  normalizeUnicode,
  UNICODE_FORM_LABELS,
  type UnicodeForm,
} from "@/core/text/unicode";
import type { ToolComponentProps } from "@/tools/implementations";
import { msg, t, tx } from "@/i18n";

/** « é » composé, puis « e » + accent combinant : visuellement identiques. */
const SAMPLE = msg("Café vs Café — ﬁchier № 1 ½");

export function UnicodeNormalizeTool(_props: ToolComponentProps) {
  const [input, setInput] = useState("");
  const [form, setForm] = useState<UnicodeForm>("NFC");

  const result = useMemo(() => normalizeUnicode(input, form), [input, form]);
  const points = useMemo(() => listCodePoints(input, 120), [input]);

  return (
    <TextToolShell
      input={input}
      onInputChange={setInput}
      output={result.text}
      inputLabel={t("Texte d'origine")}
      outputLabel={t("Texte normalisé ({form})", { form })}
      downloadName={`texte-${form.toLowerCase()}.txt`}
      layout="side-by-side"
      sample={SAMPLE}
      summary={
        input.length > 0 ? (
          <span className="tabular-nums">
            {t("{units} → {units2} unités UTF-16 · {codePoints} → {codePoints2} points de code · {bytes} → {bytes2} octets UTF-8{value}", { units: result.before.units, units2: result.after.units, codePoints: result.before.codePoints, codePoints2: result.after.codePoints, bytes: result.before.bytes, bytes2: result.after.bytes, value: result.alreadyNormalized && t(" · déjà normalisé") })}
          </span>
        ) : undefined
      }
    >
      <Fieldset columns={1}>
        <Field label={t("Forme de normalisation")} hint={tx(UNICODE_FORM_LABELS[form])}>
          <OptionGroup
            ariaLabel={t("Forme de normalisation")}
            value={form}
            onChange={setForm}
            options={(Object.keys(UNICODE_FORM_LABELS) as UnicodeForm[]).map((value) => ({
              value,
              label: value,
              hint: UNICODE_FORM_LABELS[value],
            }))}
          />
        </Field>
      </Fieldset>

      {points.length > 0 && (
        <div className="rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface)] p-3">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-[var(--ft-text-muted)]">
            <Icon name="ScanText" size={13} />{" "}{t("Points de code du texte d'origine{value}", { value: points.length === 120 && " (120 premiers)" })}
          </p>
          <div className="flex flex-wrap gap-1">
            {points.map((point, index) => (
              <span
                key={index}
                title={point.name || undefined}
                className="rounded border border-[var(--ft-border)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--ft-text-muted)]"
              >
                <span className="text-[var(--ft-text)]">
                  {point.char.trim() === "" ? "␣" : point.char}
                </span>{" "}
                {point.code}
              </span>
            ))}
          </div>
        </div>
      )}
    </TextToolShell>
  );
}
