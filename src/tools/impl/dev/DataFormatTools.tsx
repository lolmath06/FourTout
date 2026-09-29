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

const INDENTATIONS: { value: Indentation; label: string }[] = [
  { value: "2", label: "2 espaces" },
  { value: "4", label: "4 espaces" },
  { value: "tab", label: "Tabulation" },
];

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
      outputLabel={action === "format" ? "JSON formaté" : "JSON minifié"}
      output={result.output}
      error={result.error}
      layout="side-by-side"
      downloadName={action === "format" ? "formate.json" : "minifie.json"}
      sample={JSON_SAMPLE}
      summary={
        result.stats
          ? `Valide · ${result.stats.objects} objet${result.stats.objects > 1 ? "s" : ""}, ${result.stats.arrays} tableau${result.stats.arrays > 1 ? "x" : ""}, ${result.stats.values} valeur${result.stats.values > 1 ? "s" : ""}, profondeur ${result.stats.maxDepth} · ${input.length.toLocaleString("fr-FR")} → ${result.output.length.toLocaleString("fr-FR")} caractères`
          : undefined
      }
    >
      <Fieldset columns={3}>
        <Field label="Sortie">
          <OptionGroup
            ariaLabel="Sortie"
            value={action}
            onChange={setAction}
            options={[
              { value: "format", label: "Formater" },
              { value: "minify", label: "Minifier" },
            ]}
          />
        </Field>
        <Field label="Indentation">
          <OptionGroup
            ariaLabel="Indentation"
            value={indentation}
            onChange={setIndentation}
            disabled={action === "minify"}
            options={INDENTATIONS}
          />
        </Field>
        <Field label="Clés">
          <CheckOption
            checked={sortKeys}
            onChange={setSortKeys}
            label="Trier alphabétiquement"
            hint="L'ordre des tableaux reste intact."
          />
        </Field>
      </Fieldset>
    </TextToolShell>
  );
}

/* ------------------------------------------------------------------------ */

const YAML_SAMPLE = `application: FourTout
version: 2
local: true
outils:
  - id: pdf-merge
    nom: Fusionner des PDF
  - id: image-crop
    nom: Rogner une image
licence: null`;

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
        error: failure instanceof Error ? failure.message : "Document invalide.",
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
      error={result.error}
      layout="side-by-side"
      downloadName={producesYaml ? "sortie.yaml" : "sortie.json"}
      sample={action === "from-json" ? JSON_SAMPLE : YAML_SAMPLE}
    >
      <Fieldset columns={3}>
        <Field label="Opération">
          <OptionGroup
            ariaLabel="Opération"
            value={action}
            onChange={setAction}
            options={[
              { value: "format", label: "Formater" },
              { value: "to-json", label: "YAML → JSON" },
              { value: "from-json", label: "JSON → YAML" },
            ]}
          />
        </Field>
        <Field
          label="Indentation"
          hint={producesYaml && indentation === "tab" ? YAML_TAB_NOTE : undefined}
        >
          <OptionGroup
            ariaLabel="Indentation"
            value={indentation}
            onChange={setIndentation}
            options={INDENTATIONS}
          />
        </Field>
        <Field label="Clés">
          <CheckOption checked={sortKeys} onChange={setSortKeys} label="Trier alphabétiquement" />
        </Field>
      </Fieldset>

      <Callout tone="info" title="Lecture sûre">
        FourTout lit le YAML avec le schéma core de la norme 1.2 : chaînes, nombres, booléens,
        nuls, listes et dictionnaires. Aucun tag capable d'instancier un objet ou d'exécuter du
        code n'est accepté.
      </Callout>
    </TextToolShell>
  );
}

/* ------------------------------------------------------------------------ */

const XML_SAMPLE = `<?xml version="1.0" encoding="UTF-8"?><catalogue><outil id="pdf-merge"><nom>Fusionner des PDF</nom><categorie>PDF</categorie></outil><outil id="image-crop"><nom>Rogner une image</nom><categorie>Images</categorie></outil></catalogue>`;

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
        error: failure instanceof DataError ? failure.message : "Document XML invalide.",
        valid: false,
      };
    }
  }, [input, action, indentation]);

  return (
    <TextToolShell
      input={input}
      onInputChange={setInput}
      inputLabel="XML"
      outputLabel={action === "format" ? "XML formaté" : "XML minifié"}
      output={result.output}
      error={result.error}
      layout="side-by-side"
      downloadName="sortie.xml"
      sample={XML_SAMPLE}
      summary={
        result.valid
          ? `Document valide · ${input.length.toLocaleString("fr-FR")} → ${result.output.length.toLocaleString("fr-FR")} caractères`
          : undefined
      }
    >
      <Fieldset columns={2}>
        <Field label="Sortie">
          <OptionGroup
            ariaLabel="Sortie"
            value={action}
            onChange={setAction}
            options={[
              { value: "format", label: "Formater" },
              { value: "minify", label: "Minifier" },
            ]}
          />
        </Field>
        <Field label="Indentation">
          <OptionGroup
            ariaLabel="Indentation"
            value={indentation}
            onChange={setIndentation}
            disabled={action === "minify"}
            options={INDENTATIONS}
          />
        </Field>
      </Fieldset>

      <Callout tone="info" title="Entités externes refusées">
        Un document XML peut déclarer des entités qui pointent vers un fichier local ou une adresse
        réseau — c'est l'attaque dite XXE. FourTout refuse tout document qui en contient, plutôt que
        de compter sur la prudence du moteur d'analyse.
      </Callout>
    </TextToolShell>
  );
}
