import { useState } from "react";
import { PdfToolShell } from "@/components/pdf/PdfToolShell";
import { singleResult } from "@/components/pdf/result";
import { Field, Fieldset, TextInput } from "@/components/pdf/Field";
import { protectPdf } from "@/core/pdf/operations/protect";
import { Icon } from "@/components/ui/Icon";
import type { ToolComponentProps } from "@/tools/implementations";

export function PdfProtectTool({ tool }: ToolComponentProps) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");

  const mismatch = confirmation.length > 0 && password !== confirmation;
  const ready = password.length > 0 && password === confirmation;

  return (
    <div className="space-y-4">
      <p className="flex items-start gap-2 rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface-2)] px-3 py-2.5 text-xs text-[var(--ft-text-muted)]">
        <Icon name="ShieldCheck" size={14} className="mt-px shrink-0" />
        Chiffrement AES-256 conforme à la norme PDF (ISO 32000-2), appliqué sur votre machine. Le
        mot de passe n'est enregistré nulle part : s'il est perdu, le document devient
        définitivement illisible.
      </p>

      <PdfToolShell
        tool={tool}
        actionLabel="Protéger le document"
        actionDisabled={!ready}
        run={async ({ documents }) => {
          const output = await protectPdf(documents[0].source, { userPassword: password });
          return singleResult(
            output,
            "Copie chiffrée créée ; le fichier d'origine reste inchangé.",
          );
        }}
      >
        {() => (
          <Fieldset>
            <Field label="Mot de passe">
              <TextInput
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Mot de passe d'ouverture"
                aria-label="Mot de passe"
                autoComplete="new-password"
              />
            </Field>
            <Field label="Confirmation">
              <TextInput
                type="password"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                placeholder="Saisissez-le à nouveau"
                aria-label="Confirmation du mot de passe"
                autoComplete="new-password"
              />
            </Field>

            {mismatch && (
              <p className="text-xs text-[var(--ft-danger)] sm:col-span-full">
                Les deux mots de passe ne correspondent pas.
              </p>
            )}

            <p className="flex items-start gap-1.5 text-xs text-[var(--ft-warn)] sm:col-span-full">
              <Icon name="TriangleAlert" size={13} className="mt-0.5 shrink-0" />
              Le titre, l'auteur et les mots-clés ne sont pas conservés dans la copie protégée.
              Réglez-les après le déverrouillage si vous en avez besoin.
            </p>
          </Fieldset>
        )}
      </PdfToolShell>
    </div>
  );
}
