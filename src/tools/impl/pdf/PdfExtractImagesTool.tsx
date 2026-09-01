import { PdfToolShell } from "@/components/pdf/PdfToolShell";
import { Icon } from "@/components/ui/Icon";
import { extractImages } from "@/core/pdf/operations/extractImages";
import type { ToolComponentProps } from "@/tools/implementations";

export function PdfExtractImagesTool({ tool }: ToolComponentProps) {
  return (
    <div className="space-y-4">
      <p className="flex items-start gap-2 rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface-2)] px-3 py-2.5 text-xs text-[var(--ft-text-muted)]">
        <Icon name="Info" size={14} className="mt-px shrink-0" />
        Les images JPEG sont récupérées telles quelles, sans réencodage ni perte de qualité. Les
        images stockées en pixels bruts sont converties en PNG. Les encodages rares (JPEG 2000,
        fax, JBIG2) sont signalés et laissés de côté plutôt que produits corrompus.
      </p>

      <PdfToolShell
        tool={tool}
        actionLabel="Extraire les images"
        run={async ({ documents, context }) => {
          const result = await extractImages(documents[0].source, context);
          return {
            files: result.files,
            summary: `${result.files.length} image${result.files.length > 1 ? "s" : ""} extraite${result.files.length > 1 ? "s" : ""} sur ${result.found} trouvée${result.found > 1 ? "s" : ""}.`,
            warning:
              result.skipped.length > 0
                ? `${result.skipped.length} image(s) ignorée(s) : ${[...new Set(result.skipped.map((s) => s.reason))].join(", ")}.`
                : undefined,
            zipName: "images-extraites.zip",
          };
        }}
      />
    </div>
  );
}
