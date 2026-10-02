import { useMemo, useState } from "react";
import { Field, Fieldset, OptionGroup } from "@/components/pdf/Field";
import { CheckOption, TextToolShell } from "@/components/text/TextToolShell";
import { Callout } from "@/components/ui/Callout";
import {
  DataError,
  formatJson,
  formatXml,
  inspectJson,
  minifyJson,
  minifyXml,
  parseJson,
  validateXml,
  type Indentation,
} from "@/core/code/data";
import { formatYaml, jsonToYaml, YAML_TAB_NOTE, yamlToJson } from "@/core/code/yaml";
import type { ToolComponentProps } from "@/tools/implementations";
import { formatNumber, localized, msg, t, tx } from "@/i18n";

const INDENTATIONS: { value: Indentation; label: string }[] = localized(() => [
  { value: "2", label: t("2 espaces") },
  { value: "4", label: t("4 espaces") },
  { value: "tab", label: t("Tabulation") },
]);

const JSON_SAMPLE = `{"application":"FourTout","version":2,"local":true,"outils":[{"id":"pdf-merge","nom":"Fusionner des PDF"},{"id":"image-crop","nom":"Rogner une image"}],"licence":null}`;

/**
 * JSON : formater, minifier, valider.
 *
 * L'erreur de syntaxe est **située** (ligne et colonne) par un scanner maison
 * plutôt que par le message du moteur, qui change d'une version à l'autre.
 */
export function JsonTool(_props: ToolComponentProps) {
  const [input, setInput] = useState("");
  const [action, setAction] = useState<"format" | "minify">("format");
  const [indentation, setIndentation] = useState<Indentation>("2");
  const [sortKeys, setSortKeys] = useState(false);

  const result = useMemo(() => {
    if (input.trim().length === 0) return { output: "", error: undefined, stats: undefined };
    try {
      const parsed = parseJson(input);
      return {
        output:
          action === "format"
            ? formatJson(input, { indentation, sortKeys })
            : minifyJson(input, { sortKeys }),
        error: undefined,
        stats: inspectJson(parsed),
      };
    } catch (failure) {
      return {
        output: "",
        error: failure instanceof Error ? failure.message : "JSON invalide.",
        stats: undefined,
      };
    }
  }, [input, action, indentation, sortKeys]);

  return (
    <TextToolShell
      input={input}
      onInputChange={setInput}
      inputLabel="JSON"
      outputLabel={action === "format" ? t("JSON formaté") : t("JSON minifié")}
      output={result.output}
      error={tx(result.error)}
      layout="side-by-side"
      downloadName={action === "format" ? "formate.json" : "minifie.json"}
      sample={JSON_SAMPLE}
      summary={
        result.stats
          ? t("Valide · {objects} {objects, plural, one {objet} other {objets}}, {arrays} {arrays, plural, one {tableau} other {tableaux}}, {values} {values, plural, one {valeur} other {valeurs}}, profondeur {maxDepth} · {value} → {value2} caractères", { objects: result.stats.objects, arrays: result.stats.arrays, values: result.stats.values, maxDepth: result.stats.maxDepth, value: formatNumber(input.length), value2: formatNumber(result.output.length) })
          : undefined
      }
    >
      <Fieldset columns={3}>
        <Field label={t("Sortie")}>
          <OptionGroup
            ariaLabel={t("Sortie")}
            value={action}
            onChange={setAction}
            options={[
              { value: "format", label: t("Formater") },
              { value: "minify", label: t("Minifier") },
            ]}
          />
        </Field>
        <Field label={t("Indentation")}>
          <OptionGroup
            ariaLabel={t("Indentation")}
            value={indentation}
            onChange={setIndentation}
            disabled={action === "minify"}
            options={INDENTATIONS}
          />
        </Field>
        <Field label={t("Clés")}>
          <CheckOption
            checked={sortKeys}
            onChange={setSortKeys}
            label={t("Trier alphabétiquement")}
            hint={t("L'ordre des tableaux reste intact.")}
          />
        </Field>
      </Fieldset>
    </TextToolShell>
  );
}

/* ------------------------------------------------------------------------ */

const YAML_SAMPLE = msg("application: FourTout\nversion: 2\nlocal: true\noutils:\n  - id: pdf-merge\n    nom: Fusionner des PDF\n  - id: image-crop\n    nom: Rogner une image\nlicence: null");

type YamlAction = "format" | "to-json" | "from-json";

/**
 * YAML : formater, et convertir depuis ou vers JSON.
 *
 * Le schéma est le schéma core de YAML 1.2 : aucun tag ne peut instancier
 * d'objet ni exécuter quoi que ce soit.
 */
