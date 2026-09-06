import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Callout } from "@/components/ui/Callout";
import { notify } from "@/features/notifications/store";

/**
 * Ossature commune aux calculateurs et convertisseurs.
 *
 * Les dix-sept outils Calculateurs partagent les mêmes gestes : saisir,
 * lire un résultat mis en avant, le copier, comprendre comment il a été
 * obtenu. Les factoriser ici évite dix-sept mises en page différentes pour la
 * même chose — et garantit qu'un résultat se copie partout de la même façon.
 */

/** Bloc de résultat : le chiffre domine, la formule le justifie. */
export function ResultBlock({
  value,
  unit,
  formula,
  secondary,
  tone = "normal",
}: {
  value: string;
  unit?: string;
  /** Comment le résultat a été obtenu, pour qu'il soit vérifiable. */
  formula?: string;
  /** Lectures complémentaires du même résultat. */
  secondary?: { label: string; value: string }[];
  tone?: "normal" | "muted";
}) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      notify.success("Résultat copié");
    } catch {
      notify.error("Copie impossible", "Le presse-papiers n'est pas accessible.");
    }
  };

  return (
    <section className="rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface)]">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 px-3 py-2.5">
        <output
          data-testid="calc-result"
          className={`ft-num text-[22px] font-semibold leading-tight tracking-tight ${
            tone === "muted" ? "text-[var(--ft-text-muted)]" : ""
          }`}
        >
          {value}
        </output>
        {unit && <span className="text-[15px] text-[var(--ft-text-muted)]">{unit}</span>}
        <div className="flex-1" />
        <Button size="sm" variant="ghost" onClick={copy} aria-label="Copier le résultat">
          <Icon name="Copy" size={13} /> Copier
        </Button>
      </div>
      {formula && (
        <p className="ft-value border-t border-[var(--ft-rule)] px-3 py-1.5 text-[var(--ft-text-muted)]">
          {formula}
        </p>
      )}
      {secondary && secondary.length > 0 && (
        <dl className="ft-props border-t border-[var(--ft-rule)] px-3 py-2">
          {secondary.map((entry) => (
            <Fragment key={entry.label} label={entry.label} value={entry.value} />
          ))}
        </dl>
      )}
    </section>
  );
}

function Fragment({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd className="ft-value">{value}</dd>
    </>
  );
}

/** Table de valeurs : libellé, valeur, unité. Utilisée par les convertisseurs. */
export function ValueTable({
  rows,
  caption,
}: {
  rows: { label: string; value: string; hint?: string; highlight?: boolean }[];
  caption?: string;
}) {
  return (
    <section className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface)]">
      {caption && (
        <h3 className="ft-section border-b border-[var(--ft-rule)] px-3 py-1.5">{caption}</h3>
      )}
      <div className="overflow-x-auto">
        <table className="ft-table">
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <th scope="row" className="w-1/2 font-normal">
                  {row.label}
                  {row.hint && (
                    <span className="ml-1.5 text-[10.5px] text-[var(--ft-text-faint)]">
                      {row.hint}
                    </span>
                  )}
                </th>
                <td
                  className={`ft-value text-right ${
                    row.highlight ? "font-semibold text-[var(--ft-text)]" : ""
                  }`}
                >
                  {row.value}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** Message d'erreur de saisie, dans la forme commune à toute l'application. */
export function InputError({ message }: { message?: string }) {
  if (!message) return null;
  return <Callout tone="error">{message}</Callout>;
}

/** Bouton « copier » discret, pour une valeur isolée. */
export function CopyButton({
  value,
  label = "Copier",
  disabled,
}: {
  value: string;
  label?: string;
  disabled?: boolean;
}) {
  const [done, setDone] = useState(false);
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={disabled || value.length === 0}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          window.setTimeout(() => setDone(false), 1200);
        } catch {
          notify.error("Copie impossible", "Le presse-papiers n'est pas accessible.");
        }
      }}
    >
      <Icon name={done ? "Check" : "Copy"} size={13} />
      {done ? "Copié" : label}
    </Button>
  );
}
