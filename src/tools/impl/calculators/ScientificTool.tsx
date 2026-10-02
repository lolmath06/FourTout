import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Field, Fieldset, OptionGroup, TextInput } from "@/components/pdf/Field";
import { Callout } from "@/components/ui/Callout";
import { InputError, ResultBlock } from "@/components/calc/CalcShell";
import {
  CONSTANT_NAMES,
  evaluateExpression,
  ExpressionError,
  FUNCTION_NAMES,
  type AngleMode,
} from "@/core/calc/expression";
import { formatWithGrouping } from "@/core/units";
import type { ToolComponentProps } from "@/tools/implementations";
import { Trans, localized, t, tx } from "@/i18n";

interface HistoryEntry {
  expression: string;
  value: number;
}

/** Touches proposées : celles qui se tapent mal au clavier. */
const KEYS: { label: string; insert: string }[] = localized(() => [
  { label: "π", insert: "pi" },
  { label: "e", insert: "e" },
  { label: "√", insert: "sqrt(" },
  { label: "x²", insert: "^2" },
  { label: t("xʸ"), insert: "^" },
  { label: "n!", insert: "!" },
  { label: "sin", insert: "sin(" },
  { label: "cos", insert: "cos(" },
  { label: "tan", insert: "tan(" },
  { label: "ln", insert: "ln(" },
  { label: "log", insert: "log(" },
  { label: "( )", insert: "()" },
]);

/**
 * Calculatrice scientifique.
 *
 * L'expression est **analysée**, jamais évaluée par le moteur JavaScript :
 * dans une application qui a accès au système de fichiers, `eval` sur une
 * chaîne saisie serait une porte ouverte. Voir `core/calc/expression`.
 */
export function ScientificCalculatorTool(_props: ToolComponentProps) {
  const [expression, setExpression] = useState("");
  const [mode, setMode] = useState<AngleMode>("deg");
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  let value: number | undefined;
  let error: string | undefined;
  let position: number | undefined;
  if (expression.trim().length > 0) {
    try {
      value = evaluateExpression(expression, mode).value;
    } catch (failure) {
      error = failure instanceof Error ? failure.message : t("Expression invalide.");
      position = failure instanceof ExpressionError ? failure.position : undefined;
    }
  }

  const remember = () => {
    if (value === undefined) return;
    setHistory((entries) => [{ expression, value }, ...entries].slice(0, 20));
  };

  const append = (text: string) => setExpression((current) => current + text);

  return (
    <div className="space-y-4">
      <Fieldset columns={1}>
        <Field
          label={t("Expression")}
          hint={t("Entrée pour mémoriser le calcul. Les fonctions à deux arguments s'écrivent f(a ; b).")}
        >
          <TextInput
            value={expression}
            autoFocus
            spellCheck={false}
            placeholder={t("ex. : (2 + 3) × sqrt(16) - 5!")}
            onChange={(event) => setExpression(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") remember();
            }}
            aria-label={t("Expression à calculer")}
            data-testid="calc-expression"
            className="font-mono"
          />
        </Field>
      </Fieldset>

      <div className="flex flex-wrap items-center gap-1.5">
        {KEYS.map((key) => (
          <Button key={key.label} size="sm" onClick={() => append(key.insert)}>
            {tx(key.label)}
          </Button>
        ))}
        <div className="flex-1" />
        <OptionGroup
          ariaLabel={t("Unité d'angle")}
          value={mode}
          onChange={setMode}
          options={[
            { value: "deg", label: t("Degrés") },
            { value: "rad", label: t("Radians") },
          ]}
        />
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setExpression("")}
          disabled={expression.length === 0}
        >
          <Icon name="Eraser" size={13} />{" "}{t("Effacer")}
        </Button>
      </div>

      <InputError
        message={
          error
            ? position !== undefined
              ? t("{error} (caractère {value})", { error, value: position + 1 })
              : error
            : undefined
        }
      />

      {value !== undefined && (
        <ResultBlock
          value={formatWithGrouping(value, 14)}
          formula={expression}
          secondary={[
            { label: t("Valeur brute"), value: String(value) },
            {
              label: t("Notation scientifique"),
              value: value === 0 ? "0" : value.toExponential(6),
            },
          ]}
        />
      )}

      {history.length > 0 && (
        <section className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface)]">
          <div className="flex items-center gap-2 border-b border-[var(--ft-rule)] px-3 py-1.5">
            <h3 className="ft-section flex-1">{t("Historique de la session")}</h3>
            <Button size="sm" variant="ghost" onClick={() => setHistory([])}>
              {t("Vider")}
            </Button>
          </div>
          <ul className="divide-y divide-[var(--ft-rule)]">
            {history.map((entry, index) => (
              <li key={`${entry.expression}-${index}`} className="ft-row-py flex items-baseline gap-3 px-3">
                <button
                  type="button"
                  onClick={() => setExpression(entry.expression)}
                  className="ft-value min-w-0 flex-1 truncate text-left text-[var(--ft-text-muted)] hover:text-[var(--ft-text)]"
                  title={t("Reprendre cette expression")}
                >
                  {entry.expression}
                </button>
                <span className="ft-value shrink-0 font-medium">
                  {formatWithGrouping(entry.value, 14)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Callout tone="neutral" title={t("Fonctions disponibles")}>
        <p className="ft-value">{FUNCTION_NAMES.join(", ")}</p>
        <p className="mt-1">
          <Trans source={"Constantes : <0>{value}</0>. L'expression est analysée par FourTout, jamais exécutée comme du code."} values={{ value: CONSTANT_NAMES.join(", ") }} components={[<span className="ft-value" />]} />
        </p>
      </Callout>
    </div>
  );
}
