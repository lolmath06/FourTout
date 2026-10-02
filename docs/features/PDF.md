# PDF architecture

[English](PDF.md) | [Français](../fr/features/PDF.md)

[← Documentation](../README.md)

## Libraries

| Library | License | Role |
| --- | --- | --- |
| `@cantoo/pdf-lib` 2.9 | MIT | Structure, pages, annotations, metadata, and AES-256 encryption/decryption |
| `pdfjs-dist` 6.3 | Apache-2.0 | Rendering, text extraction, and protected-document opening |

Everything runs in the WebView without a system binary. The maintained Cantoo
fork preserves pdf-lib's API and adds ISO 32000-2 revision 6 AES-256. pdf.js
provides the mature renderer and text layer that pdf-lib lacks. Ghostscript was
rejected for AGPL licensing; qpdf would add redundant packaging; Poppler would
produce different Linux and Windows behavior.

## Code organization and rules

`src/core/pdf/` contains typed errors, validated document loading, page-range
parsing, safe names, lazy local pdf.js assets, image-object decoding, bitmap
backends, and operations for pages, images, annotations, metadata, protection,
text/image extraction, and compression. Shared UI lives in
`src/components/pdf/`; individual tools live in `src/tools/impl/pdf/`.

All operations follow four rules: never modify source files; load only through
the validating `loadPdf` entry point; return stable `PdfError` codes; and accept
an operation context for progress and cancellation. `RasterBackend` uses
WebView canvas in production and `@napi-rs/canvas` in Node tests, enabling real
render and compression tests rather than mocks.

`PdfToolShell` provides drop, inspection, password prompts, progress,
cancellation, errors, result saving, ZIP, and native open/reveal actions.
Shared fields, sliders, position pickers, page ranges, and page grids keep tools
consistent.

To add an operation, implement it under `operations/`, test it on a real PDF,
wrap it in `PdfToolShell`, and register both implementation and catalog entry.
A test requires those registries to match exactly.

## Known limitations

Light compression rewrites structure losslessly. Balanced and strong modes
decode, downscale, and JPEG-encode suitable embedded images while preserving
vector text. Images with alpha, JPEG 2000, CCITT, JBIG2, indexed, or ICC color
are left unchanged. Text-only documents may not shrink, and growth is reported.

AES-256 protection is interoperably tested with pdf.js. The library does not
retain title, author, subject, and keywords when writing encrypted output, so
the UI warns before acting. Unlocking always requires the password.

JPEG extraction copies original bytes. Supported raw zlib RGB/grayscale images
become PNG; unsupported encodings are reported and skipped. pdf-lib processes
whole documents in memory, while rendering is page-by-page. Reorder thumbnails
are capped at 60 pages without limiting the operation itself.

## Additional PDF tools

Document-to-PDF, placed text or images/signatures, scanned-document OCR, visual
comparison, and true redaction reuse existing layout, render, and OCR
infrastructure. Redacted pages are rasterized after masks are painted, removing
their text layer entirely; tests require the secret to be absent from both text
extraction and raw bytes. Unchanged pages remain vector. All cataloged PDF tools,
including PDF-to-audio, are delivered.

## Edit PDF text (`pdf-edit-text`)

The editor renders only the current page to a temporary PNG and overlays
clickable HTML boxes from pdf.js text content. Previous images and URLs are
released when navigating or zooming.

Editing is an honest **visual replacement**, not arbitrary rewriting of PDF
content streams and subset fonts. The operation samples a uniform background,
covers the old glyphs, and draws approximated replacement text. It refuses
non-uniform backgrounds and rotated/vertical text. Long replacements shrink no
further than 60% before overflow is reported.

Original text remains extractable underneath the visual replacement. Users who
must remove information should use redaction. The feature works best for small
changes to horizontal standard-font text on uniform backgrounds; scans and
outlined or exotic glyphs are reported as unsupported.

## PDF to audio (`pdf-to-audio`)

This tool reuses pdf.js extraction, Tesseract OCR for scans, and the shared
speech pipeline. `core/speech/pdfText.ts` removes only short first/last-page
lines that are isolated page numbers or repeat on at least 60% of three or more
pages. The count removed is displayed; body text is kept. Users can edit text
before synthesis. See [AUDIO.md](AUDIO.md).

## pdf.js assets and platforms

`scripts/sync-pdfjs-assets.mjs` copies standard fonts and CJK tables from
`node_modules` into `public/pdfjs/` before development, build, and tests. No CDN
request is made and the directory is reproducible.

Windows and Fedora run the same JavaScript and libraries. Only saving and
revealing files use Tauri's platform dialogs/plugins, and the underlying WebView
is WebView2 or WebKitGTK. Browser development falls back to downloads and hides
native open buttons.
