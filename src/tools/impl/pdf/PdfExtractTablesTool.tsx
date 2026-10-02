import { useState } from "react";
import { PdfToolShell } from "@/components/pdf/PdfToolShell";
import { Field, Fieldset, OptionGroup } from "@/components/pdf/Field";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { Icon } from "@/components/ui/Icon";
import {
  extractTables,
  tableLabel,
  tablesToXlsxFile,
  tableToCsvFile,
  type DetectedTable,
} from "@/core/pdf/operations/tables";
import type { CsvDelimiter } from "@/core/text/csv";
import { saveFile } from "@/core/output/save";
import { notify } from "@/features/notifications/store";
import type { ToolComponentProps } from "@/tools/implementations";
import { Trans, localized, t } from "@/i18n";

/**
 * Extraction des tableaux d'un PDF.
 *
 * L'outil affiche ce qu'il a reconstruit **avant** d'exporter quoi que ce soit,
 * et laisse corriger les cellules : c'est le seul moyen honnête de proposer
 * cette fonction, puisqu'un PDF ne contient pas de tableaux mais du texte
 * positionné, et que la reconstruction est une déduction.
 */
const DELIMITERS: { value: CsvDelimiter; label: string; hint: string }[] = localized(() => [
  { value: ";", label: t("Point-virgule"), hint: t("Attendu par Excel en configuration française") },
  { value: ",", label: t("Virgule"), hint: t("Convention anglo-saxonne, la plus portable") },
  { value: "\t", label: t("Tabulation"), hint: t("Pour coller directement dans un tableur") },
]);

export function PdfExtractTablesTool({ tool }: ToolComponentProps) {
  const [tables, setTables] = useState<DetectedTable[]>([]);
  const [sourceName, setSourceName] = useState("document.pdf");
  const [selected, setSelected] = useState(0);
  const [delimiter, setDelimiter] = useState<CsvDelimiter>(";");
  /** Cellules retouchées, par « tableau:ligne:colonne ». */
  const [edits, setEdits] = useState<Record<string, string>>({});

  /** Le tableau tel qu'il sera exporté : détection plus corrections. */
  const finalTable = (index: number): DetectedTable => {
    const table = tables[index];
    return {
      ...table,
      rows: table.rows.map((row, rowIndex) =>
        row.map((cell, columnIndex) => edits[`${index}:${rowIndex}:${columnIndex}`] ?? cell),
      ),
    };
  };

  const exportCsv = async () => {
    const file = tableToCsvFile(sourceName, finalTable(selected), { delimiter, bom: true });
    const saved = await saveFile(file);
    if (saved.saved) notify.success(t("Tableau enregistré"), saved.path);
  };

  const exportXlsx = async () => {
    const file = tablesToXlsxFile(
      sourceName,
      tables.map((_, index) => finalTable(index)),
    );
    const saved = await saveFile(file);
    if (saved.saved) notify.success(t("Classeur enregistré"), saved.path);
  };

  const table = tables[selected];

  return (
    <PdfToolShell
      tool={tool}
      actionLabel={t("Détecter les tableaux")}
      hint={t("FourTout reconstruit les tableaux à partir de la position du texte : les tableaux enregistrés comme image demandent d'abord un PDF recherchable.")}
      run={async ({ documents, context }) => {
        setTables([]);
        setEdits({});
        setSelected(0);
        const result = await extractTables(documents[0].source, {}, context);
        setTables(result.tables);
        setSourceName(documents[0].source.name);
        // Aucun fichier n'est produit à ce stade : on montre d'abord, on
        // exporte ensuite, une fois le résultat relu.
        return {
          files: [],
          summary: t("{count} {count, plural, one {tableau} other {tableaux}} {count, plural, one {détecté} other {détectés}} sur {pageCount} {pageCount, plural, one {page} other {pages}}.", { count: result.tables.length, pageCount: result.pageCount }),
        };
      }}
    >
      {() => (
        <>
          <Callout tone="info" title={t("Comment FourTout reconstruit un tableau")}>
            {t("Un PDF ne contient pas de tableaux : il contient du texte à des coordonnées. FourTout déduit les lignes et les colonnes de ces positions — avec ou sans bordures, cela ne change rien. Les tableaux complexes (cellules fusionnées, texte sur plusieurs lignes) peuvent demander une correction : relisez et modifiez les cellules avant d'exporter.")}
          </Callout>

          {tables.length > 0 && table && (
            <>
              {tables.length > 1 && (
                <Fieldset columns={1}>
                  <Field label={t("Tableau détecté")}>
                    <OptionGroup
                      ariaLabel={t("Tableau détecté")}
                      value={String(selected)}
                      onChange={(value) => setSelected(Number(value))}
                      options={tables.map((item, index) => ({
                        value: String(index),
                        label: tableLabel(item),
                      }))}
                    />
                  </Field>
                </Fieldset>
              )}

              <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--ft-text-muted)]">
                <Trans source={"<0>{rowCount} {rowCount, plural, one {ligne} other {lignes}} × {columnCount} {columnCount, plural, one {colonne} other {colonnes}}</0>"} values={{ rowCount: table.rowCount, columnCount: table.columnCount }} components={[<span className="tabular-nums" />]} />
                {table.fillRatio < 0.7 && (
                  <span className="flex items-center gap-1 text-[var(--ft-warn)]">
                    <Icon name="TriangleAlert" size={13} />
                    {t("Beaucoup de cellules vides : vérifiez le découpage en colonnes.")}
                  </span>
                )}
              </div>

              <TableEditor
                table={table}
                tableIndex={selected}
                edits={edits}
                onEdit={(key, value) => setEdits((current) => ({ ...current, [key]: value }))}
              />

              <Fieldset columns={1} title={t("Export")}>
                <Field
                  label={t("Séparateur du CSV")}
                  hint={t("Le fichier est écrit en UTF-8 avec BOM : les accents s'affichent correctement dans Excel.")}
                >
                  <OptionGroup
                    ariaLabel={t("Séparateur du CSV")}
                    value={delimiter}
                    onChange={setDelimiter}
                    options={DELIMITERS}
                  />
                </Field>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="primary" onClick={exportCsv}>
                    <Icon name="Download" size={14} />{" "}{t("Exporter ce tableau en CSV")}
                  </Button>
                  <Button size="sm" onClick={exportXlsx}>
                    <Icon name="Table" size={14} />
                    {t("Exporter {value} en XLSX", { value: tables.length > 1 ? t("les {count} tableaux", { count: tables.length }) : t("le tableau") })}
                  </Button>
                </div>
              </Fieldset>
            </>
          )}
        </>
      )}
    </PdfToolShell>
  );
}

