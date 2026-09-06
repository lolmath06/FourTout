import { useId, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Field } from "@/components/pdf/Field";

/**
 * Saisie d'un mot de passe destiné à une opération de chiffrement.
 *
 * Deux exigences que tous les écrans concernés partagent :
 *
 *  - **confirmation** à la création, parce qu'une faute de frappe sur un
 *    chiffrement produit un fichier que personne ne pourra jamais rouvrir ;
 *  - **affichage à la demande**, parce que taper une longue phrase secrète en
 *    aveugle est la meilleure façon de se tromper.
 *
 * Le mot de passe n'est jamais placé dans un formulaire soumis, ni enregistré,
 * ni proposé à l'autocomplétion du navigateur.
 */
export function PasswordField({
  value,
  onChange,
  confirmation,
  onConfirmationChange,
  label = "Mot de passe",
  hint,
  autoFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  /** Quand elle est fournie, la confirmation est exigée. */
  confirmation?: string;
  onConfirmationChange?: (value: string) => void;
  label?: string;
  hint?: string;
  autoFocus?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const id = useId();
  const requiresConfirmation = confirmation !== undefined && onConfirmationChange !== undefined;
  const mismatch = requiresConfirmation && confirmation.length > 0 && confirmation !== value;

  const inputClass =
    "h-[var(--ft-control)] w-full rounded-[var(--radius-md)] border border-[var(--ft-border-strong)] " +
    "bg-[var(--ft-bg)] px-2 font-mono text-[13px] outline-none transition-colors focus:border-[var(--ft-accent)]";

  return (
    <>
      <Field label={label} hint={hint}>
        <div className="flex items-center gap-2">
          <input
            id={id}
            type={visible ? "text" : "password"}
            value={value}
            autoFocus={autoFocus}
            autoComplete="new-password"
            spellCheck={false}
            onChange={(event) => onChange(event.target.value)}
            aria-label={label}
            data-testid="password-field"
            className={inputClass}
          />
          <Button
            size="sm"
            onClick={() => setVisible((current) => !current)}
            aria-label={visible ? "Masquer le mot de passe" : "Afficher le mot de passe"}
            title={visible ? "Masquer" : "Afficher"}
          >
            <Icon name={visible ? "EyeOff" : "Eye"} size={14} />
          </Button>
        </div>
      </Field>

      {requiresConfirmation && (
        <Field
          label="Confirmation"
          hint={mismatch ? "Les deux saisies diffèrent." : "Retapez le mot de passe."}
        >
          <input
            type={visible ? "text" : "password"}
            value={confirmation}
            autoComplete="new-password"
            spellCheck={false}
            onChange={(event) => onConfirmationChange(event.target.value)}
            aria-label="Confirmation du mot de passe"
            data-testid="password-confirmation"
            className={
              mismatch ? `${inputClass} border-[var(--ft-danger)]` : inputClass
            }
          />
        </Field>
      )}
    </>
  );
}

/** Le mot de passe est-il utilisable pour lancer l'opération ? */
export function passwordReady(value: string, confirmation?: string): boolean {
  if (value.length === 0) return false;
  return confirmation === undefined || confirmation === value;
}
