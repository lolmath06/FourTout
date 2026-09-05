import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FileDropZone } from "@/components/files/FileDropZone";
import { Icon } from "@/components/ui/Icon";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatFileSize, type SelectedFile } from "@/core/files";
import { conversionsFor, KIND_LABELS, presetForTarget, type ConversionTarget } from "@/core/convert/graph";
import { setHandoff } from "@/features/handoff/store";
import { toolRoute, type DataKind } from "@/core/tools/types";
import type { ToolComponentProps } from "@/tools/implementations";

/**
 * Convertisseur universel.
 *
 * Il **ne convertit rien lui-même**. Il identifie le fichier, demande au
 * registre quelles conversions existent réellement, puis ouvre l'outil
 * spécialisé avec le fichier déjà chargé et le format déjà choisi. Dupliquer
 * ici les moteurs image, FFmpeg, PDF ou TTS serait la garantie de deux
 * comportements divergents ; il n'y a donc qu'un seul chemin de code par
 * conversion, celui de l'outil dédié.
 */
export function UniversalConverterTool({ tool }: ToolComponentProps) {
  const [files, setFiles] = useState<SelectedFile[]>([]);
  const navigate = useNavigate();
  const file = files[0];

  const targets = useMemo(() => (file ? conversionsFor(file.extension) : []), [file]);
  const grouped = useMemo(() => groupByKind(targets), [targets]);

  const open = (target: ConversionTarget) => {
    setHandoff({
      toolId: target.toolId,
      files: file ? [file] : undefined,
      preset: presetForTarget(target),
    });
    navigate(toolRoute(target.toolId));
  };

  return (
    <div className="space-y-4">
      <FileDropZone
        constraints={{ inputs: [], maxFiles: 1 }}
        files={files}
        onChange={setFiles}
        label="Déposez un fichier"
        hint="FourTout identifie le format et propose les conversions réellement disponibles."
      />

      {file && (
        <div
          data-testid="converter-detection"
          className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-[var(--ft-border)] bg-[var(--ft-surface-2)] px-3 py-2 text-sm"
        >
          <span className="flex items-center gap-1.5 font-medium">
            <Icon name="FileSearch" size={15} />
            {file.extension ? file.extension.toUpperCase() : "Format inconnu"}
          </span>
          <span className="text-[var(--ft-text-muted)]">{file.name}</span>
          <span className="tabular-nums text-[var(--ft-text-muted)]">{formatFileSize(file.size)}</span>
          <span className="font-mono text-xs text-[var(--ft-text-faint)]">{file.mimeType}</span>
        </div>
      )}

      {file && targets.length === 0 && (
        <EmptyState
          icon="Shuffle"
          title="Aucune conversion disponible pour ce format"
          description={`FourTout ne propose pour l'instant aucune conversion depuis « ${
            file.extension || "ce type de fichier"
          } ». Les outils encore prévus n'apparaissent jamais ici : seule une conversion réellement implémentée est proposée.`}
        />
      )}

      {targets.length > 0 && (
        <div className="space-y-4">
          <p className="text-sm font-medium">Convertir vers</p>
          {grouped.map(([kind, entries]) => (
            <div key={kind}>
              <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-[var(--ft-text-faint)]">
                {KIND_LABELS[kind]}
              </p>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {entries.map((target) => (
                  <button
                    key={`${target.toolId}-${target.to}`}
                    type="button"
                    data-testid={`convert-to-${target.to}`}
                    onClick={() => open(target)}
                    className="flex items-start gap-2.5 rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface)] px-3 py-2.5 text-left transition-colors hover:border-[var(--ft-accent)]"
                  >
                    <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-[var(--ft-surface-2)] text-[var(--ft-text-muted)]">
                      <Icon name={target.toolIcon} size={16} />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{target.to.toUpperCase()}</span>
                      <span className="block truncate text-xs text-[var(--ft-text-muted)]">
                        {target.toolName}
                      </span>
                    </span>
                    <Icon name="ArrowRight" size={15} className="ml-auto mt-1 shrink-0 text-[var(--ft-text-faint)]" />
                  </button>
                ))}
              </div>
            </div>
          ))}
          <p className="flex items-start gap-2 text-xs text-[var(--ft-text-muted)]">
            <Icon name="Info" size={13} className="mt-px shrink-0" />
            Le bouton ouvre l'outil spécialisé avec votre fichier déjà chargé et le format
            présélectionné : les réglages fins (qualité, codec, résolution) restent disponibles.
          </p>
        </div>
      )}

      {!file && (
        <p className="text-xs text-[var(--ft-text-muted)]">
          {tool.description}
        </p>
      )}
    </div>
  );
}

function groupByKind(targets: ConversionTarget[]): [DataKind, ConversionTarget[]][] {
  const groups = new Map<DataKind, ConversionTarget[]>();
  for (const target of targets) {
    const list = groups.get(target.kind);
    if (list) list.push(target);
    else groups.set(target.kind, [target]);
  }
  return [...groups.entries()];
}
