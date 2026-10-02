# Universal converter

[English](CONVERTERS.md) | [Français](../fr/features/CONVERTERS.md)

[← Documentation](../README.md)

The universal converter is a **router**. It does not perform conversions
itself.

## The problem it solves

A user has a file and an intention (“I want to make a PDF from this”), but may
not know which category to search. The universal converter accepts the file,
identifies its format, and offers the operations that are actually possible.

## What it deliberately does not do

It does not reimplement image conversion, FFmpeg, PDF handling, or speech
synthesis. Duplicating those engines would guarantee two diverging behaviors
for the same conversion: one in the dedicated tool and one in the converter.
Every conversion therefore has a single code path.

## The graph is derived, not handwritten

`src/core/convert/graph.ts` builds its edges from the central **registry**. No
conversion table is maintained by hand.

An edge `from → to` exists if and only if a tool:

1. has the `available` status, meaning that it is actually wired up (a test
   checks this against `TOOL_IMPLEMENTATIONS`);
2. belongs to the Converters category, directly or through `alsoIn`;
3. accepts `from` in one of its `acceptedInputs`;
4. produces `to` in one of its `outputs` (`kind` is not `none`, and the
   extension is not `*`); and
5. has different source and target formats.

This has three direct consequences:

- making a tool available is enough to expose it in the converter;
- an edge exists only when its tool is registered and therefore implemented,
  so the graph cannot offer a conversion that cannot run;
- removing a tool removes its conversions without another edit.

If two tools produce the same target format, the first one in the catalog wins.
The catalog order places single-file tools before batch tools.

## Coverage examples

| Input | Offered outputs |
| --- | --- |
| PNG | JPEG, WebP, BMP, TIFF, and PDF |
| MP4 | WebM, MKV, MOV, AVI, GIF, MP3/WAV/FLAC, and PNG/JPG still images |
| PDF | PNG, JPG, TXT, MD, and speech-synthesized audio |
| TXT | PDF, HTML, MD, and audio |
| DOCX | TXT, MD, and HTML |
| MP3 | WAV, FLAC, OGG, Opus, M4A, and AAC |

`src/core/convert/graph.test.ts` locks down these mappings.

## Handing off to the specialized tool

Selecting a format does not open a duplicated conversion interface. It
**opens the specialized tool** with the file already loaded and the requested
format selected. Fine controls such as quality, codec, and resolution remain
available where they make sense.

The generic mechanism lives in `src/features/handoff/store.ts`:

```text
setHandoff({ toolId, files, preset }) → navigate(toolRoute(toolId))
                                      → useHandoff(toolId) in the tool
```

The handoff lives **outside React** in a singleton module, so it survives
navigation, and it is consumed **exactly once**. Returning to the tool later
does not reload a forgotten file.

| Consumer | Restored data |
| --- | --- |
| `PdfToolShell`, `ImageToolShell`, `MediaToolShell`, `VideoToolShell` | The dropped file |
| `ImageConvertTool` | `format` → PNG / JPEG / WebP |
| `AudioConvertTool` | `format` → one of the audio formats |
| `VideoConvertTool` | `format` → container, in custom mode |
| `TextCompareTool` | `left` / `right`, from “Compare two files” |

A tool that does not consume handoff data simply opens empty. The mechanism is
optional and never blocks a tool.

## Format detection

The converter uses the dropped file's extension and MIME type. To go further
and determine what a file **actually is**, independently of its name, the
*File information* tool reads the signature in its first bytes and reports
inconsistencies, such as a `photo.jpg` beginning with `%PDF-`.

## Deliberate limitation

The converter does not chain conversions. `DOCX → HTML → PDF` is not offered
as a one-click operation because chained conversions accumulate losses without
letting the user inspect the intermediate step. Both conversions remain
available separately, and the first result is visible before the second begins.
