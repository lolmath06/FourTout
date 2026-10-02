import { useState } from "react";
import { PdfToolShell } from "@/components/pdf/PdfToolShell";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { extractText, joinPages, textToFile } from "@/core/pdf/operations/extractText";
import { notify } from "@/features/notifications/store";
import type { ToolComponentProps } from "@/tools/implementations";
import { formatNumber, t } from "@/i18n";

export function PdfExtractTextTool({ tool }: ToolComponentProps) {
  const [preview, setPreview] = useState<{ text: string; emptyPages: number; pages: number } | null>(
    null,
  );

  const copy = async () => {
    if (!preview) return;
    try {
      await navigator.clipboard.writeText(preview.text);
      notify.success(t("Texte copié"));
    } catch {
      notify.error(t("Copie impossible"), t("Le presse-papiers n'est pas accessible."));
    }
  };

  return (
    <div className="space-y-4">
      <p className="flex items-start gap-2 rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface-2)] px-3 py-2.5 text-xs text-[var(--ft-text-muted)]">
        <Icon name="Info" size={14} className="mt-px shrink-0" />
        {t("Cet outil récupère le texte réellement enregistré dans le PDF. Une page scannée ne contient qu'une image : elle ne produira aucun texte. La reconnaissance de caractères (OCR) fera l'objet d'un outil distinct.")}
      </p>

      <PdfToolShell
        tool={tool}
        actionLabel={t("Extraire le texte")}
        run={async ({ documents, context }) => {
          const [document] = documents;
          const extracted = await extractText(document.source, context);
          setPreview({
            text: joinPages(extracted),
            emptyPages: extracted.emptyPages,
            pages: extracted.pages.length,
          });

          const file = textToFile(document.source, extracted);
          return {
            files: [file],
            summary: t("{value} caractères extraits de {count} page(s).", { value: formatNumber(extracted.totalCharacters), count: extracted.pages.length }),
            warning:
              extracted.emptyPages > 0
                ? t("{emptyPages} page(s) n'ont produit aucun texte : elles sont probablement scannées.", { emptyPages: extracted.emptyPages })
                : undefined,
          };
        }}
      />

      {preview && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--ft-text-muted)]">
              {t("Texte extrait")}
            </h3>
            <Button size="sm" onClick={copy}>
              <Icon name="Check" size={13} />
              {t("Copier")}
            </Button>
          </div>
          <textarea
            readOnly
            value={preview.text}
            aria-label={t("Texte extrait")}
            className="min-h-64 w-full resize-y rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface)] p-3 font-mono text-xs outline-none"
          />
        </div>
      )}
    </div>
  );
}
