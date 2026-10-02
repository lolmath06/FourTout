import { useState } from "react";
import { PdfToolShell } from "@/components/pdf/PdfToolShell";
import { Field, Fieldset, OptionGroup } from "@/components/pdf/Field";
import { Callout } from "@/components/ui/Callout";
import { Icon } from "@/components/ui/Icon";
import { singleResult } from "@/components/pdf/result";
import { makeSearchablePdf, type SearchablePageReport } from "@/core/pdf/operations/searchablePdf";
import { OCR_LANGUAGE_LABELS, type OcrLanguage } from "@/core/ocr";
import type { ToolComponentProps } from "@/tools/implementations";
import { localized, t } from "@/i18n";

/**
 * PDF scanné → PDF recherchable.
 *
 * L'outil ne fait que rassembler des réglages et afficher un compte rendu :
 * tout le travail — rendu, reconnaissance, écriture de la couche texte — vit
 * dans `core/pdf/operations/searchablePdf`, appelable sans interface.
 */
const LANGUAGES: { value: OcrLanguage; label: string }[] = localized(() => [
  { value: "fra", label: OCR_LANGUAGE_LABELS.fra },
  { value: "eng", label: OCR_LANGUAGE_LABELS.eng },
  { value: "fra+eng", label: OCR_LANGUAGE_LABELS["fra+eng"] },
]);

/**
 * Résolutions de reconnaissance. En deçà de 150 ppp, les caractères d'un scan
 * ordinaire sont trop petits pour être lus de façon fiable ; au-delà de 300, on
 * paie du temps sans gagner en exactitude.
 */
const RESOLUTIONS = localized(() => [
  { value: "150", label: t("Rapide"), hint: t("150 ppp — scans nets, texte de bonne taille") },
  { value: "200", label: t("Équilibré"), hint: t("200 ppp — le bon choix dans la plupart des cas") },
  { value: "300", label: t("Minutieux"), hint: t("300 ppp — petits caractères, scans médiocres") },
]);

export function PdfSearchableTool({ tool }: ToolComponentProps) {
  const [language, setLanguage] = useState<OcrLanguage>("fra");
  const [dpi, setDpi] = useState("200");
  const [pages, setPages] = useState<SearchablePageReport[]>([]);
  const [hadText, setHadText] = useState(false);

  return (
    <div className="space-y-4">
      {/* L'explication précède la zone de dépôt : on doit savoir ce que l'outil
          va faire du document avant de le lui confier, pas après. */}
      <Callout tone="info" title={t("Ce que fait exactement cet outil")}>
        {t("Les pages d'origine sont conservées telles quelles — ni rasterisées, ni recompressées. FourTout y superpose le texte reconnu, invisible à l'affichage mais présent pour la recherche, la sélection et le copier-coller. L'apparence du document ne change pas.")}
      </Callout>

      <PdfToolShell
      tool={tool}
      actionLabel={t("Rendre recherchable")}
      hint={t("La reconnaissance se fait page par page, sur votre machine. Un document long peut demander plusieurs minutes ; l'opération reste annulable.")}
      run={async ({ documents, context }) => {
        setPages([]);
        const result = await makeSearchablePdf(
          documents[0].source,
          { language, dpi: Number(dpi) },
          context,
        );
        setPages(result.pages);
        setHadText(result.hadNativeText);
        return singleResult(
          result.file,
          t("{totalWords} {totalWords, plural, one {mot} other {mots}} {totalWords, plural, one {ajouté} other {ajoutés}} en couche invisible sur {count} {count, plural, one {page} other {pages}}.", { totalWords: result.totalWords, count: result.pages.length }),
        );
      }}
    >
      {() => (
        <>
          <Fieldset columns={2}>
            <Field label={t("Langue du document")} hint={t("Choisir la bonne langue change nettement la qualité de lecture.")}>
              <OptionGroup
                ariaLabel={t("Langue du document")}
                value={language}
                onChange={setLanguage}
                options={LANGUAGES}
              />
            </Field>
            <Field label={t("Finesse de lecture")} hint={t("Plus la résolution est élevée, plus la lecture est lente.")}>
              <OptionGroup
                ariaLabel={t("Finesse de lecture")}
                value={dpi}
                onChange={setDpi}
                options={RESOLUTIONS}
              />
            </Field>
          </Fieldset>

          <SearchableReport pages={pages} hadNativeText={hadText} />
        </>
      )}
      </PdfToolShell>
    </div>
  );
}

/**
 * Compte rendu par page.
 *
 * Il porte une part de l'honnêteté de l'outil : une page dont la confiance est
 * basse est signalée comme telle, ce qui vaut mieux qu'un « terminé » uniforme
 * sur un scan que la reconnaissance a mal lu.
 */
function SearchableReport({
  pages,
  hadNativeText,
}: {
  pages: SearchablePageReport[];
  hadNativeText: boolean;
}) {
  if (pages.length === 0) return null;
  return (
    <div className="space-y-2">
      {hadNativeText && (
        <Callout tone="warning" title={t("Ce PDF contenait déjà du texte")}>
          {t("Il ne s'agissait donc pas d'un scan intégral. La couche reconnue s'ajoute au texte existant, qui reste intact.")}
        </Callout>
      )}
      <div className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--ft-border)]">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-[var(--ft-rule)] text-left">
              <th className="px-3 py-1.5 font-medium">{t("Page")}</th>
              <th className="px-3 py-1.5 font-medium">{t("Mots reconnus")}</th>
              <th className="px-3 py-1.5 font-medium">{t("Confiance")}</th>
            </tr>
          </thead>
          <tbody>
            {pages.map((page) => (
              <tr key={page.page} className="border-b border-[var(--ft-rule)] last:border-0">
                <td className="px-3 py-1.5 tabular-nums">{page.page}</td>
                <td className="px-3 py-1.5 tabular-nums">{page.words}</td>
                <td className="px-3 py-1.5 tabular-nums">
                  <span
                    className={
                      page.confidence < 60 ? "text-[var(--ft-warn)]" : "text-[var(--ft-text-muted)]"
                    }
                  >
                    {page.confidence} %
                    {page.confidence < 60 && (
                      <Icon name="TriangleAlert" size={13} className="ml-1 inline align-text-top" />
                    )}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
