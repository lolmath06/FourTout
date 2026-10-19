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

**Tools** displays the thirteen categories. A tool relevant to several families
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
converter**. FourTout identifies its type **from its content, not only its name**, offers
only conversions that this machine can actually run, and opens the specialized
tool **already populated**. A `.jpg` that is really a PNG, an animated WebP, a
video with no sound, or an ISO image each get the right options, and the page
explains when something is not offered (for example, no FFmpeg).

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

Speech synthesis, transcription, background removal, and AI upscaling need models downloaded
on request. The Models page installs and removes them and displays size, source,
and license. See [Models](../technical/MODELS.md).

### Local data

FourTout retains preferences, favorites, recent-tool IDs, and the last exchange
rate table. This page can erase all of it.

## Privacy in one sentence

Processing stays on your device, except for the tools whose purpose is the
network: the **Internet & Web** tools (downloads, URL shortener, web capture),
the **speed test**, the ECB request made by the **currency converter**, initial
**model and yt-dlp downloads**, and local-network probes you explicitly start.
Each exception is identified in the interface, and none of them sends your files.
See [Privacy](../legal/PRIVACY.md).

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

### Internet & Web tools

These tools **do contact the network**, and say so on their page.

- **Download a file** resumes an interrupted download when the server allows it,
  checks an optional SHA-256, and never overwrites a file without asking.
- **Download online media** uses yt-dlp, installed from its official release page
  the first time you ask, and checked against the official checksum. It handles
  **public content only**: no DRM, no login, no cookies. Resolution choices never
  enlarge a video. Merging audio and video or converting to MP3 needs FFmpeg.
- **Shorten a URL** sends the address to the service you pick, which stores it.
  Do not shorten anything private.
- **Web page to PDF, image, or MHTML** needs Chrome, Chromium, Edge, or Brave
  already installed. The page loads in a throwaway profile, as an anonymous
  visitor: no cookies, no history.
- **Speed test** reports latency, jitter, download, and upload against
  Cloudflare's measurement service. Results vary with VPN, Wi-Fi, and other traffic.

More in [Internet & Web](../features/INTERNET.md).

### Create, inspect, and extract an ISO image

*Create* packs a folder into an ISO 9660 file with long names (Joliet and Rock
Ridge). It writes a regular `.iso` file and never touches a disk or USB drive;
the image is not bootable. A file of 4 GiB or more is refused. *Inspect* shows
the volume, file systems, tree, and boot information without extracting
anything. *Extract* copies all or only the checked entries; names inside the
image are treated as hostile and nothing is written outside the chosen folder.
See [ISO images](../features/ISO.md).

### Compress to a maximum size

Pick a video, audio file, image, or PDF and a target such as 25 MB. FourTout
computes a budget with a safety margin, retries lower if needed, and tells you
when the target is unrealistic. It never promises the size to the byte, and it
never enlarges an image.

### Enlarge an image with AI

Doubles or quadruples the resolution with a model that runs on your computer
(about 5 MB, downloaded once on request). It reconstructs plausible detail; it
cannot recover what the image never contained. A large photo at ×4 can take
minutes. See [Models](../technical/MODELS.md#ai-upscaling-model).

### Animated images

An animated WebP or APNG keeps its animation only in tools that handle it. If
you drop one into a still-image tool, FourTout warns that only the first frame
would be kept and offers **Convert an animated image** (GIF, APNG, animated
WebP, MP4, WebM, or a series of images).

## Problems

See [Troubleshooting](TROUBLESHOOTING.md).
