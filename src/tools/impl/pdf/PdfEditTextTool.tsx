import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { constraintsForTool, type SelectedFile } from "@/core/files";
import { FileDropZone } from "@/components/files/FileDropZone";
import { PdfSourceList } from "@/components/pdf/PdfSourceList";
import { usePdfSources } from "@/components/pdf/usePdfSources";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { renderPageForEditor, type EditorPageRender } from "@/core/pdf/operations/toImages";
import {
  applyTextEdits,
  canEditCleanly,
  extractPageText,
  sampleTextStyle,
  type EditableTextItem,
} from "@/core/pdf/operations/editText";
import {
  historyReducer,
  initialHistory,
  keyOf,
  overlayBox,
  pageWidthTarget,
  toCss,
  type EditMap,
} from "./editTextUi";
import { toPdfError } from "@/core/pdf/errors";
import { saveFile } from "@/core/output/save";
import { notify } from "@/features/notifications/store";
import type { PdfSource } from "@/core/pdf/types";
import type { ToolComponentProps } from "@/tools/implementations";

/**
 * Éditeur visuel du texte d'un PDF.
 *
 * On affiche la page **réelle** (rendu pdf.js → PNG statique dans un `<img>`,
 * conformément à l'approche anti-artefacts WebKitGTK : aucune surface canvas
 * persistante) surmontée d'une couche de texte HTML interactive construite à
 * partir des positions de `getTextContent()`. Un double-clic rend un fragment
 * éditable ; l'aperçu se met à jour immédiatement. L'export produit une copie
 * par remplacement visuel (voir `editText.ts` pour la nature exacte de l'édition
 * et ses limites).
 */


export function PdfEditTextTool({ tool }: ToolComponentProps) {
  const [files, setFiles] = useState<SelectedFile[]>([]);
  const { loaded, isLoading, unlock } = usePdfSources(files);

  const document = loaded[0];
  const usable = document && !document.error && !document.needsPassword ? document : undefined;

  const [history, dispatch] = useReducer(historyReducer, initialHistory);
  const edits = history.present;

  // Réinitialise les modifications quand le document change.
  const sourceKey = usable ? `${usable.source.name}:${usable.source.bytes.length}` : "";
  useEffect(() => {
    dispatch({ type: "reset" });
  }, [sourceKey]);

  const editCount = useMemo(() => Object.keys(edits).length, [edits]);

  return (
    <div className="space-y-4">
      <FileDropZone
        constraints={{ ...constraintsForTool(tool), maxFiles: 1 }}
        files={files}
        onChange={setFiles}
        label="Déposez votre PDF ici"
        hint="Double-cliquez un texte de la page pour le modifier."
      />

      {loaded.length > 0 && (
        <PdfSourceList documents={loaded} onRemove={(id) => setFiles((f) => f.filter((x) => x.id !== id))} onUnlock={unlock} />
      )}

      {isLoading && (
        <p className="flex items-center gap-2 text-sm text-[var(--ft-text-muted)]">
          <Icon name="Loader" size={15} className="animate-spin" />
          Ouverture du document…
        </p>
      )}

      {usable && usable.info && (
        <Editor
          source={usable.source}
          pageCount={usable.info.pageCount}
          edits={edits}
          editCount={editCount}
          canUndo={history.past.length > 0}
          canRedo={history.future.length > 0}
          onSetEdits={(map) => dispatch({ type: "set", map })}
          onUndo={() => dispatch({ type: "undo" })}
          onRedo={() => dispatch({ type: "redo" })}
        />
      )}
    </div>
  );
}

interface EditorProps {
  source: PdfSource;
  pageCount: number;
  edits: EditMap;
  editCount: number;
  canUndo: boolean;
  canRedo: boolean;
  onSetEdits: (map: EditMap) => void;
  onUndo: () => void;
  onRedo: () => void;
}

