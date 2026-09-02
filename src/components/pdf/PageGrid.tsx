import { useEffect, useMemo, useRef, useState } from "react";
import { renderThumbnail } from "@/core/pdf/operations/toImages";
import { Icon } from "@/components/ui/Icon";
import type { PdfSource } from "@/core/pdf/types";
import { reorderByInsertion } from "./pageReorder";

/**
 * Grille des pages d'un document, avec miniatures.
 *
 * Le glisser-déposer repose sur les **Pointer Events** (et non l'API HTML5
 * Drag & Drop, peu fiable dans WebKitGTK) : capture du pointeur, calcul de la
 * position d'insertion, repère visuel. Les miniatures sont produites hors écran
 * puis affichées via `<img>` — aucune surface canvas n'est conservée.
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

interface DragState {
  from: number;
  /** Position d'insertion : la page ira devant `insertBefore` dans l'ordre. */
  insertBefore: number;
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
  const containerRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [drag, setDrag] = useState<DragState | null>(null);

  const reorderable = onReorder !== undefined;
  const interactive = onToggle !== undefined;

  /** Position d'insertion la plus proche du pointeur, dans [0, order.length]. */
  const insertionAt = (clientX: number, clientY: number): number => {
    let best = order.length;
    let bestDist = Infinity;
    for (let i = 0; i < order.length; i += 1) {
      const el = cardRefs.current[i];
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dist = Math.hypot(clientX - cx, clientY - cy);
      if (dist < bestDist) {
        bestDist = dist;
        // Avant ou après la carte selon le côté où pointe le curseur.
        best = clientX < cx ? i : i + 1;
      }
    }
    return best;
  };

  const beginDrag = (index: number, event: React.PointerEvent<HTMLDivElement>) => {
    if (!reorderable) return;
    event.preventDefault();
    containerRef.current?.setPointerCapture(event.pointerId);
    setDrag({ from: index, insertBefore: index });
  };

  const updateDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    const insertBefore = insertionAt(event.clientX, event.clientY);
    if (insertBefore !== drag.insertBefore) setDrag({ ...drag, insertBefore });
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    containerRef.current?.releasePointerCapture(event.pointerId);
    const { from, insertBefore } = drag;
    setDrag(null);

    // Insertion « devant l'index » : on retire d'abord, puis on réinsère en
    // corrigeant le décalage si l'élément retiré était avant la cible.
    let target = insertBefore;
    if (from < insertBefore) target -= 1;
    if (target !== from && onReorder) {
      onReorder(reorderByInsertion(order, from, insertBefore));
    }
  };

  return (
    <div
      ref={containerRef}
      onPointerMove={reorderable ? updateDrag : undefined}
      onPointerUp={reorderable ? endDrag : undefined}
      onPointerCancel={reorderable ? () => setDrag(null) : undefined}
      className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6"
    >
      {order.map((page, index) => {
        const isSelected = selected?.has(page) ?? false;
        const isDragged = drag?.from === index;
        // Repère d'insertion : trait avant cette carte.
        const showMarkerBefore = drag != null && drag.insertBefore === index;
        const showMarkerAfterLast =
          drag != null && index === order.length - 1 && drag.insertBefore === order.length;

        return (
          <div
            key={page}
            ref={(el) => {
              cardRefs.current[index] = el;
            }}
            onPointerDown={reorderable ? (event) => beginDrag(index, event) : undefined}
            onClick={interactive ? () => onToggle(page) : undefined}
            role={interactive ? "checkbox" : reorderable ? "button" : undefined}
            aria-checked={interactive ? isSelected : undefined}
            aria-label={`Page ${page}`}
            tabIndex={interactive || reorderable ? 0 : undefined}
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
            className={`group relative flex touch-none select-none flex-col overflow-hidden rounded-[var(--radius-card)] border bg-[var(--ft-surface)] transition-[border-color,opacity] ${
              reorderable ? "cursor-grab active:cursor-grabbing" : ""
            } ${interactive ? "cursor-pointer" : ""} ${
              isSelected
                ? "border-[var(--ft-accent)] ring-1 ring-[var(--ft-accent)]"
                : "border-[var(--ft-border)] hover:border-[var(--ft-border-strong)]"
            } ${isDragged ? "opacity-40 ring-2 ring-[var(--ft-accent)]" : ""}`}
          >
            {/* Repère d'insertion (barre verticale) */}
            {showMarkerBefore && (
              <span className="pointer-events-none absolute -left-1 top-0 z-10 h-full w-0.5 rounded bg-[var(--ft-accent)]" />
            )}
            {showMarkerAfterLast && (
              <span className="pointer-events-none absolute -right-1 top-0 z-10 h-full w-0.5 rounded bg-[var(--ft-accent)]" />
            )}

            <div className="flex aspect-[3/4] items-center justify-center bg-[var(--ft-surface-2)]">
              {thumbnails[page] ? (
                <img
                  src={thumbnails[page]}
                  alt={`Aperçu de la page ${page}`}
                  draggable={false}
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
              {isSelected && <Icon name="Check" size={12} className="text-[var(--ft-accent-text)]" />}
              {reorderable && index !== page - 1 && (
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
 * Chaque miniature est un PNG hors écran affiché via `<img>` : aucune surface
 * canvas n'est conservée. Les URL d'objet sont libérées au démontage.
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

