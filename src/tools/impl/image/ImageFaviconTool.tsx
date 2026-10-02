import { ImageToolShell } from "@/components/image/ImageToolShell";
import { readSelectedFile, decodeOriented } from "@/core/image/codec";
import { buildIco, squareResize, FAVICON_SIZES } from "@/core/image/favicon";
import { baseName } from "@/core/pdf/filenames";
import type { OutputFile } from "@/core/pdf/types";
import type { ToolComponentProps } from "@/tools/implementations";
import { t } from "@/i18n";

const EXTRA = [180, 192, 512];

export function ImageFaviconTool({ tool }: ToolComponentProps) {
  return (
    <ImageToolShell
      tool={tool}
      selection="single"
      actionLabel={t("Générer le favicon")}
      hint={t("Produit un vrai favicon.ico multi-résolutions (16/32/48) et les PNG utiles.")}
      run={async ({ files, context }) => {
        const bytes = await readSelectedFile(files[0]);
        const { canvas } = await decodeOriented(bytes, files[0].extension);
        const stem = baseName(files[0].name) || "favicon";
        const outputs: OutputFile[] = [];

        const icoEntries = [];
        for (const size of FAVICON_SIZES) {
          const png = await squareResize(canvas, size).encode("png");
          icoEntries.push({ size, png });
          outputs.push({ name: t("{stem}-{size}.png", { stem, size }), bytes: png, mimeType: "image/png" });
        }
        outputs.unshift({ name: "favicon.ico", bytes: buildIco(icoEntries), mimeType: "image/x-icon" });

        for (const [index, size] of EXTRA.entries()) {
          context.report?.({ ratio: index / EXTRA.length, label: t("PNG {size}px", { size }) });
          outputs.push({ name: t("{stem}-{size}.png", { stem, size }), bytes: await squareResize(canvas, size).encode("png"), mimeType: "image/png" });
        }
        return { files: outputs, summary: t("favicon.ico + PNG générés."), zipName: "favicon.zip" };
      }}
    />
  );
}
