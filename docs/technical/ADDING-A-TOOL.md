# Adding a tool

[English](ADDING-A-TOOL.md) | [Français](../fr/technical/ADDING-A-TOOL.md)

[← Documentation](../README.md)

## Contents

- [Summary](#summary)
- [1. Declare the tool in the catalog](#1-declare-the-tool-in-the-catalog)
- [2. Write the business logic](#2-write-the-business-logic)
- [3. Build and connect the interface](#3-build-and-connect-the-interface)
- [Translate the tool](#translate-the-tool)
- [Add a category](#add-a-category)
- [Tests](#tests)

---

## Summary

A catalog-only tool requires **one changed file**. A working implementation
requires **three files**.

## 1. Declare the tool in the catalog

Open its category file under `src/core/tools/catalog/`, such as `pdf.ts`, and
add a definition:

```ts
{
  id: "pdf-compress",                     // kebab-case, globally unique
  name: "Compresser un PDF",              // French source message
  description: "Réduire le poids d'un PDF en gardant une qualité correcte.",
  category: "pdf",
  alsoIn: ["converters"],                 // optional: discoverable elsewhere
  icon: "Minimize2",                      // Lucide name; see below
  keywords: ["réduire la taille", "trop lourd", "alléger"],
  aliases: ["compress pdf", "reduce pdf size"],
  capabilities: ["local", "produces-files", "long-running"],
  acceptedInputs: [IN.pdf()],
  outputs: [OUT.pdf()],
  note: "Précision affichée sur la page de l'outil.", // optional limitation
}
```

> **Add this declaration only when the tool works.** Being in the catalog means
> being usable: there is no “coming soon” state, and a test fails if the catalog
> and implementation table diverge. Future work belongs in
> [ROADMAP.md](../../ROADMAP.md) or an issue, not in the interface.

Once all three files exist, the tool appears in its category, search results,
the home page, and its own route such as `/tools/t/pdf-compress`.

### Choosing `keywords` and `aliases`

These fields determine search quality and feed the intent resolver. Write what
a user would genuinely type, such as “my PDF is too large,” “PNG to JPG,” or
“remove GPS from a photo.” Add localized catalog metadata for every supported
language. `src/core/tools/search.test.ts` locks down important phrasings.

### Icons

`icon` is a [Lucide](https://lucide.dev) icon name. Icons are imported by name
in `src/components/ui/icons.ts` so the bundle contains only those in use. Add
the icon there if necessary; otherwise the fallback icon is displayed.

## 2. Write the business logic

Create a pure module without React or DOM dependencies under
`src/tools/logic/`:

```ts
// src/tools/logic/pdfCompress.ts
export async function compressPdf(file: File, options, ctx: JobContext) { … }
```

Unit tests target this module.

## 3. Build and connect the interface

Create the component under `src/tools/impl/`:

```tsx
// src/tools/impl/PdfCompressTool.tsx
export function PdfCompressTool({ tool }: ToolComponentProps) {
  const [files, setFiles] = useState<SelectedFile[]>([]);
  const job = useJob<Blob>();

  return (
    <FileDropZone constraints={constraintsForTool(tool)} files={files} onChange={setFiles} />
    // … then job.run(async (ctx) => compressPdf(files[0].file!, options, ctx))
  );
}
```

Register it in `src/tools/implementations.ts`:

```ts
"pdf-compress": lazy(() =>
  import("./impl/PdfCompressTool").then((m) => ({ default: m.PdfCompressTool })),
),
```

A test requires the catalog and implementation table to match **exactly**, so
neither side can be forgotten and an unfinished tool cannot be registered.

### What the tool page already provides

You do **not** need to implement the heading, icon, status badge, favorite
button, recent-tool tracking, category breadcrumb, or privacy reminder.
`ToolPage` provides them. Your component contains only the tool itself.

### Available building blocks

| Need | Use |
| --- | --- |
| Accept files | `FileDropZone` + `constraintsForTool(tool)` |
| Build a PDF tool | `PdfToolShell`; see [PDF](../features/PDF.md) |
| Build a batch image tool | `ImageToolShell` from `@/components/image`; see [Images](../features/IMAGES.md) |
| Process images | `processImage` / `processImages` from `@/core/image` |
| Image preview, including live | `ImagePreview`, `useSourceCanvas`, `useProcessedPreview` |
| OCR | `recognizeImages` from `@/core/ocr` |
| Process audio with FFmpeg | `runMedia` + `MediaToolShell`; see [Media](../features/MEDIA.md) |
| Build a video tool | `VideoToolShell` from `@/components/media`; see [Video](../features/VIDEO.md) |
| Discover codecs that really work | `mediaCapabilities()` from `@/core/media/capabilities` |
| Video player and visual selection | `VideoPreview`, `CropOverlay` from `@/components/media` |
| Long-running work that survives navigation | `startBackgroundJob` from `@/features/jobs/background` |
| Generate or read QR codes | `generateQrPng` / `decodeQr` from `@/core/image/qr` |
| Save results | `saveFile` / `saveFilesToFolder` from `@/core/output/save` |
| Component-scoped long operation | `useJob()` from `@/core/jobs` |
| User notification | `notify.success/error/warning/info/loading` |
| Buttons, badges, empty states | `@/components/ui/*` |
| Persistent setting | `appStore` from `@/core/storage` |

## Translate the tool

The source definition remains in French and is never duplicated. Add an entry
with the same `id` to every file under `src/i18n/catalog/<locale>.json`, with a
localized `name`, `description`, natural search `keywords`, `aliases`, and the
optional `note`.

Wrap interface text with `t("…")`, run `pnpm i18n:extract`, and translate every
new key in all 16 real locale catalogs under `src/i18n/messages/`. Then run
`pnpm i18n:status`: every locale must report 100%. See
[Internationalization](I18N.md).

## Add a category

1. Add its identifier to `CategoryId` in `src/core/tools/types.ts`.
2. Add its `CATEGORIES` entry in `src/core/tools/categories.ts`, including
   `name`, `description`, `icon`, `order`, `accent`, and `keywords`.
3. Add complete catalog translations for all supported locales.

The sidebar, Tools page, filters, and counters update automatically.

`accent` must be one of the shades defined by `[data-accent="…"]` in
`src/styles/app.css`. To add one, extend `AccentName` and both the light and
dark blocks in the stylesheet.

## Tests

```bash
pnpm test          # everything
pnpm test:watch    # during development
pnpm verify        # lint + types + tests + build, before finishing
```

At minimum, a new tool needs:

- a test for its pure logic under `src/tools/logic/`;
- a search assertion in `src/core/tools/search.test.ts` when wording matters;
- complete localized catalog and message entries for all 16 locales.

Test fixtures live in [`test-assets/`](../../test-assets/README.md). Regenerate
them with `pnpm test:assets` when needed.
