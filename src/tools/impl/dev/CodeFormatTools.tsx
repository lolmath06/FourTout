import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Callout } from "@/components/ui/Callout";
import { Field, Fieldset, OptionGroup, Select } from "@/components/pdf/Field";
import { TextToolShell } from "@/components/text/TextToolShell";
import {
  DEFAULT_SQL_SETTINGS,
  compactSql,
  formatSql,
  SQL_DIALECTS,
  SQL_NOTE,
  type KeywordCase,
} from "@/core/code/sql";
import {
  detectLanguage,
  formatWeb,
  HTML_MINIFY_NOTE,
  LANGUAGE_LABELS,
  MAX_SOURCE_BYTES,
  minifyWeb,
  type IndentStyle,
  type WebLanguage,
} from "@/core/code/web";
import { formatFileSize } from "@/core/files";
import type { ToolComponentProps } from "@/tools/implementations";
import { localized, t, tx } from "@/i18n";

const INDENTS: { value: IndentStyle; label: string }[] = localized(() => [
  { value: "2", label: t("2 espaces") },
  { value: "4", label: t("4 espaces") },
  { value: "tab", label: t("Tabulation") },
]);

const LANGUAGES: { value: WebLanguage; label: string }[] = (
  Object.keys(LANGUAGE_LABELS) as WebLanguage[]
).map((value) => ({ value, label: LANGUAGE_LABELS[value] }));

const SQL_SAMPLE =
  "select c.nom, count(f.id) as total from clients c join factures f on f.client_id = c.id " +
  "where f.date >= '2026-01-01' and f.statut in ('payee','en_attente') group by c.nom " +
  "having count(f.id) > 3 order by total desc limit 20";

/**
 * Formatage SQL.
 *
 * Aucune connexion, aucune exécution : la requête est réécrite, point. Les
 * dialectes proposés sont ceux que la bibliothèque sait réellement analyser.
 */
export function SqlFormatTool(_props: ToolComponentProps) {
  const [input, setInput] = useState("");
  const [settings, setSettings] = useState(DEFAULT_SQL_SETTINGS);
  const [action, setAction] = useState<"format" | "compact">("format");

  let output = "";
  let error: string | undefined;
  if (input.trim().length > 0) {
    try {
      output = action === "format" ? formatSql(input, settings) : compactSql(input);
    } catch (failure) {
      error = failure instanceof Error ? failure.message : t("Requête non analysable.");
    }
  }

  return (
    <TextToolShell
      input={input}
      onInputChange={setInput}
      inputLabel={t("Requête SQL")}
      outputLabel={action === "format" ? t("Requête formatée") : t("Requête sur une ligne")}
      output={output}
      error={tx(error)}
      layout="side-by-side"
      downloadName="requete.sql"
      sample={SQL_SAMPLE}
    >
      <Fieldset columns={2}>
        <Field label={t("Sortie")}>
          <OptionGroup
            ariaLabel={t("Sortie")}
            value={action}
            onChange={setAction}
            options={[
              { value: "format", label: t("Formater") },
              { value: "compact", label: t("Une seule ligne") },
            ]}
          />
        </Field>
        <Field
          label={t("Dialecte")}
          hint={tx(SQL_DIALECTS.find((d) => d.value === settings.dialect)?.hint)}
        >
          <Select
            value={settings.dialect}
            onChange={(dialect) => setSettings((current) => ({ ...current, dialect }))}
            aria-label={t("Dialecte SQL")}
            options={SQL_DIALECTS.map((dialect) => ({
              value: dialect.value,
              label: dialect.label,
            }))}
          />
        </Field>
        <Field label={t("Mots-clés")}>
          <OptionGroup
            ariaLabel={t("Casse des mots-clés")}
            value={settings.keywordCase}
            onChange={(keywordCase: KeywordCase) =>
              setSettings((current) => ({ ...current, keywordCase }))
            }
            disabled={action === "compact"}
            options={[
              { value: "upper", label: "MAJUSCULES" },
              { value: "lower", label: "minuscules" },
              { value: "preserve", label: t("Inchangés") },
            ]}
          />
        </Field>
        <Field label={t("Indentation")}>
          <OptionGroup
            ariaLabel={t("Indentation")}
            value={settings.indentation}
            onChange={(indentation) => setSettings((current) => ({ ...current, indentation }))}
            disabled={action === "compact"}
            options={INDENTS}
          />
        </Field>
      </Fieldset>

      <Callout tone="info" title={t("Aucune exécution")}>
        {SQL_NOTE}
      </Callout>
    </TextToolShell>
  );
}

/* ------------------------------------------------------------------------ */

const WEB_SAMPLE = `const total=(a,b)=>{return a+b}
function saluer(nom){
if(!nom){return "Bonjour"}
  return \`Bonjour \${nom}\`}
console.log(saluer("FourTout"),total(1,2))`;

/**
 * Formatage HTML, CSS et JavaScript.
 *
 * Le moteur est Prettier, chargé **à la demande** : il pèse plus lourd que le
 * reste de l'application, et l'utilisateur qui ouvre un convertisseur d'unités
 * n'a aucune raison de le télécharger.
 */
