import { useState } from "react";
import { PdfToolShell } from "@/components/pdf/PdfToolShell";
import { singleResult } from "@/components/pdf/result";
import { Field, Fieldset, TextInput } from "@/components/pdf/Field";
import { unlockPdf } from "@/core/pdf/operations/protect";
import { Icon } from "@/components/ui/Icon";
import type { ToolComponentProps } from "@/tools/implementations";

export function PdfUnlockTool({ tool }: ToolComponentProps) {
  const [password, setPassword] = useState("");

  return (
    <div className="space-y-4">
      <p className="flex items-start gap-2 rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface-2)] px-3 py-2.5 text-xs text-[var(--ft-text-muted)]">
        <Icon name="ShieldCheck" size={14} className="mt-px shrink-0" />
        FourTout ne casse aucune protection : le mot de passe du document est indispensable. Le
        fichier d'origine n'est pas modifié, une copie déverrouillée est créée.
      </p>

      <PdfToolShell
        tool={tool}
        actionLabel="Déverrouiller"
        actionDisabled={password.length === 0}
        acceptProtected
        hint="Déposez le PDF protégé, puis saisissez son mot de passe."
        run={async ({ documents }) => {
          const output = await unlockPdf(documents[0].source, password);
          return singleResult(output, "Copie sans mot de passe créée.");
        }}
      >
        {() => (
          <Fieldset columns={1}>
            <Field label="Mot de passe du document">
              <TextInput
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Mot de passe connu"
                aria-label="Mot de passe du document"
                autoComplete="off"
              />
            </Field>
          </Fieldset>
        )}
      </PdfToolShell>
    </div>
  );
}
