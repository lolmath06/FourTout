import { useState } from "react";
import { NativeToolShell } from "@/components/files/NativeToolShell";
import { Field, Fieldset, OptionGroup } from "@/components/pdf/Field";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { readDocx, type DocxResult } from "@/core/files/native";
import { baseName, stemOf } from "@/core/files/paths";
import { sanitizeHtml } from "@/core/text/html";
import { saveFile } from "@/core/output/save";
import { notify } from "@/features/notifications/store";
import type { ToolComponentProps } from "@/tools/implementations";
import { localized, t, tx } from "@/i18n";

/**
 * Lecture d'un document Word (.docx).
 *
 * Ce que l'outil promet : le **contenu** — titres, paragraphes, listes,
 * gras/italique, tableaux en texte — et les propriétés du document. Ce qu'il
 * ne promet pas : la mise en page. Les images, les colonnes, les styles et la
 * pagination ne sont pas restitués, et l'outil le dit à chaque conversion
 * plutôt que de laisser croire à une conversion fidèle.
 */
type Output = "text" | "markdown" | "html";

const OUTPUT_LABELS: Record<Output, string> = localized(() => ({
  text: t("Texte brut"),
  markdown: "Markdown",
  html: "HTML",
}));

export function DocxExtractTool(_props: ToolComponentProps) {
  const [paths, setPaths] = useState<string[]>([]);
  const [output, setOutput] = useState<Output>("text");
  const [preview, setPreview] = useState(true);

  return (
    <NativeToolShell<DocxResult>
      picker={{
        mode: "files",
        paths,
        onChange: (next) => setPaths(next.slice(-1)),
        label: t("Choisissez un document Word (.docx)"),
        filters: [{ name: t("Document Word"), extensions: ["docx"] }],
      }}
      actionLabel={t("Lire le document")}
      actionIcon="FileText"
      run={async () => readDocx(paths[0])}
      successMessage={(result) => `${result.blocks} bloc(s) extrait(s)`}
      renderResult={(result) => {
        const value = result[output];
        const extension = output === "markdown" ? "md" : output === "html" ? "html" : "txt";
        const metadataRows = Object.entries({
          Titre: result.metadata.title,
          Auteur: result.metadata.author,
          Sujet: result.metadata.subject,
          "Mots-clés": result.metadata.keywords,
          "Créé le": result.metadata.created,
          "Modifié le": result.metadata.modified,
          "Dernière modification par": result.metadata.lastModifiedBy,
          Application: result.metadata.application,
          Pages: result.metadata.pages,
          Mots: result.metadata.words,
        }).filter(([, entry]) => entry);

        return (
          <div className="space-y-3" data-testid="docx-result">
            <p className="flex items-start gap-2 rounded-md border border-[var(--ft-warn)] px-3 py-2 text-xs text-[var(--ft-warn)]">
              <Icon name="TriangleAlert" size={14} className="mt-px shrink-0" />
              {t("La mise en page complexe peut différer du document original : FourTout restitue le contenu et sa structure, pas la mise en forme de Word.{value}", { value: result.dropped.length > 0 && t(" Non restitué : {value}.", { value: result.dropped.join(" ; ") }) })}
            </p>

            {metadataRows.length > 0 && (
              <div className="rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface)] p-3">
                <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-[var(--ft-text-muted)]">
                  <Icon name="Info" size={13} />{" "}{t("Propriétés du document")}
                </p>
                <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[12rem_1fr]">
                  {metadataRows.map(([label, entry]) => (
                    <div key={label} className="contents">
                      <dt className="text-[var(--ft-text-muted)]">{tx(label)}</dt>
                      <dd>{entry}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <OptionGroup
                ariaLabel={t("Format de sortie")}
                value={output}
                onChange={setOutput}
                options={(Object.keys(OUTPUT_LABELS) as Output[]).map((value_) => ({
                  value: value_,
                  label: OUTPUT_LABELS[value_],
                }))}
              />
              <div className="flex-1" />
              {output === "html" && (
                <Button size="sm" variant="ghost" onClick={() => setPreview((v) => !v)}>
                  <Icon name={preview ? "EyeOff" : "Eye"} size={14} />
                  {preview ? t("Masquer l'aperçu") : t("Afficher l'aperçu")}
                </Button>
              )}
              <Button
                size="sm"
                onClick={async () => {
                  const saved = await saveFile({
                    name: `${stemOf(baseName(paths[0] ?? "document"))}.${extension}`,
                    bytes: new TextEncoder().encode(value),
                    mimeType: extension === "html" ? "text/html" : "text/plain",
                  });
                  if (saved.saved) notify.success(t("Fichier enregistré"), saved.path);
                }}
              >
                <Icon name="Download" size={14} />{" "}{t("Télécharger")}
              </Button>
              <Button
                size="sm"
                variant="primary"
                onClick={async () => {
                  await navigator.clipboard.writeText(value);
                  notify.success(t("Copié dans le presse-papiers"));
                }}
              >
                <Icon name="Copy" size={14} />{" "}{t("Copier")}
              </Button>
            </div>

            {output === "html" && preview ? (
              <div
                className="prose-fourtout max-h-96 overflow-auto rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface)] p-4 text-sm"
                dangerouslySetInnerHTML={{ __html: sanitizeHtml(value) }}
              />
            ) : (
              <textarea
                readOnly
                value={value}
                aria-label={tx(OUTPUT_LABELS[output])}
                className="min-h-72 w-full resize-y rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface-2)] p-3 font-mono text-xs"
              />
            )}

            <p className="text-xs text-[var(--ft-text-muted)]">
              {t("{blocks} bloc(s) · {tables} tableau(x) · {images} image(s) dans le document d'origine.", { blocks: result.blocks, tables: result.tables, images: result.images })}
            </p>
          </div>
        );
      }}
    >
      <Fieldset columns={1}>
        <Field label={t("Ce que l'outil extrait")}>
          <p className="text-xs text-[var(--ft-text-muted)]">
            {t("Titres, paragraphes, listes, gras et italique, contenu des tableaux, et propriétés du document (auteur, dates, application).")}
          </p>
        </Field>
      </Fieldset>
    </NativeToolShell>
  );
}
