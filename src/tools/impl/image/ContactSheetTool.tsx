import { useState } from "react";
import { ImageToolShell } from "@/components/image/ImageToolShell";
import { Field, Fieldset, NumberInput, OptionGroup, Slider } from "@/components/pdf/Field";
import { ColorField } from "@/components/image/ColorField";
import { decodeOriented, readSelectedFile } from "@/core/image/codec";
import {
  buildContactSheet,
  contactSheetLayout,
  CONTACT_SHEET_ORDERS,
  DEFAULT_CONTACT_SHEET,
  sortByOrder,
  type ContactSheetItem,
  type ContactSheetOrder,
} from "@/core/image/contactSheet";
import type { Rgb } from "@/core/image/types";
import { JobCancelledError } from "@/core/jobs/types";
import type { ToolComponentProps } from "@/tools/implementations";

/**
 * Planche-contact : toutes les images déposées sur une seule feuille.
 *
 * Les cases sont carrées et chaque image y est inscrite sans déformation ni
 * recadrage — un portrait et un panorama peuvent donc voisiner sans décaler les
 * lignes. Une image plus petite que sa case n'est jamais agrandie : la grossir
 * donnerait une planche flatteuse sur la qualité des originaux.
 *
 * Ce n'est pas un éditeur de mise en page : les réglages s'arrêtent à ce qui
 * change vraiment la lecture de la planche.
 */

const FORMATS = [
  { value: "png", label: "PNG" },
  { value: "jpeg", label: "JPEG" },
] as const;

export function ContactSheetTool({ tool }: ToolComponentProps) {
  const [columns, setColumns] = useState(DEFAULT_CONTACT_SHEET.columns);
  const [thumbWidth, setThumbWidth] = useState(DEFAULT_CONTACT_SHEET.thumbWidth);
  const [gap, setGap] = useState(DEFAULT_CONTACT_SHEET.gap);
  const [margin, setMargin] = useState(DEFAULT_CONTACT_SHEET.margin);
  const [background, setBackground] = useState<Rgb>(DEFAULT_CONTACT_SHEET.background);
  const [showLabels, setShowLabels] = useState(true);
  const [order, setOrder] = useState<ContactSheetOrder>("dropped");
  const [format, setFormat] = useState<"png" | "jpeg">("png");

  const options = {
    ...DEFAULT_CONTACT_SHEET,
    columns,
    thumbWidth,
    gap,
    margin,
    background,
    showLabels,
  };

  return (
    <ImageToolShell
      tool={tool}
      selection="multiple"
      actionLabel="Créer la planche"
      hint="Toutes les images déposées sont disposées sur une seule feuille."
      run={async ({ files, context }) => {
        const ordered = sortByOrder(files, order);
        const items: ContactSheetItem[] = [];
        try {
          for (const [index, file] of ordered.entries()) {
            context.report?.({
              ratio: index / (ordered.length + 1),
              label: `Lecture de ${file.name}…`,
            });
            if (context.signal?.aborted) throw new JobCancelledError();
            const bytes = await readSelectedFile(file);
            const { canvas } = await decodeOriented(bytes, file.extension);
            items.push({ canvas, label: file.name });
          }

          context.report?.({ ratio: 0.9, label: "Assemblage…" });
          const sheet = buildContactSheet(items, options);
          const bytes = await sheet.encode(format, 0.9);
          const layout = contactSheetLayout(items.length, options);
          sheet.release?.();

          return {
            files: [
              {
                name: `planche-contact.${format === "jpeg" ? "jpg" : "png"}`,
                bytes,
                mimeType: format === "jpeg" ? "image/jpeg" : "image/png",
              },
            ],
            summary:
              `${items.length} image${items.length > 1 ? "s" : ""} en ${layout.columns} colonne` +
              `${layout.columns > 1 ? "s" : ""} × ${layout.rows} ligne${layout.rows > 1 ? "s" : ""} ` +
              `— planche de ${layout.width} × ${layout.height} px.`,
          };
        } finally {
          // Une planche de cent vignettes tient autant de surfaces ouvertes :
          // les libérer tout de suite évite de les empiler dans la WebView.
          for (const item of items) item.canvas.release?.();
        }
      }}
    >
      {(files) => {
        const layout = contactSheetLayout(files.length, options);
        return (
          <div className="space-y-3">
            <Fieldset columns={2}>
              <Field label="Colonnes">
                <NumberInput
                  value={columns}
                  min={1}
                  max={20}
                  onChange={(event) =>
                    setColumns(Math.max(1, Math.min(20, Number(event.target.value) || 1)))
                  }
                />
              </Field>
              <Field label={`Largeur de vignette (${thumbWidth} px)`}>
                <Slider value={thumbWidth} onChange={setThumbWidth} min={60} max={600} step={10} />
              </Field>
              <Field label={`Espacement (${gap} px)`}>
                <Slider value={gap} onChange={setGap} min={0} max={64} />
              </Field>
              <Field label={`Marge (${margin} px)`}>
                <Slider value={margin} onChange={setMargin} min={0} max={120} step={4} />
              </Field>
              <Field label="Fond">
                <ColorField value={background} onChange={setBackground} />
              </Field>
              <Field label="Noms de fichier">
                <OptionGroup
                  ariaLabel="Noms de fichier"
                  value={showLabels ? "yes" : "no"}
                  onChange={(value) => setShowLabels(value === "yes")}
                  options={[
                    { value: "yes", label: "Afficher" },
                    { value: "no", label: "Masquer" },
                  ]}
                />
              </Field>
              <Field label="Ordre" full>
                <OptionGroup
                  ariaLabel="Ordre"
                  value={order}
                  onChange={(value) => setOrder(value as ContactSheetOrder)}
                  options={CONTACT_SHEET_ORDERS}
                />
              </Field>
              <Field label="Format de sortie" full>
                <OptionGroup
                  ariaLabel="Format"
                  value={format}
                  onChange={(value) => setFormat(value as "png" | "jpeg")}
                  options={[...FORMATS]}
                />
              </Field>
            </Fieldset>

            <p className="text-xs text-[var(--ft-text-muted)]">
              Planche de {layout.width} × {layout.height} px — {layout.columns} colonne
              {layout.columns > 1 ? "s" : ""}, {layout.rows} ligne{layout.rows > 1 ? "s" : ""}.
            </p>

            <ol className="space-y-1 text-xs text-[var(--ft-text-muted)]">
              {sortByOrder(files, order).map((file, index) => (
                <li key={file.id} className="font-mono">
                  {String(index + 1).padStart(2, "0")} · {file.name}
                </li>
              ))}
            </ol>
          </div>
        );
      }}
    </ImageToolShell>
  );
}
