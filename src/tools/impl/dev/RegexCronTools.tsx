import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Callout } from "@/components/ui/Callout";
import { Field, Fieldset, OptionGroup, TextInput } from "@/components/pdf/Field";
import { CheckOption, TextPane } from "@/components/text/TextToolShell";
import { InputError, ResultBlock, ValueTable } from "@/components/calc/CalcShell";
import { FLAGS, MAX_MATCHES, type RegexRun } from "@/core/code/regex";
import { isIsolated, replaceAllIsolated, runRegexIsolated } from "@/core/code/regexRunner";
import { buildCron, CRON_PRESETS, explainCron, type CronField } from "@/core/code/cron";
import type { ToolComponentProps } from "@/tools/implementations";

const REGEX_SAMPLE = `Contact : marie.durand@exemple.fr
Support : support@fourtout.test
Ancien : ne-plus-utiliser@exemple.fr (2024-03-14)
Facture 2026-01-05 · montant 1 249,90 €`;

/**
 * Testeur d'expressions régulières.
 *
 * Le moteur d'expressions régulières de JavaScript n'est pas interruptible :
 * `(a+)+$` sur trente et un caractères occupe déjà le processeur pendant
 * plusieurs secondes, et aucun compteur ne peut l'arrêter en cours de route.
 * L'exécution part donc dans un worker, que l'on tue au bout de deux secondes
 * — c'est la seule interruption qui existe réellement. S'y ajoutent les bornes
 * de `runRegex` : taille du sujet et nombre de correspondances.
 */
