import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import type { ToolDefinition } from "@/core/tools/types";

/**
 * Table des implémentations d'outils.
 *
 * Le registre (`core/tools`) dit ce qui existe ; cette table dit ce qui est
 * réellement branché. Un outil absent d'ici s'affiche avec la vue « bientôt
 * disponible » : c'est le point d'extension des prochaines phases.
 *
 * Ajouter un outil implémenté = créer son composant dans `src/tools/impl/`,
 * l'ajouter ici, et passer son `status` à `"available"` dans le catalogue.
 * Un test vérifie que ces deux listes restent cohérentes.
 */
export interface ToolComponentProps {
  tool: ToolDefinition;
}

export type ToolComponent =
  | ComponentType<ToolComponentProps>
  | LazyExoticComponent<ComponentType<ToolComponentProps>>;

export const TOOL_IMPLEMENTATIONS: Record<string, ToolComponent> = {
  "text-statistics": lazy(() =>
    import("./impl/TextStatisticsTool").then((m) => ({ default: m.TextStatisticsTool })),
  ),
  "text-case": lazy(() =>
    import("./impl/TextCaseTool").then((m) => ({ default: m.TextCaseTool })),
  ),
  base64: lazy(() => import("./impl/Base64Tool").then((m) => ({ default: m.Base64Tool }))),

  // Outils PDF (phase 2)
  "pdf-merge": lazy(() =>
    import("./impl/pdf/PdfMergeTool").then((m) => ({ default: m.PdfMergeTool })),
  ),
  "pdf-split": lazy(() =>
    import("./impl/pdf/PdfSplitTool").then((m) => ({ default: m.PdfSplitTool })),
  ),
  "pdf-extract-pages": lazy(() =>
    import("./impl/pdf/PdfExtractPagesTool").then((m) => ({ default: m.PdfExtractPagesTool })),
  ),
  "pdf-remove-pages": lazy(() =>
    import("./impl/pdf/PdfRemovePagesTool").then((m) => ({ default: m.PdfRemovePagesTool })),
  ),
  "pdf-reorder-pages": lazy(() =>
    import("./impl/pdf/PdfReorderTool").then((m) => ({ default: m.PdfReorderTool })),
  ),
  "pdf-rotate": lazy(() =>
    import("./impl/pdf/PdfRotateTool").then((m) => ({ default: m.PdfRotateTool })),
  ),
  "images-to-pdf": lazy(() =>
    import("./impl/pdf/ImagesToPdfTool").then((m) => ({ default: m.ImagesToPdfTool })),
  ),
  "pdf-to-images": lazy(() =>
    import("./impl/pdf/PdfToImagesTool").then((m) => ({ default: m.PdfToImagesTool })),
  ),
  "pdf-watermark": lazy(() =>
    import("./impl/pdf/PdfWatermarkTool").then((m) => ({ default: m.PdfWatermarkTool })),
  ),
  "pdf-page-numbers": lazy(() =>
    import("./impl/pdf/PdfPageNumbersTool").then((m) => ({ default: m.PdfPageNumbersTool })),
  ),
  "pdf-metadata": lazy(() =>
    import("./impl/pdf/PdfMetadataTool").then((m) => ({ default: m.PdfMetadataTool })),
  ),
  "pdf-extract-text": lazy(() =>
    import("./impl/pdf/PdfExtractTextTool").then((m) => ({ default: m.PdfExtractTextTool })),
  ),
  "pdf-edit-text": lazy(() =>
    import("./impl/pdf/PdfEditTextTool").then((m) => ({ default: m.PdfEditTextTool })),
  ),
  "pdf-extract-images": lazy(() =>
    import("./impl/pdf/PdfExtractImagesTool").then((m) => ({ default: m.PdfExtractImagesTool })),
  ),
  "pdf-protect": lazy(() =>
    import("./impl/pdf/PdfProtectTool").then((m) => ({ default: m.PdfProtectTool })),
  ),
  "pdf-unlock": lazy(() =>
    import("./impl/pdf/PdfUnlockTool").then((m) => ({ default: m.PdfUnlockTool })),
  ),
  "pdf-compress": lazy(() =>
    import("./impl/pdf/PdfCompressTool").then((m) => ({ default: m.PdfCompressTool })),
  ),
  "pdf-recover-password": lazy(() =>
    import("./impl/pdf/PdfRecoverPasswordTool").then((m) => ({ default: m.PdfRecoverPasswordTool })),
  ),

  // Outils Image (phase 3)
  "image-convert": lazy(() =>
    import("./impl/image/ImageConvertTool").then((m) => ({ default: m.ImageConvertTool })),
  ),
  "image-compress": lazy(() =>
    import("./impl/image/ImageCompressTool").then((m) => ({ default: m.ImageCompressTool })),
  ),
  "image-resize": lazy(() =>
    import("./impl/image/ImageResizeTool").then((m) => ({ default: m.ImageResizeTool })),
  ),
  "image-crop": lazy(() =>
    import("./impl/image/ImageCropTool").then((m) => ({ default: m.ImageCropTool })),
  ),
  "image-rotate": lazy(() =>
    import("./impl/image/RotateFlipTool").then((m) => ({ default: m.RotateFlipTool })),
  ),
  "image-flip": lazy(() =>
    import("./impl/image/ImageFlipTool").then((m) => ({ default: m.ImageFlipTool })),
  ),
  "image-grayscale": lazy(() =>
    import("./impl/image/ImageGrayscaleTool").then((m) => ({ default: m.ImageGrayscaleTool })),
  ),
  "image-adjust": lazy(() =>
    import("./impl/image/ImageAdjustTool").then((m) => ({ default: m.ImageAdjustTool })),
  ),
  "image-blur": lazy(() =>
    import("./impl/image/ImageBlurTool").then((m) => ({ default: m.ImageBlurTool })),
  ),
  "image-remove-transparency": lazy(() =>
    import("./impl/image/ImageRemoveTransparencyTool").then((m) => ({ default: m.ImageRemoveTransparencyTool })),
  ),
  "image-color-transparent": lazy(() =>
    import("./impl/image/ImageColorTransparentTool").then((m) => ({ default: m.ImageColorTransparentTool })),
  ),
  "image-ocr": lazy(() =>
    import("./impl/image/ImageOcrTool").then((m) => ({ default: m.ImageOcrTool })),
  ),
  "image-add-text": lazy(() =>
    import("./impl/image/ImageAddTextTool").then((m) => ({ default: m.ImageAddTextTool })),
  ),
  "image-metadata-read": lazy(() =>
    import("./impl/image/ImageMetadataReadTool").then((m) => ({ default: m.ImageMetadataReadTool })),
  ),
  "image-metadata-strip": lazy(() =>
    import("./impl/image/ImageMetadataStripTool").then((m) => ({ default: m.ImageMetadataStripTool })),
  ),
};

export function getToolComponent(toolId: string): ToolComponent | undefined {
  return TOOL_IMPLEMENTATIONS[toolId];
}

export function implementedToolIds(): string[] {
  return Object.keys(TOOL_IMPLEMENTATIONS);
}
