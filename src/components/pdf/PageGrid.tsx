import { useEffect, useMemo, useState } from "react";
import { renderThumbnail } from "@/core/pdf/operations/toImages";
import { Icon } from "@/components/ui/Icon";
import type { PdfSource } from "@/core/pdf/types";

/**
 * Grille des pages d'un document, avec miniatures.
 *
 * Sert à réorganiser les pages par glisser-déposer et à en sélectionner
 * visuellement. Les miniatures sont rendues page par page en arrière-plan :
 * un document volumineux reste utilisable pendant leur apparition, et leur
 * absence n'empêche jamais l'opération — les cartes restent numérotées.
 */

interface PageGridProps {
  source: PdfSource;
  pageCount: number;
  /** Ordre courant des pages, en numérotation humaine. */
  order: number[];
  onReorder?: (order: number[]) => void;
  /** Pages cochées, si le mode sélection est actif. */
  selected?: Set<number>;
  onToggle?: (page: number) => void;
}

export function PageGrid({
  source,
  pageCount,
  order,
  onReorder,
  selected,
  onToggle,
}: PageGridProps) {
  const thumbnails = useThumbnails(source, pageCount);
  const [dragged, setDragged] = useState<number | null>(null);

  const move = (from: number, to: number) => {
    if (!onReorder || from === to) return;
    const next = [...order];
    const [page] = next.splice(from, 1);
    next.splice(to, 0, page);
    onReorder(next);
  };

  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
      {order.map((page, index) => {
        const isSelected = selected?.has(page) ?? false;
        const interactive = onToggle !== undefined;

        return (
          <div
            key={page}
            draggable={onReorder !== undefined}
            onDragStart={() => setDragged(index)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              if (dragged !== null) move(dragged, index);
              setDragged(null);
            }}
            onDragEnd={() => setDragged(null)}
            onClick={interactive ? () => onToggle(page) : undefined}
            role={interactive ? "checkbox" : undefined}
            aria-checked={interactive ? isSelected : undefined}
            aria-label={`Page ${page}`}
            tabIndex={interactive ? 0 : undefined}
            onKeyDown={
              interactive
                ? (event) => {
                    if (event.key === " " || event.key === "Enter") {
                      event.preventDefault();
                      onToggle(page);
                    }
                  }
                : undefined
            }
            className={`group relative flex flex-col overflow-hidden rounded-[var(--radius-card)] border bg-[var(--ft-surface)] transition-colors ${
              onReorder ? "cursor-grab active:cursor-grabbing" : ""
            } ${interactive ? "cursor-pointer" : ""} ${
              isSelected
                ? "border-[var(--ft-accent)] ring-1 ring-[var(--ft-accent)]"
                : "border-[var(--ft-border)] hover:border-[var(--ft-border-strong)]"
            } ${dragged === index ? "opacity-40" : ""}`}
          >
            <div className="flex aspect-[3/4] items-center justify-center bg-[var(--ft-surface-2)]">
              {thumbnails[page] ? (
                <img
                  src={thumbnails[page]}
                  alt={`Aperçu de la page ${page}`}
                  className="max-h-full max-w-full object-contain"
                />
              ) : (
                <Icon name="FileText" size={20} className="text-[var(--ft-text-faint)]" />
              )}
            </div>

            <div className="flex items-center justify-between gap-1 border-t border-[var(--ft-border)] px-1.5 py-1">
              <span className="text-[11px] tabular-nums text-[var(--ft-text-muted)]">
                Page {page}
              </span>
              {isSelected && (
                <Icon name="Check" size={12} className="text-[var(--ft-accent-text)]" />
              )}
              {onReorder && index !== page - 1 && (
                <span className="text-[10px] text-[var(--ft-accent-text)]">→ {index + 1}</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Rend les miniatures une par une et les publie au fur et à mesure.
 * Les URL d'objet sont libérées au démontage pour ne pas fuir de mémoire.
 */
function useThumbnails(source: PdfSource, pageCount: number): Record<number, string> {
  const [thumbnails, setThumbnails] = useState<Record<number, string>>({});
  const key = useMemo(() => `${source.name}:${source.bytes.length}`, [source]);

  useEffect(() => {
    let cancelled = false;
    const urls: string[] = [];
    setThumbnails({});

    async function run() {
      // Au-delà, le coût de rendu dépasse le service rendu : les cartes
      // numérotées suffisent pour réorganiser un très gros document.
      const limit = Math.min(pageCount, 60);
      for (let page = 1; page <= limit; page += 1) {
        if (cancelled) return;
        try {
          const png = await renderThumbnail(source, page, 150);
          if (!png || cancelled) continue;
          const url = URL.createObjectURL(
            new Blob([png.slice().buffer as ArrayBuffer], { type: "image/png" }),
          );
          urls.push(url);
          setThumbnails((current) => ({ ...current, [page]: url }));
        } catch {
          // Une miniature manquante n'est pas une erreur bloquante.
        }
      }
    }

    void run();
    return () => {
      cancelled = true;
      urls.forEach(URL.revokeObjectURL);
    };
    // `key` identifie le document : inutile de re-rendre si l'objet change
    // d'identité sans que son contenu change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, pageCount]);

  return thumbnails;
}
