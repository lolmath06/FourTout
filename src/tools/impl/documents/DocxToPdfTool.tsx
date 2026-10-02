import { useState } from "react";
import { NativeToolShell } from "@/components/files/NativeToolShell";
import { Field, Fieldset, NumberInput, OptionGroup, TextInput } from "@/components/pdf/Field";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Callout } from "@/components/ui/Callout";
import { readDocx, type DocxResult } from "@/core/files/native";
import { baseName, stemOf } from "@/core/files/paths";
import { documentToPdf } from "@/core/pdf/operations/documentToPdf";
import { formatFileSize } from "@/core/files";
import { saveFile, revealFile } from "@/core/output/save";
import { notify } from "@/features/notifications/store";
import type { ToolComponentProps } from "@/tools/implementations";
import { t } from "@/i18n";

/**
 * Word (.docx) vers PDF.
 *
 * L'outil **assemble deux briques existantes** plutôt que d'écrire un
 * troisième lecteur de documents : le lecteur DOCX natif (celui de « Lire un
 * document Word ») produit du Markdown structuré, et le moteur Document → PDF
 * (celui de « Document vers PDF ») le met en page. Une seule chaîne, donc un
 * seul comportement à maintenir et à corriger.
 *
 * Ce qui est restitué : titres, paragraphes, gras, italique, listes, et les
 * tableaux simples sous forme de lignes de texte.
 *
 * Ce qui ne l'est pas, et qui est dit à l'écran : les mises en page complexes
 * — colonnes, zones flottantes, en-têtes et pieds de page, polices
 * spécifiques, images. FourTout ne prétend pas remplacer Word.
 */
interface Conversion {
  docx: DocxResult;
  name: string;
  bytes: Uint8Array;
  savedPath?: string;
}

export function DocxToPdfTool(_props: ToolComponentProps) {
  const [paths, setPaths] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [fontSize, setFontSize] = useState(11);
  const [pageSize, setPageSize] = useState<"a4" | "letter">("a4");
  const [saved, setSaved] = useState<string | undefined>();

  const source = paths[0];

  return (
    <NativeToolShell<Conversion>
      picker={{
        mode: "files",
        paths,
        onChange: (next) => {
          setPaths(next.slice(-1));
          setSaved(undefined);
        },
        label: t("Choisissez un document Word (.docx)"),
        hint: t("Format .docx uniquement. Les anciens .doc ne sont pas lus."),
        filters: [{ name: t("Document Word"), extensions: ["docx"] }],
      }}
      actionLabel={t("Convertir en PDF")}
      actionIcon="FileText"
      actionDisabled={!source}
      run={async (context) => {
        const docx = await readDocx(source);
        context.report?.({ ratio: 0.5, label: t("Mise en page du PDF…") });
        const name = `${stemOf(baseName(source))}.pdf`;
        const output = await documentToPdf(
          name,
          docx.markdown,
          {
            kind: "markdown",
            title: title.trim() || docx.metadata.title || undefined,
            fontSize,
            pageSize,
          },
          context,
        );
        return { docx, name: output.name, bytes: output.bytes };
      }}
      successMessage={(result) => t("{blocks} blocs mis en page", { blocks: result.docx.blocks })}
      renderResult={(result) => (
        <div
          className="rounded-[var(--radius-card)] border border-l-2 border-[var(--ft-border)] bg-[var(--ft-surface)]"
          style={{ borderLeftColor: "var(--ft-ok)" }}
        >
          <div className="flex items-start gap-2 border-b border-[var(--ft-rule)] px-3 py-2">
            <Icon name="CircleCheck" size={15} className="mt-px shrink-0 text-[var(--ft-ok)]" />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium leading-5">{t("PDF produit — {name}", { name: result.name })}</p>
              <p className="ft-meta ft-num">
                {t("{blocks} {blocks, plural, one {bloc} other {blocs}} · {tables} {tables, plural, one {tableau} other {tableaux}} · {size}", { blocks: result.docx.blocks, tables: result.docx.tables, size: formatFileSize(result.bytes.length) })}
              </p>
            </div>
          </div>

          {result.docx.images > 0 && (
            <p className="ft-meta border-b border-[var(--ft-rule)] px-3 py-1.5 text-[var(--ft-warn)]">
              {t("{images} {images, plural, one {image} other {images}} du document ne sont pas reprises dans le PDF : le lecteur DOCX de FourTout extrait le texte, pas les illustrations.", { images: result.docx.images })}
            </p>
          )}

          {result.docx.dropped.length > 0 && (
            <ul className="divide-y divide-[var(--ft-rule)]">
              {result.docx.dropped.slice(0, 8).map((entry) => (
                <li key={entry} className="ft-meta ft-row-py px-3 text-[var(--ft-text-muted)]">
                  {t("Non repris : {entry}", { entry })}
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap gap-1.5 border-t border-[var(--ft-rule)] px-3 py-2">
            <Button
              size="sm"
              variant="primary"
              onClick={async () => {
                const outcome = await saveFile({
                  name: result.name,
                  bytes: result.bytes,
                  mimeType: "application/pdf",
                });
                if (outcome.saved) {
                  setSaved(outcome.path);
                  notify.success(t("PDF enregistré"), outcome.path);
                }
              }}
            >
              <Icon name="HardDrive" size={13} />{" "}{t("Enregistrer")}
            </Button>
            {saved && (
              <Button size="sm" variant="ghost" onClick={() => revealFile(saved)}>
                <Icon name="FolderTree" size={13} />{" "}{t("Ouvrir le dossier")}
              </Button>
            )}
          </div>
        </div>
      )}
      footer={
        <Callout tone="info" title={t("Le contenu, pas la maquette")}>
          {t("FourTout reprend les titres, les paragraphes, le gras, l'italique, les listes et les tableaux simples. Les mises en page Word complexes — colonnes, zones flottantes, en-têtes et pieds de page, polices spécifiques, images — peuvent différer ou disparaître. Pour un rendu fidèle au pixel, exportez en PDF depuis Word ou LibreOffice.")}
        </Callout>
      }
    >
      <Fieldset columns={3} title={t("Mise en page")}>
        <Field label={t("Titre du PDF")} hint={t("Vide : le titre du document Word, s'il en a un.")}>
          <TextInput
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="(titre du document)"
            aria-label={t("Titre du PDF")}
          />
        </Field>
        <Field label={t("Taille du texte")} hint={t("En points.")}>
          <NumberInput
            value={fontSize}
            min={8}
            max={18}
            onChange={(event) => setFontSize(Number(event.target.value))}
            aria-label={t("Taille du texte")}
          />
        </Field>
        <Field label={t("Format de page")}>
          <OptionGroup
            ariaLabel={t("Format de page")}
            value={pageSize}
            onChange={setPageSize}
            options={[
              { value: "a4", label: "A4" },
              { value: "letter", label: t("Letter") },
            ]}
          />
        </Field>
      </Fieldset>
    </NativeToolShell>
  );
}