export function RegexTesterTool(_props: ToolComponentProps) {
  const [pattern, setPattern] = useState("(\\w+)@([\\w.]+)\\.(fr|test)");
  const [flags, setFlags] = useState<string[]>(["g", "m"]);
  const [subject, setSubject] = useState(REGEX_SAMPLE);
  const [replacement, setReplacement] = useState("");
  const [showReplace, setShowReplace] = useState(false);

  const flagString = flags.join("");

  const [run, setRun] = useState<{ value?: RegexRun; error?: string } | undefined>(undefined);
  const [running, setRunning] = useState(false);
  const [replaced, setReplaced] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (pattern.length === 0) {
      setRun(undefined);
      setRunning(false);
      return;
    }
    let abandoned = false;
    setRunning(true);
    runRegexIsolated(pattern, flagString, subject)
      .then((value) => {
        if (!abandoned) setRun({ value });
      })
      .catch((failure: unknown) => {
        if (abandoned) return;
        setRun({
          error: failure instanceof Error ? failure.message : "Expression invalide.",
        });
      })
      .finally(() => {
        if (!abandoned) setRunning(false);
      });
    return () => {
      abandoned = true;
    };
  }, [pattern, flagString, subject]);

  useEffect(() => {
    if (!showReplace || !run?.value) {
      setReplaced(undefined);
      return;
    }
    let abandoned = false;
    replaceAllIsolated(pattern, flagString, subject, replacement)
      .then((value) => {
        if (!abandoned) setReplaced(value);
      })
      .catch(() => {
        if (!abandoned) setReplaced(undefined);
      });
    return () => {
      abandoned = true;
    };
  }, [showReplace, run, pattern, flagString, subject, replacement]);

  const toggleFlag = (flag: string) =>
    setFlags((current) =>
      current.includes(flag) ? current.filter((value) => value !== flag) : [...current, flag],
    );

  return (
    <div className="space-y-4">
      <Fieldset columns={1} title="Expression">
        <Field label="Motif">
          <TextInput
            value={pattern}
            autoFocus
            spellCheck={false}
            onChange={(event) => setPattern(event.target.value)}
            aria-label="Expression régulière"
            data-testid="regex-pattern"
            className="font-mono"
          />
        </Field>
        <Field label="Options">
          <div className="flex flex-wrap gap-1.5">
            {FLAGS.map((flag) => (
              <button
                key={flag.value}
                type="button"
                title={flag.hint}
                aria-pressed={flags.includes(flag.value)}
                onClick={() => toggleFlag(flag.value)}
                className={
                  flags.includes(flag.value)
                    ? "ft-value h-[var(--ft-control-sm)] rounded-[var(--radius-md)] border border-[var(--ft-accent)] bg-[var(--ft-accent-quiet)] px-2 font-semibold text-[var(--ft-accent-text)]"
                    : "ft-value h-[var(--ft-control-sm)] rounded-[var(--radius-md)] border border-[var(--ft-border-strong)] px-2 text-[var(--ft-text-muted)] hover:bg-[var(--ft-hover)]"
                }
              >
                {flag.label}
              </button>
            ))}
          </div>
        </Field>
      </Fieldset>

      <TextPane
        label="Texte de test"
        value={subject}
        onChange={setSubject}
        placeholder="Collez le texte sur lequel tester l'expression…"
        minHeight="10rem"
      />

      <InputError message={run?.error} />

      {!isIsolated() && (
        <Callout tone="warning" title="Protection réduite dans cet environnement">
          Le fil d'exécution isolé n'est pas disponible ici : une expression à retour sur trace
          catastrophique peut figer la fenêtre le temps de son calcul.
        </Callout>
      )}

      {running && !run && (
        <p className="ft-value text-[var(--ft-text-muted)]">Recherche en cours…</p>
      )}

      {run?.value && (
        <>
          <ResultBlock
            value={String(run.value.matches.length)}
            unit={run.value.matches.length > 1 ? "correspondances" : "correspondance"}
            tone={run.value.matches.length === 0 ? "muted" : "normal"}
            formula={`/${pattern}/${flagString} · ${run.value.groupCount} groupe${run.value.groupCount > 1 ? "s" : ""} capturant${run.value.groupCount > 1 ? "s" : ""}${run.value.groupNames.length > 0 ? ` (${run.value.groupNames.join(", ")})` : ""} · ${run.value.elapsedMs.toFixed(1)} ms`}
          />

          {run.value.truncated && (
            <Callout tone="warning" title="Recherche interrompue">
              {run.value.truncationReason}
            </Callout>
          )}

          {run.value.matches.length > 0 && (
            <section className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface)]">
              <h3 className="ft-section border-b border-[var(--ft-rule)] px-3 py-1.5">
                Correspondances{run.value.matches.length > MAX_MATCHES ? ` (${MAX_MATCHES} premières)` : ""}
              </h3>
              <div className="max-h-96 overflow-y-auto">
                <table className="ft-table">
                  <thead>
                    <tr>
                      <th className="w-16">Ligne</th>
                      <th className="w-20">Index</th>
                      <th>Correspondance</th>
                      <th>Groupes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {run.value.matches.map((match, index) => (
                      <tr key={`${match.index}-${index}`}>
                        <td className="ft-value">{match.line}</td>
                        <td className="ft-value">{match.index}</td>
                        <td className="ft-value break-all text-[var(--ft-text)]">{match.value}</td>
                        <td className="ft-value break-all text-[var(--ft-text-muted)]">
                          {match.groups.length === 0
                            ? "—"
                            : match.groups
                                .map(
                                  (group) =>
                                    `${group.name ?? group.index}: ${group.value ?? "(vide)"}`,
                                )
                                .join(" · ")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <Fieldset columns={1}>
            <Field label="Remplacement">
              <div className="space-y-2">
                <CheckOption
                  checked={showReplace}
                  onChange={setShowReplace}
                  label="Tester un remplacement"
                  hint="Motifs acceptés : $1, $<nom>, $&. Aucune fonction n'est évaluée."
                />
                {showReplace && (
                  <TextInput
                    value={replacement}
                    onChange={(event) => setReplacement(event.target.value)}
                    placeholder="[$1]"
                    aria-label="Chaîne de remplacement"
                    className="font-mono"
                  />
                )}
              </div>
            </Field>
          </Fieldset>

          {showReplace && replaced !== undefined && (
            <TextPane label="Résultat du remplacement" value={replaced} readOnly droppable={false} />
          )}
        </>
      )}
    </div>
  );
}

/* ==================================================================== */
/* Cron                                                                  */
/* ==================================================================== */

const FIELD_KEYS: CronField["key"][] = ["minute", "hour", "dayOfMonth", "month", "dayOfWeek"];

/**
 * Assistant cron.
 *
 * Deux usages dans un seul écran : construire une expression champ par champ,
 * ou coller celle qu'on a trouvée dans un fichier et la comprendre. Les deux
 * partagent le même affichage, parce que c'est la même information.
 */
export function CronTool(_props: ToolComponentProps) {
  const [expression, setExpression] = useState("0 9 * * 1-5");
  const [mode, setMode] = useState<"explain" | "build">("explain");
  const [fields, setFields] = useState<Record<CronField["key"], string>>({
    minute: "0",
    hour: "9",
    dayOfMonth: "*",
    month: "*",
    dayOfWeek: "1-5",
  });

  const active = mode === "build" ? buildCron(fields) : expression;

  const result = useMemo(() => {
    try {
      return { value: explainCron(active, new Date()), error: undefined };
    } catch (failure) {
      return {
        value: undefined,
        error: failure instanceof Error ? failure.message : "Expression cron invalide.",
      };
    }
  }, [active]);

  return (
    <div className="space-y-4">
      <Fieldset columns={1}>
        <Field label="Mode">
          <OptionGroup
            ariaLabel="Mode"
            value={mode}
            onChange={setMode}
            options={[
              { value: "explain", label: "Expliquer" },
              { value: "build", label: "Construire" },
            ]}
          />
        </Field>
      </Fieldset>

      {mode === "explain" ? (
        <>
          <Fieldset columns={1}>
            <Field label="Expression cron" hint="Cinq champs : minute, heure, jour du mois, mois, jour de la semaine.">
              <TextInput
                value={expression}
                autoFocus
                spellCheck={false}
                onChange={(event) => setExpression(event.target.value)}
                aria-label="Expression cron"
                data-testid="cron-expression"
                className="font-mono"
              />
            </Field>
          </Fieldset>
          <div className="flex flex-wrap gap-1.5">
            {CRON_PRESETS.map((preset) => (
              <Button key={preset.expression} size="sm" onClick={() => setExpression(preset.expression)}>
                {preset.label}
              </Button>
            ))}
          </div>
        </>
      ) : (
        <Fieldset columns={3} title="Champs">
          {FIELD_KEYS.map((key) => {
            const definition = result.value?.fields.find((field) => field.key === key);
            return (
              <Field
                key={key}
                label={definition?.label ?? key}
                hint={definition?.range}
              >
                <TextInput
                  value={fields[key]}
                  spellCheck={false}
                  onChange={(event) =>
                    setFields((current) => ({ ...current, [key]: event.target.value }))
                  }
                  aria-label={definition?.label ?? key}
                  className="font-mono"
                />
              </Field>
            );
          })}
        </Fieldset>
      )}

      <InputError message={result.error} />

      {result.value && (
        <>
          <ResultBlock value={result.value.description} formula={result.value.expression} />

          {result.value.warnings.map((warning) => (
            <Callout key={warning} tone="warning">
              {warning}
            </Callout>
          ))}

          <ValueTable
            caption="Champs"
            rows={result.value.fields.map((field) => ({
              label: field.label,
              hint: field.range,
              value: field.value,
            }))}
          />

          {result.value.occurrences.length > 0 && (
            <ValueTable
              caption="Prochaines exécutions"
              rows={result.value.occurrences.map((date, index) => ({
                label: `Exécution ${index + 1}`,
                value: date.toLocaleString("fr-FR", { dateStyle: "full", timeStyle: "short" }),
              }))}
            />
          )}

          <p className="ft-meta flex items-start gap-1.5">
            <Icon name="Info" size={12} className="mt-0.5 shrink-0" />
            FourTout ne planifie et n'exécute rien : l'expression est seulement lue et expliquée.
          </p>
        </>
      )}
    </div>
  );
}