function Editor({
  source,
  pageCount,
  edits,
  editCount,
  canUndo,
  canRedo,
  onSetEdits,
  onUndo,
  onRedo,
}: EditorProps) {
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [render, setRender] = useState<EditorPageRender | null>(null);
  const [items, setItems] = useState<EditableTextItem[]>([]);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [exporting, setExporting] = useState(false);
  const escapedRef = useRef(false);

  // Le document a changé : repartir de la première page.
  useEffect(() => setPage(1), [source]);

  // Rend la page courante et extrait son texte. Un jeton ignore les rendus
  // périmés (changement rapide de page/zoom), et l'URL d'objet est libérée.
  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    setRendering(true);
    setRenderError(null);
    setEditing(null);

    void (async () => {
      try {
        const dpr = typeof window !== "undefined" ? Math.min(2, window.devicePixelRatio || 1) : 1;
        const target = Math.min(2400, Math.max(600, Math.round(pageWidthTarget(zoom) * dpr)));
        const rendered = await renderPageForEditor(source, page, target);
        if (cancelled) return;
        const extracted = await extractPageText(source, page);
        if (cancelled) return;
        url = URL.createObjectURL(new Blob([rendered.png.slice().buffer as ArrayBuffer], { type: "image/png" }));
        setRender(rendered);
        setItems(extracted.items);
        setImageUrl(url);
      } catch (error) {
        if (!cancelled) setRenderError(toPdfError(error).message);
      } finally {
        if (!cancelled) setRendering(false);
      }
    })();

    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [source, page, zoom]);

  // Raccourcis annuler / rétablir, sauf pendant l'édition d'un champ.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (editing !== null) return;
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === "z" && !event.shiftKey) {
        event.preventDefault();
        onUndo();
      } else if ((key === "z" && event.shiftKey) || key === "y") {
        event.preventDefault();
        onRedo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing, onUndo, onRedo]);

  const heightPts = render?.heightPts ?? 0;
  const widthPts = render?.widthPts ?? 0;
  const cssWidth = widthPts * zoom;
  const cssHeight = heightPts * zoom;

  const beginEdit = useCallback(
    (item: EditableTextItem) => {
      const existing = edits[keyOf(page, item.index)];
      setDraft(existing ? existing.replacementText : item.text);
      setEditing(item.index);
    },
    [edits, page],
  );

  const commit = useCallback(
    (item: EditableTextItem, value: string) => {
      const key = keyOf(page, item.index);
      const next = { ...edits };
      if (value === item.text) {
        // Retour à l'original : on retire la modification.
        if (next[key]) {
          delete next[key];
          onSetEdits(next);
        }
        setEditing(null);
        return;
      }

      // Échantillonne le fond et la couleur sous la zone, dans le rendu courant.
      let color = { r: 0.1, g: 0.1, b: 0.1 };
      let background = { r: 1, g: 1, b: 1 };
      let uniform = true;
      if (render) {
        const s = render.scale;
        const fontPx = item.fontSize * s;
        const box = {
          x: Math.round(item.x * s),
          y: Math.round((heightPts - item.y) * s - fontPx * 0.8),
          w: Math.max(4, Math.round(item.width * s)),
          h: Math.max(4, Math.round(fontPx * 1.05)),
        };
        const sampled = sampleTextStyle(render.pixels, box);
        color = sampled.text;
        background = sampled.background;
        uniform = sampled.uniform;
      }

      next[key] = {
        page,
        index: item.index,
        originalText: item.text,
        replacementText: value,
        x: item.x,
        y: item.y,
        width: item.width,
        height: item.height,
        fontSize: item.fontSize,
        bold: item.bold,
        italic: item.italic,
        fontFamily: item.fontFamily,
        vertical: item.vertical,
        rotated: item.rotated,
        color,
        background,
        uniformBackground: uniform,
      };
      onSetEdits(next);
      setEditing(null);

      if (!uniform || item.rotated || item.vertical) {
        notify.warning(
          "Zone difficile à modifier proprement",
          "Le fond n'est pas uni (photo, dégradé) ou le texte est pivoté : cette modification ne sera pas appliquée à l'export.",
        );
      }
    },
    [edits, page, render, heightPts, onSetEdits],
  );

  const exportCopy = useCallback(async () => {
    const list = Object.values(edits);
    if (list.length === 0) return;
    setExporting(true);
    try {
      const result = await applyTextEdits(source, list);
      const saved = await saveFile(result.file);
      if (saved.saved) {
        const parts = [`${result.applied} modification${result.applied > 1 ? "s" : ""} appliquée${result.applied > 1 ? "s" : ""}`];
        if (result.refused > 0) parts.push(`${result.refused} refusée${result.refused > 1 ? "s" : ""} (fond non uni)`);
        if (result.overflowed > 0) parts.push(`${result.overflowed} texte(s) ajusté(s) au plus petit`);
        notify.success("Copie enregistrée", parts.join(" · "));
      }
    } catch (error) {
      notify.error("Export impossible", toPdfError(error).message);
    } finally {
      setExporting(false);
    }
  }, [edits, source]);

  const editedItems = items.filter((item) => edits[keyOf(page, item.index)]);
  const noText = !rendering && !renderError && items.length === 0;

  return (
    <div className="space-y-3">
      {/* Barre d'outils */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface)] px-2.5 py-2">
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
            <Icon name="ChevronLeft" size={15} />
          </Button>
          <span className="min-w-[92px] text-center text-xs tabular-nums text-[var(--ft-text-muted)]">
            Page {page} / {pageCount}
          </span>
          <Button size="sm" variant="ghost" onClick={() => setPage((p) => Math.min(pageCount, p + 1))} disabled={page >= pageCount}>
            <Icon name="ChevronRight" size={15} />
          </Button>
        </div>

        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={() => setZoom((z) => Math.max(0.4, +(z - 0.2).toFixed(2)))} disabled={zoom <= 0.4}>
            <Icon name="ZoomOut" size={15} />
          </Button>
          <span className="min-w-[48px] text-center text-xs tabular-nums text-[var(--ft-text-muted)]">
            {Math.round(zoom * 100)} %
          </span>
          <Button size="sm" variant="ghost" onClick={() => setZoom((z) => Math.min(3, +(z + 0.2).toFixed(2)))} disabled={zoom >= 3}>
            <Icon name="ZoomIn" size={15} />
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setZoom(1)} title="Ajuster">
            <Icon name="Maximize" size={15} />
          </Button>
        </div>

        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={onUndo} disabled={!canUndo} title="Annuler (Ctrl+Z)">
            <Icon name="Undo2" size={15} />
          </Button>
          <Button size="sm" variant="ghost" onClick={onRedo} disabled={!canRedo} title="Rétablir (Ctrl+Maj+Z)">
            <Icon name="Redo2" size={15} />
          </Button>
          {editCount > 0 && (
            <span className="ml-1 rounded bg-[var(--ft-accent-soft)] px-2 py-0.5 text-[11px] font-medium text-[var(--ft-accent-text)]">
              {editCount} modification{editCount > 1 ? "s" : ""}
            </span>
          )}
        </div>

        <Button size="sm" variant="primary" onClick={exportCopy} disabled={editCount === 0 || exporting}>
          <Icon name={exporting ? "Loader" : "Save"} size={15} className={exporting ? "animate-spin" : undefined} />
          Enregistrer une copie
        </Button>
      </div>

      {renderError && (
        <p className="flex items-start gap-2 rounded-[var(--radius-card)] border border-[var(--ft-danger)] bg-[color-mix(in_oklch,var(--ft-danger)_8%,transparent)] px-3 py-2.5 text-sm text-[var(--ft-danger)]">
          <Icon name="CircleAlert" size={16} className="mt-0.5 shrink-0" />
          {renderError}
        </p>
      )}

      {noText && (
        <p className="flex items-start gap-2 rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface-2)] px-3 py-2.5 text-sm text-[var(--ft-text-muted)]">
          <Icon name="ScanText" size={16} className="mt-0.5 shrink-0" />
          Aucun texte éditable détecté sur cette page. Le document est peut-être scanné.
        </p>
      )}

      {/* Page + couche de texte interactive */}
      <div className="flex justify-center overflow-auto rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface-2)] p-4">
        <div className="relative shadow-sm" style={{ width: cssWidth || undefined, height: cssHeight || undefined }}>
          {imageUrl && (
            <img
              src={imageUrl}
              alt={`Page ${page}`}
              draggable={false}
              className="block select-none"
              style={{ width: cssWidth, height: cssHeight }}
            />
          )}
          {rendering && (
            <div className="absolute inset-0 flex items-center justify-center bg-[color-mix(in_oklch,var(--ft-surface)_60%,transparent)]">
              <Icon name="Loader" size={20} className="animate-spin text-[var(--ft-accent)]" />
            </div>
          )}

          {render &&
            items.map((item) => {
              const box = overlayBox(item, zoom, heightPts);
              const edit = edits[keyOf(page, item.index)];
              const isEditing = editing === item.index;

              if (isEditing) {
                return (
                  <input
                    key={item.index}
                    autoFocus
                    defaultValue={draft}
                    onFocus={(e) => e.currentTarget.select()}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        commit(item, e.currentTarget.value);
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        escapedRef.current = true;
                        setEditing(null);
                      }
                    }}
                    onBlur={(e) => {
                      if (escapedRef.current) {
                        escapedRef.current = false;
                        return;
                      }
                      commit(item, e.currentTarget.value);
                    }}
                    className="absolute z-20 rounded-[2px] border border-[var(--ft-accent)] bg-[var(--ft-surface)] px-0.5 text-[var(--ft-text)] outline-none ring-2 ring-[var(--ft-accent)]"
                    style={{ left: box.left, top: box.top, minWidth: box.width, height: box.height, fontSize: box.fontSize, lineHeight: `${box.height}px` }}
                  />
                );
              }

              if (edit) {
                const clean = canEditCleanly(edit);
                return (
                  <div
                    key={item.index}
                    onDoubleClick={() => beginEdit(item)}
                    title={clean ? "Double-cliquez pour modifier" : "Cette zone ne peut pas être modifiée proprement (fond non uni ou texte pivoté)"}
                    className="absolute z-10 flex cursor-text items-center overflow-hidden whitespace-pre"
                    style={{
                      left: box.left,
                      top: box.top,
                      minWidth: box.width,
                      height: box.height,
                      fontSize: box.fontSize,
                      lineHeight: `${box.height}px`,
                      color: clean ? toCss(edit.color) : undefined,
                      background: clean ? toCss(edit.background) : undefined,
                      boxShadow: clean ? undefined : "inset 0 0 0 1.5px var(--ft-warn)",
                    }}
                  >
                    <span className="truncate">{edit.replacementText}</span>
                    {!clean && (
                      <Icon name="TriangleAlert" size={11} className="ml-0.5 shrink-0 text-[var(--ft-warn)]" />
                    )}
                  </div>
                );
              }

              return (
                <div
                  key={item.index}
                  onDoubleClick={() => beginEdit(item)}
                  title="Double-cliquez pour modifier"
                  className="absolute cursor-text rounded-[2px] hover:bg-[color-mix(in_oklch,var(--ft-accent)_18%,transparent)]"
                  style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
                />
              );
            })}
        </div>
      </div>

      <p className="flex items-center gap-1.5 text-xs text-[var(--ft-text-faint)]">
        <Icon name="Info" size={13} />
        Double-clic pour éditer · Entrée valide · Échap annule. L'export crée une copie ; le texte est
        remplacé visuellement (voir l'aide).
        {editedItems.length > 0 && ` ${editedItems.length} zone(s) modifiée(s) sur cette page.`}
      </p>
    </div>
  );
}




