import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { notify } from "@/features/notifications/store";
import type { ToolComponentProps } from "../implementations";
import { CASE_TRANSFORMS, type CaseKey } from "../logic/textCase";
import { t, tx } from "@/i18n";

export function TextCaseTool(_props: ToolComponentProps) {
  const [text, setText] = useState("");

  const apply = (key: CaseKey) => setText((current) => CASE_TRANSFORMS[key].apply(current));

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      notify.success(t("Texte copié"));
    } catch {
      notify.error(t("Copie impossible"), t("Le presse-papiers n'est pas accessible."));
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {(Object.keys(CASE_TRANSFORMS) as CaseKey[]).map((key) => (
          <Button key={key} size="sm" onClick={() => apply(key)} disabled={text.length === 0}>
            {tx(CASE_TRANSFORMS[key].label)}
          </Button>
        ))}
      </div>
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={t("Collez ou saisissez votre texte…")}
        aria-label={t("Texte à transformer")}
        className="min-h-56 w-full resize-y rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface)] p-3 font-mono text-sm outline-none focus:border-[var(--ft-accent)]"
      />
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={() => setText("")} disabled={!text}>
          {t("Effacer")}
        </Button>
        <Button size="sm" variant="primary" onClick={copy} disabled={!text}>
          {t("Copier")}
        </Button>
      </div>
    </div>
  );
}
