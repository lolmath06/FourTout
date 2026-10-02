# User guide

[English](USER_GUIDE.md) | [Français](../fr/guides/USER_GUIDE.md)

[← Documentation](../README.md)

FourTout is designed to work without a manual. This page covers the details
that are not immediately obvious.

## Finding a tool

### Describe what you want to do

The home page asks one question: **“What do you want to do?”** Answer in
ordinary language, in any of the 16 supported locales.

| You type | FourTout offers |
| --- | --- |
| `reduce the size of a pdf` | Compress a PDF |
| `gif to video` | GIF to video, not the reverse operation |
| `km to miles` | Converter — lengths |
| `my age` | Calculate an age |
| `remove metadata` | Remove metadata from a file |

Search understands direction: “GIF to video” and “video to GIF” do not return
the same first result. It **never invents a result**; when nothing matches, it
says so instead of suggesting an approximate tool.

### Browse

**Tools** displays the twelve categories. A tool relevant to several families
may appear in each without being duplicated: it has one implementation and is
discoverable wherever users are likely to look.

### Favorites and recent tools

The star on a tool page adds it to **Favorites**. Opening tools populates
**Recently used**. Both sections appear on the home page.

## Dropping files

Every tool accepts drag and drop from the system file manager. Clicking the
drop zone opens the usual file picker.

Some tools expect **two files at once**. Drop them together, for example a
video and an audio file for *Replace audio track*, or a video and `.srt` file
for subtitle tools.

### Universal converter

If you do not know which tool to use, drop the file into the **Universal
converter**. FourTout identifies its type, offers only conversions that are
actually implemented, and opens the specialized tool **already populated**.

The converter implements no operation itself. Its options are derived from
the inputs and outputs declared by registered tools, so every proposed
conversion has a working implementation behind it.

## Long-running operations

Video compression, OCR, and duplicate searches over large folders take time.

- Progress appears both inside the tool and in the task bar at the bottom of
  the window.
- You may **leave the page**; the operation continues and the app notifies you
  when it finishes.
- **Cancel** is real cancellation: the process stops, temporary files are
  removed, and a partial output is never presented as a result.

## Saving a result

Nothing is written to disk without your request. When processing finishes:

- **Save** opens the system location picker;
- **Open folder** reveals the produced file in the file manager.

Batch tools ask for a destination folder. **Existing files are never silently
overwritten**; a numbered suffix is added on collision.

Destructive tools such as batch rename, folder organization, and secure delete
require explicit confirmation. The most dangerous require typing an exact
confirmation phrase.

## Interface scale

| Action | Effect |
| --- | --- |
| `Ctrl` `+` | Increase by 10% |
| `Ctrl` `-` | Decrease by 10% |
| `Ctrl` `0` | Reset to 100% |
| `Ctrl` + mouse wheel | Adjust in 5% steps |

Scale ranges from **80% to 150%**, persists across restarts, and stays in sync
with Settings → Appearance. Command provides the equivalent shortcuts on macOS.

Scaling changes the window's layout rather than merely magnifying pixels, so
text remains sharp and visual tools such as image/video cropping, PDF editing,
and page reordering retain correct coordinates.

## Settings

### Appearance

| Setting | Values |
| --- | --- |
| **Theme** | System, Light, Dark |
| **Interface size** | 80% to 150% |
| **Density** | Compact (default) or Comfortable |
| **Animations** | Normal or Reduced |

*Reset interface preferences* restores these four defaults without touching
favorites, recent tools, or installed models.

### Language

Choose one of the 16 complete locales or **System**. System follows the first
supported operating-system language and reacts to system language changes. The
choice persists and applies immediately without changing the open tool.

### Privacy reminders

Tool pages show a local-processing reminder. You may hide it after reading it.

### Models

Speech synthesis, transcription, and background removal need models downloaded
on request. The Models page installs and removes them and displays size, source,
and license. See [Models](../technical/MODELS.md).

### Local data

FourTout retains preferences, favorites, recent-tool IDs, and the last exchange
rate table. This page can erase all of it.

## Privacy in one sentence

Processing stays on your device, except for the ECB request made by the
**currency converter**, initial **model downloads**, and local-network probes
you explicitly start. Each exception is identified in the interface. See
[Privacy](../legal/PRIVACY.md).

## Tools that deserve an explanation

### Redact a PDF

Selected content is **actually removed**, not merely covered by a black
rectangle. That is the difference between redaction and the appearance of
redaction. Always inspect the result because PDFs may contain data outside the
parts FourTout understands.

### Recover a PDF password

Tests likely passwords against a document you are authorized to access. This
is not exhaustive: a password absent from the corpus will not be found.

### Secure deletion

Overwrites current file content before deletion. On an SSD, memory card, or
copy-on-write file system, **no software can guarantee** that all earlier
physical copies disappear. The tool states this before acting.

### JWT — decode

Decoding displays claims. **Decoded does not mean verified**: without a key,
the signature's authenticity is unknown. FourTout never labels a merely
decoded token as valid. Use the separate verification operation when a key is
available.

### Word (DOCX) to PDF

Preserves content and structure — headings, paragraphs, emphasis, lists, and
simple tables — but not Word's layout engine. Columns, floating elements,
headers, footers, specific fonts, and images may differ or disappear. Export
from Word or LibreOffice when pixel fidelity matters.

### Remove background

Unlike *Make a color transparent*, this tool identifies a subject — person,
animal, or object — and makes the remainder transparent without describing the
image.

Install the model once under Settings → Models. Processing then stays local.
It works best with a distinct subject and may struggle when there is no clear
subject, foreground and background share colors, or isolated hair is very fine.
Edge feathering and threshold correction can refine small errors. Output is
**PNG**, the common format that preserves transparency.

### Currency converter

The result always shows the **date of the rate table**. Offline, FourTout
reuses and dates the last known table; without one, it displays no invented
number.

### Audio and video tools

These require FFmpeg. FourTout offers only formats and codecs that the FFmpeg
**installed on your machine** proves it can produce through a test encode. See
[Installation](INSTALLATION.md#ffmpeg-audio-and-video).

## Problems

See [Troubleshooting](TROUBLESHOOTING.md).
