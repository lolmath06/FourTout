import { useMemo, useState } from "react";
import { CheckOption, TextToolShell } from "@/components/text/TextToolShell";
import { Field, Fieldset, OptionGroup } from "@/components/pdf/Field";
import { cleanText, DEFAULT_CLEAN_OPTIONS, type CleanOptions } from "@/core/text/clean";
import type { ToolComponentProps } from "@/tools/implementations";
import { msg, t } from "@/i18n";

/**
 * Nettoyage d'un texte.
 *
 * Chaque transformation est une case cochée : rien n'est modifié « pour rendre
 * service ». Le récapitulatif compare l'avant et l'après pour que l'utilisateur
 * voie exactement ce que l'outil a fait.
 */
const SAMPLE = msg("   Texte   copié   depuis   une   page web\n\n\n  Deuxième    paragraphe avec des espaces en trop.   \n\n\n   Et une dernière ligne.   ");

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
      outputLabel={t("Texte nettoyé")}
      downloadName="texte-nettoye.txt"
      sample={SAMPLE}
      summary={
        input.length > 0 ? (
          <span className="tabular-nums">
            {t("{characters} → {characters2} caractères{value} · {lines} → {lines2} lignes · {words} → {words2} mots", { characters: result.before.characters, characters2: result.after.characters, value: delta !== 0 && ` (${delta > 0 ? "−" : "+"}${Math.abs(delta)})`, lines: result.before.lines, lines2: result.after.lines, words: result.before.words, words2: result.after.words })}
          </span>
        ) : undefined
      }
    >
      <Fieldset columns={2}>
        <Field label={t("Espaces")} full>
          <div className="grid gap-0.5 sm:grid-cols-2">
            <CheckOption
              checked={options.collapseSpaces}
              onChange={(v) => set("collapseSpaces", v)}
              label={t("Espaces multiples → un seul")}
            />
            <CheckOption
              checked={options.trimLines}
              onChange={(v) => set("trimLines", v)}
              label={t("Espaces en début et fin de ligne")}
            />
            <CheckOption
              checked={options.trimDocument}
              onChange={(v) => set("trimDocument", v)}
              label={t("Espaces au début et à la fin du texte")}
            />
            <CheckOption
              checked={options.removeInvisible}
              onChange={(v) => set("removeInvisible", v)}
              label={t("Caractères invisibles")}
              hint={t("Espaces insécables, largeur nulle, BOM")}
            />
          </div>
        </Field>

        <Field label={t("Lignes vides")} full>
          <div className="grid gap-0.5 sm:grid-cols-2">
            <CheckOption
              checked={options.collapseBlankLines}
              onChange={(v) => set("collapseBlankLines", v)}
              label={t("Lignes vides multiples → une seule")}
              disabled={options.removeBlankLines}
            />
            <CheckOption
              checked={options.removeBlankLines}
              onChange={(v) => set("removeBlankLines", v)}
              label={t("Supprimer toutes les lignes vides")}
            />
          </div>
        </Field>

        <Field label={t("Typographie")} full>
          <div className="grid gap-0.5 sm:grid-cols-2">
            <CheckOption
              checked={options.normalizeQuotes}
              onChange={(v) => set("normalizeQuotes", v)}
              label={t("Apostrophes et guillemets droits")}
              hint={t("’ « » deviennent ' et \"")}
            />
            <CheckOption
              checked={options.normalizeDashes}
              onChange={(v) => set("normalizeDashes", v)}
              label={t("Tirets normalisés")}
              hint="– — → -"
            />
          </div>
        </Field>

        <Field label={t("Normalisation Unicode")} hint={t("Utile pour les accents venus d'un autre système")}>
          <OptionGroup
            ariaLabel={t("Normalisation Unicode")}
            value={options.normalizeUnicode}
            onChange={(v) => set("normalizeUnicode", v)}
            options={[
              { value: "none", label: t("Aucune") },
              { value: "NFC", label: "NFC" },
              { value: "NFD", label: "NFD" },
              { value: "NFKC", label: "NFKC" },
            ]}
          />
        </Field>

        <Field label={t("Fins de ligne")}>
          <OptionGroup
            ariaLabel={t("Fins de ligne")}
            value={options.lineEndings}
            onChange={(v) => set("lineEndings", v)}
            options={[
              { value: "keep", label: t("Inchangées") },
              { value: "lf", label: t("LF (Unix)") },
              { value: "crlf", label: t("CRLF (Windows)") },
            ]}
          />
        </Field>
      </Fieldset>
    </TextToolShell>
  );
}
