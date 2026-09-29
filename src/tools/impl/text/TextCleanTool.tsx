import { useMemo, useState } from "react";
import { CheckOption, TextToolShell } from "@/components/text/TextToolShell";
import { Field, Fieldset, OptionGroup } from "@/components/pdf/Field";
import { cleanText, DEFAULT_CLEAN_OPTIONS, type CleanOptions } from "@/core/text/clean";
import type { ToolComponentProps } from "@/tools/implementations";

/**
 * Nettoyage d'un texte.
 *
 * Chaque transformation est une case cochée : rien n'est modifié « pour rendre
 * service ». Le récapitulatif compare l'avant et l'après pour que l'utilisateur
 * voie exactement ce que l'outil a fait.
 */
const SAMPLE = `   Texte   copié   depuis   une   page web


  Deuxième    paragraphe avec des espaces en trop.   


   Et une dernière ligne.   `;

export function TextCleanTool(_props: ToolComponentProps) {
  const [input, setInput] = useState("");
  const [options, setOptions] = useState<CleanOptions>(DEFAULT_CLEAN_OPTIONS);

  const result = useMemo(() => cleanText(input, options), [input, options]);
  const set = <K extends keyof CleanOptions>(key: K, value: CleanOptions[K]) =>
    setOptions((current) => ({ ...current, [key]: value }));

  const delta = result.before.characters - result.after.characters;

  return (
    <TextToolShell
      input={input}
      onInputChange={setInput}
      output={result.text}
      outputLabel="Texte nettoyé"
      downloadName="texte-nettoye.txt"
      sample={SAMPLE}
      summary={
        input.length > 0 ? (
          <span className="tabular-nums">
            {result.before.characters} → {result.after.characters} caractères
            {delta !== 0 && ` (${delta > 0 ? "−" : "+"}${Math.abs(delta)})`} ·{" "}
            {result.before.lines} → {result.after.lines} lignes ·{" "}
            {result.before.words} → {result.after.words} mots
          </span>
        ) : undefined
      }
    >
      <Fieldset columns={2}>
        <Field label="Espaces" full>
          <div className="grid gap-0.5 sm:grid-cols-2">
            <CheckOption
              checked={options.collapseSpaces}
              onChange={(v) => set("collapseSpaces", v)}
              label="Espaces multiples → un seul"
            />
            <CheckOption
              checked={options.trimLines}
              onChange={(v) => set("trimLines", v)}
              label="Espaces en début et fin de ligne"
            />
            <CheckOption
              checked={options.trimDocument}
              onChange={(v) => set("trimDocument", v)}
              label="Espaces au début et à la fin du texte"
            />
            <CheckOption
              checked={options.removeInvisible}
              onChange={(v) => set("removeInvisible", v)}
              label="Caractères invisibles"
              hint="Espaces insécables, largeur nulle, BOM"
            />
          </div>
        </Field>

        <Field label="Lignes vides" full>
          <div className="grid gap-0.5 sm:grid-cols-2">
            <CheckOption
              checked={options.collapseBlankLines}
              onChange={(v) => set("collapseBlankLines", v)}
              label="Lignes vides multiples → une seule"
              disabled={options.removeBlankLines}
            />
            <CheckOption
              checked={options.removeBlankLines}
              onChange={(v) => set("removeBlankLines", v)}
              label="Supprimer toutes les lignes vides"
            />
          </div>
        </Field>

        <Field label="Typographie" full>
          <div className="grid gap-0.5 sm:grid-cols-2">
            <CheckOption
              checked={options.normalizeQuotes}
              onChange={(v) => set("normalizeQuotes", v)}
              label="Apostrophes et guillemets droits"
              hint={"\u2019 \u00AB \u00BB deviennent ' et \""}
            />
            <CheckOption
              checked={options.normalizeDashes}
              onChange={(v) => set("normalizeDashes", v)}
              label="Tirets normalisés"
              hint="– — → -"
            />
          </div>
        </Field>

        <Field label="Normalisation Unicode" hint="Utile pour les accents venus d'un autre système">
          <OptionGroup
            ariaLabel="Normalisation Unicode"
            value={options.normalizeUnicode}
            onChange={(v) => set("normalizeUnicode", v)}
            options={[
              { value: "none", label: "Aucune" },
              { value: "NFC", label: "NFC" },
              { value: "NFD", label: "NFD" },
              { value: "NFKC", label: "NFKC" },
            ]}
          />
        </Field>

        <Field label="Fins de ligne">
          <OptionGroup
            ariaLabel="Fins de ligne"
            value={options.lineEndings}
            onChange={(v) => set("lineEndings", v)}
            options={[
              { value: "keep", label: "Inchangées" },
              { value: "lf", label: "LF (Unix)" },
              { value: "crlf", label: "CRLF (Windows)" },
            ]}
          />
        </Field>
      </Fieldset>
    </TextToolShell>
  );
}
