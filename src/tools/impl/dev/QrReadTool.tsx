import { useEffect, useState } from "react";
import { constraintsForTool, type SelectedFile } from "@/core/files";
import { FileDropZone } from "@/components/files/FileDropZone";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { useSourceCanvas } from "@/components/image/useSourceCanvas";
import { decodeQr, looksLikeUrl } from "@/core/image/qr";
import { notify } from "@/features/notifications/store";
import { openExternalUrl } from "@/core/output/externalUrl";
import type { ToolComponentProps } from "@/tools/implementations";

export function QrReadTool({ tool }: ToolComponentProps) {
  const [files, setFiles] = useState<SelectedFile[]>([]);
  const [content, setContent] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const source = useSourceCanvas(files[0]);

  useEffect(() => {
    setContent(null);
    setNotFound(false);
    if (source.full) {
      const result = decodeQr(source.full.getPixels());
      if (result) setContent(result);
      else setNotFound(true);
    }
  }, [source.full]);

  const openLink = async (url: string) => {
    const opened = await openExternalUrl(url).catch(() => false);
    if (!opened) notify.error("Lien non ouvrable", "Ce contenu n'est pas une adresse web valide.");
  };

  return (
    <div className="space-y-4">
      <FileDropZone constraints={{ ...constraintsForTool(tool), maxFiles: 1 }} files={files} onChange={setFiles} label="Déposez une image contenant un QR code" />
      {content && (
        <div className="rounded-[var(--radius-card)] border border-[color-mix(in_oklch,var(--ft-ok)_45%,var(--ft-border))] bg-[color-mix(in_oklch,var(--ft-ok)_6%,transparent)] p-3">
          <p className="mb-2 text-xs text-[var(--ft-text-muted)]">Contenu détecté :</p>
          <p className="break-all font-mono text-sm">{content}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="primary" onClick={() => navigator.clipboard.writeText(content).then(() => notify.success("Copié")).catch(() => {})}><Icon name="Copy" size={14} /> Copier</Button>
            {looksLikeUrl(content) && (
              <Button size="sm" onClick={() => void openLink(content)}><Icon name="Globe" size={14} /> Ouvrir le lien</Button>
            )}
          </div>
        </div>
      )}
      {notFound && (
        <p className="flex items-center gap-2 rounded-md border border-[var(--ft-border)] bg-[var(--ft-surface-2)] px-3 py-2 text-sm text-[var(--ft-text-muted)]">
          <Icon name="Info" size={15} /> Aucun QR code détecté dans cette image.
        </p>
      )}
    </div>
  );
}
