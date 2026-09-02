import { useEffect, useState } from "react";
import { constraintsForTool, formatFileSize, type SelectedFile } from "@/core/files";
import { FileDropZone } from "@/components/files/FileDropZone";
import { Icon } from "@/components/ui/Icon";
import { readSelectedFile, decodeImage } from "@/core/image/codec";
import { parseExif, type ExifData } from "@/core/image/exif";
import { toImageError } from "@/core/image/errors";
import type { ToolComponentProps } from "@/tools/implementations";

interface Meta {
  format: string;
  width: number;
  height: number;
  exif?: ExifData;
}

export function ImageMetadataReadTool({ tool }: ToolComponentProps) {
  const [files, setFiles] = useState<SelectedFile[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [error, setError] = useState<string>();
  const file = files[0];

  useEffect(() => {
    let cancelled = false;
    setMeta(null);
    setError(undefined);
    if (!file) return;
    (async () => {
      try {
        const bytes = await readSelectedFile(file);
        const canvas = await decodeImage(bytes, file.extension);
        const exif = parseExif(bytes);
        if (!cancelled) {
          setMeta({ format: file.extension.toUpperCase() || "—", width: canvas.width, height: canvas.height, exif });
        }
      } catch (e) {
        if (!cancelled) setError(toImageError(e).message);
      }
    })();
    return () => { cancelled = true; };
  }, [file]);

  return (
    <div className="space-y-4">
      <FileDropZone
        constraints={{ ...constraintsForTool(tool), maxFiles: 1 }}
        files={files}
        onChange={setFiles}
        label="Déposez votre image ici"
      />
      {error && (
        <p className="flex items-center gap-2 rounded-md border border-[var(--ft-danger)] px-3 py-2 text-sm text-[var(--ft-danger)]">
          <Icon name="CircleAlert" size={16} /> {error}
        </p>
      )}
      {file && meta && <MetaTable file={file} meta={meta} />}
    </div>
  );
}

function MetaTable({ file, meta }: { file: SelectedFile; meta: Meta }) {
  const e = meta.exif;
  const rows: [string, string | undefined][] = [
    ["Format", meta.format],
    ["Dimensions", `${meta.width} × ${meta.height} px`],
    ["Taille du fichier", formatFileSize(file.size)],
    ["Orientation", e?.orientation ? `EXIF ${e.orientation}` : undefined],
    ["Appareil", [e?.make, e?.model].filter(Boolean).join(" ") || undefined],
    ["Logiciel", e?.software],
    ["Date de prise de vue", e?.dateTimeOriginal ?? e?.dateTime],
    ["Exposition", e?.exposureTime],
    ["Ouverture", e?.fNumber ? `f/${e.fNumber}` : undefined],
    ["ISO", e?.iso ? String(e.iso) : undefined],
    ["Focale", e?.focalLength ? `${e.focalLength} mm` : undefined],
    ["Objectif", e?.lens],
    ["Altitude GPS", e?.gpsAltitude !== undefined ? `${e.gpsAltitude} m` : undefined],
  ];
  const hasExif = (e?.tagCount ?? 0) > 0;

  return (
    <div className="space-y-3">
      <dl className="grid gap-px overflow-hidden rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-border)] sm:grid-cols-2">
        {rows.filter(([, value]) => value).map(([label, value]) => (
          <div key={label} className="flex flex-col gap-0.5 bg-[var(--ft-surface)] px-3 py-2">
            <dt className="text-[11px] uppercase tracking-wide text-[var(--ft-text-faint)]">{label}</dt>
            <dd className="text-sm">{value}</dd>
          </div>
        ))}
      </dl>

      {e?.gpsLatitude !== undefined && e?.gpsLongitude !== undefined && (
        <a
          href={`https://www.openstreetmap.org/?mlat=${e.gpsLatitude}&mlon=${e.gpsLongitude}#map=15/${e.gpsLatitude}/${e.gpsLongitude}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 rounded-md border border-[var(--ft-border)] px-3 py-2 text-sm text-[var(--ft-accent-text)] hover:bg-[var(--ft-surface-2)]"
        >
          <Icon name="MapPin" size={15} />
          {e.gpsLatitude.toFixed(6)}, {e.gpsLongitude.toFixed(6)} — voir sur la carte
        </a>
      )}

      {!hasExif && (
        <p className="flex items-center gap-2 rounded-md border border-[var(--ft-border)] bg-[var(--ft-surface-2)] px-3 py-2 text-xs text-[var(--ft-text-muted)]">
          <Icon name="Info" size={14} />
          Aucune métadonnée EXIF détectée dans cette image.
        </p>
      )}
    </div>
  );
}
