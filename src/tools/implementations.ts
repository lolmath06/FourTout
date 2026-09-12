import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import type { ToolDefinition } from "@/core/tools/types";

/**
 * Table des implémentations d'outils.
 *
 * Le registre (`core/tools`) dit ce qui existe ; cette table dit ce qui est
 * réellement branché. Les deux listes doivent coïncider exactement : figurer
 * au catalogue de FourTout, c'est fonctionner. Un outil encore incomplet ne
 * s'annonce pas « bientôt » — il n'est simplement pas enregistré, et son
 * arrivée vit dans `ROADMAP.md`, pas dans l'interface.
 *
 * Ajouter un outil = créer son composant dans `src/tools/impl/`, l'ajouter ici
 * et l'ajouter au catalogue. Un test vérifie que les deux listes restent
 * alignées.
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

  // Parole locale : synthèse (Piper) et transcription (whisper.cpp) — phase 4C
  "text-to-speech": lazy(() =>
    import("./impl/speech/TextToSpeechTool").then((m) => ({ default: m.TextToSpeechTool })),
  ),
  "text-file-to-audio": lazy(() =>
    import("./impl/speech/TextFileToAudioTool").then((m) => ({ default: m.TextFileToAudioTool })),
  ),
  "pdf-to-audio": lazy(() =>
    import("./impl/speech/PdfToAudioTool").then((m) => ({ default: m.PdfToAudioTool })),
  ),
  "audio-transcribe": lazy(() =>
    import("./impl/speech/AudioTranscribeTool").then((m) => ({ default: m.AudioTranscribeTool })),
  ),
  "audio-generate-srt": lazy(() =>
    import("./impl/speech/AudioSubtitlesTool").then((m) => ({ default: m.AudioSubtitlesTool })),
  ),

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
  "document-to-pdf": lazy(() =>
    import("./impl/pdf/DocumentToPdfTool").then((m) => ({ default: m.DocumentToPdfTool })),
  ),
  "pdf-add-text": lazy(() =>
    import("./impl/pdf/PdfAddTextTool").then((m) => ({ default: m.PdfAddTextTool })),
  ),
  "pdf-add-image": lazy(() =>
    import("./impl/pdf/PdfAddImageTool").then((m) => ({ default: m.PdfAddImageTool })),
  ),
  "ocr-document": lazy(() =>
    import("./impl/pdf/PdfOcrTool").then((m) => ({ default: m.PdfOcrTool })),
  ),
  "pdf-compare": lazy(() =>
    import("./impl/pdf/PdfCompareTool").then((m) => ({ default: m.PdfCompareTool })),
  ),
  "pdf-redact": lazy(() =>
    import("./impl/pdf/PdfRedactTool").then((m) => ({ default: m.PdfRedactTool })),
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
  "image-remove-background": lazy(() =>
    import("./impl/image/ImageRemoveBackgroundTool").then((m) => ({
      default: m.ImageRemoveBackgroundTool,
    })),
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

  // Images — finition (phase 4)
  "image-batch-convert": lazy(() => import("./impl/image/ImageBatchConvertTool").then((m) => ({ default: m.ImageBatchConvertTool }))),
  "image-watermark": lazy(() => import("./impl/image/ImageWatermarkTool").then((m) => ({ default: m.ImageWatermarkTool }))),
  "image-favicon": lazy(() => import("./impl/image/ImageFaviconTool").then((m) => ({ default: m.ImageFaviconTool }))),
  "image-icon-sizes": lazy(() => import("./impl/image/ImageIconSizesTool").then((m) => ({ default: m.ImageIconSizesTool }))),
  "color-picker": lazy(() =>
    import("./impl/image/ColorInspectTool").then((m) => ({ default: m.ColorInspectTool })),
  ),

  // Phase 10 : comparaison d'images, planche-contact, média et sous-titres
  "image-compare": lazy(() =>
    import("./impl/image/ImageCompareTool").then((m) => ({ default: m.ImageCompareTool })),
  ),
  "image-contact-sheet": lazy(() =>
    import("./impl/image/ContactSheetTool").then((m) => ({ default: m.ContactSheetTool })),
  ),
  "audio-channels": lazy(() =>
    import("./impl/audio/AudioChannelsTool").then((m) => ({ default: m.AudioChannelsTool })),
  ),
  "audio-metadata": lazy(() =>
    import("./impl/audio/AudioMetadataTool").then((m) => ({ default: m.AudioMetadataTool })),
  ),
  "media-info": lazy(() =>
    import("./impl/media/MediaInspectTool").then((m) => ({ default: m.MediaInspectTool })),
  ),
  "video-frame-rate": lazy(() =>
    import("./impl/video/VideoFrameRateTool").then((m) => ({ default: m.VideoFrameRateTool })),
  ),
  "subtitle-edit": lazy(() =>
    import("./impl/text/SubtitleEditTool").then((m) => ({ default: m.SubtitleEditTool })),
  ),

  // QR (phase 4)
  "qr-generate": lazy(() => import("./impl/dev/QrGenerateTool").then((m) => ({ default: m.QrGenerateTool }))),
  "qr-read": lazy(() => import("./impl/dev/QrReadTool").then((m) => ({ default: m.QrReadTool }))),

  // Audio (phase 4)
  "audio-convert": lazy(() => import("./impl/audio/AudioConvertTool").then((m) => ({ default: m.AudioConvertTool }))),
  "audio-compress": lazy(() => import("./impl/audio/AudioCompressTool").then((m) => ({ default: m.AudioCompressTool }))),
  "audio-trim": lazy(() => import("./impl/audio/AudioTrimTool").then((m) => ({ default: m.AudioTrimTool }))),
  "audio-merge": lazy(() => import("./impl/audio/AudioMergeTool").then((m) => ({ default: m.AudioMergeTool }))),
  "audio-volume": lazy(() => import("./impl/audio/AudioVolumeTool").then((m) => ({ default: m.AudioVolumeTool }))),
  "audio-normalize": lazy(() => import("./impl/audio/AudioNormalizeTool").then((m) => ({ default: m.AudioNormalizeTool }))),
  "audio-speed": lazy(() => import("./impl/audio/AudioSpeedTool").then((m) => ({ default: m.AudioSpeedTool }))),
  "audio-remove-silence": lazy(() => import("./impl/audio/AudioRemoveSilenceTool").then((m) => ({ default: m.AudioRemoveSilenceTool }))),
  "audio-record": lazy(() => import("./impl/audio/AudioRecordTool").then((m) => ({ default: m.AudioRecordTool }))),
  "video-extract-audio": lazy(() => import("./impl/audio/VideoExtractAudioTool").then((m) => ({ default: m.VideoExtractAudioTool }))),

  // Vidéo — petits ponts (phase 4)
  "video-to-gif": lazy(() => import("./impl/video/VideoToGifTool").then((m) => ({ default: m.VideoToGifTool }))),
  "gif-to-video": lazy(() => import("./impl/video/GifToVideoTool").then((m) => ({ default: m.GifToVideoTool }))),
  "video-extract-frame": lazy(() => import("./impl/video/VideoExtractFrameTool").then((m) => ({ default: m.VideoExtractFrameTool }))),

  // Suite vidéo complète (phase 5)
  "video-convert": lazy(() => import("./impl/video/VideoConvertTool").then((m) => ({ default: m.VideoConvertTool }))),
  "video-compress": lazy(() => import("./impl/video/VideoCompressTool").then((m) => ({ default: m.VideoCompressTool }))),
  "video-resolution": lazy(() => import("./impl/video/VideoResolutionTool").then((m) => ({ default: m.VideoResolutionTool }))),
  "video-trim": lazy(() => import("./impl/video/VideoTrimTool").then((m) => ({ default: m.VideoTrimTool }))),
  "video-merge": lazy(() => import("./impl/video/VideoMergeTool").then((m) => ({ default: m.VideoMergeTool }))),
  "video-crop": lazy(() => import("./impl/video/VideoCropTool").then((m) => ({ default: m.VideoCropTool }))),
  "video-rotate": lazy(() => import("./impl/video/VideoRotateTool").then((m) => ({ default: m.VideoRotateTool }))),
  "video-speed": lazy(() => import("./impl/video/VideoSpeedTool").then((m) => ({ default: m.VideoSpeedTool }))),
  "video-remove-audio": lazy(() => import("./impl/video/VideoRemoveAudioTool").then((m) => ({ default: m.VideoRemoveAudioTool }))),
  "video-replace-audio": lazy(() => import("./impl/video/VideoReplaceAudioTool").then((m) => ({ default: m.VideoReplaceAudioTool }))),
  "video-volume": lazy(() => import("./impl/video/VideoVolumeTool").then((m) => ({ default: m.VideoVolumeTool }))),
  "video-add-subtitles": lazy(() => import("./impl/video/VideoAddSubtitlesTool").then((m) => ({ default: m.VideoAddSubtitlesTool }))),
  "video-burn-subtitles": lazy(() => import("./impl/video/VideoBurnSubtitlesTool").then((m) => ({ default: m.VideoBurnSubtitlesTool }))),
  "video-extract-subtitles": lazy(() => import("./impl/video/VideoExtractSubtitlesTool").then((m) => ({ default: m.VideoExtractSubtitlesTool }))),
  "video-generate-subtitles": lazy(() => import("./impl/video/VideoGenerateSubtitlesTool").then((m) => ({ default: m.VideoGenerateSubtitlesTool }))),
  "video-batch": lazy(() => import("./impl/video/VideoBatchTool").then((m) => ({ default: m.VideoBatchTool }))),

  // Texte (phase 6)
  "text-clean": lazy(() => import("./impl/text/TextCleanTool").then((m) => ({ default: m.TextCleanTool }))),
  "text-deduplicate": lazy(() => import("./impl/text/TextDeduplicateTool").then((m) => ({ default: m.TextDeduplicateTool }))),
  "text-sort-lines": lazy(() => import("./impl/text/TextSortLinesTool").then((m) => ({ default: m.TextSortLinesTool }))),
  "text-find-replace": lazy(() => import("./impl/text/TextFindReplaceTool").then((m) => ({ default: m.TextFindReplaceTool }))),
  "text-compare": lazy(() => import("./impl/text/TextCompareTool").then((m) => ({ default: m.TextCompareTool }))),
  "markdown-convert": lazy(() => import("./impl/text/MarkdownConvertTool").then((m) => ({ default: m.MarkdownConvertTool }))),
  "url-encode": lazy(() => import("./impl/text/UrlEncodeTool").then((m) => ({ default: m.UrlEncodeTool }))),
  "lorem-ipsum": lazy(() => import("./impl/text/LoremIpsumTool").then((m) => ({ default: m.LoremIpsumTool }))),
  "text-unicode-normalize": lazy(() => import("./impl/text/UnicodeNormalizeTool").then((m) => ({ default: m.UnicodeNormalizeTool }))),
  "text-line-endings": lazy(() => import("./impl/text/LineEndingsTool").then((m) => ({ default: m.LineEndingsTool }))),
  // Trois outils, une seule implémentation : seul le motif recherché change.
  "text-extract-urls": lazy(() => import("./impl/text/TextExtractTool").then((m) => ({ default: m.TextExtractTool }))),
  "text-extract-emails": lazy(() => import("./impl/text/TextExtractTool").then((m) => ({ default: m.TextExtractTool }))),
  "text-extract-numbers": lazy(() => import("./impl/text/TextExtractTool").then((m) => ({ default: m.TextExtractTool }))),
  "hash-text": lazy(() => import("./impl/dev/HashTextTool").then((m) => ({ default: m.HashTextTool }))),

  // Documents (phase 6)
  "docx-extract": lazy(() => import("./impl/documents/DocxExtractTool").then((m) => ({ default: m.DocxExtractTool }))),

  // Fichiers et archives (phase 6)
  "archive-create": lazy(() => import("./impl/files/ArchiveCreateTool").then((m) => ({ default: m.ArchiveCreateTool }))),
  "archive-extract": lazy(() => import("./impl/files/ArchiveExtractTool").then((m) => ({ default: m.ArchiveExtractTool }))),
  "file-hash": lazy(() => import("./impl/files/FileHashTool").then((m) => ({ default: m.FileHashTool }))),
  "file-verify-hash": lazy(() => import("./impl/files/FileHashTool").then((m) => ({ default: m.FileHashTool }))),
  "file-compare": lazy(() => import("./impl/files/FileCompareTool").then((m) => ({ default: m.FileCompareTool }))),
  "file-find-duplicates": lazy(() => import("./impl/files/FileDuplicatesTool").then((m) => ({ default: m.FileDuplicatesTool }))),
  "file-split": lazy(() => import("./impl/files/FileSplitTool").then((m) => ({ default: m.FileSplitTool }))),
  "file-join": lazy(() => import("./impl/files/FileJoinTool").then((m) => ({ default: m.FileJoinTool }))),
  "file-bulk-rename": lazy(() => import("./impl/files/BulkRenameTool").then((m) => ({ default: m.BulkRenameTool }))),
  "file-clean-names": lazy(() => import("./impl/files/BulkRenameTool").then((m) => ({ default: m.BulkRenameTool }))),
  "folder-size": lazy(() => import("./impl/files/FolderSizeTool").then((m) => ({ default: m.FolderSizeTool }))),
  "folder-tree": lazy(() => import("./impl/files/FolderTreeTool").then((m) => ({ default: m.FolderTreeTool }))),
  "file-info": lazy(() => import("./impl/files/FileInspectTool").then((m) => ({ default: m.FileInspectTool }))),
  "folder-compare": lazy(() => import("./impl/files/FolderCompareTool").then((m) => ({ default: m.FolderCompareTool }))),
  "folder-sync": lazy(() => import("./impl/files/FolderSyncTool").then((m) => ({ default: m.FolderSyncTool }))),
  "file-search": lazy(() => import("./impl/files/FileSearchTool").then((m) => ({ default: m.FileSearchTool }))),
  "file-preview": lazy(() => import("./impl/files/FilePreviewTool").then((m) => ({ default: m.FilePreviewTool }))),
  "file-hex-edit": lazy(() => import("./impl/files/HexEditorTool").then((m) => ({ default: m.HexEditorTool }))),
  "folder-backup": lazy(() => import("./impl/files/FolderBackupTool").then((m) => ({ default: m.FolderBackupTool }))),
  "folder-restore": lazy(() => import("./impl/files/FolderRestoreTool").then((m) => ({ default: m.FolderRestoreTool }))),
  "checksum-manifest": lazy(() => import("./impl/files/ChecksumManifestTool").then((m) => ({ default: m.ChecksumManifestTool }))),
  "checksum-verify": lazy(() => import("./impl/files/ChecksumManifestTool").then((m) => ({ default: m.ChecksumManifestTool }))),
  hmac: lazy(() => import("./impl/security/HmacTool").then((m) => ({ default: m.HmacTool }))),
  "file-compress": lazy(() => import("./impl/files/StreamCompressTool").then((m) => ({ default: m.StreamCompressTool }))),
  "file-decompress": lazy(() => import("./impl/files/StreamCompressTool").then((m) => ({ default: m.StreamCompressTool }))),
  "archive-inspect": lazy(() => import("./impl/files/ArchiveInspectTool").then((m) => ({ default: m.ArchiveInspectTool }))),
  "archive-test": lazy(() => import("./impl/files/ArchiveInspectTool").then((m) => ({ default: m.ArchiveInspectTool }))),

  // Convertisseur universel (phase 6) : il route, il ne convertit pas.
  "universal-converter": lazy(() => import("./impl/converters/UniversalConverterTool").then((m) => ({ default: m.UniversalConverterTool }))),

  // --------------------------------------------------------------- phase 7
  // Développeur : formats de données, code, jetons, expressions, planification.
  "json-tools": lazy(() => import("./impl/dev/DataFormatTools").then((m) => ({ default: m.JsonTool }))),
  "yaml-format": lazy(() => import("./impl/dev/DataFormatTools").then((m) => ({ default: m.YamlTool }))),
  "xml-format": lazy(() => import("./impl/dev/DataFormatTools").then((m) => ({ default: m.XmlTool }))),
  "sql-format": lazy(() => import("./impl/dev/CodeFormatTools").then((m) => ({ default: m.SqlFormatTool }))),
  "web-beautify": lazy(() => import("./impl/dev/CodeFormatTools").then((m) => ({ default: m.WebBeautifyTool }))),
  "web-minify": lazy(() => import("./impl/dev/CodeFormatTools").then((m) => ({ default: m.WebMinifyTool }))),
  "jwt-decode": lazy(() => import("./impl/dev/TokenTools").then((m) => ({ default: m.JwtDecodeTool }))),
  "uuid-generate": lazy(() => import("./impl/dev/TokenTools").then((m) => ({ default: m.UuidTool }))),
  "timestamp-convert": lazy(() => import("./impl/dev/TokenTools").then((m) => ({ default: m.TimestampTool }))),
  "number-base-convert": lazy(() => import("./impl/dev/TokenTools").then((m) => ({ default: m.NumberBaseTool }))),
  "regex-tester": lazy(() => import("./impl/dev/RegexCronTools").then((m) => ({ default: m.RegexTesterTool }))),
  "cron-helper": lazy(() => import("./impl/dev/RegexCronTools").then((m) => ({ default: m.CronTool }))),
  "code-diff": lazy(() => import("./impl/dev/CodeDiffTool").then((m) => ({ default: m.CodeDiffTool }))),

  // Calculateurs : dix convertisseurs d'unités sur un seul moteur, puis les
  // calculs du quotidien.
  "unit-length": lazy(() => import("./impl/calculators/UnitConverterTool").then((m) => ({ default: m.UnitLengthTool }))),
  "unit-weight": lazy(() => import("./impl/calculators/UnitConverterTool").then((m) => ({ default: m.UnitMassTool }))),
  "unit-temperature": lazy(() => import("./impl/calculators/UnitConverterTool").then((m) => ({ default: m.UnitTemperatureTool }))),
  "unit-volume": lazy(() => import("./impl/calculators/UnitConverterTool").then((m) => ({ default: m.UnitVolumeTool }))),
  "unit-area": lazy(() => import("./impl/calculators/UnitConverterTool").then((m) => ({ default: m.UnitAreaTool }))),
  "unit-speed": lazy(() => import("./impl/calculators/UnitConverterTool").then((m) => ({ default: m.UnitSpeedTool }))),
  "unit-pressure": lazy(() => import("./impl/calculators/UnitConverterTool").then((m) => ({ default: m.UnitPressureTool }))),
  "unit-energy": lazy(() => import("./impl/calculators/UnitConverterTool").then((m) => ({ default: m.UnitEnergyTool }))),
  "unit-power": lazy(() => import("./impl/calculators/UnitConverterTool").then((m) => ({ default: m.UnitPowerTool }))),
  "unit-data": lazy(() => import("./impl/calculators/UnitConverterTool").then((m) => ({ default: m.UnitDataTool }))),
  "calc-percentage": lazy(() => import("./impl/calculators/ArithmeticTools").then((m) => ({ default: m.PercentageTool }))),
  "calc-proportion": lazy(() => import("./impl/calculators/ArithmeticTools").then((m) => ({ default: m.ProportionTool }))),
  "calc-date-difference": lazy(() => import("./impl/calculators/DateTools").then((m) => ({ default: m.DateDifferenceTool }))),
  "calc-duration": lazy(() => import("./impl/calculators/DateTools").then((m) => ({ default: m.DurationTool }))),
  "calc-age": lazy(() => import("./impl/calculators/DateTools").then((m) => ({ default: m.AgeTool }))),
  "calc-scientific": lazy(() => import("./impl/calculators/ScientificTool").then((m) => ({ default: m.ScientificCalculatorTool }))),
  "calc-currency": lazy(() => import("./impl/calculators/CurrencyTool").then((m) => ({ default: m.CurrencyTool }))),

  // Sécurité : mots de passe, chiffrement de fichiers, métadonnées.
  "password-generate": lazy(() => import("./impl/security/PasswordTools").then((m) => ({ default: m.PasswordGenerateTool }))),
  "password-strength": lazy(() => import("./impl/security/PasswordTools").then((m) => ({ default: m.PasswordStrengthTool }))),
  "file-encrypt": lazy(() => import("./impl/security/FileCryptoTools").then((m) => ({ default: m.FileEncryptTool }))),
  "file-decrypt": lazy(() => import("./impl/security/FileCryptoTools").then((m) => ({ default: m.FileDecryptTool }))),
  "metadata-strip-any": lazy(() => import("./impl/security/MetadataStripTool").then((m) => ({ default: m.MetadataStripTool }))),

  // Fichiers : archive protégée, rangement, effacement renforcé.
  "archive-encrypted": lazy(() => import("./impl/files/EncryptedArchiveTool").then((m) => ({ default: m.EncryptedArchiveTool }))),
  "file-organize": lazy(() => import("./impl/files/OrganizeFolderTool").then((m) => ({ default: m.OrganizeFolderTool }))),
  "file-secure-delete": lazy(() => import("./impl/files/SecureDeleteTool").then((m) => ({ default: m.SecureDeleteTool }))),

  // Documents : Word vers PDF, en réutilisant le lecteur DOCX et le moteur PDF.
  "docx-to-pdf": lazy(() => import("./impl/documents/DocxToPdfTool").then((m) => ({ default: m.DocxToPdfTool }))),
  // Intelligence documentaire — phase 8
  "pdf-searchable": lazy(() =>
    import("./impl/pdf/PdfSearchableTool").then((m) => ({ default: m.PdfSearchableTool })),
  ),
  "pdf-extract-tables": lazy(() =>
    import("./impl/pdf/PdfExtractTablesTool").then((m) => ({ default: m.PdfExtractTablesTool })),
  ),
  "scans-to-pdf": lazy(() =>
    import("./impl/pdf/ScansToPdfTool").then((m) => ({ default: m.ScansToPdfTool })),
  ),
  "document-perspective": lazy(() =>
    import("./impl/image/DocumentPerspectiveTool").then((m) => ({
      default: m.DocumentPerspectiveTool,
    })),
  ),
  "scan-clean": lazy(() =>
    import("./impl/image/ScanCleanTool").then((m) => ({ default: m.ScanCleanTool })),
  ),
  "document-compare": lazy(() =>
    import("./impl/text/DocumentCompareTool").then((m) => ({ default: m.DocumentCompareTool })),
  ),
  "text-encoding-detect": lazy(() =>
    import("./impl/text/TextEncodingDetectTool").then((m) => ({
      default: m.TextEncodingDetectTool,
    })),
  ),
  "text-encoding-convert": lazy(() =>
    import("./impl/text/TextEncodingConvertTool").then((m) => ({
      default: m.TextEncodingConvertTool,
    })),
  ),
};

export function getToolComponent(toolId: string): ToolComponent | undefined {
  return TOOL_IMPLEMENTATIONS[toolId];
}

export function implementedToolIds(): string[] {
  return Object.keys(TOOL_IMPLEMENTATIONS);
}