export function WebBeautifyTool(_props: ToolComponentProps) {
  const [input, setInput] = useState("");
  const [language, setLanguage] = useState<WebLanguage>("js");
  const [indentation, setIndentation] = useState<IndentStyle>("2");
  const [auto, setAuto] = useState(true);
  const [output, setOutput] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  // Le langage suit la saisie tant que l'utilisateur ne l'a pas fixé lui-même.
  useEffect(() => {
    if (auto && input.trim().length > 0) setLanguage(detectLanguage(input));
  }, [auto, input]);

  useEffect(() => {
    let cancelled = false;
    if (input.trim().length === 0) {
      setOutput("");
      setError(undefined);
      return;
    }
    setBusy(true);
    void formatWeb(input, language, { indentation })
      .then((result) => {
        if (cancelled) return;
        setOutput(result);
        setError(undefined);
      })
      .catch((failure: unknown) => {
        if (cancelled) return;
        setOutput("");
        setError(failure instanceof Error ? failure.message : t("Formatage impossible."));
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [input, language, indentation]);

  return (
    <TextToolShell
      input={input}
      onInputChange={setInput}
      inputLabel={t("Code source")}
      outputLabel={t("{value} formaté", { value: LANGUAGE_LABELS[language] })}
      output={output}
      error={tx(error)}
      layout="side-by-side"
      downloadName={`formate.${language === "js" ? "js" : language}`}
      sample={WEB_SAMPLE}
      summary={busy ? t("Formatage en cours…") : undefined}
    >
      <Fieldset columns={2}>
        <Field label={t("Langage")} hint={auto ? t("Détecté automatiquement.") : undefined}>
          <Select
            value={language}
            onChange={(value) => {
              setAuto(false);
              setLanguage(value);
            }}
            aria-label={t("Langage")}
            options={LANGUAGES}
          />
        </Field>
        <Field label={t("Indentation")}>
          <OptionGroup
            ariaLabel={t("Indentation")}
            value={indentation}
            onChange={setIndentation}
            options={INDENTS}
          />
        </Field>
      </Fieldset>
    </TextToolShell>
  );
}

/* ------------------------------------------------------------------------ */

/**
 * Minification HTML, CSS et JavaScript.
 *
 * Le contrat est clair : réduire la taille **sans changer le comportement**.
 * C'est pourquoi la minification HTML reste conservatrice, et pourquoi un
 * script en ligne qui ressemble à un gabarit serveur n'est pas touché.
 */
export function WebMinifyTool(_props: ToolComponentProps) {
  const [input, setInput] = useState("");
  const [language, setLanguage] = useState<WebLanguage>("js");
  const [auto, setAuto] = useState(true);
  const [output, setOutput] = useState("");
  const [stats, setStats] = useState<{ before: number; after: number; saved: number } | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (auto && input.trim().length > 0) setLanguage(detectLanguage(input));
  }, [auto, input]);

  const run = async () => {
    if (input.trim().length === 0) return;
    if (new TextEncoder().encode(input).length > MAX_SOURCE_BYTES) {
      setError(t("Le code dépasse {size} : réduisez l'échantillon.", { size: formatFileSize(MAX_SOURCE_BYTES) }));
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const result = await minifyWeb(input, language);
      setOutput(result.code);
      setStats({
        before: result.originalBytes,
        after: result.minifiedBytes,
        saved: result.savedPercent,
      });
    } catch (failure) {
      setOutput("");
      setStats(undefined);
      setError(failure instanceof Error ? failure.message : t("Minification impossible."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <TextToolShell
      input={input}
      onInputChange={(value) => {
        setInput(value);
        setOutput("");
        setStats(undefined);
      }}
      inputLabel={t("Code source")}
      outputLabel={t("{value} minifié", { value: LANGUAGE_LABELS[language] })}
      output={output}
      error={tx(error)}
      layout="side-by-side"
      downloadName={`minifie.min.${language === "js" ? "js" : language}`}
      sample={WEB_SAMPLE}
      summary={
        stats
          ? t("{size} → {size2} · {value} % de gain", { size: formatFileSize(stats.before), size2: formatFileSize(stats.after), value: stats.saved.toFixed(1) })
          : undefined
      }
      actions={
        <Button size="md" variant="primary" onClick={() => void run()} disabled={busy || input.trim().length === 0}>
          <Icon name={busy ? "Loader" : "Play"} size={15} className={busy ? "animate-spin" : undefined} />
          {busy ? t("Minification…") : t("Minifier")}
        </Button>
      }
    >
      <Fieldset columns={1}>
        <Field label={t("Langage")} hint={auto ? t("Détecté automatiquement.") : undefined}>
          <Select
            value={language}
            onChange={(value) => {
              setAuto(false);
              setLanguage(value);
            }}
            aria-label={t("Langage")}
            options={LANGUAGES}
          />
        </Field>
      </Fieldset>

      {language === "html" && (
        <Callout tone="info" title={t("Minification HTML conservatrice")}>
          {HTML_MINIFY_NOTE}
        </Callout>
      )}
    </TextToolShell>
  );
}