export function YamlTool(_props: ToolComponentProps) {
  const [input, setInput] = useState("");
  const [action, setAction] = useState<YamlAction>("format");
  const [indentation, setIndentation] = useState<Indentation>("2");
  const [sortKeys, setSortKeys] = useState(false);

  const result = useMemo(() => {
    if (input.trim().length === 0) return { output: "", error: undefined };
    try {
      const options = { indentation, sortKeys };
      return {
        output:
          action === "format"
            ? formatYaml(input, options)
            : action === "to-json"
              ? yamlToJson(input, options)
              : jsonToYaml(input, options),
        error: undefined,
      };
    } catch (failure) {
      return {
        output: "",
        error: failure instanceof Error ? failure.message : t("Document invalide."),
      };
    }
  }, [input, action, indentation, sortKeys]);

  const producesYaml = action !== "to-json";

  return (
    <TextToolShell
      input={input}
      onInputChange={setInput}
      inputLabel={action === "from-json" ? "JSON" : "YAML"}
      outputLabel={producesYaml ? "YAML" : "JSON"}
      output={result.output}
      error={tx(result.error)}
      layout="side-by-side"
      downloadName={producesYaml ? "sortie.yaml" : "sortie.json"}
      sample={action === "from-json" ? JSON_SAMPLE : YAML_SAMPLE}
    >
      <Fieldset columns={3}>
        <Field label={t("Opération")}>
          <OptionGroup
            ariaLabel={t("Opération")}
            value={action}
            onChange={setAction}
            options={[
              { value: "format", label: t("Formater") },
              { value: "to-json", label: "YAML → JSON" },
              { value: "from-json", label: "JSON → YAML" },
            ]}
          />
        </Field>
        <Field
          label={t("Indentation")}
          hint={producesYaml && indentation === "tab" ? YAML_TAB_NOTE : undefined}
        >
          <OptionGroup
            ariaLabel={t("Indentation")}
            value={indentation}
            onChange={setIndentation}
            options={INDENTATIONS}
          />
        </Field>
        <Field label={t("Clés")}>
          <CheckOption checked={sortKeys} onChange={setSortKeys} label={t("Trier alphabétiquement")} />
        </Field>
      </Fieldset>

      <Callout tone="info" title={t("Lecture sûre")}>
        {t("FourTout lit le YAML avec le schéma core de la norme 1.2 : chaînes, nombres, booléens, nuls, listes et dictionnaires. Aucun tag capable d'instancier un objet ou d'exécuter du code n'est accepté.")}
      </Callout>
    </TextToolShell>
  );
}

/* ------------------------------------------------------------------------ */

const XML_SAMPLE = msg("<?xml version=\"1.0\" encoding=\"UTF-8\"?><catalogue><outil id=\"pdf-merge\"><nom>Fusionner des PDF</nom><categorie>PDF</categorie></outil><outil id=\"image-crop\"><nom>Rogner une image</nom><categorie>Images</categorie></outil></catalogue>");

/** XML : formater, minifier, valider — sans jamais résoudre d'entité externe. */
export function XmlTool(_props: ToolComponentProps) {
  const [input, setInput] = useState("");
  const [action, setAction] = useState<"format" | "minify">("format");
  const [indentation, setIndentation] = useState<Indentation>("2");

  const result = useMemo(() => {
    if (input.trim().length === 0) return { output: "", error: undefined, valid: false };
    try {
      validateXml(input);
      return {
        output: action === "format" ? formatXml(input, indentation) : minifyXml(input),
        error: undefined,
        valid: true,
      };
    } catch (failure) {
      return {
        output: "",
        error: failure instanceof DataError ? failure.message : t("Document XML invalide."),
        valid: false,
      };
    }
  }, [input, action, indentation]);

  return (
    <TextToolShell
      input={input}
      onInputChange={setInput}
      inputLabel="XML"
      outputLabel={action === "format" ? t("XML formaté") : t("XML minifié")}
      output={result.output}
      error={tx(result.error)}
      layout="side-by-side"
      downloadName="sortie.xml"
      sample={XML_SAMPLE}
      summary={
        result.valid
          ? t("Document valide · {value} → {value2} caractères", { value: formatNumber(input.length), value2: formatNumber(result.output.length) })
          : undefined
      }
    >
      <Fieldset columns={2}>
        <Field label={t("Sortie")}>
          <OptionGroup
            ariaLabel={t("Sortie")}
            value={action}
            onChange={setAction}
            options={[
              { value: "format", label: t("Formater") },
              { value: "minify", label: t("Minifier") },
            ]}
          />
        </Field>
        <Field label={t("Indentation")}>
          <OptionGroup
            ariaLabel={t("Indentation")}
            value={indentation}
            onChange={setIndentation}
            disabled={action === "minify"}
            options={INDENTATIONS}
          />
        </Field>
      </Fieldset>

      <Callout tone="info" title={t("Entités externes refusées")}>
        {t("Un document XML peut déclarer des entités qui pointent vers un fichier local ou une adresse réseau — c'est l'attaque dite XXE. FourTout refuse tout document qui en contient, plutôt que de compter sur la prudence du moteur d'analyse.")}
      </Callout>
    </TextToolShell>
  );
}