/**
 * Aperçu tabulaire modifiable.
 *
 * La première ligne est traitée comme un en-tête à l'affichage seulement : rien
 * ne dit qu'un tableau de PDF en possède un, et l'export reproduit les lignes
 * telles qu'elles sont.
 */
function TableEditor({
  table,
  tableIndex,
  edits,
  onEdit,
}: {
  table: DetectedTable;
  tableIndex: number;
  edits: Record<string, string>;
  onEdit: (key: string, value: string) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-[var(--radius-card)] border border-[var(--ft-border)]">
      <table className="w-full border-collapse text-sm">
        <tbody>
          {table.rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-b border-[var(--ft-rule)] last:border-0">
              <td className="w-9 select-none border-r border-[var(--ft-rule)] px-1.5 py-1 text-right align-middle text-[11px] tabular-nums text-[var(--ft-text-faint)]">
                {rowIndex + 1}
              </td>
              {row.map((cell, columnIndex) => {
                const key = `${tableIndex}:${rowIndex}:${columnIndex}`;
                return (
                  <td key={columnIndex} className="border-r border-[var(--ft-rule)] p-0 last:border-0">
                    <input
                      value={edits[key] ?? cell}
                      onChange={(event) => onEdit(key, event.target.value)}
                      aria-label={t("Ligne {value}, colonne {value2}", { value: rowIndex + 1, value2: columnIndex + 1 })}
                      className={`w-full min-w-28 bg-transparent px-2 py-1 text-[13px] outline-none focus:bg-[var(--ft-hover)] ${
                        rowIndex === 0 ? "font-medium" : ""
                      }`}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
