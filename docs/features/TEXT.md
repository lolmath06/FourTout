# Text and documents

[English](TEXT.md) | [Français](../fr/features/TEXT.md)

[← Documentation](../README.md)

This page describes FourTout's text foundation, its organization, and the
promises it intentionally does not make.

## Immediate, local, backend-free processing

Text tools run synchronously in the WebView as pure functions under
`src/core/text/`. They use no native command, job, or progress stream. A task
large enough to require streaming belongs in the file tools instead.

```text
src/core/text/
├── clean.ts      # explicit cleanup options
├── lines.ts      # splitting, line endings, duplicates, sorting
├── replace.ts    # text and regular-expression replacement
├── diff.ts       # line- and word-level LCS comparison
├── markdown.ts   # Markdown to HTML
├── html.ts       # sanitization and HTML conversions
├── url.ts        # percent encoding
├── unicode.ts    # NFC, NFD, NFKC, NFKD
├── extract.ts    # URLs, email addresses, numbers
├── lorem.ts      # placeholder text
└── stats.ts      # counts, durations, readability
```

Except for `html.ts`, which needs `DOMParser`, these modules know nothing about
React or the DOM and can be tested directly.

## A shared interface shell

`src/components/text/TextToolShell.tsx` supplies the common UI used by the text
tools: input, `.txt`/`.md` drop, character/word/line counts, file opening,
examples, clearing, copying, downloading, and reusing output as input.

Tools can use stacked or side-by-side layouts and provide a custom `outputSlot`
for Markdown previews or diff tables. Input is capped at **8 MB** because a
`textarea` is not a large-file editor; refusing clearly is safer than freezing.

## HTML safety: never execute, always rebuild

User HTML—pasted, dropped, or extracted from DOCX—is never injected directly.

1. `DOMParser` parses it as `text/html` without loading resources or running
   scripts.
2. The result is rebuilt from explicit `ALLOWED_TAGS` and
   `ALLOWED_ATTRIBUTES` lists.
3. `script`, `style`, `iframe`, `object`, `embed`, `form`, form controls,
   `svg`, and `math` are removed together with their content.
4. No `on*` event attribute is allowed.
5. Unknown elements become their text content.
6. Link `href` accepts only HTTP(S), `mailto:`, anchors, or relative paths;
   image `src` accepts HTTP(S) or `data:image/…`.

`markdownToHtml` first escapes all raw HTML in Markdown, then builds its own
output. Previews still pass through `sanitizeHtml` as defense in depth.

## Cleanup never changes content implicitly

`cleanText` applies only selected options and always shows before/after counts.
The exact order is Unicode normalization → invisible characters → typography →
line operations → line endings.

Zero-width characters are removed, while non-breaking and thin spaces become
ordinary spaces. Converting French guillemets around a word to straight quotes
also removes their surrounding French spacing.

## Comparing two texts

The diff uses longest common subsequence (LCS) on lines, groups consecutive
deletions and additions as modifications, then refines them with word-level
LCS. Above four million cells—roughly 2,000 × 2,000 lines—it falls back to
position-by-position alignment and reports the limitation rather than freezing
the tab. Results support side-by-side, unified, and `.diff` export views.

## Statistics are documented estimates

- Silent reading: 200 words per minute; reading aloud: 130.
- Syllables are approximated by vowel groups.
- French uses Kandel and Moles readability; English uses Flesch Reading Ease.

The assumptions are displayed below the result. A readability score is a guide,
not a substitute for review.

## Documents

### TXT, Markdown, and HTML

The interface reads these directly. Markdown and HTML have sanitized previews
and cross-conversion through `markdown-convert`.

### DOCX

A `.docx` is a ZIP archive containing XML. FourTout reads it natively in
`src-tauri/src/files/docx.rs`, where ZIP support already exists and large files
do not need to cross the WebView boundary.

The extractor handles headings, paragraphs, lists, bold and italic runs, table
content, and core/application document properties. It explicitly does not
preserve images, columns, layout styles, headers, footers, or pagination. Its
purpose-built XML parser covers the regular Word structures involved without a
full XML dependency; table paragraphs are counted exactly once in document
order.

### DOCX to PDF: content, not page layout

`docx-to-pdf` combines the native DOCX reader with `documentToPdf`. Headings,
paragraphs, emphasis, lists, simple tables, and UTF-8 are preserved. Images,
columns, floating objects, headers/footers, document fonts, and original
pagination are not. Pixel-perfect Word rendering would require a full external
layout engine such as LibreOffice and conflict with the bundled-only promise.

The limitation is permanent and visible in the tool, catalog note, and result,
which reports omitted images. Tests read the generated DOCX natively, convert
the actual extracted Markdown, then reopen the PDF with pdf.js and verify pages,
headings, lists, tables, and accents.

## Line endings

`text-line-endings` detects LF, CRLF, CR, and mixed files, reports each count,
then converts. Detection always precedes conversion, explaining visible `^M`
characters in Windows-originated files.

## Deliberate limits

| Topic | Reason |
| --- | --- |
| Pixel-perfect Word rendering | It requires a full Word layout engine; FourTout preserves content and structure and states that limit. |
| Rich-text editing | FourTout transforms content; it is not an editor. |
| Legacy `.doc` files | The binary Word 97 format differs from `.docx`; only `.docx` is read. |

Technical formats such as JSON, YAML, XML, and SQL are covered in
[DEVELOPER.md](DEVELOPER.md).
