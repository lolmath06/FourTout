# Image and OCR architecture

[English](IMAGES.md) | [Français](../fr/features/IMAGES.md)

[← Documentation](../README.md)

Image tools cover conversion, compression, resize, crop, rotate/mirror,
grayscale, brightness/contrast/saturation/gamma, blur and pixelation,
transparency, text overlays, metadata, and OCR. Processing is local: images and
recognized text never leave the machine, and no system Tesseract installation
is required.

## Libraries

| Library | License | Role |
| --- | --- | --- |
| WebView canvas through `RasterBackend` | — | Bitmap decode, PNG/JPEG encode, and transforms |
| Rust `image` 0.25 | MIT | Reliable native WebP encoding |
| `tesseract.js` 6 and core | Apache-2.0 | Offline WebAssembly OCR worker |
| `@napi-rs/canvas` (development) | MIT | Node test backend and fixture generation |

## Image processing

`src/core/image/codec.ts` identifies formats by signature, limits decoding to
100 megapixels, applies EXIF orientation, and flattens transparency for JPEG.
`operations.ts` contains pure transforms that always return a new canvas.
`exif.ts` reads JPEG APP1, PNG `eXIf`, and WebP `EXIF` metadata including
orientation, camera, date, exposure, and GPS. `svg.ts` sanitizes SVG and reads
intrinsic size. `pipeline.ts` combines oriented decode, operation, encode,
naming, batch progress, and cancellation.

| Format | Read | Write |
| --- | --- | --- |
| PNG | Yes | Yes |
| JPEG | Yes | Yes |
| WebP | Yes | Yes |
| GIF | First frame | No |
| BMP, TIFF, SVG | Yes | No |
| AVIF, HEIC | WebView-dependent | No |

### WebP encoding

WebKitGTK can return PNG bytes from `canvas.toBlob(..., "image/webp")`, creating
a mislabeled file. In the desktop application, `encode_webp` uses Rust's
`image` crate to produce genuine lossless RIFF/VP8L bytes while preserving
alpha. Browser and Node contexts use their canvas backend only after checking
the returned signature. Tests inspect output independently rather than trusting
the extension.

### EXIF orientation and naming

Orientation is applied before dimensions or crop coordinates are shown, so
what users select matches output pixels. Exported pixels are upright and stale
orientation metadata is not copied. Output names preserve a safe base name and
append operation and collision suffixes without overwriting the source.

Large work is bounded by pixel count and batch jobs report progress and honor
cancellation between files. Canvas allocations are released after each item.

## OCR

Tesseract.js runs fully offline in a worker with locally packaged French and
English data. The same pipeline accepts one image or a batch, reports progress,
and returns text without uploading pixels. Language is selected explicitly;
quality depends on resolution, contrast, and source clarity. OCR for scanned
PDF pages uses the PDF rendering foundation before recognition.

## Batch processing and SVG safety

Batch conversion and resize reuse the single-image pipeline, naming rules, and
cancellation behavior. One failure is reported for its file without disguising
the status of other results.

SVG is untrusted active content. Before rasterization, scripts, event handlers,
foreign objects, external URLs, and unsafe references are removed. It is never
inserted as live user markup. Tests include hostile SVG payloads.

## Shared interface and finishing tools

Reusable drop, preview, dimension, crop, color, quality, result, and batch
components keep constraints consistent. Finishing tools include metadata view
and removal, image comparison, contact sheets, favicon creation, QR generation
and reading, watermarks, and color extraction. QR results are displayed but
never opened automatically. Video-to-GIF, GIF-to-video, and frame extraction
belong to the [media foundation](MEDIA.md).

## Known limits

- Export is limited to PNG, JPEG, and WebP.
- GIF decoding uses only the first frame.
- OCR ships French and English data and does not auto-detect language.
- AVIF/HEIC decoding depends on WebKitGTK or WebView2 support.
- Crop exports the exact displayed selection; aspect presets are resolved in
  display/source geometry.

Core tests cover formats, geometry, per-pixel operations, EXIF orientation,
SVG security, pipelines, naming, and cancellation. OCR tests include real
offline French, English, and batch recognition. Fixture tests validate the
generated images and metadata.

## Remove background (`image-remove-background`)

This learned-model tool differs from color-to-transparency, which removes a
specified color without understanding content.

### Model and runtime

U²-Net runs through ONNX Runtime Web (WebAssembly) in the WebView. It uses one
thread because multithreading requires `SharedArrayBuffer` origin isolation.
Runtime files are copied locally into `public/ort/`; no CDN is used.

Both `ort-wasm-simd-threaded.mjs` and its `.wasm` binary are required. FourTout
imports `onnxruntime-web/wasm`, supplies absolute URLs derived from the current
origin, and uses the 13.9 MB standard WASM runtime rather than the unused JSEP
variant. `assertRuntimeServed` checks content types to turn an SPA-fallback HTML
response into a useful error. Tests verify identical assets in `public/` and
`dist/` and serve the production build through the real SPA fallback.

U²-Net's code and weights are Apache-2.0. Alternatives with non-commercial
weight restrictions were rejected.

Two optional models are managed like speech assets:

| Item | File | Size | Purpose |
| --- | --- | --- | --- |
| `seg-u2netp` | `segmentation/u2netp.onnx` | 4.6 MB | Fast |
| `seg-u2net` | `segmentation/u2net.onnx` | 176 MB | Accurate |

### Processing

The input is resized to 320×320, normalized with ImageNet statistics, and
converted to planar RGB. The first of seven saliency outputs is min-max
normalized; a uniform output becomes fully opaque rather than erasing the
image. Optional separable smoothing costs linear rather than quadratic work.
The mask is bilinearly resampled to original dimensions and combined with the
existing alpha without changing colors. Output resolution is never reduced.

Real-model tests check retained resolution, meaningful transparency, opaque
subjects, transparent corners, re-readable PNG alpha, threshold ordering,
smoothing, cancellation, and rejection of unexpected output shapes. They skip
with installation guidance when models are absent.

The UI states the model's limits: it expects a principal subject and can fail
on ambiguous scenes, similar foreground/background colors, and fine detail.
